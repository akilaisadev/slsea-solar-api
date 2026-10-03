# AI Disclosure Log (source for Report Appendix A)

**AI aid:** Claude Code (Anthropic), model Claude Opus 5.5 (`claude-opus-5-5`), run in the Claude desktop app.
**Used for:** generating code, tests, the OpenAPI document and supporting docs, under my direction.
**Not used for:** the prose of the report.

Each increment records the prompt I gave, what was generated, and what the review against the WSO2 REST API Design Guidelines and the module's "generator mistake" checklists caught and changed. Only issues that actually happened are listed.

---

## Directing prompts (session start, 2026-10-03)

1. "check up the project cw markings and list down all requirements briefly", with the brief, rubric and report template attached.
2. "now go on make CW to gain highest marks before that learn wso2 api guidelines and all also this CW stuffs https://github.com/nirangadh/NB6007CEM-Web-API-Development/tree/dev use my gh cli access and u can read these are the lecture materials go on make plan"
3. My design choices, given when the AI asked: Node.js + Express (as taught), Render + Neon Postgres, a GitHub Actions device simulator, and a deadline a month or more away.
4. I approved the build plan: the resource map, scopes, error schema and the 14 increments.

---

## Increment 1: Scaffold (Express 5, error contract, negotiation)

**Generated:** `src/app.js`, `src/server.js`, `src/config.js`, `src/lib/errors.js`, `src/lib/urls.js`, `src/middleware/{negotiate,allow,errorHandler}.js`, `src/routes/{health,errors}.js`, `test/scaffold.test.js` and the CI workflow.

**Review findings and fixes:**

| # | Finding | Guideline | Fix |
|---|---|---|---|
| 1 | The 415 error was raised as `new ApiError(415_01, ...)`. JavaScript reads the numeric separator as 41501, so it worked, but it doesn't match the catalogue key's spelling and would be hard to explain. | Code clarity / §11 | Changed to the literal `41501`. |
| 2 | A `GET /errors` listing route returned a bare JSON array, while every domain collection is planned to use the §10.3 paginated shape `{count, offset, limit, next, previous, items}`. That would make the representation inconsistent. | §6 / §10.3 consistency | Removed the listing. Only `GET /errors/{error-code}`, the `more_info` target, remains. |
| 3 | Express generates weak ETags automatically and answers `If-None-Match` itself, which would hide how conditional GET works. | §10.4 | Set `app.set('etag', false)`. ETags will be generated explicitly per resource in increment 8. |
| 4 | Behind Render's TLS proxy, `req.protocol` would report `http`, so absolute `Location`/`more_info` URLs would be wrong. | §5.2 (HTTPS) | Set `app.set('trust proxy', 1)`. |
| 5 | The `.gitignore` from the initial commit ignored `.env.*`, which would have silently kept `.env.example` and `.env.test` out of the repository. | Deployment reproducibility | Narrowed it to `.env` and `.env.local`. |

**Plan deviation (increment 1):** the Docker daemon wasn't running locally, so local development uses the existing Homebrew PostgreSQL 16 (`slsea_dev` and `slsea_test` databases) instead of docker-compose. CI uses a `postgres:16` service container.

---

## Increment 2: Data model and schema

**Prompt context:** the approved plan, §1 "Data model" (five-entity hierarchy plus User; inverter_id as an attribute; append-only readings).

**Generated:** `docs/data-model.md` (implementation-independent Mermaid ER), `db/schema.sql`, `scripts/migrate.js`, `test/schema.test.js`.

**Review findings and fixes:**

| # | Finding | Guideline | Fix |
|---|---|---|---|
| 1 | The first `updated_at` trigger test compared timestamps with `>=` inside one transaction. Because `now()` is fixed for the whole transaction, the test would pass even if the trigger didn't exist. | Test validity | The fixture now inserts the installation with `updated_at = 2000-01-01`, and the test asserts that the update replaces it. |
| 2 | Checked against the S1 "generator mistakes" list: no Device entity, no `last_power`/`last_*` fields on the installation, no format names (`json_payload`) in the model, and the User is never a data producer. | WSO2 §3, S1 notes | Nothing to change; recorded as a deliberate check. |
| 3 | "Append-only" was only a convention (no PUT/DELETE routes). | Brief §3 | Added a `BEFORE UPDATE OR DELETE` trigger that rejects row changes, with tests proving it. TRUNCATE stays possible for the seed reset, which is a maintenance-only operation. |

---

## Increment 3: Deterministic seed data

**Prompt context:** the approved plan, §5 "Seed data" (real provinces and districts, 200+ installations, more than a week of 15-minute readings, a daytime curve, FK consistency). The S2 notes warned that generated seed data often has broken foreign keys.

**Generated:** `scripts/lib/seed-data.js` (reference data and the installation list), `scripts/lib/solar-model.js` (hash-based deterministic generation model), `scripts/lib/device-secrets.js`, `scripts/seed.js`, `scripts/check-seed.js`, `src/lib/credentials.js`.

**Review findings and fixes:**

| # | Finding | Guideline | Fix |
|---|---|---|---|
| 1 | **The checker caught a brief violation in the seed itself.** With 8 days of history, the three "maintenance" sites (which stop reporting two days before the end) had only 6 days, failing "1 week or more per installation" (236 of 239 passed). | Brief §4 | Seeded 9 days instead. Re-check: 239 of 239 reporting sites have 7+ days. |
| 2 | The weighted substation pick decremented a variable inside a `findIndex` callback. It was correct but hard to read and explain. | Code clarity | Extracted a plain `pickWeighted(weights, u)` loop. |
| 3 | The sequence reset rebuilt the entire installation list just to find the highest ID number, which is always 240. | Simplicity | Replaced with `setval(..., INSTALLATION_COUNT)`. |
| 4 | Generated seeds usually use `Math.random()`, so the data changes on every run and a simulator can't reproduce past values. | Viva explainability | Every value is a pure hash of (installation, time slot). The seed and the simulator compute identical readings, so a re-sent slot is a genuine duplicate (409). |

**Evidence (full seed, local):** 9 provinces, 25 districts, 32 substations, 240 installations, 5 users and 206,159 readings. No orphaned foreign keys, zero generation in all 83k+ overnight readings, and no decreasing energy counters. The `npm run db:check` table output is a report screenshot candidate.
