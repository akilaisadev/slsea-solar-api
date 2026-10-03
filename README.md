# SLSEA Real-Time Solar Generation Data API

NB6007CEM Web API Development coursework: a REST API that ingests and serves real-time and historical generation data from rooftop solar installations for the Sri Lanka Sustainable Energy Authority (SLSEA).

- **Design authority:** WSO2 REST API Design Guidelines (Richardson Maturity Level 2)
- **Stack:** Node.js 24, Express 5, PostgreSQL (Neon), deployed on Render
- **Base path:** `/solar/v1`

## Local development

Prerequisites: Node.js 22+ and PostgreSQL 16.

```bash
createdb slsea_dev && createdb slsea_test
cp .env.example .env        # then set JWT_SECRET (openssl rand -hex 32)
npm install
npm run dev                 # http://localhost:3000
npm test                    # runs against slsea_test
```

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

Demo credentials for the deployed instance are listed in the report appendix (they are seeded test accounts, not real users).

```bash
curl -X POST https://<host>/oauth2/token -d grant_type=password -d username=colombo.analyst -d password=<demo password>
curl https://<host>/solar/v1/installations -H "Authorization: Bearer <access_token>"
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
| `npm run db:migrate` / `db:seed` / `db:check` | schema / deterministic seed / dataset verification |
| `npm run smoke -- <base-url>` | contract checks against a running deployment |
| `npm run lint:openapi` | validates `openapi/openapi.yaml` |

## Documentation

- [Data model](docs/data-model.md)
- [Deployment runbook](docs/deployment.md)
- [AI disclosure log](docs/ai-log.md) (source for report Appendix A)
