# Deployment Runbook (Neon + Render + GitHub Actions)

Steps 1, 4 and 6 need your own accounts, so they're done by you. Everything else is commands.

## 0. Generate the production secrets (once)

```bash
openssl rand -hex 32   # JWT_SECRET        -> Render only
openssl rand -hex 32   # DEVICE_SECRET_SEED -> your seeding shell + GitHub secret
```

Also choose a **demo password** for the five demo SLSEA users (`DEMO_PASSWORD`). You'll list it in the report appendix for the marker, so don't reuse a real password.

Keep these three values in a password manager. Never commit them.

## 1. Neon database

1. Sign in at https://neon.tech (GitHub sign-in is fine).
2. Create a project named `slsea-solar-api` in region **AWS Asia Pacific (Singapore)**, the closest to Sri Lanka and the same region as Render.
3. Copy the **direct** (not pooled) connection string. It looks like `postgresql://...@ep-....ap-southeast-1.aws.neon.tech/neondb?sslmode=require`.

## 2. Create the schema and seed it (from this repo)

Values passed inline take precedence over your local `.env`:

```bash
DATABASE_URL='<neon-url>' npm run db:migrate
DATABASE_URL='<neon-url>' DEVICE_SECRET_SEED='<seed>' DEMO_PASSWORD='<demo>' npm run db:seed
DATABASE_URL='<neon-url>' npm run db:check
```

`db:check` must show every row as PASS. Screenshot it for the report.

## 3. Render web service

1. Sign in at https://render.com with GitHub, and allow Render to access the `akilaisadev/slsea-solar-api` repository.
2. **New → Blueprint →** pick the repository. Render reads `render.yaml`: a free Node web service in Singapore with health check `/health`, schema applied on start, and deploys only after CI passes.
3. When prompted, set `DATABASE_URL` to the Neon URL and `JWT_SECRET` to the value from step 0.
4. Wait for the deploy to finish, then note the URL (e.g. `https://slsea-solar-api.onrender.com`).

## 4. Verify the live deployment

```bash
DEMO_PASSWORD='<demo>' DEVICE_SECRET_SEED='<seed>' npm run smoke -- https://<your-app>.onrender.com
```

All checks must pass. Screenshot the table for the report's Deployment section. Then open `https://<your-app>.onrender.com/docs`, click **Authorize** (password flow, `colombo.analyst`), and try a few endpoints.

## 5. Turn on the device simulator

```bash
gh variable set API_BASE_URL --body 'https://<your-app>.onrender.com'
gh secret set DEVICE_SECRET_SEED          # paste the value when prompted
gh workflow run simulate-devices.yml -f lookback_slots=96   # backfill since seeding
gh run list --workflow simulate-devices.yml --limit 3
```

After that it runs every 30 minutes by itself. Check that `GET /solar/v1/districts/ds-01/generation-summary` shows `reporting_installation_count` above 0.

## 6. Keep it awake (recommended)

Render's free instances sleep after 15 minutes without traffic, so the first request then takes about a minute. That can look like an "intermittent service" to a marker.

Add a free **UptimeRobot** HTTP monitor on `https://<your-app>.onrender.com/health` every 5 minutes. `/health` doesn't touch the database, so this doesn't use Neon compute time.

## 7. Report cover page

| Field | Value |
|---|---|
| Deployed API URL | `https://<your-app>.onrender.com/solar/v1` |
| OpenAPI (Swagger) URL | `https://<your-app>.onrender.com/docs` |
| Git repository URL | `https://github.com/akilaisadev/slsea-solar-api` |

## Before submitting

- Run the smoke test again and confirm the simulator workflow's recent runs succeeded.
- Confirm the lecturer has **accepted** the repository invitation (Settings → Collaborators).
- Re-seeding isn't needed. History keeps growing (about 23k readings a day, well within Neon's free storage). If you do re-seed, run step 2 again, and the simulator carries on seamlessly.
