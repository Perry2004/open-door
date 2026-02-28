import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { tool } from "@browserbasehq/stagehand";
import z from "zod";
import { logger } from "../index.js";

type FileInputLocator = {
	count: () => Promise<number>;
	setInputFiles: (files: string | string[]) => Promise<void>;
};

type StagehandPageLike = {
	url: () => string;
	locator: (selector: string) => {
		first: () => FileInputLocator;
	};
};

type UploadResumeToolOptions = {
	page: StagehandPageLike;
	defaultResumePath: string;
};

const uploadResumeInputSchema = z.object({
	selector: z
		.string()
		.describe(
			"CSS selector for the file input element that should receive the resume file.",
		),
	filePath: z
		.string()
		.optional()
		.describe(
			"Optional file path override. If omitted, the default resume path is used.",
		),
	timeoutMs: z
		.number()
		.int()
		.positive()
		.default(10000)
		.describe("Maximum wait time for the file input to appear."),
});

type UploadResumeToolInput = z.infer<typeof uploadResumeInputSchema>;

export function createUploadResumeTool({
	page,
	defaultResumePath,
}: UploadResumeToolOptions) {
	return tool({
		description:
			"Upload the applicant resume file to a file input on the current application page.",
		inputSchema: uploadResumeInputSchema,
		execute: async ({
			selector,
			filePath,
			timeoutMs,
		}: UploadResumeToolInput) => {
			const resolvedPath = resolve(filePath ?? defaultResumePath);
			await access(resolvedPath, constants.R_OK);

			const startedAt = Date.now();
			const fileInput = page.locator(selector).first();
			let elementCount = await fileInput.count();
			while (elementCount < 1 && Date.now() - startedAt < timeoutMs) {
				await new Promise((resolveDelay) => {
					setTimeout(resolveDelay, 200);
				});
				elementCount = await fileInput.count();
			}

			if (elementCount < 1) {
				return {
					success: false,
					message: "No file input found for the provided selector.",
					selector,
					filePath: resolvedPath,
				};
			}

			await fileInput.setInputFiles(resolvedPath);
			logger.info(
				{ selector, filePath: resolvedPath, pageUrl: page.url() },
				"Uploaded resume file using custom upload tool.",
			);

			return {
				success: true,
				selector,
				filePath: resolvedPath,
			};
		},
	});
}
