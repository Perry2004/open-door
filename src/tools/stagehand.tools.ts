import { StagehandToolkit } from "@langchain/community/agents/toolkits/stagehand";
import { getStagehandInstance } from "../utils/instances.js";

export const stagehandToolkit = await StagehandToolkit.fromStagehand(
	await getStagehandInstance(),
);
