# LiftItUp

A notebook-styled, multi-user workout tracker PWA built on a **rotation queue** instead of rigid weekdays.

- **Multi-user & isolated**: personal accounts with session cookies + per-user MCP API keys, plus a 24-hour **Sample** sandbox for trying the app without signing up.
- **Rotation-queue schedule**: missed days carry forward automatically; postpone by 1–3 days, skip, log a Jolly day (extra or instead), or reset to day 1.
- **8 tracking types + optional execution quality %**: barbell, bodyweight, weighted/assisted calisthenics, holds, carries, and distance.
- **AI-friendly**: copy one prompt into your own AI chat (ChatGPT, Claude, Gemini, etc.) to onboard or edit your split, paste the JSON back, or connect your AI directly over **MCP** (`/api/mcp`).
- **Your data**: full nested JSON and tidy, pandas-ready CSV export, plus Apple Health webhook and file import.

## Documentation

- **[Quickstart (`docs/QUICKSTART.md`)](docs/QUICKSTART.md)** — run locally or with Docker, first visit, two-way onboarding, logging a workout, and connecting an MCP client.
- **[User Guide (`docs/GUIDE.md`)](docs/GUIDE.md)** — full reference for every screen, button, rotation-queue rule, tracking type, set-quality colour, AI JSON schema, MCP tools, export formats, Apple Health, and troubleshooting.
- **[Architecture Plan (`docs/ARCHITECTURE_PLAN.md`)](docs/ARCHITECTURE_PLAN.md)** — technical architecture and database schema.

## Development

Run the unit test suite (`pg-mem`) with:

```bash
npm test
```

Run the real-PostgreSQL integration suite (requires a running PostgreSQL instance, e.g. via `docker compose up -d postgres`):

```bash
npm run test:postgres
```

## Security & Backups

- **Database backups contain private progress photos:** LiftItUp stores progress photos as binary data in PostgreSQL (`progress_photo_blobs`). Any `pg_dump`, volume snapshot (`liftitup-pgdata`), or database backup contains users' private progress photos and must be encrypted, stored, and shared accordingly.
- **Set a real `POSTGRES_PASSWORD`:** `docker-compose.yml` falls back to a local development default (`liftitup`). Before deploying or exposing the database/app beyond local development, always set `POSTGRES_PASSWORD` (and matching `DATABASE_URL`) to a strong, unique secret.
