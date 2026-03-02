import { tool } from "@langchain/core/tools";
import z from "zod";
import {
	getReadlineInterfaceInstance,
	getStagehandInstance,
} from "../utils/instances.js";

const confirmSubmitInputSchema = z.object({});

export const confirmSubmitTool = tool(
	async () => {
		const readlineInterface = await getReadlineInterfaceInstance();
		const prompt =
			"Final submission is ready. Submit the application now? (yes/no)";
		const answer = await readlineInterface.question(`\n${prompt}\n> `);
		const normalized = answer.trim().toLowerCase();

		if (normalized === "yes") {
			const stagehand = await getStagehandInstance();

			try {
				const actResult = await stagehand.act(
					"Click the final submit button to submit this job application.",
				);

				if (!actResult.success) {
					return `Submission confirmed by user, but submit action failed. Feedback: ${actResult.message}`;
				}

				return "Submission confirmed by user and submit button clicked.";
			} catch (error) {
				const feedback = error instanceof Error ? error.message : String(error);
				return `Submission confirmed by user, but submit action failed. Feedback: ${feedback}`;
			}
		}

		return `Submission not confirmed by user. Treat as rejected and modify application based on this user input: ${answer}`;
	},
	{
		name: "confirm_submit",
		description:
			"Use only when all application steps are complete and the final submit button is ready. If user answers 'yes', clicks submit via Stagehand act. Any other user input is treated as no and returned for agent-side modification.",
		schema: confirmSubmitInputSchema,
	},
);
