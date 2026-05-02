# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Parent-oriented intermittent fasting tracker for your household. Each member picks a daily goal (16:8, 14:10, 12:12), checks in when their fast starts, checks out when they break it, and earns stars on consecutive days that meet the goal. Simple brrr.com notifications nudge at the start and end of the eating window. No ads, no medical advice, no nutrition tracking beyond an optional free-text break-meal note.

Companion to the other "family*" apps (familyPulse, familyPlan, familyDinner) — same Node/Express/Postgres shape, same `family_members` + `app_config` conventions, same browser-driven household bootstrap.

## Dev Commands

```bash
npm install              # first time
npm run dev              # node --watch (Node 18+)
npm start                # production
npm run db:migrate       # run pending migrations
npm run send-reminders   # manual trigger (dry-run via --dry-run)
npm test                 # node --test
```

Copy `.env.example` to `.env` and fill in `DATABASE_URL`.

## Architecture

```
server.js              # Express — all HTTP routes inline
lib/
  date-utils.js        # YYYY-MM-DD + mondayOf helpers
  fast-windows.js      # plan + timezone → scheduled fast start/end instants
  streaks.js           # walk daily_fast_log → { current, longest }
  notifications.js     # brrr.com send + delivery log (copied verbatim from familyPlan)
db/
  schema.sql           # canonical snapshot for fresh installs
  migrate.js           # migration runner (copied verbatim from familyDinner)
  migrations/          # numbered .sql migrations
scripts/
  send-reminders.js    # systemd-timer entry point; sends brrr at eat/fast boundaries
public/
  setup.html|js        # first-run household bootstrap (no family_members → /setup)
  login.html|js        # member picker (stores selection in localStorage)
  index.html|app.js    # today view — start/end fast, current streak, countdown
  calendar.html|js     # month grid with ★ for met-goal days
  settings.html|js     # plan + brrr channel setup per member
  style.css, theme.js, nav.js
deploy/
  fast-to-eat.service
  fast-to-eat-reminders.service
  fast-to-eat-reminders.timer
  deploy.sh
```

## Key Data Model

| Table | Purpose |
|---|---|
| `family_members` | household roster (shared convention) |
| `app_config` | key/value store (shared convention) |
| `member_notification_channels` | brrr secret per member (copied from familyPlan) |
| `fast_plans` | each member's daily IF goal + eat-window start time + timezone |
| `fast_sessions` | one row per started fast; `ended_at` NULL while running |
| `daily_fast_log` | one row per (member, local date) with `met_goal` boolean — drives calendar stars + streak math |
| `notification_event_state` | per-event cooldown tracking used by the reminder runner |

`daily_fast_log` is the source of truth for streaks. When a fast ends, `POST /api/fast/end` upserts the row keyed on the member's local date (derived from `fast_plans.timezone`).

## Routes (mount at `/fte/`)

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/health` | liveness |
| GET | `/api/bootstrap` | `{ bootstrap: { needs_household } }` — gates `/setup` |
| POST | `/api/bootstrap/household` | one-time household creation |
| GET | `/api/members` | list for login picker |
| GET | `/api/me/:id/status` | current session + plan + streak |
| GET/PUT | `/api/me/:id/plan` | 16:8 / 14:10 / 12:12 + eat-window start + timezone |
| POST | `/api/fast/start` | open a fast_session |
| POST | `/api/fast/end` | close it, compute met_goal, upsert daily_fast_log |
| PUT | `/api/fast/:sessionId/times` | edit start/end timestamps, recompute met_goal + daily_fast_log |
| GET | `/api/me/:id/calendar?month=YYYY-MM` | per-day star data |
| GET | `/api/me/:id/streak` | `{ current, longest, last_met_date }` |
| GET | `/api/family/leaderboard` | `{ name, current_streak }[]` sorted desc |
| GET/PUT | `/api/me/:id/notifications` | brrr channel config |

## Deployment

Nginx maps `/fte/ → http://127.0.0.1:3005/`. All fetch() calls and asset refs use **relative** paths so subpath mounting works.

Registered in the homeBase catalog as `fast-to-eat` (see `homeBase/src/catalog.js`).
