# fastToEat

family intermittent fasting tracker. Simple check-in / check-out for 16:8, 14:10, or 12:12 fasts; stars on consecutive days that meet the goal; optional brrr.com push notifications at window boundaries.

## Quick start

```bash
cp .env.example .env
# edit DATABASE_URL to point at a local Postgres
npm install
npm run db:migrate
npm run dev
# open http://localhost:3005/
```

First visit redirects to `/setup` so you can create the household. Then `/login` lets each family member pick their profile; afterwards the main page handles the daily start/end fast flow.

## Deployment

Designed to run behind nginx at `/fte/` on the home server. It listens on loopback (`PORT` 3005, `HOST` to override) or, under Home Base, on the Unix socket `SOVEREIGN_LISTEN=unix:/path/app.sock` names; set at all, even blank, that must name a socket. See `deploy/` for systemd unit + reminder timer, and see `homeBase/src/catalog.js` for the full manifest entry.

See [`CLAUDE.md`](./CLAUDE.md) for architecture.

## Silent push verification

Push setup uses `PUSH_BASE_URL` (default: `https://api.brrr.now`). In notification
settings, **Verify saved secret (no push)** rechecks the currently saved target;
save any edited secret first. Saving a target also returns a verification result.
The check uses bearer-authenticated `GET /v1/check` with a timeout and refuses
redirects or URLs belonging to a different push service. Secrets and gateway
response bodies are not included in verification feedback.

A verified device/person secret means homePush recognizes it and has at least one
active device with an APNs key. It does **not** prove phone delivery, notification
permissions, or end-to-end receipt. Unknown secrets, inactive devices, missing
APNs keys, connectivity errors, and invalid responses remain **not verified**.
brrr and endpoints returning 404/405/501 are **unsupported**, not successful
verification; saving remains available. Results are point-in-time, not a durable
health badge—recheck after changing services or rotating/enrolling devices.
