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

---

## Increment 4: Deployment configuration and Swagger UI

**Prompt context:** the approved plan, increment 4 "Deploy early" (Render + Neon, live `/health`, Swagger at `/docs`). The S2 notes stress `process.env.PORT` and a start command that matches the entry file.

**Generated:** `render.yaml` (Blueprint, Singapore region, `/health` health check, deploy only after CI passes), `openapi/openapi.yaml` (OpenAPI 3.1 skeleton: security schemes, shared headers, `Error` schema, standard responses), `src/routes/docs.js` (Swagger UI and `/openapi.json`), `test/docs.test.js`.

**Review findings and fixes:**

| # | Finding | Guideline | Fix |
|---|---|---|---|
| 1 | `swagger-ui-express` pulls in `@scarf/scarf`, which runs an install-time analytics script. npm 12 blocked it with a warning. | Supply-chain hygiene | Denied it explicitly (`allowScripts: {"@scarf/scarf": false}` in `package.json`), so no telemetry runs in local or Render builds. |
| 2 | The global JSON-only `Accept` rule (406) would also apply to Swagger UI, which browsers request as `text/html`. | §10.1 vs. usability | Mounted the docs router before the negotiation middleware. A test checks that `/docs/` returns HTML. |
| 3 | helmet's default Content-Security-Policy can break Swagger UI. | Security headers | Checked in the browser: Swagger UI loads with no console errors, so the default CSP stays as is. |

---

## Increment 5: Hierarchy and installation read endpoints

**Prompt context:** the approved plan, increment 5: collections and atomic resources for provinces, districts, grid substations and installations; snake_case representations; member 404s; the §10.3 paginated collection shape; jurisdiction scoping built into every query before auth exists.

**Generated:** `src/routes/{api,provinces,districts,gridSubstations,installations}.js`, `src/repositories/{page,hierarchy,installations}.js`, `src/representations.js`, `src/lib/{validate,pagination,sql,jurisdiction,respond}.js`, `test/{hierarchy,jurisdiction}.test.js`, and OpenAPI paths and schemas.

**Review findings and fixes:**

| # | Finding | Guideline | Fix |
|---|---|---|---|
| 1 | node-postgres converts a SQL `DATE` into a JavaScript `Date` at local midnight. On a UTC+05:30 machine, `commissioned_on = 2023-04-02` would have serialised as `"2023-04-01T18:30:00.000Z"`: the wrong day, plus a time the field doesn't have. | §6 representation | Added a type parser that keeps DATE as a `YYYY-MM-DD` string. A test asserts the format. |
| 2 | **Redocly lint found broken OpenAPI.** Unquoted descriptions containing commas inside YAML flow mappings (`{ ... }`) were parsed as extra keys (e.g. `stable description of the error code`), so the published schema was wrong. | Documentation accuracy | Quoted those descriptions. Lint now reports only the expected `security-defined` errors, which increment 9 resolves. |
| 3 | A collection's `Last-Modified` computed as `max(updated_at)` over the *visible* rows wouldn't move when an installation is decommissioned, because the row leaves the set. A client using `If-Modified-Since` would then get a false 304 for a list that had changed. | §10.4 correctness | The installations list uses the table-wide `max(updated_at)`. It's coarser, but it can never claim "not modified" wrongly. |
| 4 | With default (non-strict) schemas, unknown query parameters such as `?district_id=` (underscore typo) would be silently ignored and return unfiltered data. | §5.7, client feedback | All query schemas are strict: unknown parameters get 400 and are named in `errors[]`. |
| 5 | The installation query pushed a raw string straight into `conditions.clauses`, bypassing the `Conditions` API that guarantees client values are bound parameters. | SQL-injection hygiene | Added `addFixed()` for constant conditions; every client value goes through `add()`/`bind()`. |
| 6 | S3 and S4 generator-mistake checklist: plural lowercase hyphenated collections (`/grid-substations`), no verbs, `{province-id}` URI-template variables in the spec, no global `/readings` yet, and seed data read from the database rather than per request. | §5.1, §5.6 | Verified. |
