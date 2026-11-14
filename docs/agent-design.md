# How the agent works, and why

This document explains the design of the Claude path of the agent (`server/agent.ts`, `server/tools.ts`): what each mechanism does, the problem it solves, where the code is, and how to check it is working. It was written alongside the November 2026 round of improvements, so each section also says what changed.

Read the "What has not been verified" section at the end before relying on any of this in production.

## Contents

1. [The shape of a request](#1-the-shape-of-a-request)
2. [Context snapshots live in the history](#2-context-snapshots-live-in-the-history)
3. [Prompt caching](#3-prompt-caching)
4. [Long conversations](#4-long-conversations)
5. [Tool calls: writes before reads](#5-tool-calls-writes-before-reads)
6. [Gross or yearly pay is rejected in code](#6-gross-or-yearly-pay-is-rejected-in-code)
7. [Cut-off answers and the step limit](#7-cut-off-answers-and-the-step-limit)
8. [Web search and stale rates](#8-web-search-and-stale-rates)
9. [Notes: memory across conversations](#9-notes-memory-across-conversations)
10. [The eval suite](#10-the-eval-suite)
11. [Two suggestions that needed no change](#11-two-suggestions-that-needed-no-change)
12. [What has not been verified](#12-what-has-not-been-verified)
13. [Files changed](#13-files-changed)

---

## 1. The shape of a request

Every step of a turn sends one request to the Claude API. The API reads it in a fixed order: tools, then the system prompt, then the messages.

| Part | Content | Changes when |
| --- | --- | --- |
| `tools` | The tool registry plus web search | Only when the code changes |
| `system` | `INSTRUCTIONS`, the broker's rules | Only when the code changes |
| `messages` | The stored conversation | Grows by appending; earlier messages never change |

Two features of the API depend on the beginning of the request staying identical from one request to the next:

- **Prompt caching.** The API can reuse work it already did for a prefix it has seen before, at 5 % of the normal input price on Claude Opus 5.5. One changed character at position N means everything after N is paid in full.
- **Thinking blocks.** Claude's reasoning is stored in the history, as CLAUDE.md requires. On current models each stored block is tied to the system prompt, the tool set and the messages that came before it. If any of those change, the block is no longer valid. On Anthropic accounts created after 31 August 2026 the API rejects such a request with a 400 error.

So the design rule is: **nothing at the front of the request may depend on the user, the date or the turn.** `buildRequest()` in `server/agent.ts` builds the request, and a test in `server/broker.test.ts` ("la petición a Claude: prompt fijo…") checks the rule without calling the model.

## 2. Context snapshots live in the history

**Before.** The system prompt had a second block with today's date, the profile and the saved homes. It was rebuilt on every step of the loop.

**The problem.** That block sat in front of the whole conversation. Whenever it changed (a new day, or `update_profile` running in the middle of a turn) the cache for the entire history was lost, and every stored thinking block became invalid.

**Now.** The system prompt is only `INSTRUCTIONS`. The user's context is a *snapshot*: a message with role `system` that the server appends to the conversation, right after the user's message.

```
user       "Me han subido el sueldo…"
system     <contexto_actual> date, profile, homes, notes </contexto_actual>
assistant  …
```

Rules, all in `runClaude()`:

- A snapshot is appended **once per turn, and only if it differs** from the last one the model saw. A chat on the same day with no profile change adds none.
- Inside a turn no new snapshot is added. If a tool changes the profile, the model reads the new values in the tool's result.
- Snapshots are stored in the `messages` table like any other message. Migration `004_system_messages.sql` allows the `system` role. The history stays append-only.
- `toDisplay()` skips them, so the chat UI never shows them. Local mode ignores them.

**One edge case.** If a turn is interrupted right after its snapshot is stored, that snapshot has no reply after it, and the API requires one. `apiMessages()` leaves such a snapshot out of the request. No reply was ever generated with it, so omitting it changes nothing the model has seen. The row stays in the database, and the next turn adds a fresh snapshot.

**Models.** Mid-conversation system messages exist on Claude Opus 4.8 and later, the Fable and Mythos models, Sonnet 5.5 and Haiku 5.5. For any other `ANTHROPIC_MODEL`, `apiMessages()` sends the same text as a user message wrapped in `<system-reminder>`.

## 3. Prompt caching

**Before.** One cache point, on the system prompt. The conversation itself was never cached, so each of the up to 16 steps in a turn paid full price for the whole history.

**Now.** Two cache points, both in `buildRequest()`:

1. On `INSTRUCTIONS`. This covers the tools and the system prompt, which are the same for every user and conversation.
2. The top-level `cache_control`, which places a cache point on the last block of the history automatically. Step N+1 of a turn reads everything up to step N from cache. So does the next turn, if it starts within 5 minutes.

The tool definitions are computed once per process, in a fixed order, so they are byte-identical on every request.

**How to check.** Start the server with `BROKER_LOG_USAGE=1`. Each step prints a line:

```
[claude] paso 2: entrada sin caché 412 · leída de caché 9830 · escrita en caché 655 · salida 240
```

From the second step on, "leída de caché" should be the large number. If it is 0, something at the front of the request is changing. The `cache` case in the eval suite checks the same thing.

## 4. Long conversations

**The problem.** Tool results are large (a full listing evaluation is a few hundred tokens of JSON) and old ones are rarely needed again. Nothing limited how much history was sent.

**Why not delete old messages.** Two reasons. CLAUDE.md says the history is never edited. And removing a message from the middle invalidates every later thinking block.

**Now.** `buildRequest()` turns on the API's context editing. When the input passes 40,000 tokens, Anthropic's server leaves old tool results out of what the model reads, keeping the 6 most recent. It only acts if that frees at least 8,000 tokens, because each clearing forces the cache to be rewritten from that point.

This happens on Anthropic's side, per request. The database keeps every message, and the request we send is still the full history. If Claude needs an old result again it calls the tool again; the tools are cheap and deterministic.

**Thinking blocks and code changes.** Editing `INSTRUCTIONS` or adding a tool changes the front of every existing conversation. This round did both. So the request sets `prefix_mismatch_behavior: "drop_block"`: when a stored thinking block no longer matches, the API drops that block and answers anyway, instead of returning an error. The cost is that Claude loses its earlier private reasoning in that conversation; the visible messages and tool results are all still there. With `BROKER_LOG_USAGE=1` the log line says when blocks were dropped.

## 5. Tool calls: writes before reads

**The problem.** Claude can ask for several tools in one step. They all ran at once with `Promise.all`. For "ahora cobro 2.600, ¿me llega para este piso?" Claude may call `update_profile` and `evaluate_listing` together, and the evaluation could read the profile before the new salary was saved. The verdict would be computed with old numbers, with no error anywhere.

**Now.** Every tool in `TOOLS` declares `mutates: true` (writes to the database) or `mutates: false` (reads or calculates). `runToolCalls()` in `server/tools.ts`:

1. runs the writing tools first, one at a time, in the order Claude asked for them;
2. then runs the read-only tools in parallel;
3. returns one result per call, in the original order, including failures.

When you add a tool, set `mutates` honestly. A tool marked `false` that writes brings the race back.

**Test.** "varias herramientas a la vez…" asks for the evaluation before the profile update and checks the result equals an evaluation made afterwards.

## 6. Gross or yearly pay is rejected in code

**The problem.** CLAUDE.md says ambiguous input is asked about, never guessed. Local mode enforced that in `shared/extract.ts`. The Claude path enforced it only with a sentence in the prompt. Saving 30,000 € gross a year as net monthly pay inflates the budget enormously, and nothing fails.

**Now.** `payDoubt()` in `shared/extract.ts` compares the pay Claude wants to save with the user's own words, which `update_profile` already receives in `note`. It refuses when:

- the note says "bruto" and does not also mention the net amount;
- the net pay per payslip is above 15,000 €;
- the note talks about a yearly amount and gives no monthly or per-payslip figure.

On refusal `update_profile` throws before writing anything. The error text tells Claude what to ask and that it can call again without the pay to save the other fields.

Two softer additions to the result of `update_profile`:

- `avisos`: a warning when pay is given without the number of payments. The engine assumes 12, and the warning tells Claude to ask.
- `viviendas_que_cambian_de_veredicto`: the saved homes whose verdict changed, already filtered.

**Local mode is exempt** (`ctx.checked = true` in `local.ts`). Its arguments come from the deterministic extractor, which already drops gross and yearly figures. Without the exemption, "tengo 40.000 ahorrados y cobro 30.000 brutos" would stop saving the savings.

**Limit.** This is a text check, so it can be wrong in both directions. It catches the common cases, and the prompt still tells Claude to ask.

## 7. Cut-off answers and the step limit

**Answer cut by length** (`stop_reason: "max_tokens"`). Before, the user saw the partial text and an error, and the text was never stored, so it vanished on reload. Now the text written so far is stored, a fixed user message (`CONTINUE`) asks Claude to carry on, and the loop continues. This happens at most once per turn. Half-written tool calls are discarded because their arguments may be incomplete. `toDisplay()` hides the `CONTINUE` message, so the chat shows one answer.

**Step limit** (`MAX_STEPS = 16`). Before, the turn ended with "He hecho demasiados pasos". Now the server appends a system message saying the limit was reached and makes one more request with `tool_choice: none`. Claude writes a summary of what it did and what is pending. The tools stay declared in that request, because removing them would change the front of it.

## 8. Web search and stale rates

**Web search.** It was unrestricted, so a price-per-m² search could return any blog, cited with the same confidence as the INE. It is now limited with `allowed_domains` to property portals and official sources. The list is `DEFAULT_SEARCH_DOMAINS` in `server/agent.ts`. Set `WEB_SEARCH_DOMAINS` to a comma-separated list to replace it, or to `*` to remove the limit. The prompt tells Claude to say so when it finds nothing reliable.

**Stale rates.** `data/rates.json` is updated by hand. When it is more than 30 days old (`RATES_STALE_DAYS`):

- the context snapshot says so,
- `mortgage_offers` and `compare_bank_offers` return an `aviso_datos` field,
- local mode adds a warning line to its mortgage summary.

I did not build an automatic refresh. The sources are blog pages, and scraping them would be fragile and against the spirit of the "does not scrape" limitation in the README.

## 9. Notes: memory across conversations

**The problem.** The profile and the saved homes persist, but reasons do not. "I ruled out Vallecas because of my partner's commute" lived only in the conversation where it was said.

**Now.**

- Table `broker_notes` (migration `005_broker_notes.sql`), one row per note, with `user_id`.
- Store functions `addNote`, `listNotes`, `removeNote`, all filtered by `currentUser()`.
- Tools `save_note` and `remove_note`. `get_profile` returns the notes too.
- The 12 most recent notes are part of every context snapshot, so a new conversation starts with them.
- `GET /api/notes` and `DELETE /api/notes/:id`, so notes can be read and deleted without going through the model.
- An isolation test: another user cannot see or delete them.

The prompt tells Claude what belongs in a note (decisions, reasons, what a bank or agency said, preferences) and what does not (financial facts go to `update_profile`; remarks about a saved home go to `update_home`).

**Not done.** There is no screen for notes in the web UI. Today you see them by asking the agent or calling the endpoint. Local mode does not write notes, because its router is deterministic and has no rule for them.

## 10. The eval suite

`npm test` never calls a model, by design. That means a prompt change or a model change can break behaviour with every test still green. `scripts/eval-claude.ts` fills that gap:

```bash
npm run eval                 # all cases
npm run eval -- bruto cache  # only the cases whose name contains one of these words
```

It runs scripted conversations against the real Claude API on an in-memory database, one fresh user per case, and checks what was actually stored and which tools were called.

| Case | Checks |
| --- | --- |
| `bruto` | Gross yearly pay is not saved, and the agent asks for the net |
| `perfil` | Clear facts are saved with the number of payments, and a budget figure is given |
| `anuncio` | A pasted listing is evaluated with its full description and not saved unasked |
| `orden` | A salary change and a listing in one message: the listing uses the new salary |
| `oferta` | An offer with an unpriced insurance: the agent asks the price before recommending |
| `memoria` | A decision with its reason becomes a note |
| `cache` | The second turn reads from the prompt cache |

It costs money (about 15 model requests) and needs `ANTHROPIC_API_KEY`. Run it after changing `INSTRUCTIONS`, a tool description or `ANTHROPIC_MODEL`. It prints token usage per case, which makes it the easiest way to see whether caching works.

## 11. Two suggestions that needed no change

Two points from my first review turned out to be wrong once I read the rest of the code:

- **"Anyone on the network can read the data."** Not true. `server/index.ts` listens on `127.0.0.1` unless `HOST` is set, and `docker-compose.yml` publishes the port on `127.0.0.1` only. I made no change. The README's existing warning still applies: there are no passwords, so do not set `HOST` to a public address.
- **"Compute in code which saved homes change verdict."** `update_profile` already returned the verdict before and after for every saved home, and local mode already wrote that summary. I only added the pre-filtered `viviendas_que_cambian_de_veredicto` list.

## 12. What has not been verified

There was no API key on the machine where this was written, so **nothing in the Claude path was run against the real API**. What was checked:

- `npm run typecheck` is clean against the installed SDK (`@anthropic-ai/sdk` 1.8.0), which has types for every request field used.
- `npm test` passes (67 tests), including new tests for request shape, snapshot handling, tool ordering, the pay check, notes and isolation.
- The server starts on a fresh database, applies both migrations, and local mode behaves as before.

What only a real run can confirm:

- That the API accepts this combination of beta features together: server-side fallbacks, context editing, and the thinking-block controls.
- That caching hits as expected.
- That Claude follows the new prompt sections (notes, warnings) the way the eval cases expect.

**First thing to do with a key:** `npm run eval`. If a request is rejected, the error names the field. The three features are independent, so one can be removed from `buildRequest()` without affecting the others.

## 13. Files changed

| File | Change |
| --- | --- |
| `server/agent.ts` | Frozen system prompt, context snapshots, `buildRequest()`, `apiMessages()`, caching, context editing, cut-off and step-limit handling, search domains, usage log |
| `server/tools.ts` | `mutates` on every tool, `runToolCalls()`, pay check in `update_profile`, `avisos`, notes tools, rates age warning |
| `server/store.ts` | `system` messages, notes functions |
| `server/local.ts` | Ignores `system` messages, marks its arguments as already checked |
| `server/summaries.ts` | Stale-rates line in the local mortgage summary |
| `server/index.ts` | `/api/notes` endpoints |
| `shared/extract.ts` | `payDoubt()` |
| `shared/chat.ts` | Labels for the two new tools |
| `server/migrations/004_system_messages.sql` | Allows role `system` in `messages` |
| `server/migrations/005_broker_notes.sql` | `broker_notes` table |
| `scripts/eval-claude.ts` | New eval suite (`npm run eval`) |
| `server/broker.test.ts`, `shared/extract.test.ts` | 9 new tests |

New environment variables, all optional: `BROKER_LOG_USAGE=1`, `WEB_SEARCH_DOMAINS`.
