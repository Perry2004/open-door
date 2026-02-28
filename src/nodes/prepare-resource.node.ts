import { readFile } from "node:fs/promises";
import type { RunnableConfig } from "@langchain/core/runnables";
import type { GraphNode } from "@langchain/langgraph";
import { PDFParse } from "pdf-parse";
import { logger } from "../index.js";
import type { AgentStateType } from "../states/state.js";
import { getModelInstance } from "../utils/instances.js";
import type { NodeName } from "./node.types.js";

export const prepareResourceNode: GraphNode<
	AgentStateType,
	RunnableConfig,
	NodeName
> = async (state) => {
	const resumePath = state.resumePath;
	const extraPromptsPath = state.extraPromptsPath;

	// [DEBUG]
	const model = await getModelInstance();
	logger.debug(await model.invoke("What is the capital of Japan?"));

	const parser = new PDFParse({
		url: resumePath,
	});
	const resumeText = (await parser.getText()).text;

	const extraPrompts = extraPromptsPath
		? await readFile(extraPromptsPath, "utf-8")
		: undefined;

	return {
		resumeText,
		extraPrompts,
	};
};
