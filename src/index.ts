import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { InvalidArgumentError, program } from "commander";
import pino from "pino";
import z from "zod";
import { agent, buildSystemPromptFromFiles } from "./agent.js";
import {
	closeReadlineInterfaceInstance,
	closeStagehandInstance,
} from "./utils/instances.js";

export const logger = pino({
	level: "debug",
	transport: {
		target: "pino-pretty",
		options: {
			colorize: true,
		},
	},
});

function validatePath(value: string): string {
	try {
		const path = z.string().min(1).parse(value);
		if (!existsSync(path)) {
			throw new InvalidArgumentError(`File not found at path: ${path}`);
		}
		return path;
	} catch (err) {
		throw new InvalidArgumentError(
			`Invalid path: ${value}, ${err instanceof Error ? err.message : ""}`,
		);
	}
}

async function invokeAgent(input: AgentInput) {
	const { jobUrl, resumePath, extraPrompts: extraPromptsPath } = input;
	const applicationInfoContext = await buildSystemPromptFromFiles({
		resumePath,
		extraPromptsPath,
	});

	await agent.invoke(
		{
			messages: [
				{
					role: "user",
					content: `APPLICATION_INFO_CONTEXT:\n${applicationInfoContext}\n\nGo to this job URL and complete the application flow: ${jobUrl}`,
				},
			],
		},
		{
			recursionLimit: 500,
		},
	);
}

type AgentInput = {
	jobUrl: string;
	resumePath: string;
	extraPrompts?: string;
};

async function main() {
	try {
		program
			.requiredOption("--job-url <url>", "Job posting URL", (value) =>
				z.url().parse(value),
			)
			.requiredOption(
				"--resume-path <path>",
				"Path to resume PDF",
				validatePath,
			)
			.option(
				"--extra-prompts <path>",
				"Path to extra prompts file",
				validatePath,
			)
			.parse(process.argv);
		const cliOptions = program.opts<AgentInput>();
		await invokeAgent(cliOptions);
		// keep process alive
		await new Promise(() => {});
	} finally {
		await closeReadlineInterfaceInstance();
		await closeStagehandInstance();
	}
}

const isMainModule =
	process.argv[1] !== undefined &&
	fileURLToPath(import.meta.url) === process.argv[1];

if (isMainModule) {
	await main();
}
