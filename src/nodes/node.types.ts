import type { END, START } from "@langchain/langgraph";

export type NodeName =
		| "FillFormNode"
		| "HandleAccountNode"
		| "PrepareResourceNode"
		| "SubmitNode"
		| typeof START
		| typeof END;
