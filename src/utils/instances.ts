import readline from "node:readline/promises";
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
const STAGEHAND_ACT_COMPAT_PATCHED = Symbol("stagehandActCompatPatched");

/**
 * For compatibility with Stagehand v3 which doesn't expose `stagehand.page`.
 * @param stagehand The Stagehand instance.
 * @returns Patched Stagehand instance with `page.goto` method for navigation backwards compatibility.
 */
function ensureStagehandNavigateCompatibility(stagehand: Stagehand): Stagehand {
	const stagehandWithCompat = stagehand as Stagehand & {
		page?: {
			goto: (url: string) => Promise<unknown>;
		};
	};

	if (!stagehandWithCompat.page) {
		Object.defineProperty(stagehandWithCompat, "page", {
			configurable: true,
			enumerable: false,
			get() {
				return {
					goto: async (url: string) => {
						const activePage = await stagehand.context.awaitActivePage();
						return activePage.goto(url);
					},
				};
			},
		});
	}

	return stagehand;
}

/**
 * For compatibility with older Stagehand integrations that call `stagehand.act({ action })`.
 * @param stagehand The Stagehand instance.
 * @returns Patched Stagehand instance with `act` accepting both string and object action shapes.
 */
function ensureStagehandActCompatibility(stagehand: Stagehand): Stagehand {
	type LegacyInstructionShape = {
		action?: string;
		instruction?: string;
		input?: string;
	};

	const stagehandWithCompat = stagehand as Stagehand & {
		[STAGEHAND_ACT_COMPAT_PATCHED]?: boolean;
	};
	const mutableStagehand = stagehandWithCompat as Stagehand & {
		[STAGEHAND_ACT_COMPAT_PATCHED]?: boolean;
	};

	if (mutableStagehand[STAGEHAND_ACT_COMPAT_PATCHED]) {
		return stagehand;
	}

	const originalAct = mutableStagehand.act.bind(mutableStagehand) as (
		instruction: unknown,
		options?: unknown,
	) => Promise<unknown>;

	const patchedAct = (async (instruction: unknown, options?: unknown) => {
		if (typeof instruction === "object" && instruction !== null) {
			const legacyInstruction = instruction as LegacyInstructionShape;
			const resolvedInstruction =
				typeof legacyInstruction.action === "string"
					? legacyInstruction.action
					: typeof legacyInstruction.instruction === "string"
						? legacyInstruction.instruction
						: typeof legacyInstruction.input === "string"
							? legacyInstruction.input
							: null;

			if (resolvedInstruction) {
				return originalAct(resolvedInstruction, options);
			}
		}

		return originalAct(instruction, options);
	}) as Stagehand["act"];

	mutableStagehand.act = patchedAct;

	mutableStagehand[STAGEHAND_ACT_COMPAT_PATCHED] = true;
	return stagehand;
}

function ensureStagehandCompatibility(stagehand: Stagehand): Stagehand {
	const withNavigateCompat = ensureStagehandNavigateCompatibility(stagehand);
	return ensureStagehandActCompatibility(withNavigateCompat);
}

export async function getStagehandInstance(): Promise<Stagehand> {
	if (stagehandInstance) {
		return ensureStagehandCompatibility(stagehandInstance);
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
				experimental: true,
			});
			await stagehand.init();
			const compatibleStagehand = ensureStagehandCompatibility(stagehand);
			stagehandInstance = compatibleStagehand;
			return compatibleStagehand;
		})();
	}

	return stagehandInitPromise;
}

export async function closeStagehandInstance() {
	if (stagehandInstance) {
		await stagehandInstance.close();
		stagehandInstance = null;
		stagehandInitPromise = null;
	}
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

let readlineInterfaceInstance: ReturnType<
	typeof readline.createInterface
> | null = null;
let readlineInterfaceInstancePromise: Promise<
	ReturnType<typeof readline.createInterface>
> | null = null;

export async function getReadlineInterfaceInstance() {
	if (readlineInterfaceInstance) {
		return readlineInterfaceInstance;
	}

	if (!readlineInterfaceInstancePromise) {
		readlineInterfaceInstancePromise = (async () => {
			const rl = readline.createInterface({
				input: process.stdin,
				output: process.stdout,
			});
			readlineInterfaceInstance = rl;
			return rl;
		})();
	}

	return readlineInterfaceInstancePromise;
}

export async function closeReadlineInterfaceInstance() {
	if (readlineInterfaceInstance) {
		await readlineInterfaceInstance.close();
		readlineInterfaceInstance = null;
		readlineInterfaceInstancePromise = null;
	}
}
