import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import path from "node:path";
import { tool } from "@langchain/core/tools";
import z from "zod";
import { getStagehandInstance } from "../utils/instances.js";

type RankedFileInputCandidate = {
	index: number;
	score: number;
	disabled: boolean;
};

const uploadLocalFileInputSchema = z.object({
	filePath: z
		.string()
		.min(1)
		.describe(
			"Local file path to upload (absolute or relative to project root), e.g. data/coop_resume.pdf",
		),
	targetDescription: z
		.string()
		.min(1)
		.describe(
			"Description of the upload target on the page, e.g. 'resume upload field' or 'cover letter uploader'.",
		),
});

export const uploadLocalFileTool = tool(
	async ({ filePath, targetDescription }) => {
		const resolvedFilePath = path.resolve(filePath.trim());

		try {
			await access(resolvedFilePath, constants.R_OK);
			const fileStats = await stat(resolvedFilePath);

			if (!fileStats.isFile()) {
				return `Upload failed: path is not a file: ${resolvedFilePath}`;
			}
		} catch (error) {
			const feedback = error instanceof Error ? error.message : String(error);
			return `Upload failed: cannot access local file at ${resolvedFilePath}. Feedback: ${feedback}`;
		}

		const stagehand = await getStagehandInstance();

		try {
			const activePage = await stagehand.context.awaitActivePage();
			const fileInputLocator = activePage.locator('input[type="file"]');
			const fileInputCount = await fileInputLocator.count();

			if (fileInputCount === 0) {
				return `Upload failed for ${resolvedFilePath}: no file input controls were found on the current page.`;
			}

			const rankedCandidates = await activePage.evaluate(
				(description: string): RankedFileInputCandidate[] => {
					const elements = Array.from(
						document.querySelectorAll('input[type="file"]'),
					);
					const normalizedDescription = description.toLowerCase().trim();
					const tokens = normalizedDescription
						.split(/\s+/)
						.filter((token: string) => token.length > 1);

					return elements
						.map(
							(element: Element, index: number): RankedFileInputCandidate => {
								if (!(element instanceof HTMLInputElement)) {
									return {
										index,
										score: -10000,
										disabled: true,
									};
								}

								const labelsText = Array.from(element.labels ?? [])
									.map((label) => label.textContent ?? "")
									.join(" ");

								const labelledByIds = (
									element.getAttribute("aria-labelledby") ?? ""
								)
									.split(/\s+/)
									.filter(Boolean);
								const labelledByText = labelledByIds
									.map((id) => document.getElementById(id)?.textContent ?? "")
									.join(" ");

								const searchableText = [
									element.getAttribute("id") ?? "",
									element.getAttribute("name") ?? "",
									element.getAttribute("aria-label") ?? "",
									element.getAttribute("data-testid") ?? "",
									element.getAttribute("placeholder") ?? "",
									labelsText,
									labelledByText,
								]
									.join(" ")
									.toLowerCase();

								let score = 0;
								if (
									normalizedDescription &&
									searchableText.includes(normalizedDescription)
								) {
									score += 100;
								}

								for (const token of tokens) {
									if (searchableText.includes(token)) {
										score += 10;
									}
								}

								if (element.disabled) {
									score -= 1000;
								}

								return {
									index,
									score,
									disabled: element.disabled,
								};
							},
						)
						.sort(
							(
								left: RankedFileInputCandidate,
								right: RankedFileInputCandidate,
							) => right.score - left.score,
						);
				},
				targetDescription,
			);

			const bestCandidate =
				rankedCandidates.find(
					(candidate: RankedFileInputCandidate) => !candidate.disabled,
				) ?? rankedCandidates[0];

			if (!bestCandidate) {
				return `Upload failed for ${resolvedFilePath}: no usable file input control matched ${targetDescription}.`;
			}

			await fileInputLocator
				.nth(bestCandidate.index)
				.setInputFiles(resolvedFilePath);

			return `Upload succeeded for ${resolvedFilePath} to ${targetDescription}.`;
		} catch (error) {
			const feedback = error instanceof Error ? error.message : String(error);
			return `Upload failed for ${resolvedFilePath}. Feedback: ${feedback}`;
		}
	},
	{
		name: "upload_local_file",
		description:
			"Upload a local file (resume, cover letter, transcript, etc.) to a file upload control on the current page.",
		schema: uploadLocalFileInputSchema,
	},
);
