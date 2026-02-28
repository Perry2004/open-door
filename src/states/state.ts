import { MessagesValue, StateSchema } from "@langchain/langgraph";
import z from "zod";

export const reviewSuggestionsSchema = z
	.array(z.string())
	.describe("A list of review suggestions for modifying the application.");

export const fillContextSchema = z
	.object({
		attemptCount: z.number().int().nonnegative().default(0),
		missingInformation: z.array(z.string()).default([]),
		lastCompletionNote: z.string().optional(),
	})
	.describe(
		"Persisted fill-form context to help resumed runs continue without rediscovering the whole form.",
	);

export const stateSchema = new StateSchema({
	messages: MessagesValue,
	jobUrl: z.url(),
	resumePath: z.string(),
	resumeText: z.string().optional(),
	extraPromptsPath: z.string().optional(),
	extraPrompts: z.string().optional(),
	fillStatus: z
		.object({
			success: z.boolean(),
			message: z.string(),
			completed: z.boolean(),
		})
		.optional(),
	reviewSuggestions: reviewSuggestionsSchema.optional(),
	fillContext: fillContextSchema.optional(),
});

export type AgentStateType = typeof stateSchema.State;
export type AgentStateUpdateType = typeof stateSchema.Update;
