import type { RunnableConfig } from "@langchain/core/runnables";
import type { GraphNode } from "@langchain/langgraph";
import { logger } from "../index.js";
import type { AgentStateType } from "../states/state.js";
import { envVars } from "../utils/env.js";
import { getStagehandInstance } from "../utils/instances.js";
import type { NodeName } from "./node.types.js";

export const fillFormNode: GraphNode<
	AgentStateType,
	RunnableConfig,
	NodeName
> = async (state) => {
	const stagehand = await getStagehandInstance();
	const { resumeText, extraPrompts, reviewSuggestions } = state;

	const page = stagehand.context.pages()[0];
	if (!page) {
		logger.error("No page found in the context.");
		throw new Error("No page found in the context.");
	}

	if (!state.fillStatus) {
		await page.goto(state.jobUrl);
	}

	const agent = stagehand.agent({
		mode: "hybrid",
		model: {
			modelName: envVars.MODEL_NAME,
			apiKey: envVars.AI_API_KEY,
		},
		systemPrompt:
			"You're a helpful assistant that can control a web browser. I need you to help me submit co-op job applications.",
	});

	const fillResponse = await agent.execute({
		instruction: `
    			Please fill out the application form on this page based on the information and resources I provided.
    			\n\n
    			Here is my resume:
    			${resumeText}
    			${extraPrompts ? `\n\nAdditional instructions:\n${extraPrompts}` : ""}
          ${
						reviewSuggestions && reviewSuggestions.length > 0
							? `\n\nPlease revise the current application using these review suggestions:
                ${reviewSuggestions.map((suggestion, index) => `${index + 1}. ${suggestion}`).join("\n")}`
							: ""
					}
    			\n\n
    			DO NOT CLICK THE SUBMIT BUTTON.
    		`,
		highlightCursor: true,
	});

	const { success, message, completed } = fillResponse;

	return {
		fillStatus: {
			success,
			message,
			completed,
		},
	};
};
