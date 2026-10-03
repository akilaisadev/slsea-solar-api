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
