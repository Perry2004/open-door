import { END, MemorySaver, START, StateGraph } from "@langchain/langgraph";
import { fillFormNode } from "./nodes/fill-form.node.js";
import { handleAccountNode } from "./nodes/handle-account.node.js";
import { prepareResourceNode } from "./nodes/prepare-resource.node.js";
import { submitNode } from "./nodes/submit.node.js";
import { stateSchema } from "./states/state.js";

export const agent = new StateGraph(stateSchema)
	.addNode("PrepareResourceNode", prepareResourceNode)
	.addNode("HandleAccountNode", handleAccountNode)
	.addNode("FillFormNode", fillFormNode)
	.addNode("SubmitNode", submitNode, {
		ends: [END, "FillFormNode"],
	})
	.addEdge(START, "PrepareResourceNode")
	.addEdge("PrepareResourceNode", "HandleAccountNode")
	.addEdge("HandleAccountNode", "FillFormNode")
	.addEdge("FillFormNode", "SubmitNode")
	.compile({
		checkpointer: new MemorySaver(),
	});
