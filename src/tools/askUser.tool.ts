import { stdout } from "node:process";
import { tool } from "@langchain/core/tools";
import z from "zod";
import { getReadlineInterfaceInstance } from "../utils/instances.js";

const askUserInputSchema = z.object({
	question: z
		.string()
		.min(1)
		.describe("The specific clarification question to ask the user."),
});

export const askUserTool = tool(
	async ({ question }) => {
		const readlineInterface = await getReadlineInterfaceInstance();

		while (true) {
			const answer = (
				await readlineInterface.question(
					`\nClarification needed: ${question}\n> `,
				)
			).trim();

			if (answer.length > 0) {
				return answer;
			}

			stdout.write("Please enter a response before continuing.\n");
		}
	},
	{
		name: "ask_user_clarification",
		description:
			"Ask the human user a clarification question when required information is missing. Do not use this tool for asking user confirmation about final submission, use the confirm_submit tool instead.",
		schema: askUserInputSchema,
	},
);
