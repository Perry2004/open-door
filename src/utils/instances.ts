import { Stagehand } from "@browserbasehq/stagehand";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { initChatModel } from "langchain";
import { envVars } from "./env.js";

function normalizeGoogleModelName(modelName: string): string {
	return modelName.startsWith("google/")
		? modelName.slice("google/".length)
		: modelName;
}

let stagehandInstance: Stagehand | null = null;
let stagehandInitPromise: Promise<Stagehand> | null = null;

export async function getStagehandInstance(): Promise<Stagehand> {
	if (stagehandInstance) {
		return stagehandInstance;
	}

	if (!stagehandInitPromise) {
		stagehandInitPromise = (async () => {
			const stagehand = new Stagehand({
				env: "LOCAL",
				model: {
					modelName: envVars.MODEL_NAME,
					apiKey: envVars.AI_API_KEY,
					temperature: 0,
				},
				localBrowserLaunchOptions: {
					headless: false,
				},
			});
			await stagehand.init();
			stagehandInstance = stagehand;
			return stagehand;
		})();
	}

	return stagehandInitPromise;
}

let modelInstance: BaseChatModel | null = null;
let modelInitPromise: Promise<BaseChatModel> | null = null;

export async function getModelInstance(): Promise<BaseChatModel> {
	if (modelInstance) {
		return modelInstance;
	}

	if (!modelInitPromise) {
		modelInitPromise = (async () => {
			try {
				const model = await initChatModel(
					normalizeGoogleModelName(envVars.MODEL_NAME),
					{
						apiKey: envVars.AI_API_KEY,
						temperature: 0,
						modelProvider: "google-genai",
					},
				);
				modelInstance = model;
				return model;
			} catch (error) {
				modelInitPromise = null;
				throw error;
			}
		})();
	}

	return modelInitPromise;
}
