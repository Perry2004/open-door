import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createAgent, todoListMiddleware } from "langchain";
import { PDFParse } from "pdf-parse";
import { askUserTool } from "./tools/askUser.tool.js";
import { confirmSubmitTool } from "./tools/confirmSubmit.tool.js";
import { stagehandToolkit } from "./tools/stagehand.tools.js";
import { uploadLocalFileTool } from "./tools/uploadLocalFile.tool.js";
import { getModelInstance } from "./utils/instances.js";

const model = await getModelInstance();

const BASE_SYSTEM_PROMPT = `
	You are an autonomous job application assistant that have control to a browser.
	Use the provided application info context as the source of truth when filling forms.
	You may call multiple tools in one turn to fill section-by-section to save time.
	Use the upload_local_file tool when a form requires uploading local documents like resume or cover letter.
	When required information is missing or you're not confident about the answer, call the ask_user_clarification tool instead of guessing.
	Before final submission, once all steps are complete and the final submit button is ready, call the confirm_submit tool.
	DO NOT CLICK THE FINAL SUBMIT BUTTON YOURSELF! USE THE confirm_submit TOOL!
`;

type SystemPromptInput = {
	resumePath: string;
	extraPromptsPath?: string;
};

async function loadResumeText(resumePath: string): Promise<string> {
	const pdfBuffer = await readFile(resumePath);
	const parser = new PDFParse({ data: pdfBuffer });
	const parsed = await parser.getText();
	await parser.destroy();
	const resumeText = parsed.text.trim();

	if (!resumeText) {
		throw new Error(`Resume PDF contains no extractable text: ${resumePath}`);
	}

	return resumeText;
}

async function loadExtraPromptsText(
	extraPromptsPath?: string,
): Promise<string | null> {
	if (!extraPromptsPath) {
		return null;
	}

	const extraPromptsText = (await readFile(extraPromptsPath, "utf-8")).trim();
	return extraPromptsText.length > 0 ? extraPromptsText : null;
}

export async function buildSystemPromptFromFiles(
	input: SystemPromptInput,
): Promise<string> {
	const { resumePath, extraPromptsPath } = input;
	const resolvedResumePath = resolve(resumePath);
	const [resumeText, extraPromptsText] = await Promise.all([
		loadResumeText(resumePath),
		loadExtraPromptsText(extraPromptsPath),
	]);

	return [
		"RESUME_FILE_PATH:",
		resolvedResumePath,
		"",
		"RESUME_CONTEXT:",
		resumeText,
		extraPromptsText ? "" : null,
		extraPromptsText ? "EXTRA_INSTRUCTIONS:" : null,
		extraPromptsText,
	]
		.filter((section): section is string => Boolean(section))
		.join("\n");
}

export const agent = createAgent({
	model,
	systemPrompt: BASE_SYSTEM_PROMPT,
	middleware: [todoListMiddleware()],
	tools: [
		askUserTool,
		uploadLocalFileTool,
		confirmSubmitTool,
		...stagehandToolkit.getTools(),
	],
});
