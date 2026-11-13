# Next session plan: from mortgage calculator to AI broker agent

Written 2026-11-13. Read the **Status** section first; the rest is the original plan.

## Status (end of session 2, 2026-11-13)

**Done:** Phase 0, Phase 1 and most of Phase 2, built as one vertical slice: paste a listing → verdict with reasons → saved → still there after a restart → recalculated when the situation changes.

- git repo (`main`), package renamed `broker-ia`. **The folder still needs renaming by hand** (see below).
- `docker compose up -d --build` → app + Postgres 16/pgvector, ports bound to 127.0.0.1. `npm run dev` without Docker uses PGlite (embedded Postgres, same migrations).
- DB: `profile` + append-only `profile_facts`, `conversations` + `messages` (stored exactly as sent to the API, never edited), `homes` + `home_prices`.
- New tools: `update_profile` (netPay × pagas computed in code, returns budget before/after and verdict changes for saved homes), `evaluate_listing`, `save_home` (idempotent by Idealista URL id, records price changes), `list_saved_homes`, `update_home`, `remove_home`. Idealista search code removed.
- Red flags: deterministic rules in `shared/broker.ts` with evidence snippets and negation handling.
- Agent: interview-first system prompt, conversation memory from DB, screenshot paste (downscaled in the browser), model `claude-opus-5-5` (override with `ANTHROPIC_MODEL`), effort `medium`, server-side refusal fallback on.
- UI: "Tu bróker" is the default tab; it has conversation history, pasted images, listing cards with flags and live profile updates. "Mis viviendas" shows saved homes from the DB with status, notes, price history and a comparison table.
- Tests: 26 passing (`npm test`), using an in-memory DB, no model calls. Verified by hand: Docker health, profile PATCH, restart persistence, and a real MCP stdio client saving a home that the web API then returns.

**Not verified:** the live model loop. There was no `ANTHROPIC_API_KEY` in this session, so no real conversation has run yet, and the new UI was built and typechecked but not looked at in a browser. First thing next session: add the key, run the demo below, and fix what breaks.

**Demo script (3 minutes):**
1. New conversation → "Hola, quiero comprar mi primera casa". It should interview, one question at a time.
2. Answer savings and pay ("cobro 1.900 netos en 14 pagas, tengo 42.000 ahorrados"). The profile panel updates and you get a first budget.
3. Paste a real Idealista listing (text or screenshot). You should get a verdict, the real cost, flags and questions for the seller.
4. "Guárdala" → it appears in Mis viviendas. `docker compose restart app` → still there.
5. "Me han subido el sueldo a 2.100" → the budget is recalculated and saved homes change verdict.

**Week two (cut on purpose this session):**
- Rolling conversation summaries / compaction (history is replayed in full; fine until conversations get long).
- Price per m² by zone from a real source (decision 5 below is still open).
- Phase 3 chat-first layout (side panel with snapshot + saved homes); Phase 4 RAG; Phase 5 MCP over HTTP + skills; Phase 6 evals.
- Eval set: 15-20 scripted conversations asserting the right tool calls and that numbers match `shared/finance.ts`.

**Still needed from you:** an API key in `.env`, the folder rename, and answers to decisions 2, 3, 5 and 6 (defaults were used: Claude API, custom React UI, single user, Spanish UI).

## Goal

A chat-first AI agent that acts as a personal property broker for Spain (I find listings on Idealista, the agent evaluates them). It:

- interviews me about my finances (savings, income, debts, job stability) and keeps that profile up to date,
- evaluates the listings I paste in (text or screenshot) and saves the ones I ask it to save,
- recalculates mortgages whenever my situation changes,
- remembers past conversations,
- runs locally with `docker compose up`, with a RAG system, an MCP server and skills.

It should also be a portfolio piece for forward-deployed engineering work: compose, RAG, agent, MCP, evals.

## What exists today (keep it)

| Piece | Where | Status |
| --- | --- | --- |
| Finance engine, tested against the Excel | `shared/finance.ts`, `shared/taxes.ts`, `shared/finance.test.ts` | Keep as is. This is the most valuable part. |
| Agent loop with tools + web search | `server/agent.ts`, `server/tools.ts` | Keep, extend. Model `claude-opus-5-5`. |
| MCP server (stdio) | `server/mcp.ts` | Keep, add HTTP transport and the new tools. |
| Idealista client + sample data fallback | `server/idealista.ts`, `server/sample.ts`, `server/search.ts` | Park the Idealista client; keep sample data as demo seed (see "Idealista: the real constraint"). |
| React UI with 8 tabs | `src/` | Rework: chat becomes the main screen. |
| Profile | `data/profile.json` (one flat JSON file) | Move into the database. |

Gaps: no database, no conversation persistence, no RAG, no Docker, no git repo, the profile is only editable through forms, and the agent cannot save homes or update the profile itself.

**Decision: stay in TypeScript.** Rewriting in Python would throw away the tested engine for no gain.

## Target architecture

```
docker compose
├── web      React chat UI (static build, served by nginx or by api)
├── api      Node/Express: agent loop, tools, REST, SSE streaming
├── mcp      same tools over MCP streamable HTTP (for Claude Desktop / Claude Code)
├── db       Postgres 16 + pgvector: profile, homes, conversations, RAG chunks
└── ollama   optional (compose profile "local"): embeddings, and a local chat model as fallback
```

One tool registry (`server/tools.ts`) feeds both the in-app agent and the MCP server, as it does now.

### Local or cloud model?

Recommendation: **everything runs locally in Docker except the chat model**, which stays on the Claude API. Reasons:

- The agent depends on reliable multi-step tool calling; small local models are noticeably weaker at it, and this machine (Windows 10 Home) probably has no GPU to run a larger one at usable speed.
- The Claude Code quota that ran out is the subscription. The app uses `ANTHROPIC_API_KEY`, which is billed separately per token, so the two do not compete.
- Make the provider swappable (`LLM_PROVIDER=anthropic|ollama`) so the demo still works offline. Embeddings can be local from day one (`nomic-embed-text` or `bge-m3` on Ollama; `bge-m3` handles Spanish better).

To save cost in daily use, default the agent to `claude-sonnet-5-5` and keep Opus as an option.

## Data model (Postgres)

- `profile`: one row of current values (the fields in `data/profile.json` plus the new ones below).
- `profile_facts`: append-only log: `key, value, source_message_id, created_at`. This gives the history of my situation and lets the agent say "you told me on 3 Dec that savings were 38,000 €".
- `conversations`, `messages`: full chat history, including tool calls.
- `conversation_summaries`: rolling summary per conversation, injected into the system prompt so long chats stay cheap.
- `saved_homes`: listing snapshot (price, m², zone, URL, photos, description), status (`interested | visited | offered | discarded`), my notes, and the analysis at save time.
- `home_price_history`: price per check, to detect drops.
- `rag_documents`, `rag_chunks` (with `vector` column).

New profile fields the interview should fill: employment type and seniority (indefinido / temporal / autónomo / funcionario), number of pagas (12 or 14), co-buyer and their income, monthly expenses, expected family help, monthly saving capacity, target zones, must-haves, and timeline.

## Agent design

### New tools

| Tool | Purpose |
| --- | --- |
| `get_profile`, `update_profile` | Read and patch the profile; every update writes a `profile_facts` row. |
| `save_home`, `list_saved_homes`, `update_home`, `remove_home` | Saved homes with status and notes. |
| `import_listing` | Turn a pasted Idealista URL or pasted listing text into a structured home. |
| `compare_homes` | Side-by-side of saved homes with full cost and monthly payment. |
| `search_knowledge` | RAG retrieval with source citations. |
| `recall` | Semantic search over past conversations. |
| Existing | budget, purchase analysis, `search_homes`, offers, web search. |

Rule to keep in the system prompt: all numbers come from tools, never from the model's head.

### Onboarding interview

On first run (empty profile) the agent starts the conversation itself and asks one question at a time: savings, net monthly income and number of pagas, contract type, debts, co-buyer, region, first home or not, timeline. In Spain the right question is monthly net pay × 12 or 14, not weekly. After each answer it calls `update_profile` and, once it has the minimum set, shows the first budget.

Later, any message like "I got a raise to 2,600" triggers `update_profile` and an automatic recalculation of the budget and of every saved home's verdict.

### Skills

Markdown playbooks in `skills/<name>/SKILL.md`, loaded by the agent on demand (short description in the system prompt, full text fetched through a `load_skill` tool). The same folder can be linked into `.claude/skills/` so they also work from Claude Code.

1. `intake-interview`: what to ask, in which order, how to validate answers.
2. `affordability`: debt ratio, LTV, entry + taxes + costs, bank acceptance criteria.
3. `evaluate-listing`: price per m² against the zone, red flags (occupied, nuda propiedad, no cédula, ITE pending), questions for the seller.
4. `compare-mortgages`: fixed vs variable vs mixed, bonificaciones, TAE vs TIN, reading a FEIN.
5. `taxes-and-aid`: ITP/AJD by region, youth reductions, ICO guarantee.
6. `negotiate-and-close`: offer strategy, arras, notary, timeline.

### RAG corpus

Put source files in `knowledge/` and ingest with `npm run ingest`.

- Banco de España: guía de acceso al préstamo hipotecario.
- Ley 5/2019 (LCCI), the consumer-relevant parts.
- ITP/AJD rules per region and youth reductions (the source behind `shared/taxes.ts`).
- ICO youth guarantee conditions.
- Bank offer sheets and any FEIN/FIPRE I receive.
- Descriptions of saved homes, so "the one with the terrace near the metro" resolves.
- Conversation summaries.

Chunk by heading, store source and date, return citations in answers. Hybrid search (pgvector + Postgres full-text) is enough; no separate vector DB.

## Interface

Chat is the main screen, not a tab.

- Center: the conversation, streaming, with rich cards rendered from tool results (listing cards, budget summary, mortgage comparison, amortization chart).
- Right panel, always visible: my financial snapshot (savings, income, max price, max monthly payment), updating live when the agent changes the profile, and the saved-homes list with status.
- Left: conversation history.
- The current calculator tabs stay reachable as a "Tools" section; nothing is deleted.

Build it on the existing React app. Alternative if time is short: run Open WebUI or LibreChat in the compose and connect it to the MCP server. That gives a polished chat for free but no custom cards or live side panel, so it is the fallback, not the plan.

## Idealista: the real constraint

**Decided 2026-11-13: no Idealista API and no scraping.** The agent does not search; Idealista's site and alerts do that better.

- I browse Idealista myself and hand the agent a listing by pasting its text or a screenshot. `import_listing` structures it (Claude reads images, so screenshots work).
- The agent's job starts there: affordability, full cost, mortgage options, fair-price check, red flags, questions for the seller, offer range, save and track.
- Remove or park `server/idealista.ts` and the `search_homes` tool; keep `server/sample.ts` only as demo seed data. Drop the `IDEALISTA_*` variables from `.env.example` and the README.
- Fair-price check needs €/m² by zone. Source still to choose and verify at neighbourhood level: public statistics (INE, Ministerio de Vivienda, notaries) or web search for published zone price reports. Cache what is found in the DB.
- Price changes on saved homes: I re-paste the listing; the agent records the new price in `home_price_history`.

## Phases

Each phase ends with something that runs.

**Phase 0: housekeeping (30 min)**
- Rename the folder (see below), `git init`, first commit. Check `.gitignore` covers `.env`, `node_modules`, `dist`, `data/profile.json`.
- Fix the hard-coded path in the README's `claude mcp add` command.

**Phase 1: Docker + database**
- `Dockerfile`, `docker-compose.yml` (web, api, db with pgvector), `.env` wiring, healthchecks, migrations (Drizzle or plain SQL files).
- Move the profile from JSON to Postgres, with a one-time import.
- Done when: `docker compose up` gives the current app, backed by Postgres.

**Phase 2: memory + stateful tools**
- Persist conversations and messages; rolling summaries.
- Add profile and saved-homes tools; first-run interview.
- Done when: I restart the containers and the agent still knows my savings and my saved homes.

**Phase 3: chat-first UI**
- New layout, tool-result cards, live side panel, conversation list.
- Done when: I can do intake, search, save and compare without leaving the chat.

**Phase 4: RAG**
- Ingest pipeline, `search_knowledge`, citations in the UI, `recall` over past chats.
- Done when: "What ITP do I pay in Madrid as a 28-year-old first-time buyer?" answers with a cited source.

**Phase 5: MCP over HTTP + skills**
- Streamable HTTP transport in the compose, all new tools exposed, skills folder and `load_skill`.
- Done when: Claude Desktop connected to `http://localhost:<port>/mcp` can save a home that then appears in the web UI.

**Phase 6: polish for the portfolio**
- Optional Ollama profile and provider switch.
- A small eval set (20 or so scripted conversations checking the right tool was called and the numbers match `shared/finance.ts`).
- README with an architecture diagram, a demo script and a seeded demo profile.

Phases 1 to 3 are the product. 4 to 6 are what make it a good FDE showcase.

## Renaming the folder

Suggested name: **`broker-ia`** (alternatives: `casa-agent`, `homebroker-agent`). Also rename `name` in `package.json` and the title in the README.

Do it with Claude Code closed, because Windows locks the current directory:

```powershell
cd C:\Users\34658\Projects\hipoteca-searcher; docker compose down   # keeps the data volume
cd ..; Rename-Item hipoteca-searcher broker-ia
cd broker-ia; docker compose up -d   # compose project name is fixed to broker-ia, so the same volume is reused
```

Then open Claude Code in the new folder. Claude Code keys its per-project memory on the folder path; there is nothing saved there yet, so nothing is lost.

## Decisions to confirm at the start

1. Folder and project name (`broker-ia`?).
2. Claude API for the chat model with Ollama optional (recommended), or local-only?
3. Custom React chat (recommended) or Open WebUI as the front end?
4. Single user, no login (recommended for local use)?
5. Which source to use for zone price per m² (see the Idealista section).
6. App language: keep Spanish UI with code and docs in English?

## Prompt to start the next session

> Read NEXT_SESSION.md. My answers to the decisions are: [1…6]. Do Phase 0 and Phase 1, run the tests and `docker compose up`, and stop when the current app works on Postgres.
