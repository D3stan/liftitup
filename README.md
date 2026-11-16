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

## Admin Area, MCP Security & Password Reset

- **Admin access (`ADMIN_USER_IDS`):** Set `ADMIN_USER_IDS` to a comma- or whitespace-separated list of user IDs (e.g., `usr_...`) allowed to access `/admin`, `/api/admin/*`, and admin MCP tools on `/api/mcp`. Non-admins, guests, disabled users, unauthenticated visitors, and web-admin API-key callers receive HTTP `404` on `/admin` and `/api/admin/*`; on `/api/mcp`, non-admins and guests do not see admin tools and receive `Unknown tool` (`-32601`).
- **Single API key warning (Shortcut + MCP + Admin):** Each user has a single API key shared between `/api/mcp` and the Apple Health iOS Shortcut. For any user in `ADMIN_USER_IDS`, that key grants full admin power over the instance via MCP (with two-step single-use confirmations for destructive actions and immutable `audit_log` entries). Regenerating the key in **Settings › Integrations** immediately revokes the previous key and invalidates pending MCP confirmations.
- **Signed MCP photo download links (`PHOTO_DOWNLOAD_SECRET`):** Set `PHOTO_DOWNLOAD_SECRET` (for example `openssl rand -hex 32`) to enable the MCP `get_photo_download_links` tool, which issues short-lived (5-minute), opaque, HMAC-authenticated `/api/photos/signed/<token>` URLs for the key owner's own progress photos. If `PHOTO_DOWNLOAD_SECRET` is unset or blank, `get_photo_download_links` and `/api/photos/signed/*` refuse to run rather than falling back to an insecure secret.
- **Password reset CLI:** Accounts have no email. To reset a user's password from the container terminal without exposing a reset button in the web UI or passing a password on the command line (or through an AI agent's conversation):

```bash
docker compose exec liftitup node scripts/reset-password.mjs <username>
```

The script generates a one-time high-entropy temporary password, revokes all active sessions for that user, requires choosing a new password at next login, and writes an entry to `audit_log`.
