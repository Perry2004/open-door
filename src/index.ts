import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { Command } from "@langchain/langgraph";
import { InvalidArgumentError, program } from "commander";
import dotenv from "dotenv";
import pino from "pino";
import z from "zod";
import { agent } from "./agent.js";

dotenv.config({ path: ".env" });

export const logger = pino({
	level: "debug",
	transport: {
		target: "pino-pretty",
		options: {
			colorize: true,
		},
	},
});

type InterruptPayload = {
	value?: {
		type?: string;
		message?: string;
		reason?: string;
		reviewSuggestions?: string[];
	};
};

function getInterruptPayload(result: unknown): InterruptPayload | undefined {
	if (!result || typeof result !== "object") {
		return undefined;
	}

	const maybeInterrupt = (result as { __interrupt__?: unknown }).__interrupt__;
	if (!Array.isArray(maybeInterrupt) || maybeInterrupt.length === 0) {
		return undefined;
	}

	const firstInterrupt = maybeInterrupt[0];
	if (!firstInterrupt || typeof firstInterrupt !== "object") {
		return undefined;
	}

	return firstInterrupt as InterruptPayload;
}

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

async function main() {
	program
		.requiredOption("--job-url <url>", "Job posting URL", (value) =>
			z.url().parse(value),
		)
		.requiredOption("--resume-path <path>", "Path to resume PDF", validatePath)
		.option(
			"--extra-prompts <path>",
			"Path to extra prompts file",
			validatePath,
		)
		.parse(process.argv);

	const cliOptions = program.opts<{
		jobUrl: string;
		resumePath: string;
		extraPromptsPath?: string;
	}>();

	const config = {
		configurable: {
			thread_id: randomUUID(),
		},
	};

	const rl = createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	let result = await agent.invoke(
		{
			jobUrl: cliOptions.jobUrl,
			resumePath: cliOptions.resumePath,
			extraPromptsPath: cliOptions.extraPromptsPath,
		},
		config,
	);

	try {
		while (true) {
			const interruptPayload = getInterruptPayload(result);
			if (!interruptPayload) {
				break;
			}

      await new Promise((resolve) => setTimeout(resolve, 1000));

			const interruptValue = interruptPayload.value;
			const interruptType = interruptValue?.type;
			let resumeValue: Record<string, unknown>;

			if (interruptType === "missing_application_information") {
				if (interruptValue?.reason) {
					logger.info(
						{ reason: interruptValue.reason },
						"Fill form interruption reason",
					);
				}

				const message =
					interruptValue?.message ??
					"The application form needs more information. Provide missing details to continue.";
				const answer = (await rl.question(`${message}\n> `)).trim();

				resumeValue = {
					type: "provide_information",
					additionalInformation: answer,
				};
			} else {
				const message =
					interruptValue?.message ??
					"Review submission: type 'approve' to submit, or provide modification suggestions separated by ';'.";

				if (interruptValue?.reviewSuggestions?.length) {
					logger.info(
						{ reviewSuggestions: interruptValue.reviewSuggestions },
						"Review suggestions from interrupt",
					);
				}

				const answer = (await rl.question(`${message}\n> `)).trim();
				resumeValue =
					answer.toLowerCase() === "approve"
						? { action: "approve" }
						: {
								action: "modify",
								suggestions: answer
									.split(";")
									.map((suggestion) => suggestion.trim())
									.filter((suggestion) => suggestion.length > 0),
							};
			}

			result = await agent.invoke(new Command({ resume: resumeValue }), config);
		}
	} finally {
		rl.close();
	}

	await new Promise(() => {});
}

const isMainModule =
	process.argv[1] !== undefined &&
	fileURLToPath(import.meta.url) === process.argv[1];

if (isMainModule) {
	await main();
}
