# Possible improvements

A list of ideas for the next rounds of work, grouped by area and roughly ordered by value for effort within each group. None of these is started. Each one says why it matters and what it would touch, so it can be picked up on its own.

Anything that changes `INSTRUCTIONS`, a tool description or the model must be followed by `npm run eval`. New tables need `user_id` and an isolation test (see `CLAUDE.md`).

## Contents

1. [Verify what exists](#1-verify-what-exists)
2. [Numbers and financial accuracy](#2-numbers-and-financial-accuracy)
3. [Listings](#3-listings)
4. [Bank offers](#4-bank-offers)
5. [Knowledge base (the reserved pgvector)](#5-knowledge-base-the-reserved-pgvector)
6. [Agent behaviour](#6-agent-behaviour)
7. [Local mode](#7-local-mode)
8. [User interface](#8-user-interface)
9. [Data, privacy and operations](#9-data-privacy-and-operations)
10. [Ideas from louisbyun/mortgage-ai](#10-ideas-from-louisbyunmortgage-ai)
11. [Not recommended](#11-not-recommended)

---

## 1. Verify what exists

Do these before adding features. They are cheap and they tell you whether the current design works.

- **Run `npm run eval` with a real key.** `docs/agent-design.md` §12 says the Claude path (server-side fallback, context editing, thinking-block controls together) has never run against the API. Record the cache-read numbers from `BROKER_LOG_USAGE=1` in that doc.
- **Grow the eval suite.** Today it has 7 cases. Add: a co-buyer whose pay comes in a later message; a user who changes region (taxes must change); a listing screenshot; a user who asks for a figure the tools can't compute (the agent must say so, not estimate); an offer with a mixed rate; a turn that hits `MAX_STEPS`.
- **Record eval results over time.** Write each run to `data/evals/<date>.json` (git-ignored) with pass/fail and token usage, so a model or prompt change can be compared with the last good run.
- **Golden tests for the tax table.** One test per comunidad autónoma, with a resale home, a new build and a youth case, each checked against the official regional source. Tax rules change every January.

## 2. Numbers and financial accuracy

- **Euribor scenarios in the offer comparison.** The comparison assumes Euribor stays at today's value (README, Known limitations). Add three paths (flat, +1 pt, −1 pt, or a forward curve entered by hand) and show the cost range for variable and mixed offers. Touches `shared/offers.ts` and `compare_bank_offers`. This is the most useful "rate sensitivity" feature for Spain.
- **Insurance that changes with age.** Life insurance premiums rise every year. Let a linked product's yearly cost grow by a percentage, and use it in "does this bonificación pay for itself".
- **TAE computed by the engine.** Compute the TAE of each received offer from its cash flows (fees, linked products) using the Banco de España method, and show it next to the bank's stated TAE. A mismatch is worth flagging.
- **Stress test on the budget.** "If Euribor rises 2 points, your payment goes from X to Y, and your debt ratio from A % to B %." Code-computed, shown in the listing verdict for variable and mixed offers.
- **Bank-specific affordability rules.** Some banks use 30 %, others 35–40 %, and treat temporary contracts or self-employed income differently. Keep a per-bank rule table next to `data/rates.json` and run affordability per bank.
- **Aval ICO / youth guarantee.** Model the public guarantee for young buyers (financing above 80 %), with its income and age limits, as a separate scenario. Check current conditions before coding them.

## 3. Listings

- **Price per m² against the zone.** Compare the listing's €/m² with a reference for the area (INE, notaries' or registrars' statistics, entered as a dated table in `data/`). Show it as context, never as a valuation.
- **Appraisal gap warning.** Banks lend on the lower of price and appraisal. Let the user enter the appraisal when they have it and recompute the cash needed if it comes in below price.
- **Better parsing for other portals.** The rules are tuned to Idealista text. Add test fixtures from Fotocasa, pisos.com and Habitaclia copies, and adjust `parseListingText()`.
- **Checklist per home status.** When a home moves to `visitar` or `oferta`, generate its checklist (nota simple, certificado de la comunidad, IBI, ITE, cargas). Pure code, per red flag.
- **Price-drop alerts on saved homes.** `home_prices` already stores history. Show the drop and the days on market when the user pastes the same listing again.

## 4. Bank offers

- **Read a FEIN or offer PDF with Claude.** Today offers are typed into the form or pasted. Let the user upload the FEIN; Claude extracts the fields into `save_bank_offer`, the user confirms them in the form before saving. Keep local mode on the form.
- **Negotiation helper.** Given two offers, compute what the more expensive bank would have to change (spread, fee, one product) to become cheaper, and write it as a message the user can send. Figures from code; wording from the model.
- **Offer expiry.** FEIN offers are binding for a period. Store the expiry date and remind the user in the context snapshot.

## 5. Knowledge base (the reserved pgvector)

`docker-compose.yml` already runs Postgres with pgvector "for the RAG of the next phase". A small, curated corpus would let the agent answer rule questions with citations instead of from memory.

- **Corpus:** Ley 5/2019 de crédito inmobiliario (key articles), Banco de España customer guides, regional tax rules for the current year, the notaries' and registrars' guides for buyers. Only official sources, each chunk with URL and date.
- **Tool:** `search_rules(query)` returning chunks with source and date; `mutates: false`. The prompt says rule answers must cite a chunk or say "no lo sé".
- **Local mode:** the same retrieval can feed the local model's open answers, which today only have `GLOSSARY`. Retrieval is deterministic, so it fits the local-mode rules.
- **Freshness:** a `corpus_updated` date surfaced like the stale-rates warning.
- **Not per user:** this table holds public documents only, so it is the one table without `user_id`. Say so in the migration.

## 6. Agent behaviour

- **Notes screen in the UI.** Notes can only be seen through the agent or `GET /api/notes` (agent-design §9). Add a list with delete.
- **Notes in local mode.** A rule for "apunta que…" / "recuerda que…" that saves the sentence verbatim as a note.
- **Explain a figure.** A tool `explain_figure(field)` that returns the inputs and formula of a computed value ("¿de dónde sale esa cuota?"). Builds trust and is easy since everything is in `shared/`.
- **Proactive check-ins.** When the context snapshot shows rates are stale, a saved home dropped in price, or an offer is about to expire, the agent mentions it once at the start of the turn.
- **Cost guard.** A per-user daily token budget, with the usage already logged by `BROKER_LOG_USAGE`.

## 7. Local mode

- **Re-measure newer small models** with `scripts/bench-local.ts` every few months. If one fills arguments reliably on the benchmark cases, consider letting it call *read-only* tools only, keeping writes deterministic.
- **Screenshot text in local mode** with on-device OCR (for example Tesseract) feeding `parseListingText()`. Keeps the "no network" promise.
- **Router coverage report.** Log which messages fell through to the model (no rule matched), locally only, to find the next rules to write.

## 8. User interface

- **Timeline of the user's situation** from `profile_facts`: what changed and how the budget moved.
- **Side-by-side home comparison** with the same cash-needed and monthly-cost breakdown.
- **Export a report** (PDF or Markdown) of the profile, chosen home and offer comparison, to take to a bank or share with a partner. Demo data in any screenshot.
- **Mobile layout pass.** Buyers paste listings from their phone.

## 9. Data, privacy and operations

- **Export and delete my data** per user (JSON export; delete already cascades via `users`).
- **Optional PIN per user** for shared family computers. Still local-only; not a substitute for real auth.
- **Backups:** a documented `pg_dump` command and restore test in the README.
- **Rates update helper:** a script that opens the source pages listed in `data/rates.json` and prints a checklist for a manual update, rather than scraping them (agent-design §8 explains why).
- **CI:** run `npm test` and `npm run typecheck` on every push (GitHub Actions). Evals stay manual because they cost money.

## 10. Ideas from louisbyun/mortgage-ai

I reviewed [louisbyun/mortgage-ai](https://github.com/louisbyun/mortgage-ai) on 2026-11-14. **The repository contains only a README and three images; there is no source code**, so everything below comes from its description and could not be checked.

What it describes: a Langflow pipeline that classifies the user's intent and routes it to (a) RAG over vectorised mortgage regulations in Supabase/pgvector (LTV limits, debt-to-income thresholds, compliance), (b) a deterministic mortgage calculator tool with principal/interest breakdown and interest-rate sensitivity analysis, (c) a URL fetcher for live market rates, or (d) direct LLM reasoning. The model is Llama 3.1 on Groq for low latency, with a Vercel front end.

What Bróker IA already does the same way or better:

- **Deterministic calculator.** Same idea, but here it is tested against a spreadsheet and covers taxes, offers, rent vs buy, savings plans and early repayment.
- **Intent routing.** Local mode already routes with deterministic rules; the Claude path lets the model choose tools.

What is worth taking:

| Idea | How it maps here | Section |
| --- | --- | --- |
| RAG over regulations with grounded answers | `search_rules` over official Spanish sources in the existing pgvector | §5 |
| Interest-rate sensitivity analysis | Euribor scenarios and budget stress test | §2 |
| Live market rates | Keep the manual `data/rates.json`, but add the update checklist script; avoid scraping | §9 |
| Fast open-model inference as a cheap tier | Optional OpenAI-compatible endpoint (Groq or similar) as a fourth provider in `provider.ts`, **for conversation only**, under the same local-mode rules (no tool arguments from the model) until it passes `bench-local.ts`. Note that this sends user messages to a third party, so it must be opt-in and stated in the README's Privacy section | — |

What not to take: an unrestricted URL fetcher. Bróker IA restricts web search to official and portal domains on purpose (agent-design §8).

## 11. Not recommended

- **Scraping Idealista or bank sites.** Against their terms and fragile. The README states the agent evaluates, the user searches.
- **Letting any model produce figures** "just for estimates". It breaks the project's main promise.
- **Putting the date or user data back into the system prompt** for convenience. See agent-design §1–2.
- **Hosting it for other people** without real authentication, encryption at rest and a privacy review.
