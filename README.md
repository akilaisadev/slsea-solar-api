# SLSEA Real-Time Solar Generation Data API

NB6007CEM Web API Development coursework: a REST API that ingests and serves real-time and historical generation data from rooftop solar installations for the Sri Lanka Sustainable Energy Authority (SLSEA).

- **Design authority:** WSO2 REST API Design Guidelines (Richardson Maturity Level 2)
- **Stack:** Node.js 24, Express 5, PostgreSQL (Neon), deployed on Vercel (Singapore)
- **Base path:** `/solar/v1`
- **API base:** [https://slsea-solar-api-seven.vercel.app/solar/v1](https://slsea-solar-api-seven.vercel.app/solar/v1)
- **Swagger:** [Interactive API documentation](https://slsea-solar-api-seven.vercel.app/docs/)
- **OpenAPI:** [Published specification](https://slsea-solar-api-seven.vercel.app/openapi.json)

## Verified deployment — 10 October 2026

| Check | Result |
|---|---|
| Published API operations | **22/22 exercised successfully** |
| Live functional checks | **136/136 passed** |
| Automated tests | **116 passed** |
| Seed verification | **12/12 passed; 240/240 current installations have at least seven days of readings** |
| GitHub CI | **Passed**, including JavaScript lint, OpenAPI validation and the coverage gate |
| Browser test | Swagger password-flow login and authenticated provinces GET returned **200** with nine provinces |

[Verified CI run](https://github.com/akilaisadev/slsea-solar-api/actions/runs/38072435701).
Live checks covered staff and device authentication, jurisdiction boundaries, all resource operations, filtering, pagination, conditional requests, ingestion, append-only readings, error responses and cleanup. Root, health, database health, Swagger and OpenAPI returned HTTP 200. Temporary test installations were decommissioned; their audit readings remain in regional history.

These results describe the deployed API at the time of verification.

## Local development

Prerequisites: Node.js 22+ and PostgreSQL 16.

```bash
createdb slsea_dev && createdb slsea_test
cp .env.example .env        # then set JWT_SECRET (openssl rand -hex 32)
npm install
npm run dev                 # http://localhost:3000
npm test                    # runs against slsea_test
```

## Code structure

A request passes through four layers, each with one job:

```
request ─► middleware ─────────────► route ─────────────────────► repository ─► PostgreSQL
           negotiate (406/415)        validate input (zod)          parameterised SQL only
           authenticate (401)         load + jurisdiction (404/403)
           requireScope (403)         choose status and headers
                                          │
                                          ▼
                       representations.js (JSON shape) ─► respond.js (ETag, 304, Cache-Control)
```

| Folder | Responsibility | Rule |
|---|---|---|
| `src/routes/` | HTTP: one router per resource, status codes and headers | never writes SQL |
| `src/repositories/` | data access, one module per aggregate | never sees `req` or `res`; client values only as bound parameters |
| `src/representations.js` | every JSON shape the API returns | the only place field names are chosen |
| `src/middleware/` | negotiation, authentication, scopes, 405, the error handler | runs before the routes |
| `src/lib/` | cross-cutting rules: errors, conditional requests, pagination, jurisdiction, tokens, limits | no Express routing |
| `src/db/` | connection pool, transactions, readiness ping | |

Errors take a single path: any layer throws an `ApiError` from the catalogue in `src/lib/errors.js`, and the error handler turns it into the standard body.

## Operations

- Every response carries an `X-Request-Id` (generated, or the caller's own if it is a safe 1–64 character id).
- The server writes one JSON line per request (time, request id, method, path, status, duration, client role and id). Query strings, headers and bodies are never logged. Set `LOG_REQUESTS=false` to turn this off.
- Server errors are logged under the same request id, so a problem a client reports can be found from its `X-Request-Id`.

## Error contract

Every error response uses the same body (WSO2 §11):

```json
{
  "code": 40402,
  "message": "No resource matches /solar/v1/unknown.",
  "description": "Unknown URI",
  "more_info": "https://<host>/errors/40402",
  "errors": []
}
```

## Authentication

Every resource under `/solar/v1` needs a JWT bearer token from `POST /oauth2/token`, or use the **Authorize** button in Swagger UI at `/docs`.

| Client | Grant | Scopes | Jurisdiction |
|---|---|---|---|
| Metering device | `client_credentials` (`client_id` = installation id) | `readings:write` | its own installation only |
| `national.analyst` | `password` | `assets:read readings:read` | whole country |
| `western.analyst` | `password` | `assets:read readings:read` | Western Province |
| `colombo.analyst` | `password` | `assets:read readings:read` | Colombo District |
| `kandy.analyst` | `password` | `assets:read readings:read` | Kandy District |
| `asset.admin` | `password` | `assets:read readings:read installations:write` | whole country |

### Lecturer access

This repository is private. The lecturer's GitHub account **`nirangadh`** is an accepted collaborator with write access, verified on 10 October 2026. Sign in with that account to view the source and Actions runs.

**Password for all five deployed staff demo accounts:** `Solar-6M1lBAoM8j`

These are synthetic coursework accounts. Use `national.analyst` for nationwide reads, `asset.admin` for installation CRUD, and the regional accounts in the table above for jurisdiction checks.

### Test through Swagger

1. Open [Swagger](https://slsea-solar-api-seven.vercel.app/docs/) and click **Authorize**.
2. Choose the OAuth2 **password** flow. Enter a staff username from the table and the demo password above. Leave client ID, client secret and scopes blank to use that account's default permissions.
3. Click **Authorize**, close the dialog, expand an operation, choose **Try it out**, then **Execute**.
4. To switch accounts, open **Authorize**, log out, and authorize the other account.
5. For CRUD checks, create a temporary installation with a unique inverter ID and decommission it when finished.

The [token endpoint](https://slsea-solar-api-seven.vercel.app/oauth2/token) accepts **POST**. The API base is a prefix, not a catalogue page: start with Swagger or an authenticated `/solar/v1/provinces` request. An unauthenticated protected request returns **401** as expected.

### Test device ingestion

In Swagger, log out of the staff account and choose the OAuth2 **clientCredentials** flow:

| Field | Demo value |
|---|---|
| Client ID | `ins-0001` |
| Client secret | `akVWBVKBkFqYKyO3Lg6w_dWcauTVOvRylq5QARQtYW8` |
| Scope | `readings:write` |

This device may POST only to `/solar/v1/installations/ins-0001/readings`. Staff accounts cannot ingest readings, and devices cannot read assets; those **403** responses are intentional.

Before switching to device authentication, GET the latest reading as `national.analyst`. Choose a timestamp not already stored and no later than the current time, with a cumulative energy value consistent with the neighboring readings. A successful upload returns **201** and a **Location** URL; use a staff read account to retrieve that URL. Registering a temporary installation as `asset.admin` also returns its own one-time device secret for isolated ingestion tests.

### Conditional updates

Use the ETag from GET as `If-Match` when changing an installation. Successful conditional PUT, PATCH and DELETE return **204 with no response body**; GET the installation again to see an updated representation. A stale `If-Match` or `If-Unmodified-Since` returns **412** and leaves the installation unchanged. Ordinary PUT/PATCH/DELETE retain their **200** responses.


For terminal testing, replace `YOUR_DEMO_PASSWORD` and `YOUR_ACCESS_TOKEN` with the demo password and returned token.

```bash
curl -X POST https://slsea-solar-api-seven.vercel.app/oauth2/token \
  -d grant_type=password -d username=national.analyst -d "password=YOUR_DEMO_PASSWORD"
curl https://slsea-solar-api-seven.vercel.app/solar/v1/installations \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

## Resource map

| Method(s) | URI (under `/solar/v1`) | Kind |
|---|---|---|
| GET | `/provinces`, `/provinces/{province-id}` | collection / atomic |
| GET | `/districts`, `/districts/{district-id}` | collection / atomic |
| GET | `/districts/{district-id}/generation-summary` | processing (district aggregate) |
| GET | `/grid-substations`, `/grid-substations/{substation-id}` | collection / atomic |
| GET, POST | `/installations` | collection (factory) |
| GET, PUT, PATCH, DELETE | `/installations/{installation-id}` | composite |
| GET | `/installations/{installation-id}/last-reading` | processing (latest reading) |
| GET, POST | `/installations/{installation-id}/readings` | scoped collection (device ingestion) |
| GET | `/installations/{installation-id}/readings/{reading-id}` | atomic |
| GET | `/readings` | regional analytical view |

Outside the base path: `POST /oauth2/token`, `GET /health`, `GET /health/database`, `GET /errors/{error-code}`, `GET /docs`, `GET /openapi.json`.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | API with auto-reload on http://localhost:3000 |
| `npm test` | resets `slsea_test`, seeds a small dataset, runs all tests |
| `npm run test:coverage` | the same, with the coverage gate CI uses (lines 95%, branches 90%, functions 95%) |
| `npm run lint` | ESLint over the whole codebase |
| `npm run db:migrate` / `db:seed` / `db:check` | schema / deterministic seed / dataset verification |
| `npm run smoke -- <base-url>` | contract checks against a running deployment |
| `npm run lint:openapi` | validates `openapi/openapi.yaml` |

## Documentation

- [Data model](docs/data-model.md)
- [Deployment runbook](docs/deployment.md)
- [AI disclosure log](docs/ai-log.md) (source for report Appendix A)
