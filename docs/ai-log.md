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

---

## Increment 10: Write path (device ingestion and installation CRUD)

**Prompt context:** the approved plan, increment 10; brief §5 "Write path" (201 + Location on create; correct create/retrieve/update/delete semantics and idempotency); WSO2 §7, §9 and §10.5; the S7/S8 generator-mistake lists (200 instead of 201, missing or unresolvable Location, PUT as a partial update, vehicle id taken from the body, cascade-deleting history, a second DELETE returning 200).

**Generated:** POST/PUT/PATCH/DELETE on `/installations`, POST on `/installations/{id}/readings`, `src/db/transaction.js`, write repositories, `test/writes.test.js` (13 tests), and the OpenAPI write operations and schemas.

**Review findings and fixes:**

| # | Finding | Guideline | Fix |
|---|---|---|---|
| 1 | After increment 9's fail-closed change, reusing the user loader for device writes would have refused **every** device with 403, because a device has no jurisdiction. | Write-read split | A separate `loadDeviceInstallation()`: the token's `sub` must equal the path's installation **before** any database lookup, so a device can't even probe which installation IDs exist. |
| 2 | `POST /installations` returns a one-time `device_secret` in the body. An ETag hashed from that body would never equal the ETag a later GET returns, so it would be useless for `If-Match`. | §8.2, §10.5 | `sendRepresentation` accepts an ETag override. The 201's ETag is the GET representation's, and a test asserts they're equal. |
| 3 | Checking `If-Match` and then writing in separate statements leaves a race window: two admins could both pass the check, and the second would silently overwrite the first. | §10.5 | Check and write run in one transaction with `SELECT … FOR UPDATE` on the installation row. |
| 4 | **My own generator mistakes, caught in review:** the update query selected `capacity_kw` twice, and the DELETE used `INSTALLATION_COLUMNS.replaceAll('i.', '')` to build its RETURNING list, a string trick that would break silently if a column name contained "i.". | Clarity | Removed the duplicate; wrote the RETURNING column list out explicitly. |
| 5 | Catching the unique-violation exception for duplicate readings would abort the statement and conflate it with other errors. | Robustness | `INSERT … ON CONFLICT ON CONSTRAINT generation_reading_unique_instant DO NOTHING`, then 409 with the URI of the existing reading. Retries are therefore harmless, even though POST itself isn't idempotent. |
| 6 | **Test-data mistake (mine):** the first ingestion tests posted the *next 15-minute slot*, which can be up to 15 minutes in the future just after a seed. The API correctly answered 400 ("cannot be in the future"). | Test validity | Tests post one minute after the latest reading. The API's 5-minute clock-skew rule stays. |
| 7 | The `If-Match` test first sent a PUT without `status`, which got 400 rather than 412. Validation runs before the precondition, which RFC 9110 allows: an invalid request is rejected whatever its preconditions. | §9 | The test now sends a complete body. The ordering is documented behaviour. |
| 8 | S7/S8 checklist: POST returns 201 with an absolute `Location` that resolves (tested); ETag and Last-Modified are sent; PUT requires every field (tested); PATCH uses JSON Merge Patch; the installation comes from the path and a body `installation_id` is rejected; DELETE gives 200 then 404; readings survive decommissioning (tested); PUT/PATCH/DELETE on readings get 405 with `Allow`. | §7, §9 | Verified. |

---

## Increment 11: District generation summary (upper-band stretch)

**Prompt context:** brief §5 "Upper-band stretch: district generation summary" (current total power and today's total energy across a district's installations); rubric dimension 3 (First band requires it); WSO2 §4.5.

**Generated:** `src/repositories/summaries.js` (one SQL query using LATERAL joins on the `(installation_id, recorded_at)` index), the route in `src/routes/districts.js`, `src/lib/time.js`, `test/summary.test.js` (6 tests), and the OpenAPI path and schema.

**Review findings and fixes:**

| # | Finding | Guideline | Fix |
|---|---|---|---|
| 1 | The obvious way to get "today's energy", `sum(power_kw) × 0.25 h`, undercounts whenever readings are missing and depends on the reporting interval. | Data correctness | Uses each inverter's cumulative counter: the last value in the Colombo day minus the last value before the day (or the day's first value for a new site). Missing readings can't lose energy. |
| 2 | "Today" computed in UTC would put 00:00–05:30 Sri Lankan time in the previous day. | Domain correctness | Day boundaries are `date::timestamp AT TIME ZONE 'Asia/Colombo'`; the response states the `timezone` and `date`. |
| 3 | "Current power" summed over every site's latest reading would count a site that went silent two days ago (the maintenance edge case) as still generating. | Domain correctness | Only sites that reported within `reporting_window_minutes` (60, matching the simulator's 30-minute cadence plus GitHub's scheduling delay) count. The window is exposed in the response. |
| 4 | An aggregate query is easy to get subtly wrong and hard to eyeball. | Test validity | The test recomputes the summary independently in JavaScript from the raw rows and compares every figure. A sanity test checks that a full day's yield is 1.5–6.5 kWh per kW of capacity. |
| 5 | Measured: about 10–15 ms per summary locally on the full 206k-row dataset. The LATERAL subqueries each use the unique index. | Performance | No change needed. |

---

## Increment 12: Verification: Swagger UI, smoke test, CI lint

**Prompt context:** the approved plan, increment 12; rubric dimensions 5 (functionality against seed data) and 6 (live Swagger UI).

**Generated:** `scripts/smoke.js` (23 contract checks against any deployment, read-only mode available), the `smoke` and `lint:openapi` npm scripts, an OpenAPI lint step in CI, and two auth tests.

**Review findings and fixes (found by using Swagger UI in a real browser):**

| # | Finding | Guideline | Fix |
|---|---|---|---|
| 1 | **Shared rate-limit bucket.** Swagger UI's password flow sends `Authorization: Basic Og==` (an empty client id and secret) even for user logins. The token endpoint merged the empty `client_id` into the body, and the rate-limit key used `??`, so every user's failures would have been counted under one key `credential:`. One mistyped password could start locking everyone out. | Availability, §12 | Empty Basic credentials are ignored, and the key uses `||`. A regression test sends `Basic Og==` exactly as Swagger does. |
| 2 | Swagger UI's "select all" requests `installations:write` for an analyst, and the endpoint refused the whole request (400). That was correct but unhelpful to anyone trying the API. | RFC 6749 §3.3 | The server grants the permitted subset and states it in the `scope` response field. It refuses only when none is grantable. Tested both ways. |
| 3 | The `If-None-Match`/`If-Modified-Since` parameters had `example` values, which Swagger UI pre-fills into "Try it out". A marker clicking Execute would unknowingly send conditional headers and could get a puzzling 304. | Documentation usability | Removed those examples; the inputs start empty. |
| 4 | The `license.identifier` value made Swagger UI link to a non-existent SPDX page. | Documentation accuracy | Replaced it with a URL. |
| 5 | Smoke-testing the write path on the live deployment could corrupt the simulator's data. A test reading with a higher energy counter would make the simulator's next (lower) value look like the counter ran backwards, and it would be rejected. | Data integrity | The smoke reading is posted one second after the latest reading with the same values, so it can never break the counter's monotonic order. |

**Evidence:** Swagger UI → Authorize (password flow) → `GET /provinces` returned 200 with all 9 provinces. The smoke test passes all 23 checks against the local server. The OpenAPI document lints with no errors or warnings.

---

## Increment 13: Device simulator and free-tier operations

**Prompt context:** your choice of "Yes, GitHub Actions simulator" (keep `last-reading` and the district summary's "today" genuinely live until marking); the approved plan, increment 13.

**Generated:** `scripts/simulate-devices.js` (no dependencies), `.github/workflows/simulate-devices.yml` (every 30 minutes, manual run with an adjustable look-back), and the split health endpoints.

**Review findings and fixes:**

| # | Finding | Guideline | Fix |
|---|---|---|---|
| 1 | **Operational cost:** Render polls the health-check path every few seconds, and the original `/health` ran `SELECT 1`. That would keep Neon's serverless compute awake 24/7, using up the free monthly compute allowance and risking the database being suspended before marking. | Deployment and operation | `/health` is now liveness only (no database); `/health/database` is the explicit readiness check used by the smoke test. Tests assert that `/health` doesn't report on the database. |
| 2 | A simulator that wrote straight into the database would bypass the very write path being assessed. | Write-read split | Each simulated inverter gets its own token (client credentials) and POSTs through the public API, exercising authentication, device binding, validation and 201/409. |
| 3 | A scheduled run can be delayed or skipped by GitHub, which would leave gaps in the 15-minute series. | Data completeness | Each run re-sends the last 6 slots (90 minutes). Because values come from the deterministic model, a slot already stored returns 409 instead of a conflicting duplicate. Verified locally: run 1 created the 471 missing readings with 945 × 409 and 0 failures; run 2 created only the new slot. |
| 4 | GitHub Actions minutes are limited on private repositories (2,000 per month on the free plan). | Cost | 30-minute schedule ≈ 48 runs/day × 1 billed minute ≈ 1,440 minutes/month. The simulator needs no `npm install`, which keeps each run short. |

---

## Increment 14: Documentation for deployment, report and viva

**Generated:** `docs/deployment.md` (Neon, Render and GitHub runbook), a report evidence pack (tables, diagrams, bullet facts, screenshot list and APA 7 references; **no report prose**), viva revision notes (likely questions with pointers to the code), and the README resource map. The evidence pack and revision notes are my private study material, kept in a local folder outside version control.

**Review notes:**
- The evidence pack first said "17 URI templates". That count included the health, errors and token paths. Corrected to the 13 resource URI templates under `/solar/v1`.
- On integrity: the report prose is mine to write. The evidence pack deliberately contains only facts, tables and bullet points.

---

## Code-quality pass (development branch)

**Prompt:** "make development branch and make some code quality improvements according to CW". Rubric dimension 4 asks for a coherent, well-structured codebase, with generator mistakes identified and repaired.

**Generated:** `eslint.config.js` with a CI lint step; database resilience in `src/db/pool.js` and `src/middleware/errorHandler.js`; shared helpers (`loadInScope` in `src/routes/loaders.js`, `sendPage` in `src/lib/respond.js`); `src/lib/limits.js`; a coverage gate; `test/resilience.test.js` and `test/guards.test.js`; and the README code-structure section.

**Review findings and fixes:**

| # | Finding | Why it matters | Fix |
|---|---|---|---|
| 1 | ESLint found three shadowed names. In one test, a local variable called `after` hid the test framework's `after()` hook, so a later edit could have silently broken cleanup. There was also a stale `eslint-disable` comment. | Code clarity | Renamed (`afterInsert`, `tx`, `requestToken`); removed the stale comment. Lint now runs in CI. |
| 2 | **Crash risk on the target platform:** the PostgreSQL pool had no `'error'` listener. Neon closes idle connections when it scales to zero, and node-postgres then emits `'error'` on the pool. With no listener, Node treats that as unhandled and the API process exits. | Deployment and operation | Added a pool error listener (tested by emitting an error on a real pool). |
| 3 | A connection attempt could wait forever, and an unreachable database surfaced as a generic 500. | §9, operability | 10-second connection timeout; connectivity failures map to **503** with `Retry-After` (catalogue code 50301). Tested with a stand-in database that refuses connections. |
| 4 | The "find, 404, then jurisdiction 403" lookup was written three times, and the paginated-response block six times. Copies like this drift apart. | Maintainability | One `loadInScope()` and one `sendPage()`. All tests passed unchanged, so behaviour is identical. |
| 5 | Validation limits were bare numbers (`max(500)`, `min(5.8)`, `* 1.25`) with no explanation. | Readability, viva | Named constants with reasons in `src/lib/limits.js`, matching the database CHECK constraints. |
| 6 | Coverage was measured for the first time: 98.8% lines, 94.2% branches, 99.4% functions. The untested lines were safety nets: the startup config check, fail-closed jurisdiction, the generic 500 (now checked not to leak internal error text), unknown error codes, and client credentials without a secret. | Test validity | Added tests for each. Coverage is now 99.8% lines, 95.4% branches and 100% functions, gated in CI (95/90/95). I confirmed the gate fails a run below its threshold. |
| 7 | The one SQL statement in a route file was the readiness probe's `SELECT 1`. | Layering | Moved into `src/db` (`pingDatabase`). The README documents the layering rules, and a check shows no route contains SQL and no repository touches `req`/`res`. |

---

## Production hardening (branch `improve/production-hardening`)

**Prompt:** "make a new branch do some improvements push code". I chose hardening for going live: safe concurrent ingestion, traceable logs, and the slowest query.

**Generated:** an upload lock and next-reading check (`src/repositories/readings.js`, `src/routes/installationReadings.js`), `src/middleware/observability.js` (request ids, access log), the two-step regional readings query, and `test/ingestion.test.js` and `test/observability.test.js`.

**Review findings and fixes:**

| # | Finding | Why it matters | Fix |
|---|---|---|---|
| 1 | Two readings for the same installation arriving together could both pass the cumulative-counter check against the same neighbours, leaving the series out of order. | Data integrity (append-only time series) | Each upload runs in a transaction holding a PostgreSQL advisory lock for its installation; other installations still upload in parallel. |
| 2 | **Honest test note:** the HTTP test with two conflicting uploads passed 6 of 6 times *even with the lock removed*, because the requests never actually overlapped on a fast local machine. It documents the rule but doesn't prove the lock. | Test validity | Added a deterministic test that holds the lock in one transaction and checks that a second one waits. Verified that it **fails** with the lock removed and passes with it. |
| 3 | The counter check only looked backwards. A buffering device uploading a late (back-filled) reading could store a counter higher than the reading that follows it. | Data integrity | The reading must also not exceed the next one. Tested with valid and invalid back-fills. |
| 4 | Nothing linked a client's error to the server logs, and the logs were unstructured. | Deployment and operation | Every response has `X-Request-Id`, plus one JSON log line per request; errors are logged under the same id. A client-supplied id is kept only if it's 1–64 safe characters, so it can't inject text into the logs. Query strings, headers and bodies are never logged, and a test asserts the bearer token never appears. |
| 5 | The regional `/readings` count joined every reading (about 200k) to three tables. | Performance | Resolve the caller's visible installations first, then filter readings by id. Measured on the full dataset: SQL 159 → 98 ms; HTTP 117 → 53 ms (best of 5). Correction: the earlier "0.35–0.5 s" figure was measured before `VACUUM ANALYZE`, with stale statistics. |
| 6 | **My own test-data mistake, again:** the new "uploads after the latest reading" tests stepped forward in whole minutes, so depending on the time of day the last upload landed more than 5 minutes in the future and the API refused it (a flaky failure). | Test reliability | 10-second steps. Three consecutive full runs passed. |
| 7 | ESLint flagged the test helper that temporarily replaces `console` methods to capture log output. | Lint configuration | Rule relaxed for `test/**` only. |

---

## Coursework seed coverage repair — 10 October 2026

**AI aid:** Codex (OpenAI).

**Directing prompt:** "can u do that now??", following the requirement to give every seeded installation at least seven days of readings.

**Generated and reviewed:** the full seed now includes history for `ins-0240`; empty-history fixtures are enabled explicitly only for the small test seed. The checker uses a left join so installations with zero readings cannot disappear from its coverage calculation. Decommissioned audit records are excluded consistently with the live installation catalogue. The simulator includes the formerly empty installation. Added a backfill utility that authenticates through the deployed API, aligns the installation with its deterministic seed model, and posts readings as its own device without replacing existing history.

**Live repair:** appended 673 synthetic 15-minute seed readings to `ins-0240`, from `2026-10-03T17:00:00Z` through `2026-10-10T17:00:00Z` (seven days). The API returned 201 for all 673 uploads; the created Location URL resolved with 200. These are generated coursework data, not measurements from physical hardware.

**Validation:** all 115 automated tests passed against a separate local test database, including regressions for full-seed history coverage and the explicit empty-history test fixture. The live history was checked in ascending and descending order. All 12 live seed checks passed: 240/240 catalogue installations have seven or more days of history, no catalogue installation has empty history, foreign keys are consistent, and cumulative energy counters never decrease. ESLint passed. The report PDF was not edited.


## Deployed API verification and conditional-write repair — 10 October 2026

**AI aid:** Codex (OpenAI).

**Directing prompt:** “now all work? can lecture access all?? can test all??”

**Observed fault:** a live PATCH with the current If-Match ETag committed successfully in the function, but Vercel returned a plain-text PRECONDITION_FAILED / 412 response to the caller. A subsequent GET confirmed the edit, making the failure misleading.

**Generated and reviewed:** successful conditional PUT/PATCH/DELETE requests now return 204 without a response entity or validators. The client retrieves the updated representation through GET. Ordinary writes keep their existing 200 responses. Transactional precondition checks and stale-write 412 errors remain intact. Updated the OpenAPI responses, the history-repair utility, and regression tests covering successful writes, unchanged state after stale writes, and conditional deletion. The report PDF was not edited.

**Validation:** 116 automated tests passed against the separate local test database. Live verification confirmed a successful conditional PATCH returns 204 and the subsequent GET contains the saved change. All 136 live checks passed across all 22 published operations, including current/stale conditional PUT, PATCH and DELETE, If-Unmodified-Since, five staff logins, device authentication and ingestion, jurisdiction boundaries, filtering, pagination, append-only readings, error schemas, and cleanup. Full deployment checks are recorded separately in the verification evidence.
