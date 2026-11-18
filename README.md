# Bróker IA

**An AI agent that works as your personal mortgage broker for buying a home in Spain.** It runs on your computer with `docker compose`, remembers everything in Postgres, and works with Claude, with a free local model through Ollama, or with no AI at all.

You tell it your situation and it works out how much you can buy. You paste a listing from Idealista and it tells you whether it fits, what it really costs and which red flags it has. You enter the mortgage offers banks give you and it tells you which one is cheapest once insurance and fees are counted, and which linked products aren't worth taking.

> The app's interface is in Spanish, since it is built for the Spanish market.

![A listing saved from the portal with the «Guardar en Bróker IA» bookmark: analysed and saved in one turn, with savings coming from the Finanzas app](docs/chat.png)

The broker has a face: a little house that follows your cursor, puffs chimney smoke while it thinks, talks while the answer streams in, hops when a turn goes well and dozes off if you leave it alone. All screenshots use made-up demo data.

## What it does

- **Interview and memory.** It asks one question at a time (savings, net pay and number of payments, contract, debts, whether you buy alone), saves each answer with its date, and recalculates when something changes ("me han subido el sueldo").
- **Listing review.** Paste the text of a listing, or a screenshot with Claude. You get the verdict, the savings needed (down payment plus regional taxes and fees), the monthly payment, the monthly cost of owning it, red flags (occupied, bare ownership, special levy, no lift…) with the sentence that triggered each one, and questions for the agency.
- **Save a listing from the portal in one click.** Drag the «Guardar en Bróker IA» button from «Mis viviendas» to your bookmarks bar. When you are looking at a listing on Idealista, Fotocasa or any other portal, click it: your browser reads the page you already have open and sends its text to the app, which analyses the home and saves it. Nothing scrapes the portal.
- **Links it can't read are said to be so.** The agent cannot open web pages. If you send only the URL of a listing, it tells you it hasn't seen it, asks for the text (or a screenshot with Claude), and offers to keep the link meanwhile. It asks before saving.
- **Saved homes.** Status, notes and price history, all recalculated with your situation today, each with a button that opens the original listing. Each card has a tag with the portal it came from (Idealista, Fotocasa…), and you can filter by portal. A red × deletes a home after asking you to confirm. The same listing is never saved twice, even if its link arrives with a different tracking query. A home saved from a bare link shows no figures until you paste its listing, and is then completed in place.

![Saved homes: the bookmarklet, the portal filter, the comparison and one home saved as a link only](docs/homes.png)

- **Memory across conversations.** With Claude, the agent keeps short notes on decisions and their reasons ("ruled out that area because of the commute") and starts every new chat with them.
- **Market mortgages matched to you.** Ask which mortgage suits you: offers are ranked by what you would pay over the whole term, not by the first payment. Each is checked against your loan, income and financing, so offers you cannot get are set apart with the reason, and variable and mixed ones show the payment if the Euribor rises two points next to your maximum payment.
- **Bank offer comparison.** Enter each offer the banks make you (rate, fixed years, spread, fees, and every linked product with its discount and yearly cost). You get the real cost over the whole term, whether each linked product pays for itself, and the cheapest way to take each offer.
- **Several users.** Each person has their own profile, conversations, homes and offers. You can have two people open at once, one per browser tab.
- **MCP server** exposing the same tools to Claude Desktop or Claude Code.

![Comparing the offers banks gave you](docs/offers.png)

## Quick start

```bash
git clone <this repo> && cd <repo>
docker compose up -d --build      # http://localhost:8787, or http://broker-ia.local (see below)
```

No API key is required. The agent picks the best "brain" available:

| Mode | When | What changes |
| --- | --- | --- |
| **Claude** | `ANTHROPIC_API_KEY` in `.env` (copy `.env.example`) | Full agent: converses, reads screenshots, searches the web and calls the tools itself |
| **Local AI** | No key, [Ollama](https://ollama.com) installed (`ollama pull qwen3:1.7b`) | Free and private. The broker work is done by code instantly; the model only answers open questions |
| **No AI** | Neither | Interview, listing review, saving, comparing homes and offers all still work |

Without Docker: `npm install && npm run dev` (web on http://localhost:5173), using an embedded Postgres in `data/pglite`.

## Savings from a personal-finance app (optional)

The broker can take your savings from **Finanzas**, a separate personal-finance app (its own repository, server and database) that runs on `:8788`.

1. In Finanzas, create a share token.
2. Paste it in the broker: «Lo que sé de ti» → «Ahorros desde Finanzas».

From then on:

- **What it reads.** The broker reads only the housing goal: the amount set aside for it, its target, the monthly contribution and the date. Never accounts or movements.
- **When.** It updates your savings before each answer.
- **If you give another figure,** it tells you it doesn't match and doesn't save it, unless you say «ignora la app de finanzas». «vuelve a usar la app de finanzas» switches back.
- **If Finanzas is stopped,** the broker keeps working with the last value it read.

The shape of what crosses is fixed in `server/finance-contract.ts`. Without a link, the broker works exactly as before.

### Names instead of ports

`docker compose up` also starts a small proxy on `127.0.0.1:80`. With this line in your `hosts` file (`C:\Windows\System32\drivers\etc\hosts` on Windows, `/etc/hosts` elsewhere), the broker opens at http://broker-ia.local and Finanzas at http://finanzas.local:

```
127.0.0.1 broker-ia.local finanzas.local
```

## How it is built

```
docker compose
├── app   Node 24 + Express: agent, tools, REST + SSE, and the React app
└── db    Postgres 16 (+ pgvector, reserved for the knowledge base)
```

### Layers

```
src/        React UI (Vite). Chat plus calculator tabs, and the mascot (Mascot.tsx). Every /api call carries X-Broker-User.
   │  REST + Server-Sent Events
server/
   index.ts      Express API. Middleware wraps each request in withUser() (AsyncLocalStorage)
   provider.ts   picks the brain: Claude if there is a key, else Ollama, else none
   agent.ts      Claude path: builds the request, runs the tool loop, streams the answer
   local.ts      no-Claude path: deterministic router; Ollama only for open questions
   tools.ts      the single tool registry, used by agent.ts, local.ts and mcp.ts
   summaries.ts  broker answers written by code (verdict, budget, offers) for local mode
   store.ts      all database access, every query filtered by the current user
   mcp.ts        the same tools over MCP (stdio)
shared/     pure, tested logic used by server and browser
   finance.ts    mortgage engine: payment, schedule, affordability, rent vs buy, savings plan…
   taxes.ts      purchase taxes per comunidad autónoma
   offers.ts     comparison of the offers a user received from banks
   broker.ts     interview order, profile extras, red-flag rules for listings
   extract.ts    regex extraction of user facts and listing fields; payDoubt()
data/rates.json   market rates and Euribor, updated by hand
```

### How a message is handled

1. The browser posts the message to `/api/chat` with the user id header. The server stores it in `messages`, exactly in Claude API format.
2. `provider.ts` decides the mode.
3. **Claude mode** (`agent.ts`): if the user's context (profile, saved homes, notes, date, rates age) changed since the model last saw it, a `system`-role snapshot is appended to the history. The request is fixed tools + fixed `INSTRUCTIONS` + the history. Claude answers or calls tools; `runToolCalls()` runs writing tools first, in order, then read-only tools in parallel; results go back to Claude. This repeats up to 16 steps. Text and tool activity stream to the browser over SSE, and every message is appended to the database.
4. **Local mode** (`local.ts`): regexes decide what the message is (an interview answer, a pasted listing, a bare link, a budget question, an offers question, a greeting, an open question). The matching tool runs with arguments from `shared/extract.ts`, and `summaries.ts` writes the answer. Only open questions go to Ollama, with a glossary and the user's context, and any euro figure in its answer that isn't from the user's data is flagged.
   After the answer, the code asks the next missing interview question, in the order set by `KEY_FACTS` in `shared/broker.ts`.
5. **No-AI mode**: the same router and code-written answers. Open questions get a short message explaining what works without a model.
6. Tools that change the profile return which saved homes changed verdict, so the answer can say that a saved home now fits (or no longer does) with the new salary.

### Architecture decisions

Each decision below solves a specific problem.

| Decision | Why |
| --- | --- |
| **Every figure comes from code in `shared/`.** Prompts tell Claude to use tools; local mode never lets the model produce numbers. | A model that estimates a payment or a tax is sometimes wrong and always sounds sure. A tested function is right or visibly broken, and every result can be explained. The engine is tested against the original spreadsheet. |
| **Rules that protect numbers are enforced in code**, not only in the prompt (`payDoubt()` rejects gross or yearly pay in `update_profile`). | Saving 30,000 € gross a year as monthly net pay inflates the budget and nothing fails. A prompt rule can be ignored; a thrown error can't. |
| **Ambiguous input is asked about, not guessed.** | Same reason: a wrong saved fact silently corrupts every later calculation. |
| **Local mode is a deterministic router, not a small agent.** | Measured with `scripts/bench-local.ts`: a 2B model on a CPU laptop picks the right tool but fills its arguments badly. Regexes plus code-written answers are instant and correct; the model only explains concepts. |
| **A bare link is handled by code, never by the model.** It is answered with "I can't open links" and saved, only on request, as a link-only home (price 0, `isLinkOnly()`) that is left out of every calculation. | A small model asked about a URL it cannot read answers as if it had read it, and says it saved a home that does not exist. |
| **One tool registry** for Claude, local mode and MCP. | One place to fix a tool, and the same behaviour everywhere. Conversations share one storage format, so a chat started locally can continue with Claude. |
| **Every tool declares `mutates`; writes run before reads.** | Claude may call `update_profile` and `evaluate_listing` in one step. Run in parallel, the evaluation could read the old salary with no error anywhere. |
| **The system prompt and tool list never change** (no date, no user data). User context goes into the history as a `system` snapshot, only when it changed. | Anything dynamic at the front of the request breaks prompt caching for the whole conversation and invalidates stored thinking blocks. |
| **Conversation history is append-only**, stored exactly as sent to the API, thinking blocks included. Long chats use the API's context editing instead of deleting messages. | Editing or removing a message invalidates every later thinking block and makes behaviour impossible to reproduce from the database. |
| **Profile changes are an append-only log** (`profile_facts`) next to the current profile. | The agent can say what the user said and when, and recalculate when something changes. |
| **Per-user isolation through `AsyncLocalStorage`.** Every store function filters by `currentUser()`; tests check isolation. | Several people can share one installation without passing a user id through every function, and a forgotten filter fails a test. |
| **Postgres in Docker, PGlite for `npm run dev`.** Plain SQL migrations applied at startup. | Real Postgres (with pgvector for later) in the packaged app, zero setup for development, and schema changes that are reviewable SQL. |
| **Web search limited to portals and official sources.** | Unrestricted search returns blogs that the model cites with the same confidence as the INE. |
| **Market offers are ranked by total cost and checked against the user in code** (`rankOffers()` in `shared/finance.ts`), with requirements stored as data. | The lowest first payment is usually a variable rate that rises after a year, and the cheapest offer on paper is useless if it needs a payroll the user does not have. |
| **Market rates in a hand-edited file**, with a warning after 30 days. | The only sources are comparison blogs; scraping them would be fragile and against the project's no-scraping rule. A visible age is better than a silent stale number. |
| **Runs on `127.0.0.1` only, no accounts.** | It holds personal financial data and is meant for one household's computer. Nothing leaves the machine except Claude API calls when a key is set. |
| **Unit tests never call a model; evals do.** | `npm test` is free, fast and deterministic. `npm run eval` checks real model behaviour (what was stored, which tools ran) after prompt or model changes. |


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
| `broker_notes` | What the agent noted to remember in later conversations |

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
npm test                         # engine, extraction, offers, tools, local mode, user isolation, the Finanzas link (no model calls)
npm run typecheck
node scripts/chat.mjs "hola" "tengo 30.000 ahorrados" "cobro 1.800 netos en 12 pagas"     # drive the chat from the terminal
node scripts/bench-local.ts qwen3:1.7b                   # measure a local model on this machine
npm run eval                     # scripted conversations against the real Claude API (needs a key, costs money)
```

Set `BROKER_LOG_USAGE=1` to print token and cache usage for every model call.

Schema changes go in `server/migrations/`, and migrations run at startup.

## Updating the bank rates

Market offers and the Euribor live in one hand-edited file, `data/rates.json`. The app warns when it is more than 30 days old. To update it:

1. Open the pages listed under `sources` in the file (comparison sites and each bank's own page).
2. Set `updated` to today (`YYYY-MM-DD`) and update `euribor` (`monthlyAvg`, `month`, `daily`, `dailyDate`).
3. For each offer, check `tinBonif`, `tinNoBonif`, `tae`, `openingFee` and, for variable and mixed ones, `initialYears` and `diffBonif`. Add or remove offers as banks change them; each needs a unique `id`.
4. Check the small print in `requirements`, which is what decides whether an offer is shown as available to a user:

   | Field | Meaning |
   | --- | --- |
   | `minLoan` | Smallest loan the bank grants |
   | `minHouseholdIncome` | Net monthly household income the bank demands (`minHouseholdIncomeCivilServant` if it is lower for civil servants) |
   | `payrollForBonus` | Payroll needed to get the discounted rate; below it the offer is priced at `tinNoBonif` / `diffNoBonif` |

5. Run `npm test`: one test validates the file, so a typo or a missing field fails with the offer's id.
6. Reload the page. In Docker the file is mounted, and both the agent and the web read it on the fly, so no rebuild is needed.

In Claude Code you can also ask it to do steps 1 to 5 ("update the rates in data/rates.json from its sources") and review the diff.

## Known limitations

- It does not search listings or open links: Idealista forbids scraping and its API needs approval. You search, then paste the listing text or use the «Guardar en Bróker IA» bookmark, which reads the page in your own browser; the agent evaluates. A bare link can only be saved, not analysed.
- The bookmark works on desktop browsers only. On a phone, paste the text or save the bare link.
- Listing parsing and red flags are text rules tuned to Idealista text copied from the page. Unusual wording can be missed in either direction, so each flag shows its evidence and missing fields are listed.
- The offer comparison assumes Euribor stays at today's value and that insurance costs the same every year.
- In local mode screenshots can't be read (paste the text instead), and answers to open questions come from a 2B model: fine for concepts, weak for nuanced advice.
- Users have no passwords. This is meant to run on your own machine; don't expose it to a network.
- Figures are guidance, not financial advice. Taxes and youth reductions have conditions, and banks set the real terms.

## Privacy

Everything stays on your computer. The only outside calls are to the Claude API, and only when you add a key. Personal files (`.env`, `data/pglite/`, spreadsheets, database dumps) are listed in `.gitignore`.
