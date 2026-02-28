import type { END, START } from "@langchain/langgraph";

export type NodeName =
	| "FillFormNode"
	| "PrepareResourceNode"
	| "SubmitNode"
	| typeof START
	| typeof END;
