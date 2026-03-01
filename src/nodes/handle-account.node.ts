import type { RunnableConfig } from "@langchain/core/runnables";
import { type GraphNode, interrupt } from "@langchain/langgraph";
import z from "zod";
import { logger } from "../index.js";
import type { AgentStateType } from "../states/state.js";
import { envVars } from "../utils/env.js";
import { getStagehandInstance } from "../utils/instances.js";
import type { NodeName } from "./node.types.js";

const accountRequirementSchema = z.object({
	accountRequired: z
		.boolean()
		.describe(
			"Whether this application flow requires creating/logging into an account.",
		),
	existingAccountDetected: z
		.boolean()
		.optional()
		.describe(
			"Whether the flow indicates the applicant already has an account and should log in instead of creating one.",
		),
	applicationUrl: z
		.string()
		.url()
		.optional()
		.describe("Current or next application URL after clicking apply."),
	statusMessage: z.string().optional(),
});

const accountSetupSchema = z.object({
	accountSetupComplete: z
		.boolean()
		.describe("Whether account creation/login is complete."),
	requiresVerification: z
		.boolean()
		.describe("Whether email verification is required to continue."),
	verificationInstructions: z
		.string()
		.optional()
		.describe("Instructions or context for email verification step."),
	applicationUrl: z
		.string()
		.url()
		.optional()
		.describe("Application URL after account setup attempt."),
	statusMessage: z.string().optional(),
});

const loginCompletionSchema = z.object({
	loggedIn: z
		.boolean()
		.describe(
			"Whether login/verification is now complete and application is accessible.",
		),
	applicationUrl: z
		.string()
		.url()
		.optional()
		.describe("Logged-in application URL to continue filling form."),
	statusMessage: z.string().optional(),
});

type AccountVerificationDecision =
	| string
	| {
			type?: string;
			action?: string;
			verificationCode?: string;
			message?: string;
			reason?: string;
	  };

type AccountPasswordDecision =
	| string
	| {
			type?: string;
			action?: string;
			password?: string;
			message?: string;
			reason?: string;
	  };

function extractAccountRequirement(
	response: unknown,
): z.infer<typeof accountRequirementSchema> {
	const maybeResponse = response as {
		output?: unknown;
		result?: unknown;
	};

	const candidates = [maybeResponse.output, maybeResponse.result, response];
	for (const candidate of candidates) {
		const parsed = accountRequirementSchema.safeParse(candidate);
		if (parsed.success) {
			return parsed.data;
		}
	}

	return {
		accountRequired: false,
	};
}

function extractAccountSetup(
	response: unknown,
): z.infer<typeof accountSetupSchema> {
	const maybeResponse = response as {
		output?: unknown;
		result?: unknown;
	};

	const candidates = [maybeResponse.output, maybeResponse.result, response];
	for (const candidate of candidates) {
		const parsed = accountSetupSchema.safeParse(candidate);
		if (parsed.success) {
			return parsed.data;
		}
	}

	return {
		accountSetupComplete: false,
		requiresVerification: false,
	};
}

function extractLoginCompletion(
	response: unknown,
): z.infer<typeof loginCompletionSchema> {
	const maybeResponse = response as {
		output?: unknown;
		result?: unknown;
	};

	const candidates = [maybeResponse.output, maybeResponse.result, response];
	for (const candidate of candidates) {
		const parsed = loginCompletionSchema.safeParse(candidate);
		if (parsed.success) {
			return parsed.data;
		}
	}

	return {
		loggedIn: false,
	};
}

function parseVerificationDecision(decision: AccountVerificationDecision): {
	verificationCode?: string;
} {
	if (typeof decision === "string") {
		const trimmed = decision.trim();
		if (!trimmed || trimmed.toLowerCase() === "done") {
			return {};
		}

		return { verificationCode: trimmed };
	}

	const verificationCode =
		decision.verificationCode?.trim() ?? decision.message?.trim() ?? undefined;
	if (!verificationCode || verificationCode.toLowerCase() === "done") {
		return {};
	}

	return { verificationCode };
}

function parsePasswordDecision(decision: AccountPasswordDecision): {
	password?: string;
} {
	if (typeof decision === "string") {
		const trimmed = decision.trim();
		if (!trimmed) {
			return {};
		}

		return { password: trimmed };
	}

	const password =
		decision.password?.trim() ?? decision.message?.trim() ?? undefined;
	if (!password) {
		return {};
	}

	return { password };
}

export const handleAccountNode: GraphNode<
	AgentStateType,
	RunnableConfig,
	NodeName
> = async (state) => {
	const stagehand = await getStagehandInstance();
	const page = stagehand.context.pages()[0];

	if (!page) {
		logger.error("No page found in browser context.");
		throw new Error("No page found in browser context.");
	}

	await page.goto(state.jobUrl);

	const agent = stagehand.agent({
		mode: "hybrid",
		model: {
			modelName: envVars.MODEL_NAME,
			apiKey: envVars.AI_API_KEY,
		},
		systemPrompt:
			"You're a helpful assistant that can control a web browser to complete job applications.",
	});

	const accountRequirementResponse = await agent.execute({
		instruction: `
			From the current job posting page, click the main apply/application button to enter the employer's application flow.
			Then determine whether creating/logging into an account is required before reaching the application form.
            Only determine if account creation/login is required, do not attempt to create an account or log in at this step.
			If the page indicates an existing account should be used (for example, there is a sign-in flow for returning users), set existingAccountDetected=true.
			If the page clearly leads only to account creation for new users, set existingAccountDetected=false.
			If the form is directly accessible without an account, do not create any account.
            If there's already a "upload resume" button, it is likely that no account is required.
			Return output that strictly matches the schema.
		`,
		highlightCursor: true,
		output: accountRequirementSchema,
	});
	const accountRequirement = extractAccountRequirement(
		accountRequirementResponse,
	);

	if (!accountRequirement.accountRequired) {
		return {};
	}

	if (!envVars.ACCOUNT_EMAIL) {
		throw new Error(
			"This application requires account creation/login, but ACCOUNT_EMAIL is missing in .env.",
		);
	}

	let accountPassword = envVars.ACCOUNT_PASSWORD;
	if (accountRequirement.existingAccountDetected) {
		const decision = interrupt<AccountPasswordDecision>({
			type: "account_password",
			message:
				"An existing account appears to be required. Please provide your account password to continue.",
			reason:
				accountRequirement.statusMessage ??
				"Returning-user login flow detected before application form.",
		});

		const { password } = parsePasswordDecision(decision);
		if (!password) {
			throw new Error(
				"A password is required to log into your existing account.",
			);
		}

		accountPassword = password;
	} else if (!accountPassword) {
		throw new Error(
			"This application requires account creation/login, but ACCOUNT_PASSWORD is missing in .env.",
		);
	}

	const accountSetupInstruction = `			Complete all required account setup steps up to the point where the application becomes accessible.
        Use this account email when prompted: ${envVars.ACCOUNT_EMAIL}
        Use this account password when prompted: ${accountPassword}
        If email verification is required, stop at that step and set requiresVerification=true.
        If verification is not required or is already complete, continue until logged in and application is accessible.
        Return output that strictly matches the schema.
    `;
	logger.debug(`Account setup instruction: ${accountSetupInstruction}`);
	const accountSetupResponse = await agent.execute({
		instruction: accountSetupInstruction,
		highlightCursor: true,
		output: accountSetupSchema,
	});
	const accountSetup = extractAccountSetup(accountSetupResponse);

	if (accountSetup.requiresVerification) {
		const decision = interrupt<AccountVerificationDecision>({
			type: "account_verification",
			message:
				"Email verification is required. Provide the verification code from your email, or click the verification link and type 'done' to continue.",
			reason:
				accountSetup.verificationInstructions ??
				accountSetup.statusMessage ??
				"Account verification required before login can complete.",
		});

		const { verificationCode } = parseVerificationDecision(decision);

		if (verificationCode) {
			await agent.execute({
				instruction: `
					Use this verification code to complete account verification and continue login: ${verificationCode}
					After entering the code, continue until the application page is accessible while logged in.
				`,
				highlightCursor: true,
			});
		}

		const completionResponse = await agent.execute({
			instruction: `
				Continue from the current page and finish login after verification.
				If verification was completed externally via email link, continue from the now-authenticated browser state.
				Return output that strictly matches the schema.
			`,
			highlightCursor: true,
			output: loginCompletionSchema,
		});
		const completion = extractLoginCompletion(completionResponse);

		if (!completion.loggedIn) {
			throw new Error(
				completion.statusMessage ??
					"Unable to complete login after verification step.",
			);
		}

		return {};
	}

	if (!accountSetup.accountSetupComplete) {
		throw new Error(
			accountSetup.statusMessage ??
				"Account setup did not complete successfully.",
		);
	}

	return {};
};
