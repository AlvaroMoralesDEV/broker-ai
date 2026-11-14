# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

Bróker IA: a local, multi-user AI agent that acts as a personal mortgage and property broker in Spain. The user tells it about their finances, pastes property listings, and enters the mortgage offers banks give them. The agent keeps all of that in Postgres and recalculates everything when their situation changes. The UI and all user-facing text are in Spanish; code comments are in Spanish too.

## Commands

```bash
npm install
npm run dev          # API on :8787 (tsx watch) + Vite on :5173; uses embedded PGlite in data/pglite
npm test             # node:test over shared/*.test.ts and server/*.test.ts; in-memory DB, no model calls
npm run typecheck    # tsc --noEmit, must be clean
npm run up           # docker compose up -d --build  →  http://localhost:8787 (app + Postgres 16/pgvector)
node scripts/chat.mjs [url] "msg 1" "msg 2"   # drive the chat from the terminal
node scripts/bench-local.ts <ollama-model>    # measure a local model on real tool-calling cases
```

Run `npm test` and `npm run typecheck` before every commit.

## Architecture

```
shared/   pure logic, used by server and browser
  finance.ts    mortgage engine (tested against the original spreadsheet). All numbers come from here.
  taxes.ts      purchase taxes per comunidad autónoma
  broker.ts     profile extras, KEY_FACTS (interview order), red-flag rules for listings
  extract.ts    deterministic extraction: user facts and pasted-listing fields (regex)
  offers.ts     comparison of the bank offers a user received (true cost, are linked products worth it)
server/
  index.ts      Express API + SSE chat. Middleware wraps each /api request in withUser()
  context.ts    AsyncLocalStorage with the current user
  store.ts      all DB access; every query filters by currentUser()
  tools.ts      the single tool registry (Claude agent, local router and MCP all use it)
  agent.ts      Claude path (tool-use loop) and toDisplay(); dispatches to local.ts when no key
  local.ts      local/no-AI path: deterministic router + Ollama for free-form questions only
  summaries.ts  broker answers written by code (listing verdict, offers, budget…)
  provider.ts   picks Claude, Ollama or none
  mcp.ts        stdio MCP server over the same tools (BROKER_USER selects the user)
  migrations/   plain SQL, applied in order at startup
src/            React UI (Vite). lib.ts adds the X-Broker-User header to every /api call
```

## Rules that matter

- **Numbers come from code, never from a model.** Payments, taxes, budgets and offer costs are computed in `shared/`. Prompts tell Claude to use tools; local mode never lets the model produce figures.
- **Everything is per user.** New tables need a `user_id` column, and new store functions must filter by `currentUser()`. Add an isolation test in `server/broker.test.ts`.
- **Conversation history is append-only.** Messages are stored exactly as sent to the Claude API (including thinking blocks) and never edited. Interrupted tool calls are repaired by appending a result, not by deleting.
- **Local mode is deterministic by design.** A 2B model on a CPU laptop picks the right tool but fills arguments badly, so `local.ts` routes with regexes and writes answers in `summaries.ts`. Don't hand tool calls to the local model without re-measuring with `scripts/bench-local.ts`.
- **Ambiguous input is asked about, not guessed.** Gross or yearly pay, or an answer about a different topic, must not be saved as a fact.
- **Schema changes go in a new migration file**; never edit an applied one.
- **Model:** `claude-opus-5-5` by default (`ANTHROPIC_MODEL` overrides), with server-side refusal fallback enabled.

## Privacy

The repository is public. Never commit `.env`, `data/pglite/`, spreadsheets, database dumps or real user data. Screenshots in `docs/` must use demo data only.
