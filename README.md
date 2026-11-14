# Bróker IA

**An AI agent that works as your personal mortgage broker for buying a home in Spain.** It runs on your computer with `docker compose`, remembers everything in Postgres, and works with Claude, with a free local model through Ollama, or with no AI at all.

You tell it your situation and it works out how much you can buy. You paste a listing from Idealista and it tells you whether it fits, what it really costs and which red flags it has. You enter the mortgage offers banks give you and it tells you which one is cheapest once insurance and fees are counted, and which linked products aren't worth taking.

> The app's interface is in Spanish, since it is built for the Spanish market.

![Chat with the broker](docs/chat.png)

## What it does

- **Interview and memory.** It asks one question at a time (savings, net pay and number of payments, contract, debts, whether you buy alone), saves each answer with its date, and recalculates when something changes ("me han subido el sueldo").
- **Listing review.** Paste the text of a listing, or a screenshot with Claude. You get the verdict, the savings needed (down payment plus regional taxes and fees), the monthly payment, the monthly cost of owning it, red flags (occupied, bare ownership, special levy, no lift…) with the sentence that triggered each one, and questions for the agency.
- **Saved homes.** Status, notes and price history, all recalculated with your situation today.
- **Bank offer comparison.** Enter each offer the banks make you (rate, fixed years, spread, fees, and every linked product with its discount and yearly cost). You get the real cost over the whole term, whether each linked product pays for itself, and the cheapest way to take each offer.
- **Several users.** Each person has their own profile, conversations, homes and offers. You can have two people open at once, one per browser tab.
- **MCP server** exposing the same tools to Claude Desktop or Claude Code.

![Comparing the offers banks gave you](docs/offers.png)

## Quick start

```bash
git clone <this repo> && cd <repo>
docker compose up -d --build      # http://localhost:8787
```

No API key is required. The agent picks the best "brain" available:

| Mode | When | What changes |
| --- | --- | --- |
| **Claude** | `ANTHROPIC_API_KEY` in `.env` (copy `.env.example`) | Full agent: converses, reads screenshots, searches the web and calls the tools itself |
| **Local AI** | No key, [Ollama](https://ollama.com) installed (`ollama pull qwen3:1.7b`) | Free and private. The broker work is done by code instantly; the model only answers open questions |
| **No AI** | Neither | Interview, listing review, saving, comparing homes and offers all still work |

Without Docker: `npm install && npm run dev` (web on http://localhost:5173), using an embedded Postgres in `data/pglite`.

## How it is built

```
docker compose
├── app   Node 24 + Express: agent, tools, REST + SSE, and the React app
└── db    Postgres 16 (+ pgvector, reserved for the knowledge base)
```

- **The model reads and talks; code decides.** Every figure comes from `shared/finance.ts`, which is tested against the original spreadsheet. Red flags and offer maths are plain, tested rules, so every result can be explained.
- **One tool registry** (`server/tools.ts`) serves the Claude agent, the local mode and the MCP server. Conversations are stored in the same format in every mode, so a chat started locally can continue with Claude.
- **Per-user isolation.** Every request runs with its user (`AsyncLocalStorage`), and every query filters by it. Tests check that one user can neither read nor write another's data.

### Why local mode is not "Claude, but worse"

Measured on a laptop without a GPU (11th-gen i7, 16 GB) with `scripts/bench-local.ts`: `qwen3:4b` did not answer in 5 minutes, and `qwen3:1.7b` chose the right tool but filled its arguments badly (invented fields, zeros for data the user never gave). So in local mode the model never calls tools:

- `shared/extract.ts` reads the user's facts and the fields of a pasted listing with rules. Anything ambiguous (gross or yearly pay) is asked about, not saved.
- `server/summaries.ts` writes the verdict, costs, red flags and offer comparison. A listing is evaluated in under 100 ms.
- The local model answers everything else using a glossary and the user's context, and the app flags any euro figure it gives that does not come from the user's data.

## Inspecting the data

Everything is stored in Postgres inside the `db` container:

```bash
# open a SQL console (the user is "broker", not "postgres")
docker exec -it broker-ia-db-1 psql -U broker -d broker
```

```sql
\dt                                                      -- list tables
SELECT id, name FROM users;                              -- users
SELECT user_id, data, extra FROM profile;                -- current profile of each user
SELECT user_id, field, new_value, note, created_at
  FROM profile_facts ORDER BY id DESC LIMIT 20;          -- what each user said, and when
SELECT user_id, title, updated_at FROM conversations ORDER BY updated_at DESC;
SELECT user_id, id, title, price, status FROM homes;     -- saved homes
SELECT user_id, bank, offer FROM bank_offers;            -- offers from banks
\q                                                       -- exit
```

| Table | Contents |
| --- | --- |
| `users` | People using this installation |
| `profile` / `profile_facts` | Current situation, plus an append-only log of every change |
| `conversations` / `messages` | Chats, stored exactly as sent to the model |
| `homes` / `home_prices` | Saved homes and their price history |
| `bank_offers` | Mortgage offers received from banks |

Data lives in the `broker-ia_pgdata` Docker volume and survives restarts. `docker compose down -v` deletes it.

## MCP server

The same tools, from Claude Desktop or Claude Code, against the same database:

```bash
docker compose up -d db
claude mcp add broker -e DATABASE_URL=postgres://broker:broker@localhost:5433/broker -- node <path-to-repo>/server/mcp.ts
```

Add `-e BROKER_USER=<user id>` to act as a user other than the default one (see `SELECT id, name FROM users`).

## Development

```bash
npm test                         # engine, extraction, offers, tools, local mode, user isolation (no model calls)
npm run typecheck
node scripts/chat.mjs "hola" "tengo 30.000 ahorrados"     # drive the chat from the terminal
node scripts/bench-local.ts qwen3:1.7b                   # measure a local model on this machine
```

Bank rates and the Euribor live in `data/rates.json` (mounted in Docker, so edit and reload). Schema changes go in `server/migrations/`, and migrations run at startup.

## Known limitations

- It does not search listings: Idealista forbids scraping and its API needs approval. You search; the agent evaluates.
- Listing parsing and red flags are text rules tuned to Idealista text copied from the page. Unusual wording can be missed in either direction, so each flag shows its evidence and missing fields are listed.
- The offer comparison assumes Euribor stays at today's value and that insurance costs the same every year.
- In local mode screenshots can't be read (paste the text instead), and answers to open questions come from a 2B model: fine for concepts, weak for nuanced advice.
- Users have no passwords. This is meant to run on your own machine; don't expose it to a network.
- Figures are guidance, not financial advice. Taxes and youth reductions have conditions, and banks set the real terms.

## Privacy

Everything stays on your computer. The only outside calls are to the Claude API, and only when you add a key. Personal files (`.env`, `data/pglite/`, spreadsheets, database dumps) are listed in `.gitignore`.
