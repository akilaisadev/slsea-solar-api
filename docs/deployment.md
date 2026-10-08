# Deployment Runbook (Vercel + Neon + GitHub Actions)

The API runs on **Vercel** (free Hobby plan, region Singapore `sin1`) with a **Neon** PostgreSQL database (Singapore).
Render was the platform taught in the module, but it now requires a payment card even for free instances, so Vercel is used;
`render.yaml` is kept as an alternative.

| | |
|---|---|
| Deployed API | https://slsea-solar-api-seven.vercel.app/solar/v1 |
| Swagger UI | https://slsea-solar-api-seven.vercel.app/docs |

## How it is wired
- `index.js` exports the Express app; `vercel.json` builds it with `@vercel/node` in `sin1`, routes every path to it and bundles the OpenAPI document and Swagger UI assets.
- Settings are Vercel environment variables: `DATABASE_URL` (Neon direct connection string) and `JWT_SECRET` (64 hex chars). Nothing secret is committed.

## 1. Database (once)
```bash
DATABASE_URL='<neon-url>' npm run db:migrate
DATABASE_URL='<neon-url>' DEVICE_SECRET_SEED='<seed>' DEMO_PASSWORD='<demo>' npm run db:seed
DATABASE_URL='<neon-url>' npm run db:check
```

## 2. Deploy
```bash
vercel login
vercel link --project slsea-solar-api
vercel env add DATABASE_URL production
vercel env add JWT_SECRET production
vercel deploy --prod
```
The Vercel account must be the one that authors the commits, otherwise the Hobby plan blocks the deployment.

## 3. Verify
```bash
DEMO_PASSWORD='<demo>' DEVICE_SECRET_SEED='<seed>' npm run smoke -- https://slsea-solar-api-seven.vercel.app
```

## 4. Keep the data live (device simulator)
```bash
gh variable set API_BASE_URL --body 'https://slsea-solar-api-seven.vercel.app'
gh secret set DEVICE_SECRET_SEED
gh workflow run simulate-devices.yml -f lookback_slots=96
```

## Notes
- Serverless functions do not share memory, so the per-credential token rate limit is enforced per instance (a shared store such as Redis would make it global).
- The first request after idle has a short cold start (about 1 s); there is no 15-minute sleep as on Render's free plan.
