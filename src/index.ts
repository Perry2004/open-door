import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { Stagehand } from "@browserbasehq/stagehand";
import { InvalidArgumentError, program } from "commander";
import dotenv from "dotenv";
import { PDFParse } from "pdf-parse";
import pino from "pino";
import { z } from "zod";

dotenv.config({ path: ".env" });

const logger = pino({
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

program
	.requiredOption("--job-url <url>", "Job posting URL", (value) =>
		z.url().parse(value),
	)
	.requiredOption("--resume-path <path>", "Path to resume PDF", validatePath)
	.option("--extra-prompts <path>", "Path to extra prompts file", validatePath)
	.parse(process.argv);

const cliOptions = program.opts<{
	jobUrl: string;
	resumePath: string;
	extraPromptsPath?: string;
}>();

const envVars = z
	.object({
		AI_API_KEY: z.string(),
		MODEL_NAME: z.string(),
	})
	.parse(process.env);

async function parseResume(filePath: string): Promise<string> {
	const parser = new PDFParse({
		url: filePath,
	});
	const result = await parser.getText();
	return result.text;
}

async function askForApproval(promptText: string): Promise<boolean> {
	const rl = createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	try {
		const answer = (await rl.question(promptText)).trim().toLowerCase();
		return answer === "y" || answer === "yes";
	} finally {
		rl.close();
	}
}

async function main() {
	const stagehand = new Stagehand({
		env: "LOCAL",
		model: {
			modelName: envVars.MODEL_NAME,
			apiKey: envVars.AI_API_KEY,
		},
		localBrowserLaunchOptions: {
			headless: false,
		},
	});

	await stagehand.init();
	logger.info("OpenDoor Stagehand Session Started");

	const page = stagehand.context.pages()[0];
	if (!page) {
		logger.error("No page found in the context.");
		throw new Error("No page found in the context.");
	}

	await page.goto(cliOptions.jobUrl);

	const agent = stagehand.agent({
		mode: "hybrid",
		model: {
			modelName: envVars.MODEL_NAME,
			apiKey: envVars.AI_API_KEY,
		},
		systemPrompt:
			"You're a helpful assistant that can control a web browser. I need you to help me submit co-op job applications.",
	});

	const resumeText = await parseResume(cliOptions.resumePath);
	logger.debug({ resumeText }, "Parsed resume text");

	const extraPrompts = cliOptions.extraPromptsPath
		? await readFile(cliOptions.extraPromptsPath, "utf-8")
		: null;

	const fillResult = await agent.execute({
		instruction: `
			Please fill out the application form on this page based on the information and resources I provided.
			\n\n
			Here is my resume:
			${resumeText}
			${extraPrompts ? `\n\nAdditional instructions:\n${extraPrompts}` : ""}
			\n\n
			DO NOT CLICK THE SUBMIT BUTTON.
		`,
		highlightCursor: true,
	});
	logger.debug({ fillResult }, "Fill result");

	logger.debug("Form filled. Starting validation...");

	const validationResult = await agent.execute({
		instruction: `
			Validate the filled form.

			1. Review all required fields and confirm they are filled.
			2. Check for visible validation errors or warnings.
			3. Return a concise summary of what was validated and any fixes you applied.
			4. Ensure the fields are filled according to the resume ${resumeText} ${extraPrompts ? `and the additional instructions ${extraPrompts}` : ""}.

			DO NOT CLICK THE FINAL SUBMIT BUTTON.
		`,
		highlightCursor: true,
	});
	logger.info({ validationResult }, "Validation result");

	// wait a moment before asking for approval to ensure all browser logging is complete
	await new Promise((resolve) => setTimeout(resolve, 1000));
	const approved = await askForApproval("Form validated. Submit now? (y/N): ");

	if (!approved) {
		logger.info("Submission cancelled by user. Browser session remains open.");
		await new Promise(() => {});
		return;
	}

	const submitResult = await agent.execute({
		instruction:
			"The user approved submission. Click the final submit button now and confirm submission status.",
		highlightCursor: true,
	});
	logger.info({ submitResult }, "Submit result");

	// await stagehand.close();
	await new Promise(() => {});
}

main().catch((err) => {
	logger.error({ err }, "Unhandled error");
	process.exit(1);
});
