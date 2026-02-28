import type { RunnableConfig } from "@langchain/core/runnables";
import { Command, END, type GraphNode, interrupt } from "@langchain/langgraph";
import { logger } from "../index.js";
import type { AgentStateType } from "../states/state.js";
import { getStagehandInstance } from "../utils/instances.js";
import type { NodeName } from "./node.types.js";

type SubmissionDecision =
	| string
	| {
			type?: string;
			action?: string;
			suggestions?: string[];
			message?: string;
			reviewSuggestions?: string[];
	  };

function parseDecision(decision: SubmissionDecision): {
	approved: boolean;
	reviewSuggestions: string[];
} {
	if (typeof decision === "string") {
		const normalized = decision.trim().toLowerCase();
		if (normalized === "approve") {
			return { approved: true, reviewSuggestions: [] };
		}

		const reviewSuggestions = decision
			.split(";")
			.map((suggestion) => suggestion.trim())
			.filter((suggestion) => suggestion.length > 0);
		return { approved: false, reviewSuggestions };
	}

	const action = decision.action?.trim().toLowerCase();
	if (action === "approve") {
		return { approved: true, reviewSuggestions: [] };
	}

	const reviewSuggestions = (decision.suggestions ?? [])
		.map((suggestion) => suggestion.trim())
		.filter((suggestion) => suggestion.length > 0);

	return {
		approved: false,
		reviewSuggestions,
	};
}

export const submitNode: GraphNode<
	AgentStateType,
	RunnableConfig,
	NodeName
> = async (state) => {
	await new Promise((resolve) => setTimeout(resolve, 1000));
	logger.info(
		"Ready to submit application. Waiting for user decision via interrupt.",
	);

	const decision = interrupt<SubmissionDecision>({
		type: "submission_approval",
		message:
			"Review the application and decide: approve submission, or provide modification suggestions.",
		reviewSuggestions: state.reviewSuggestions ?? [],
	});

	const { approved, reviewSuggestions } = parseDecision(decision);

	if (!approved) {
		if (reviewSuggestions.length === 0) {
			logger.info(
				"No approval or valid suggestions provided, defaulting to refilling form.",
			);
			return new Command({
				update: {
					reviewSuggestions: [
						"Please review and improve the form before submission.",
					],
				},
				goto: "FillFormNode",
			});
		}

		logger.info(
			{ reviewSuggestions },
			"User provided modification suggestions, routing back to FillFormNode",
		);

		return new Command({
			update: {
				reviewSuggestions,
			},
			goto: "FillFormNode",
		});
	}

	const stagehand = await getStagehandInstance();
	const submitResponse = await stagehand.act(
		"The user approved submission. Click the final submit button now and confirm submission status.",
	);
	logger.info({ submitResponse }, "Submission action completed in SubmitNode");

	return new Command({
		goto: END,
	});
};
