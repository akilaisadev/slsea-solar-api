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

**Plan deviation:** the Docker daemon wasn't running locally, so local development uses the existing Homebrew PostgreSQL 16 (`slsea_dev` and `slsea_test` databases) instead of docker-compose. CI uses a `postgres:16` service container.
