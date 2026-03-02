# OpenDoor (v2)

Automate job applications with a human-in-the-loop browser agent powered by LangChain + Stagehand.

This version uses a single `createAgent` agent with tool calling (instead of custom node graph files). It fills forms from your resume context, asks for clarification when needed, uploads local files, and requires explicit terminal confirmation before final submit.

## What it does

- Loads and parses your resume PDF into plain text context.
- Optionally loads extra instructions from a local text/markdown file.
- Opens the target job URL and interacts with the page through Stagehand tools.
- Asks you follow-up questions in terminal when details are missing.
- Uploads local files (resume/cover letter/transcript) to file inputs.
- Never submits automatically; it calls a confirmation step first.

## Current architecture

- `src/index.ts` is the CLI entrypoint.
- `src/agent.ts` defines:
  - base system prompt,
  - resume/extra-instructions loading helpers,
  - the LangChain agent with tools and `todoListMiddleware`.
- Tools used by the agent:
  - `ask_user_clarification`
  - `upload_local_file`
  - `confirm_submit`
  - Stagehand toolkit tools from `@langchain/community`.

LangGraph registration in `langgraph.json` points to:

- `agent: ./src/agent.ts:agent`

## Requirements

- Node.js
- `pnpm`
- Valid model API key (`AI_API_KEY`)
- Local browser runtime (Stagehand runs with `env: "LOCAL"`, non-headless)

## Setup

1. Install dependencies:

```bash
pnpm install
```

1. Create `.env` in project root:

```env
AI_API_KEY=your_api_key
MODEL_NAME=google/gemini-2.5-pro
ACCOUNT_EMAIL=you@example.com
ACCOUNT_PASSWORD=your_password
```

### Environment variables

- `AI_API_KEY` (required): used for model + Stagehand.
- `MODEL_NAME` (required): model identifier (supports `google/...`; prefix is normalized internally for `initChatModel`).
- `ACCOUNT_EMAIL` (optional): used when site login/account flow needs email.
- `ACCOUNT_PASSWORD` (optional): used when login/account flow needs password.

## Usage

Run from project root:

```bash
pnpm start -- --job-url "https://example.com/job/123" --resume-path "/absolute/path/resume.pdf"
```

With extra instructions:

```bash
pnpm start -- --job-url "https://example.com/job/123" --resume-path "/absolute/path/resume.pdf" --extra-prompts "/absolute/path/instructions.md"
```

### CLI options

- `--job-url <url>` (required)
- `--resume-path <path>` (required, must exist)
- `--extra-prompts <path>` (optional, must exist)

## Interactive terminal prompts

You will see prompts when the agent needs input:

- Clarification prompts via `ask_user_clarification`.
- Final submit confirmation via `confirm_submit`:
  - `yes` → agent clicks final submit button.
  - any other input → treated as rejection/feedback for agent adjustment.

## Development commands

```bash
pnpm start --job-url "..." --resume-path "..."
pnpm dev
pnpm build
pnpm biome:check
pnpm biome:lint
pnpm biome:format
pnpm biome:fix
```

## Project map

- `src/index.ts` — CLI parsing and agent invocation.
- `src/agent.ts` — agent setup + prompt/context builders.
- `src/tools/askUser.tool.ts` — human clarification tool.
- `src/tools/uploadLocalFile.tool.ts` — local file upload tool.
- `src/tools/confirmSubmit.tool.ts` — guarded final submit tool.
- `src/tools/stagehand.tools.ts` — Stagehand toolkit binding.
- `src/utils/env.ts` — env var loading/validation.
- `src/utils/instances.ts` — singleton model, Stagehand, and readline instances.
- `data/instructions.md` — optional extra instruction template.

## Notes

- Browser is intentionally non-headless so you can observe and intervene.
- File paths are validated before execution.
- Keep secrets in `.env` and out of version control.
- Job sites vary widely; monitor terminal prompts and browser behavior during runs.
