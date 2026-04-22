# fastToEat

Forbell family intermittent fasting tracker. Simple check-in / check-out for 16:8, 14:10, or 12:12 fasts; stars on consecutive days that meet the goal; optional brrr.com push notifications at window boundaries.

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

Designed to run behind nginx at `/fte/` on the home server. See `deploy/` for systemd unit + reminder timer, and see `homeBase/src/catalog.js` for the full manifest entry.

See [`CLAUDE.md`](./CLAUDE.md) for architecture.
