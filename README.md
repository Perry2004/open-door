# OpenDoor

Automate online job applications with a human-in-the-loop LangGraph agent.

The agent opens a browser with Stagehand, navigates the application flow, fills forms using your resume + optional custom instructions, pauses when it needs your input, and only submits after your explicit approval.

## What it does

- Parses your resume PDF into text.
- Opens the job URL and detects account/login requirements.
- Handles account creation/login and email verification when required.
- Fills application forms across steps/pages.
- Interrupts to ask you for missing required details.
- Pauses for final review and submits only after approval.

## Architecture

The graph is defined in `src/agent.ts`:

`START -> PrepareResourceNode -> HandleAccountNode -> FillFormNode <-> SubmitNode -> END`

- `PrepareResourceNode`: loads resume text and optional extra prompts.
- `HandleAccountNode`: handles apply click-through + account/login/verification flows.
- `FillFormNode`: fills fields, uploads resume, and requests missing info via interrupt.
- `SubmitNode`: requests your review decision; loops back for edits or submits.

## Requirements

- Node.js
- `pnpm`
- Gemini API key. Requiring `gemini-3.0-flash-preview` for computer-user and multi-modal capabilities.
- A local browser environment (Stagehand runs in `LOCAL` mode, non-headless for eash observation and intervention).

## Setup

1. Install dependencies:

```bash
pnpm install
```

1. Create a `.env` file in the project root:

```env
AI_API_KEY=your_api_key
MODEL_NAME=google/gemini-2.5-pro
ACCOUNT_EMAIL=you@example.com
ACCOUNT_PASSWORD=your_password
```

### Environment variables

- `AI_API_KEY` (required): key used by model + Stagehand agent.
- `MODEL_NAME` (required): model identifier.
- `ACCOUNT_EMAIL` (optional but required when a site needs account auth).
- `ACCOUNT_PASSWORD` (optional, but required for account creation/login unless prompted during an existing-account flow).

## Usage

Put your resume and extra instructions (if any) in the `data/` folder or anywhere accessible, and provide absolute paths in the CLI.

Run from the project root:

```bash
pnpm start --job-url "https://example.com/job/123" --resume-path "/absolute/path/resume.pdf"
```

Optional extra prompts file:

```bash
pnpm start -- \
 --job-url "https://example.com/job/123" \
 --resume-path "/absolute/path/resume.pdf" \
 --extra-prompts "/absolute/path/instructions.md"
```

### CLI options

- `--job-url <url>` (required): target job posting URL.
- `--resume-path <path>` (required): path to your resume PDF.
- `--extra-prompts <path>` (optional): text file with extra instructions for the agent (e.g. special instructions, skills to emphasize, etc).

## Interactive interrupts

During execution, the agent may prompt you for input in the terminal when it needs guidance or information it can't find:

- `missing_application_information`: provide missing details.
- `account_verification`: enter code or type `done` if verified via email link.
- `account_password`: provide password when returning-user login is detected.
- `submission_approval`: type `approve` to submit, or provide suggestions separated by `;`.

If suggestions are provided at submission, the graph routes back to `FillFormNode` and retries with your feedback.

## Development

- Run CLI:

```bash
pnpm start --job-url "..." --resume-path "..."
```

- LangGraph dev mode:

```bash
pnpm dev
```

- Build TypeScript:

```bash
pnpm build
```

- Lint/format with biome:

```bash
pnpm biome:check
pnpm biome:lint
pnpm biome:format
pnpm biome:fix
```

## Key files

- `src/index.ts`: CLI entrypoint + interrupt loop.
- `src/agent.ts`: LangGraph definition.
- `src/nodes/*.ts`: graph node logic.
- `src/tools/upload-resume.tool.ts`: file upload tool for form file inputs.
- `src/states/state.ts`: shared graph state schema.
- `src/utils/env.ts`: env var validation.
- `src/utils/instances.ts`: singleton llm model + Stagehand instances.
- `langgraph.json`: LangGraph graph registration.

## Notes

- The browser runs non-headless by design so you can observe and intervene.
- Resume path and extra prompt path are validated before run.
- Keep sensitive data in `.env` and do not commit it.
- Due to the variability of job application sites, the agent may not work perfectly on all sites and may go through redundant loops. Be mindful of your API usage and monitor the terminal for prompts.
