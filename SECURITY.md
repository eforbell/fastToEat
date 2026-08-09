# Security Policy

## Scope

fastToEat is a household fasting tracker intended for a trusted home LAN or Tailnet. It stores health-adjacent fasting activity and optional notification destinations. It does not provide strong user authentication and must not be exposed directly to the public internet.

## Basic security rules

- Keep `DATABASE_URL` in the runtime environment or a gitignored `.env` file. Per-member brrr destination secrets are stored in the application database, so database access and backups must be protected like credentials.
- Replace all sample credentials before deployment.
- Run behind nginx on a trusted private network; use HTTPS when traffic crosses an untrusted network.
- Treat profile selection as convenience, not proof of identity. Anyone who can reach the app may be able to view or change household data.
- Run as an unprivileged service account and limit the database account to this application's database.
- Protect database backups as private household data and test restores.
- Notification delivery logs currently persist `payload_json` that can contain fasting, weight-goal, or reminder detail. Treat those logs and backups as health-adjacent data, restrict access, minimize message content, and define a short operational retention period. Do not put credentials or additional sensitive health information in issues, screenshots, or commits.

If a secret is exposed, rotate it first and then remove it from files or git history.

## Reporting a vulnerability

Report security issues privately through a GitHub Security Advisory when available, or contact the repository owner through a private channel. Do not include live credentials or household data in a public issue.

There is no bug bounty program or guaranteed response SLA.
