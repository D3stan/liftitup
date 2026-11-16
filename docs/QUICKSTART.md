# LiftItUp Quickstart

## 1. Run Locally or Deploy with Docker

### Local (Node.js 24+ for `node:sqlite`)
```bash
npm install
npm run dev        # http://localhost:3000
```

### Docker Compose
```bash
docker compose up -d --build
```

**Environment variables** (`docker-compose.yml`):
- `DATABASE_PATH` — SQLite path (default in Docker: `/app/data/liftitup.db`; locally: `./data/liftitup.db`).
- `NEXT_PUBLIC_APP_URL` — public origin for MCP snippets (default: `https://lift.0xpuddu.com`).
- `PORT` / `HOSTNAME` — server bind (`3000` / `0.0.0.0`).
- `LOG_LEVEL` — set `debug` for verbose logs (optional). No `SESSION_SECRET` is needed.

> **Upgrading from v1:** On first startup, if `DATABASE_PATH` contains a v1 database (no `schema_version` table or `version < 2`), LiftItUp automatically renames it to `liftitup.v1-backup-<timestamp>.db` in the same directory, logs the backup, and initializes a fresh v2 database—no manual wipe required.

---

## 2. First Visit

Open `/welcome` and choose:
- **Register / Log in**: create your personal account (`Username`, `Password`, optional `Name`).
- **Explore as sample user**: launches an isolated 24-hour sandbox pre-loaded with a fictional 6-day split and ~3 weeks of sample history.

---

## 3. Two-Way Onboarding

Right after registering, `/onboarding` gives you two paths:
1. **Empty setup** → opens the Calendar (`/`) with a blank slate.
2. **AI onboarding** → opens `/ai`:
   - Tap **Copy onboarding prompt** and paste it into your own AI chat (ChatGPT, Claude, Gemini, etc.).
   - Answer its 4 quick questions (height, weight, age, training years) and describe your split (text, voice transcript, or screenshot).
   - Copy the JSON it returns, paste it into `/ai`, review the preview, and tap **Confirm**.

---

## 4. Log a Workout

1. On **Calendar** (`/`), tap **Start** on today's card (or tap any day cell → **Start**). Workouts never auto-start.
2. Enter your sets (fields adapt to each exercise's tracking type), check off completed sets, and optionally tap the **Timer** or add workout/exercise **Notes**.
3. Tap **Save**.

---

## 5. Connect Your Own MCP Client

1. Open **Settings** (gear icon) → **MCP** and tap **Regenerate**.
2. Copy the API key immediately (it is shown only once).
3. Copy the **Client Config** JSON into your MCP client (e.g. Claude Desktop, Cursor) to query your workouts, schedule, exercises, and log sessions via `/api/mcp`.

See [docs/GUIDE.md](GUIDE.md) for the full reference.
