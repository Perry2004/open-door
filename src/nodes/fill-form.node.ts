import type { RunnableConfig } from "@langchain/core/runnables";
import { type GraphNode, interrupt } from "@langchain/langgraph";
import z from "zod";
import { logger } from "../index.js";
import type { AgentStateType } from "../states/state.js";
import { createUploadResumeTool } from "../tools/upload-resume.tool.js";
import { envVars } from "../utils/env.js";
import { getStagehandInstance } from "../utils/instances.js";
import type { NodeName } from "./node.types.js";

const fillExecutionOutputSchema = z.object({
	needsMoreInformation: z
		.boolean()
		.describe("Whether additional applicant details are required to continue."),
	missingInformation: z
		.array(z.string())
		.default([])
		.describe("List of missing fields/details needed to proceed."),
	completionNote: z
		.string()
		.optional()
		.describe("Short note about what was filled or what blocked completion."),
});

type FillExecutionOutput = z.infer<typeof fillExecutionOutputSchema>;
const initializedPages = new WeakSet<object>();

type MissingInfoInterruptDecision =
	| string
	| {
			type?: string;
			additionalInformation?: string;
			message?: string;
			reason?: string;
	  };

function normalizeAdditionalInformation(
	decision: MissingInfoInterruptDecision,
): string {
	if (typeof decision === "string") {
		return decision.trim();
	}

	return (
		decision.additionalInformation?.trim() ?? decision.message?.trim() ?? ""
	);
}

function shouldRequestMoreInformation(
	fillResponse: { success?: boolean; completed?: boolean },
	structuredOutput: FillExecutionOutput,
): boolean {
	if (structuredOutput.needsMoreInformation) {
		return true;
	}

	if (fillResponse.completed) {
		return false;
	}

	return fillResponse.success === false;
}

function extractStructuredOutput(fillResponse: unknown): FillExecutionOutput {
	const maybeResponse = fillResponse as {
		output?: unknown;
		result?: unknown;
	};

	const candidates = [maybeResponse.output, maybeResponse.result, fillResponse];
	for (const candidate of candidates) {
		const parsed = fillExecutionOutputSchema.safeParse(candidate);
		if (parsed.success) {
			return parsed.data;
		}
	}

	return {
		needsMoreInformation: false,
		missingInformation: [],
	};
}

function mergeExtraPrompts(
	existingExtraPrompts: string | undefined,
	additionalInformation: string,
): string {
	const trimmedExisting = existingExtraPrompts?.trim() ?? "";
	const trimmedAdditional = additionalInformation.trim();

	if (!trimmedExisting) {
		return `Additional applicant information:\n${trimmedAdditional}`;
	}

	return `${trimmedExisting}\n\nAdditional applicant information:\n${trimmedAdditional}`;
}

export const fillFormNode: GraphNode<
	AgentStateType,
	RunnableConfig,
	NodeName
> = async (state) => {
	const stagehand = await getStagehandInstance();
	const { resumeText, reviewSuggestions } = state;
	let effectiveExtraPrompts = state.extraPrompts;
	let effectiveFillContext = state.fillContext;

	const page = stagehand.context.pages()[0];
	if (!page) {
		logger.error("No page found in the context.");
		throw new Error("No page found in the context.");
	}

	if (!initializedPages.has(page)) {
		logger.info(
			{ currentPageUrl: page.url(), jobUrl: state.jobUrl },
			"Navigating to job application page",
		);
		await page.goto(state.jobUrl);
		initializedPages.add(page);
	}

	const agent = stagehand.agent({
		mode: "hybrid",
		model: {
			modelName: envVars.MODEL_NAME,
			apiKey: envVars.AI_API_KEY,
		},
		tools: {
			uploadResume: createUploadResumeTool({
				page,
				defaultResumePath: state.resumePath,
			}),
		},
		systemPrompt:
			"You're a helpful assistant that can control a web browser. I need you to help me submit co-op job applications.",
	});

	for (let attempt = 0; attempt < 3; attempt += 1) {
		const resumedMissingInformation =
			effectiveFillContext?.missingInformation
				?.map((detail) => detail.trim())
				.filter((detail) => detail.length > 0) ?? [];

		const fillResponse = await agent.execute({
			instruction: `
		    		Please fill out the application form on this website based on the information and resources I provided.
		    		If the form includes a resume/CV upload input, use the uploadResume tool to attach my resume file before continuing.
		    		${resumedMissingInformation.length > 0 ? `\n\nThis is a resumed run. Continue from the current form state and focus only on unresolved required fields: ${resumedMissingInformation.join("; ")}. Do not re-process fields that are already filled unless they are clearly incorrect.` : ""}
		    		\n\n
		    		Here is my resume:
		    		${resumeText}
		    		${effectiveExtraPrompts ? `\n\nAdditional instructions:\n${effectiveExtraPrompts}` : ""}
          ${
						reviewSuggestions && reviewSuggestions.length > 0
							? `\n\nPlease revise the current application using these review suggestions:
                ${reviewSuggestions.map((suggestion, index) => `${index + 1}. ${suggestion}`).join("\n")}`
							: ""
					}
		    		\n\n
					You may fill multiple fields in one go if you can confidently determine their values, but only fill fields for which you have high confidence based on the provided information.
					There may be multiple pages or sections in the application. Ensure you have checked all of them.
		    		Return structured output that strictly matches the requested schema.
		    		Set needsMoreInformation=true whenever any required form field cannot be confidently completed with available data.
		    		When needsMoreInformation=true, list every missing field/detail in missingInformation.
		    		DO NOT CLICK THE SUBMIT BUTTON.
		    	`,
			highlightCursor: true,
			output: fillExecutionOutputSchema,
		});

		const structuredOutput = extractStructuredOutput(fillResponse);
		const { success, message, completed } = fillResponse;
		effectiveFillContext = {
			attemptCount: (effectiveFillContext?.attemptCount ?? 0) + 1,
			missingInformation: structuredOutput.missingInformation,
			lastCompletionNote: structuredOutput.completionNote,
		};

		const needsMoreInformation = shouldRequestMoreInformation(
			{ success, completed },
			structuredOutput,
		);

		if (!needsMoreInformation || attempt === 2) {
			return {
				fillStatus: {
					success,
					message,
					completed,
				},
				extraPrompts: effectiveExtraPrompts,
				fillContext: effectiveFillContext,
			};
		}

		logger.info(
			{ message, missingInformation: structuredOutput.missingInformation },
			"Fill form needs more applicant information. Requesting user input via interrupt.",
		);

		const missingDetails = structuredOutput.missingInformation
			.map((detail) => detail.trim())
			.filter((detail) => detail.length > 0);
		const reason =
			missingDetails.length > 0
				? `Missing required information: ${missingDetails.join("; ")}`
				: message;

		const decision = interrupt<MissingInfoInterruptDecision>({
			type: "missing_application_information",
			message:
				"More applicant information is required to continue this application. Provide the missing details (single line or semicolon-separated).",
			reason,
		});

		const additionalInformation = normalizeAdditionalInformation(decision);
		if (!additionalInformation) {
			return {
				fillStatus: {
					success: false,
					message:
						"Application requires more information, but no additional details were provided.",
					completed: false,
				},
				extraPrompts: effectiveExtraPrompts,
				fillContext: effectiveFillContext,
			};
		}

		effectiveExtraPrompts = mergeExtraPrompts(
			effectiveExtraPrompts,
			additionalInformation,
		);
	}

	return {
		fillStatus: {
			success: false,
			message: "Unable to complete form filling after repeated attempts.",
			completed: false,
		},
		extraPrompts: effectiveExtraPrompts,
		fillContext: effectiveFillContext,
	};
};
