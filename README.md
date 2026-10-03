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
