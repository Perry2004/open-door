import { readFile } from "node:fs/promises";
import type { RunnableConfig } from "@langchain/core/runnables";
import type { GraphNode } from "@langchain/langgraph";
import { PDFParse } from "pdf-parse";
import type { AgentStateType } from "../states/state.js";
import type { NodeName } from "./node.types.js";

export const prepareResourceNode: GraphNode<
	AgentStateType,
	RunnableConfig,
	NodeName
> = async (state) => {
	const resumePath = state.resumePath;
	const extraPromptsPath = state.extraPromptsPath;

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
