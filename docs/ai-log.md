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

---

## Increment 6: Installation composite, last-reading and readings sub-collection

**Prompt context:** the approved plan, increment 6. The S5 and S6 notes define the composite (embed exactly one most-recent item, never the history), the processing-function resource (`/last-position`, named with a noun), and S6's three generator mistakes for the composite.

**Generated:** `src/repositories/readings.js`, `src/routes/{installationReadings,loaders}.js`, composite and reading representations, `test/installations.test.js`, and OpenAPI paths and schemas.

**Review findings and fixes:**

| # | Finding | Guideline | Fix |
|---|---|---|---|
| 1 | `installations.js` and `installationReadings.js` imported each other (circular dependency). It worked only because of ES-module evaluation order, which would be hard to defend. | Code structure | Moved `loadInstallation` into `src/routes/loaders.js`, which both routers import. |
| 2 | `GET /installations/{id}/readings/abc` would have passed `'abc'` to a `bigint` comparison, and PostgreSQL would reject the cast as a **500**. | §9 (404 vs 500) | Non-numeric reading IDs are answered with 404 before querying. Tested. |
| 3 | The composite changes when either the installation or its latest reading changes. Using only `installation.updated_at` as `Last-Modified` would let `If-Modified-Since` return a false "not modified" after a new reading arrived. | §8.2, §10.4 | `Last-Modified` is the later of `installation.updated_at` and `last_reading.received_at`. |
| 4 | S6 composite checklist: newest reading chosen by `ORDER BY recorded_at DESC` (not array order or ascending); `last_reading` is a nested object, not `last_power`/`last_*` flat fields; no history array embedded; `last-reading` named with a hyphenated noun. | §4.3, §4.5, §5.1 | Verified, with tests comparing against the database's newest row. |
| 5 | A reading lookup by ID alone would let `/installations/A/readings/{id of B's reading}` return B's data. | §4.6 scoping | The lookup is by (installation_id, reading_id). A test confirms the cross-parent read is 404. |

---

## Increment 7: Filtering, sorting, time windows and the regional readings view

**Prompt context:** the approved plan, increment 7, and brief §5 "Advanced behaviour": filtering by jurisdiction (province, district, substation) and by time window, sorting by timestamp both ways, and pagination over readings. WSO2 §5.7 and §10.2–10.3.

**Generated:** `src/routes/{queryParams,readings}.js`, filter and sort support in the repositories and list routes, `test/filters.test.js`, and OpenAPI parameters plus the `/readings` path.

**Design decision to defend:** `GET /readings` is a read-only regional view across installations. The S3/S4 notes call a global `/pings` a generator mistake because no police client needs every ping. Here the brief's analytical scope ("how generation has behaved over time, by region") is exactly that client need, so the §4 "clients win over data" test is met. Creation stays only in the scoped factory `/installations/{installation-id}/readings`, and results are always clipped to the caller's jurisdiction.

**Review findings and fixes:**

| # | Finding | Guideline | Fix |
|---|---|---|---|
| 1 | Offset pagination sorted only by `recorded_at` or `power_kw` has no total order: many sites report at the same instant, and every site reads 0 kW overnight. SQL gives no guarantee about the order of tied rows between two queries, so a row could be skipped or repeated across pages. | §10.3 correctness | Every sort appends the unique `reading_id` (installations: `installation_id`) as a tie-breaker. **Honest note:** I removed the tie-breaker temporarily, and the page-walk test still passed on this dataset, because PostgreSQL happened to return ties in a consistent order. The test documents the contract; it doesn't prove failure without the fix. |
| 2 | An explicit filter outside the caller's jurisdiction (a Colombo user asking for `?district-id=ds-04`) would only return an empty page, because the scope clause is ANDed. That doesn't leak data, but it hides the refusal. | §12, brief §10 | `jurisdictionFiltersOf()` resolves the filter's place in the hierarchy and returns **403** when it's outside the caller's jurisdiction. (Fully tested with tokens in increment 9.) |
| 3 | A time window with `from >= to`, or a non-ISO value like `from=yesterday`, would either error in SQL or silently return nothing. | §9 (400) | Validated as ISO 8601 with an offset; an empty window gets 400 with the field named. `from` is inclusive and `to` exclusive, so consecutive windows never double-count. |
| 4 | Sort keys could be passed straight into `ORDER BY` (SQL injection). | Security | Sort keys are an enum mapped through a fixed column whitelist (`SORT_COLUMNS`); the direction comes from an enum. |
| 5 | Measured cost: national unfiltered `/readings` (about 206k rows, with a count) takes 0.35–0.5 s locally; a single installation's history takes about 6 ms. | Performance | Acceptable at this scale. Recorded as a limitation for the critical evaluation (offset pagination plus `count(*)` versus keyset/cursor pagination). |

---

## Increment 8: Conditional GET and concurrency preconditions

**Prompt context:** the approved plan, increment 8; brief §5 "Conditional GET … not-modified response with an empty body"; WSO2 §8, §10.4 and §10.5.

**Generated:** `src/lib/conditional.js` (ETag, If-None-Match, If-Modified-Since, If-Match, If-Unmodified-Since), the updated `src/lib/respond.js`, `test/conditional.test.js`, and OpenAPI conditional parameters, validator headers and `304` on every GET (applied with a one-off script that edits the YAML document).

**Review findings and fixes:**

| # | Finding | Guideline | Fix |
|---|---|---|---|
| 1 | **Security:** the same URI returns different data to different jurisdictions. A shared cache (corporate proxy or CDN) that stored Colombo's `/installations` response could replay it to a Kandy user. | §10.4, §12 | Every representation is sent with `Cache-Control: private, no-cache` and `Vary: Authorization`. |
| 2 | A collection replay with the current ETag returned **200, not 304** in tests. The cause: bodies contain absolute `next`/`previous` URLs built from the `Host` header, and supertest uses a new port per request, so the bytes and the ETag genuinely differed. | §10.4 | Correct behaviour (in production the host is fixed and part of the cache key). The test pins `Host`, and the comment explains why. |
| 3 | HTTP dates have one-second precision, but `updated_at`/`received_at` have milliseconds. Comparing them directly would make `If-Modified-Since: <the exact Last-Modified sent>` look "modified" and always return 200. | RFC 9110 §13.1.3 | Both sides are compared in whole seconds. Tested. |
| 4 | Tag comparison rules differ: `If-None-Match` uses weak comparison (`W/"x"` matches `"x"`); `If-Match` must use strong comparison (weak tags never match). A single comparison function would get one of them wrong. | RFC 9110 §8.8.3 | Two functions (`weakMatch`, `strongMatch`); unit tests cover lists, `*` and `W/`. |
| 5 | Express's built-in ETag was switched off in increment 1, so these validators are generated explicitly and can be explained line by line. | §10.4 | Confirmed: `app.set('etag', false)` remains; the ETag is a SHA-256 of the exact JSON bytes. |

---

## Increment 9: JWT bearer authentication, scopes and jurisdiction enforcement

**Prompt context:** the approved plan §3 "Security"; brief §2 (the write-read split) and §10; rubric dimension 7 (JWT bearer with scopes, write path per installation, no cross-jurisdiction leakage); WSO2 §12; S7 and S8 notes on 401 versus 403 and `WWW-Authenticate`.

**Generated:** `src/lib/tokens.js`, `src/middleware/authenticate.js` (`authenticate`, `requireScope`), `src/routes/oauth.js` (token endpoint with per-credential rate limiting), `src/repositories/principals.js`, scope checks on every route, token helpers in `test/helpers.js`, `test/auth.test.js` (15 security tests), and OpenAPI security requirements plus the token endpoint.

**Review findings and fixes:**

| # | Finding | Guideline | Fix |
|---|---|---|---|
| 1 | **Fail-open default.** `scopeOf()` returned NATIONAL when no jurisdiction was present (a placeholder from increment 5). Once auth exists, any request reaching a read handler without a user jurisdiction (for example a device token, if a scope check were ever missed) would have read the whole country. | §12, least privilege | `scopeOf()` now **fails closed**: no verified user jurisdiction means 403. |
| 2 | **My own generator mistake:** the first version of the token endpoint compared unknown usernames against a hand-typed "bcrypt hash" constant that wasn't a valid hash. bcrypt can reject that instantly, so a response-time difference would reveal which usernames exist. | Security (user enumeration) | A real bcrypt hash of random bytes is computed once at startup and used for the comparison. |
| 3 | Rate limiting by IP address would block the device simulator (one GitHub runner IP asking for 240 device tokens per run) while letting an attacker rotate IPs. | §12, availability | Failed attempts are limited **per credential** (10 per 15 min, successes not counted). A test confirms one locked credential doesn't affect another. |
| 4 | **Inconsistency in the lecture notes:** S8 Layer 3 says wrong Basic credentials should return **403**, while S7 (and RFC 9110 / RFC 6750) say **401**: 403 is only for a known identity without permission. | §9, RFC 9110 §15.5.2–4 | Followed S7 and the RFCs: missing or invalid credentials → 401 with `WWW-Authenticate`; valid token without scope or outside jurisdiction → 403. |
| 5 | A JWT library will accept whatever algorithm the token's header names unless it's pinned (the "alg: none" and algorithm-confusion attacks). | §12.2 | HS256 is pinned on sign and verify, with `iss`, `aud` and `exp` checked. Tests reject wrong-key, expired, wrong-audience, `alg: none` and garbage tokens. |
| 6 | Generators often return **201** from a token endpoint. A token isn't a stored, addressable resource and RFC 6749 §5.1 specifies 200 with `Cache-Control: no-store`. | §9, RFC 6749 | 200 with `no-store` and `Pragma: no-cache`. |
| 7 | Swagger UI's client-credentials flow sends credentials as HTTP Basic, which the first version ignored. | RFC 6749 §2.3.1 | The token endpoint accepts client credentials in the body or as Basic. Tested both ways. |

**Scope design (report material):** scopes express *what* a client may do (`readings:write`, `assets:read`, `readings:read`, `installations:write`); *where* a user may read is a signed `jurisdiction` claim enforced in every SQL query. The alternative, one scope per jurisdiction (`read:district:ds-01`, ...), would need 35+ scopes and still couldn't express "this district's province name". The claim-plus-query approach is effectively attribute-based access control (WSO2 §12.3) without a separate XACML policy engine.
