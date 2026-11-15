# LiftItUp v2 — Architecture & Rework Plan

> **Scope:** Full rework of LiftItUp (Next.js 15 App Router, React 19, Tailwind 4, SQLite via `node:sqlite`) from a single-page gamified hypertrophy tracker into a clean, multi-user, rotation-queue workout tracker PWA.  
> **Source of truth:** `SWARM_TASKS.md` (requirements A–J and binding answers Q1–Q6).  
> **Catalog reference:** `src/lib/exercises/catalog.ts` (built in parallel by `@catalog`; defines `TrackingType`, `CatalogExercise`, `EXERCISE_CATALOG`, `getCatalogExercise`, `searchCatalog`).

---

## 1. Current-Structure Analysis (Keep / Rewrite / Delete)

| Current File / Directory | Current Role | Action | v2 Disposition |
|---|---|---|---|
| `src/app/layout.tsx`, `src/styles/tokens.css`, `src/styles/notebook.css`, `public/` | PWA root layout, fonts, ink-on-paper cartoon notebook CSS | **KEEP / MINOR EDIT** | Keep notebook aesthetic, tokens, mobile-native tap/zoom rules; update `<title>`/metadata (remove gamification wording). |
| `src/app/page.tsx` | Monolithic client shell (`activeTab` state), 4-endpoint waterfall loader, hardcoded `'demo-alex'` fallback | **REWRITE** | Replace with App Router pages; `/` becomes minimal Calendar Home; unauthenticated users redirect to `/welcome`. |
| `src/types/domain.ts` | Mixed hypertrophy/gamification/schedule types | **REWRITE** | Clean v2 domain types (User, Session, Exercise + `TrackingType`, RotationSchedule, ScheduleEvent, WorkoutSession/Exercise/Set + Quality, Export). |
| `src/lib/db/index.ts` | SQLite setup with `days_json`/`sets_json` blobs; auto-calls `seedDatabaseIfNeeded` | **REWRITE** | Normalized Schema v2 DDL + `schema_version` + sync `EXERCISE_CATALOG` into `exercises` table; **no real-user seeding**. |
| `src/lib/db/queries.ts` | 997-line query monolith with `getDefaultDemoUser()` fallback, XP/PR updates, JSON blob parsing | **REWRITE** | Split into domain query modules (`users`, `sessions`, `exercises`, `schedule`, `workouts`, `export`, `appleHealth`). Zero default-user fallback. |
| `src/lib/db/seed.ts` | Seeds `'alex'` and `'marco'` directly into production DB | **DELETE → REPLACE** | Delete production seeding. Replace with `src/lib/auth/sandbox.ts` creating an isolated temporary fictional sample copy (`is_guest = 1`) on demand. |
| `src/lib/auth/session.ts` | Stores raw `userId` in `liftitup_session` cookie; falls back to `getDefaultDemoUser()` | **REWRITE** | Random 32-byte session token (SHA-256 hashed in `auth_sessions`); per-user hashed `api_keys` lookup; return `null` / `401` when unauthenticated. |
| `src/lib/gamification/engine.ts` | XP curve, Rank Tiers, Streak Shields, Debrief impact | **DELETE** | Removed per D5. |
| `src/lib/audio/soundEngine.ts` | Web Audio API procedural sound synth | **DELETE** | Removed per Q4. |
| `src/lib/hypertrophy/exercises.ts` | 1,472-line hardcoded list with `formCues`, `movementSlot`, `canonicalEquivalenceRatio`, `SCHEDULE_PRESETS` | **DELETE** | Replaced by `src/lib/exercises/catalog.ts` (`@catalog`) + per-user custom/hidden DB tables. |
| `src/lib/hypertrophy/equivalence.ts`, `precompiler.ts`, `analytics.ts` | Slot equivalence math, double-progression precompiler, MEV/MAV/MRV landmarks, 72h muscle recovery | **DELETE** | Removed per I1/D5/F3. Last-session values for an exercise are queried directly in SQL for prefill & swap. |
| `src/lib/offline/outbox.ts` | `localStorage` outbox + active workout draft | **REWRITE** | Keep draft persistence and idempotency `cid`, remove XP/debrief assumptions, fix non-OK error handling so failed requests surface errors instead of looping. |
| `src/lib/mcp/server.ts`, `compilerSchema.ts` | JSON-RPC MCP server + 1,706-line AI prompt/parser | **REWRITE** | Rework MCP tools for v2 normalized data + plan import/exercises (`src/lib/mcp/server.ts`); replace prompt/parser with concise `src/lib/ai/importSchema.ts`. |
| `src/components/shell/TopHudBar.tsx` | Rank badge, XP bar, Flame streak, Shields, Sound toggle, Profile button | **REWRITE** | Minimal header: brand + current user/sandbox pill + Settings icon link only. |
| `src/components/shell/BottomTabBar.tsx` | 4 tabs (`Train`, `Split`, `Progress`, `AI & Sync`) duplicating `WorkoutTabView` top bar | **REWRITE** | Single bottom nav (`Calendar`, `Split`, `Exercises`, `Progress`, `AI`) — remove duplicate top Train/Split segmented bar. |
| `src/components/shell/ProfileAuthModal.tsx` | Lists all users for 1-tap switching, exposes raw API key | **DELETE** | Replaced by `/welcome` (Login / Register / Sample User) and `/settings`. |
| `src/components/workout/WorkoutTabView.tsx` | 910-line monolith mixing Today, Split, History, Timer, Plate Calc, Debrief | **DELETE → SPLIT** | Split into clean App Router pages: `/`, `/workout/[date]`, `/workout/[date]/log`, `/split`, `/split/edit`. |
| `src/components/workout/HeroTodayCard.tsx`, `ActiveSessionSheet.tsx` | Auto-shown active logger, "LIVE SESSION TRACKER" HUD, XP/tonnage bar, quick-complete | **DELETE** | Replaced by explicit read-only `/workout/[date]` with **Start** button + clean `/workout/[date]/log`. |
| `src/components/workout/ExerciseSlotCard.tsx` | Muscle tags, secondary factors, progression badges, form cues, cramped 12-col set grid | **REWRITE** | Clean `ExerciseLoggerCard.tsx`: exercise name, reorder/delete controls, swap button, optional notes, stacked mobile-friendly set rows respecting `trackingType`, optional quality pop-up. |
| `src/components/workout/FloatingRestTimer.tsx` | Floating wall-clock countdown + presets | **KEEP (EDIT)** | Keep UI & wall-clock timing; remove `soundEngine` dependency (use optional Web Notification / vibration / visual pulse). |
| `src/components/workout/VariationSwapSheet.tsx` | Bottom sheet to swap exercise for today or schedule | **REWRITE** | Keep sheet UX; remove biomechanical equivalence math — show user's last logged weight/reps for candidate exercises instead. |
| `src/components/workout/ScheduleBuilderSheet.tsx` | Fixed Mon–Sun 7-day editor with presets | **REWRITE** | Rewrite as `/split/edit` for variable-length rotation queue (add/remove/reorder days and exercises). |
| `src/components/workout/PlateCalculatorModal.tsx`, `SessionDebriefModal.tsx` | Plate calculator & post-workout XP modal | **DELETE** | Removed per Q4 & D5. |
| `src/components/dashboard/*` (`DashboardTabView`, `MuscleRecoveryMap`, `PrTrophyRoomCard`, `VolumeLandmarksCard`, `ShareableWorkoutCard`, `ProgressionChartCard`) | Hardcoded recovery map, trophy room, volume landmarks, shareable image card, e1RM chart | **DELETE → REWRITE** | Delete recovery map, trophy room, volume landmarks, shareable card. Rewrite `ProgressionChartCard` into `/progress` pure graph views (respecting `trackingType`). |
| `src/components/integrations/AppleFitnessPanel.tsx` | Apple Health webhook/XML/JSON/CSV import | **KEEP (EDIT)** | Keep shortcut webhook + file import UI inside `/settings`; remove XP bonus. |
| `src/components/integrations/AiRoutineCompiler.tsx`, `McpConnectPanel.tsx`, `IntegrationsTabView.tsx` | Long prompts, pre-filled sample JSON, inline before/after diff, MCP tester | **REWRITE** | Split into `/ai` (empty preview until pasted, 1 copy prompt + 1 copy edit prompt, paste button) and `/settings` (MCP URL + key regenerate + Export). |
| `src/app/api/*` | 8 API routes (missing auth 401 enforcement, no logging) | **REWRITE** | Full v2 REST routes + `/api/mcp` with `requireAuth()` returning `401` and structured logger. |

---

## 2. New Information Architecture & Navigation

### Single Navigation Model (No Duplicate Nav)
- **Top Bar (`AppHeader`)**: Brand (`LIFTITUP`), optional `SAMPLE` badge (with quick "Create Account" CTA for guest sandboxes), and a **Settings** link (`/settings`). Zero XP, rank, streak, or sound controls.
- **Bottom Navigation (`BottomNav`)** — single primary nav, 5 routes:
  1. **Calendar** (`/`)
  2. **Split** (`/split`)
  3. **Exercises** (`/exercises`)
  4. **Progress** (`/progress`)
  5. **AI** (`/ai`)

### Route Map (Separate View & Edit Pages, Minimal UI Copy)

| Route | Mode | One-Line Purpose | Main Controls |
|---|---|---|---|
| `/welcome` | Public | Entry screen for unauthenticated visitors. | **Log in** form, **Register** form, **Explore as sample user** button. |
| `/onboarding` | Auth | First-time setup right after registration. | **Empty setup** button (goes to `/`), **AI onboarding** option (goes to `/ai`). |
| `/` | View | Minimal calendar showing projected rotation week and logged days. | Week `<` `>` / Today buttons; 7 day cells (tap → `/workout/[date]`); action bar for today: **Postpone (+1/+2/+3d)**, **Skip**, **Jolly Day**, **Reset**. |
| `/workout/[date]` | View | Read-only view of planned or completed workout for `date`. | **Start** button (explicit, never auto-starts → `/workout/[date]/log`), **Edit** button (when logged), **Skip** / **Jolly** toggles if today. |
| `/workout/[date]/log` | Edit | Active workout logger & session editor. | Stacked set inputs per `trackingType`, rest timer trigger, optional set-quality pop-up, exercise reorder/delete/add/swap, workout & exercise notes, **Save** button. |
| `/split` | View | Read-only view of the active rotation queue days and exercises. | **Edit** button (→ `/split/edit`), **Reset Rotation** button. |
| `/split/edit` | Edit | Edit rotation queue order, days, exercises, sets/targets/rest/notes. | Add/remove/reorder days (`↑`/`↓`), toggle Rest Day, add/remove/reorder exercises, edit sets/reps-or-time/weight/rest/notes, **Save**. |
| `/exercises` | View | Searchable catalog of built-in and custom exercises. | Search input, category/tracking-type filter chips, hide/unhide toggle, **+ New** button (→ `/exercises/new`), edit custom exercise link. |
| `/exercises/new` | Edit | Create a custom exercise (and `/exercises/[id]/edit` to edit custom). | Name, `trackingType` selector, category, equipment, default rest seconds, **Save** / **Delete**. |
| `/progress` | View | Graph-only progress tracking respecting each exercise's `trackingType`. | Exercise selector + date range (`4w`/`12w`/`All`); charts: exercise progression, weekly sessions, sets/volume over time, bodyweight. |
| `/ai` | Tool | Copy AI prompt, paste returned JSON, preview diff/plan, confirm import. | **Copy onboarding prompt**, **Copy edit prompt** (with current data), **Paste AI result** button + textarea, validation errors, empty-until-pasted preview, **Confirm**. |
| `/settings` | View/Edit | Profile, preferences, integrations, and data export. | Height/weight/age/training years, unit (`kg`/`lb`), **Execution quality %** toggle (default OFF), MCP URL + **Regenerate Key**, Apple Health import/webhook, **Export JSON / CSV**, **Log out**. |

---

## 3. DB Schema v2 (`node:sqlite`, Normalized, Wipe-on-Deploy)

No migration from v1 is required (old DB is wiped on deploy per Q3). Foreign keys enabled (`PRAGMA foreign_keys = ON;`).

### Tracking Types Justification
Matches `src/lib/exercises/catalog.ts` (`@catalog`):
1. `weight_reps` — external load × reps (barbell, dumbbell, machine, cable).
2. `bodyweight_reps` — pure bodyweight reps (push-ups, muscle-ups, pistol squats).
3. `weighted_bodyweight` — bodyweight + added belt/vest kg × reps (weighted dips, weighted pull-ups).
4. `assisted_bodyweight` — bodyweight − counterweight/band kg × reps (assisted pull-ups/dips).
5. `time` — duration hold in seconds (plank, L-sit, planche, handstand).
6. `weight_time` — external load × hold/carry seconds (farmer's walk, weighted plank).
7. `distance` — distance in meters without timed pace (sled push, broad jumps).
8. `distance_time` — distance in meters + duration in seconds (rowing, running, ski erg).

### Full `CREATE TABLE` Statements

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  height_cm REAL,
  weight_kg REAL NOT NULL DEFAULT 75,
  age INTEGER,
  training_years REAL,
  unit TEXT NOT NULL DEFAULT 'kg' CHECK (unit IN ('kg', 'lb')),
  enable_set_quality INTEGER NOT NULL DEFAULT 0 CHECK (enable_set_quality IN (0, 1)),
  apple_fitness_enabled INTEGER NOT NULL DEFAULT 1 CHECK (apple_fitness_enabled IN (0, 1)),
  is_guest INTEGER NOT NULL DEFAULT 0 CHECK (is_guest IN (0, 1)),
  last_active_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_guest_active ON users (is_guest, last_active_at);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions (user_id);

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT UNIQUE NOT NULL,
  key_hash TEXT UNIQUE NOT NULL,
  key_prefix TEXT NOT NULL,
  key_encrypted TEXT NOT NULL, -- AES-256-GCM with SESSION_SECRET so user can copy MCP URL anytime
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Synced from src/lib/exercises/catalog.ts (is_custom=0, user_id=NULL) + user custom exercises (is_custom=1)
CREATE TABLE IF NOT EXISTS exercises (
  id TEXT PRIMARY KEY,
  user_id TEXT, -- NULL for built-in catalog
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  tracking_type TEXT NOT NULL CHECK (
    tracking_type IN (
      'weight_reps', 'bodyweight_reps', 'weighted_bodyweight',
      'assisted_bodyweight', 'time', 'weight_time', 'distance', 'distance_time'
    )
  ),
  equipment TEXT NOT NULL DEFAULT 'other',
  category TEXT NOT NULL DEFAULT 'other',
  default_rest_seconds INTEGER NOT NULL DEFAULT 120,
  is_custom INTEGER NOT NULL DEFAULT 0 CHECK (is_custom IN (0, 1)),
  aliases_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_exercises_user ON exercises (user_id, is_custom);
CREATE UNIQUE INDEX IF NOT EXISTS idx_exercises_user_slug ON exercises (COALESCE(user_id, '__global__'), slug);

CREATE TABLE IF NOT EXISTS hidden_exercises (
  user_id TEXT NOT NULL,
  exercise_id TEXT NOT NULL,
  hidden_at TEXT NOT NULL,
  PRIMARY KEY (user_id, exercise_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (exercise_id) REFERENCES exercises(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS schedules (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  rotation_anchor_date TEXT NOT NULL,  -- YYYY-MM-DD
  rotation_anchor_index INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_schedules_user_active ON schedules (user_id, is_active);

CREATE TABLE IF NOT EXISTS schedule_days (
  id TEXT PRIMARY KEY,
  schedule_id TEXT NOT NULL,
  position INTEGER NOT NULL, -- 0 .. N-1 in rotation queue
  label TEXT NOT NULL,
  is_rest_day INTEGER NOT NULL DEFAULT 0 CHECK (is_rest_day IN (0, 1)),
  FOREIGN KEY (schedule_id) REFERENCES schedules(id) ON DELETE CASCADE,
  UNIQUE (schedule_id, position)
);

CREATE TABLE IF NOT EXISTS schedule_day_exercises (
  id TEXT PRIMARY KEY,
  schedule_day_id TEXT NOT NULL,
  exercise_id TEXT NOT NULL,
  order_index INTEGER NOT NULL,
  target_sets INTEGER NOT NULL DEFAULT 3,
  target_reps INTEGER,
  target_reps_min INTEGER,
  target_reps_max INTEGER,
  target_time_seconds INTEGER,
  target_weight_kg REAL,
  target_distance_m REAL,
  rest_seconds INTEGER NOT NULL DEFAULT 120,
  notes TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (schedule_day_id) REFERENCES schedule_days(id) ON DELETE CASCADE,
  FOREIGN KEY (exercise_id) REFERENCES exercises(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_sched_day_ex_order ON schedule_day_exercises (schedule_day_id, order_index);

CREATE TABLE IF NOT EXISTS schedule_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  schedule_id TEXT NOT NULL,
  event_date TEXT NOT NULL, -- YYYY-MM-DD
  event_type TEXT NOT NULL CHECK (
    event_type IN ('skip', 'postpone', 'reset', 'jolly_extra', 'jolly_instead')
  ),
  shift_days INTEGER, -- 1, 2, or 3 for postpone
  jolly_label TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (schedule_id) REFERENCES schedules(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sched_events_user_date ON schedule_events (user_id, schedule_id, event_date);

CREATE TABLE IF NOT EXISTS workout_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  session_date TEXT NOT NULL, -- YYYY-MM-DD
  schedule_id TEXT,
  schedule_day_id TEXT,
  is_jolly INTEGER NOT NULL DEFAULT 0 CHECK (is_jolly IN (0, 1)),
  jolly_mode TEXT CHECK (jolly_mode IN ('extra', 'instead')),
  title TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  duration_minutes INTEGER,
  user_weight_kg REAL,
  notes TEXT NOT NULL DEFAULT '',
  apple_watch_kcal INTEGER,
  apple_watch_avg_hr INTEGER,
  apple_watch_max_hr INTEGER,
  cid TEXT, -- idempotency key
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (schedule_id) REFERENCES schedules(id) ON DELETE SET NULL,
  FOREIGN KEY (schedule_day_id) REFERENCES schedule_days(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_date ON workout_sessions (user_id, session_date DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_user_cid ON workout_sessions (user_id, cid) WHERE cid IS NOT NULL;

CREATE TABLE IF NOT EXISTS workout_exercises (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  exercise_id TEXT NOT NULL,
  order_index INTEGER NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (session_id) REFERENCES workout_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (exercise_id) REFERENCES exercises(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_workout_ex_order ON workout_exercises (session_id, order_index);

CREATE TABLE IF NOT EXISTS workout_sets (
  id TEXT PRIMARY KEY,
  workout_exercise_id TEXT NOT NULL,
  set_number INTEGER NOT NULL,
  weight_kg REAL,
  reps INTEGER,
  time_seconds INTEGER,
  distance_m REAL,
  rest_seconds INTEGER,
  execution_quality_pct INTEGER CHECK (execution_quality_pct BETWEEN 0 AND 100), -- NULL = normal 100%
  is_completed INTEGER NOT NULL DEFAULT 1 CHECK (is_completed IN (0, 1)),
  created_at TEXT NOT NULL,
  FOREIGN KEY (workout_exercise_id) REFERENCES workout_exercises(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_workout_sets_ex ON workout_sets (workout_exercise_id, set_number);

-- Optional per-rep execution quality overrides (only rows != 100% or when per-rep mode used)
CREATE TABLE IF NOT EXISTS workout_set_rep_qualities (
  id TEXT PRIMARY KEY,
  workout_set_id TEXT NOT NULL,
  rep_index INTEGER NOT NULL, -- 1-based
  quality_pct INTEGER NOT NULL CHECK (quality_pct BETWEEN 0 AND 100),
  FOREIGN KEY (workout_set_id) REFERENCES workout_sets(id) ON DELETE CASCADE,
  UNIQUE (workout_set_id, rep_index)
);

CREATE TABLE IF NOT EXISTS apple_health_workouts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  workout_type TEXT NOT NULL,
  started_at TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL,
  active_calories INTEGER NOT NULL,
  avg_heart_rate INTEGER,
  max_heart_rate INTEGER,
  bodyweight_kg REAL,
  linked_session_id TEXT,
  source TEXT NOT NULL DEFAULT 'shortcut_webhook',
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (linked_session_id) REFERENCES workout_sessions(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_apple_health_user ON apple_health_workouts (user_id, started_at DESC);

CREATE TABLE IF NOT EXISTS session_swaps (
  user_id TEXT NOT NULL,
  date_key TEXT NOT NULL,
  schedule_day_exercise_id TEXT NOT NULL,
  exercise_id TEXT NOT NULL,
  PRIMARY KEY (user_id, date_key, schedule_day_exercise_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (exercise_id) REFERENCES exercises(id) ON DELETE CASCADE
);
```

### Guest Sandbox Lifecycle
- Selecting **"Explore as sample user"** on `/welcome` calls `POST /api/auth/guest`:
  - Creates a `users` row (`is_guest = 1`, `last_active_at = now`) + realistic fictional sample split, 3 weeks of workout history, custom exercise example, and sample notes, plus a normal `auth_sessions` cookie.
  - Guest can freely edit, log workouts, postpone, skip, test AI preview, etc. in their own isolated sandbox.
  - Every authenticated request updates `users.last_active_at` (throttled e.g. >5m) and opportunistically runs `DELETE FROM users WHERE is_guest = 1 AND last_active_at < datetime('now', '-24 hours')` (`ON DELETE CASCADE` removes all sandbox rows).

---

## 4. Schedule Rotation-Queue Algorithm

The schedule is an ordered queue `Q = [Q[0], ..., Q[N-1]]` (no fixed weekdays), projected day-by-day onto calendar dates starting from `rotation_anchor_date` (or latest `reset` event date).

### Rules
1. **Anchor / Reset**: Start simulation at `startDate = max(schedule.rotation_anchor_date, latestResetEvent.event_date)` with `qIdx = schedule.rotation_anchor_index` (0 after `reset`).
2. **Postpone (`shift_days` in `{1,2,3}`)**: When a `postpone` event occurs on date `d`, it marks `[d .. d + shift_days - 1]` as `postponed` (off days). On those days `qIdx` does **not** advance.
3. **Completed Planned Session**: If a non-jolly session (`completed_at IS NOT NULL`) exists on `d`, `d` is `completed` and `qIdx = (qIdx + 1) % N`.
4. **Jolly Day**:
   - `jolly_instead`: marks the planned `Q[qIdx]` for `d` as **skipped** (replaced), renders the Jolly workout on `d`, and advances `qIdx = (qIdx + 1) % N`.
   - `jolly_extra`: renders the Jolly workout on `d`. If `Q[qIdx]` was already completed on `d`, `qIdx` already advanced; if `Q[qIdx]` is a Rest day, `qIdx = (qIdx + 1) % N`; otherwise `Q[qIdx]` is deferred to `d + 1` (`qIdx` does **not** advance).
5. **Explicit Skip (`skip` event on `d`)**: marks `Q[qIdx]` as `skipped` on `d` and advances `qIdx = (qIdx + 1) % N`.
6. **Planned Rest Day (`Q[qIdx].isRestDay == true`)**: `d` is `rest`, and `qIdx = (qIdx + 1) % N` for `d + 1`.
7. **Missed Past Training Day (`d < today`, `Q[qIdx]` is a training day, no logged session, no `skip`, no `postpone`)**:
   - Per Q5: no "do missed workout" button; calendar cell `d` shows status `skipped` (not done).
   - **Queue pointer `qIdx` does NOT advance**, so the missed workout shifts onto the next available day (`d + 1`), keeping the rest of the sequence (including following Rest days) intact.
8. **Today & Future (`d >= today`)**: projects `Q[qIdx]` onto `d` as `planned` (or `rest`) and advances `qIdx = (qIdx + 1) % N` across future days.

### Pseudo-Code

```ts
function projectCalendar(
  queue: ScheduleDay[],      // length N >= 1
  anchorDate: string,        // YYYY-MM-DD
  anchorIndex: number,       // 0..N-1
  events: ScheduleEvent[],   // sorted ascending by event_date, created_at
  sessions: WorkoutSession[],
  today: string,             // YYYY-MM-DD
  rangeStart: string,
  rangeEnd: string
): CalendarDay[] {
  // 1. Find latest reset event <= rangeEnd
  const reset = events.filter(e => e.event_type === 'reset' && e.event_date <= rangeEnd).at(-1);
  let simStart = reset ? reset.event_date : anchorDate;
  let qIdx = reset ? 0 : (anchorIndex % queue.length);
  if (rangeStart < simStart) simStart = simStart; // days before simStart have status 'unscheduled'

  // Index sessions & events by YYYY-MM-DD
  const sessionsByDate = groupBy(sessions, s => s.sessionDate);
  const postponedUntilByDate = buildPostponeSet(events); // expands (d, k) -> set of postponed dates

  const result: CalendarDay[] = [];
  for (let d = simStart; d <= rangeEnd; d = addDays(d, 1)) {
    const daySessions = sessionsByDate.get(d) ?? [];
    const dayEvents = events.filter(e => e.event_date === d);
    const plannedDay = queue[qIdx];

    let entry: CalendarDay;

    if (postponedUntilByDate.has(d)) {
      entry = { date: d, status: 'postponed', plannedDay: null, sessions: daySessions };
      // qIdx unchanged
    } else if (dayEvents.some(e => e.event_type === 'jolly_instead') || daySessions.some(s => s.isJolly && s.jollyMode === 'instead')) {
      entry = { date: d, status: 'jolly_instead', plannedDay, skippedLabel: plannedDay.label, sessions: daySessions };
      qIdx = (qIdx + 1) % queue.length;
    } else if (daySessions.some(s => !s.isJolly && s.completedAt)) {
      entry = { date: d, status: 'completed', plannedDay, sessions: daySessions };
      qIdx = (qIdx + 1) % queue.length;
    } else if (dayEvents.some(e => e.event_type === 'jolly_extra') || daySessions.some(s => s.isJolly && s.jollyMode === 'extra')) {
      entry = { date: d, status: 'jolly_extra', plannedDay, sessions: daySessions };
      if (plannedDay.isRestDay) qIdx = (qIdx + 1) % queue.length;
      // else qIdx stays so planned workout moves to d + 1
    } else if (dayEvents.some(e => e.event_type === 'skip')) {
      entry = { date: d, status: 'skipped', plannedDay, sessions: daySessions };
      qIdx = (qIdx + 1) % queue.length;
    } else if (plannedDay.isRestDay) {
      entry = { date: d, status: 'rest', plannedDay, sessions: daySessions };
      qIdx = (qIdx + 1) % queue.length;
    } else if (d < today) {
      // Past training day with no logged workout -> counts as skipped on calendar, queue carries workout forward
      entry = { date: d, status: 'skipped', plannedDay, sessions: daySessions };
      // qIdx unchanged!
    } else {
      // d >= today: planned workout (and project forward)
      entry = { date: d, status: 'planned', plannedDay, sessions: daySessions };
      qIdx = (qIdx + 1) % queue.length;
    }

    if (d >= rangeStart) result.push(entry);
  }
  return result;
}
```

### Worked Examples (Test Cases)
Queue for all cases unless noted: `Q = [Push1(0), Pull1(1), Legs1(2), Rest(3), Push2(4), Legs2(5)]` (`N=6`), anchored `Fri = 0`.

1. **Normal week (no misses)**: Fri `Push1 (completed)`, Sat `Pull1 (completed)`, Sun `Legs1 (completed)`, Mon `Rest`, Tue `Push2 (planned)`, Wed `Legs2 (planned)`, Thu `Push1 (planned)`.
2. **Missed Sunday Legs (`today = Mon`)**: Fri `Push1 (completed)`, Sat `Pull1 (completed)`. Sun had no session → Sun displays `skipped` (`Legs1` not done; no "do missed workout" button). Queue stays at `qIdx=2` (`Legs1`). Result: **Mon = `Legs1 (planned)`, Tue = `Rest`, Wed = `Push2`, Thu = `Legs2`** (sequence continues without breaking the Rest).
3. **Postpone +2 days on Monday**: Mon was `Legs1`. User taps `Postpone +2d` → Mon = `postponed`, Tue = `postponed`, **Wed = `Legs1`**, Thu = `Rest`, Fri = `Push2`.
4. **Explicit Skip vs Jolly Instead vs Jolly Extra (on Monday `Legs1`)**:
   - **Skip**: Mon = `skipped` (`Legs1`), Tue = `Rest`, Wed = `Push2`.
   - **Jolly Instead** (e.g. "5k Run"): Mon = `jolly_instead` (`Legs1` marked skipped), Tue = `Rest`, Wed = `Push2`.
   - **Jolly Extra** (e.g. "Arms Pump"): Mon = `jolly_extra`, **Tue = `Legs1`**, Wed = `Rest`, Thu = `Push2`.
5. **Reset on Wednesday**: Queue drifted to `Legs1`; user taps `Reset` on Wed → `reset` event at Wed sets `qIdx = 0` → Wed = `Push1`, Thu = `Pull1`, Fri = `Legs1`, Sat = `Rest`.

---

## 5. Set-Quality UX (Q1)

- **Setting**: `users.enable_set_quality` (`0` by default). Controlled in `/settings`.
- **When OFF**: Zero quality UI shown on `/workout/[date]/log`. Existing quality values (if any) stay preserved in DB.
- **When ON**:
  - Each set card shows a compact `%` pill (`100%` by default, or current average e.g. `85%`) beside the Check button.
  - Tapping the `%` pill (or long-pressing the set row) opens a small **Set Quality Popover**:
    - Quick chips: `100%` (Clean), `85%` (Minor breakdown), `70%` (Assisted / Partial), `50%` (Half / Heavy assist).
    - Fine slider/stepper (`0–100%`, step `5`).
    - Optional **"Per-rep"** toggle: renders `1..reps` small chips (each defaults `100%`, tap to cycle/set e.g. rep 3 = `70%` → saves `workout_set_rep_qualities` rows and sets `execution_quality_pct = round(avg)`).
- **Row Color Coding** (applied when `is_completed = 1`):
  - `quality == null || quality === 100`: standard completed green (`#cde6c0`)
  - `80 <= quality < 100`: warm yellow (`#fef0c3`)
  - `50 <= quality < 80`: orange (`#fbd5b5`)
  - `quality < 50`: soft red (`#f9c6bf`)

---

## 6. API Routes, Error Handling, Logging & Performance Fix

### Standard Error Shape & Server Logger
- Every API route wraps its handler in `withApiHandler(routeName, fn)` (`src/lib/api/handler.ts`) using `src/lib/logger.ts`:
  - Emits single-line JSON logs: `{ ts, level, requestId, route, method, userId, status, durationMs, msg, err }`.
  - Standard error payload on `4xx`/`5xx`:
    ```json
    { "error": { "code": "UNAUTHORIZED", "message": "Authentication required" }, "requestId": "req_..." }
    ```
- **Strict Auth (`401`)**: `requireAuth(req)` checks Bearer/x-api-key (via `api_keys.key_hash`) or `liftitup_session` cookie (via `auth_sessions.token_hash`). Returns `401` immediately if missing/invalid. **No default-user fallback.**

### Route List

| Method & Path | Purpose | Request Shape | Response Shape |
|---|---|---|---|
| `GET /api/auth/me` | Current user profile + sandbox flag | Cookie / API key | `200 { user }` or `401` |
| `POST /api/auth/register` | Create real account & set cookie | `{ username, password, displayName? }` | `201 { user }` |
| `POST /api/auth/login` | Verify password & set session cookie | `{ username, password }` | `200 { user }` |
| `POST /api/auth/logout` | Delete `auth_sessions` row & clear cookie | — | `200 { ok: true }` |
| `POST /api/auth/guest` | Create temporary guest sandbox w/ sample data | — | `201 { user }` |
| `PATCH /api/settings` | Update profile/preferences | `{ displayName?, heightCm?, weightKg?, age?, trainingYears?, unit?, enableSetQuality?, appleFitnessEnabled? }` | `200 { user }` |
| `POST /api/settings/api-key` | Regenerate personal MCP/API key | — | `200 { apiKey, mcpUrl }` |
| `GET /api/calendar` | Projected calendar for date range | `?start=YYYY-MM-DD&end=YYYY-MM-DD` | `200 { days: CalendarDay[], schedule }` |
| `POST /api/schedule/events` | Trigger Skip / Postpone / Reset | `{ eventDate, eventType: 'skip'|'postpone'|'reset', shiftDays?: 1|2|3 }` | `201 { event }` |
| `GET /api/schedule` | Get active rotation schedule | — | `200 { schedule }` |
| `PUT /api/schedule` | Replace active rotation schedule & days/exercises | `{ name, days: [...] }` | `200 { schedule }` |
| `GET /api/exercises` | List visible catalog + custom exercises | `?q=&category=&trackingType=&includeHidden=0|1` | `200 { exercises }` |
| `POST /api/exercises` | Create custom exercise | `{ name, trackingType, equipment, category, defaultRestSeconds? }` | `201 { exercise }` |
| `PATCH /api/exercises/[id]` | Edit custom exercise or toggle hide/unhide | `{ name?, trackingType?, ..., hidden?: boolean }` | `200 { exercise }` |
| `DELETE /api/exercises/[id]` | Delete custom exercise (fails if referenced in logged sets unless hidden) | — | `200 { ok: true }` |
| `GET /api/workouts/[date]` | View planned or logged session(s) for `date`, plus last-logged perf per exercise | — | `200 { calendarDay, sessions, prefillByExerciseId }` |
| `POST /api/workouts/sessions` | Save/complete a workout session (normal or jolly) | `{ sessionDate, scheduleDayId?, isJolly?, jollyMode?, title, durationMinutes?, notes?, cid?, exercises: [{ exerciseId, orderIndex, notes?, sets: [...] }] }` | `201 { session }` |
| `PATCH /api/workouts/sessions/[id]` | Edit an existing logged session | Same body (partial/full exercises+sets) | `200 { session }` |
| `DELETE /api/workouts/sessions/[id]` | Delete / undo a logged session | — | `200 { ok: true }` |
| `POST /api/workouts/swap` | Swap exercise for a day (`session_swaps`) or permanently in split | `{ dateKey, scheduleDayExerciseId, toExerciseId, scope: 'session'|'schedule' }` | `200 { ok: true, prefill }` |
| `GET /api/progress` | Chart series for exercise progression, frequency, volume, weight | `?exerciseId=&range=4w|12w|all` | `200 { exerciseSeries, frequency, weeklyVolume, bodyweight }` |
| `POST /api/ai/import` | Validate or confirm AI onboarding/plan JSON | `{ mode: 'validate'|'confirm', rawText }` | `200 { valid, errors, preview, createdCustomExercises?, schedule? }` |
| `GET /api/export` | Download user data | `?format=json|csv` | JSON attachment or `text/csv` attachment |
| `GET/POST /api/integrations/apple-health` | Webhook + file import for Apple Health | `{ workoutType, startedAt, durationMinutes, activeCalories, ... }` | `200 { workouts }` |
| `GET/POST /api/mcp` | Per-user MCP JSON-RPC endpoint (API key auth only) | JSON-RPC 2.0 | `200` JSON-RPC or `401` |

### Why "Save Current Workout" Is Slow / Appears Stuck Today
Observed in `src/lib/db/queries.ts`, `src/components/workout/WorkoutTabView.tsx`, and `src/app/page.tsx`:
1. **Heavy synchronous server pipeline (`logWorkoutSessionWithImpact`)**: On every `POST /api/workouts/log`, the server reads and `JSON.parse()`s up to 40 `sets_json` blobs, scans all `pr_records`, and runs `calculateSessionImpact()` + `buildAnalyticsSummary()` synchronously inside the save request.
2. **4-endpoint waterfall refetch + duplicate mount trigger**: `WorkoutTabView.tsx` triggers `onSessionLogged` → `loadAllData()` (`src/app/page.tsx`), firing 4 parallel endpoints (`/api/auth`, `/api/workouts/precompile`, `/api/schedule`, `/api/analytics`) that re-parse `sets_json` and re-serialize the exercise catalog; additionally, `loadAllData` depends on `exercises.length` in `useCallback`, causing redundant refetches.
3. **Silent `!res.ok` swallowing into outbox loop**: In `WorkoutTabView.tsx` (lines 451–488) and `ScheduleBuilderSheet.tsx` (lines 246–270), non-OK (`4xx`/`5xx`) HTTP responses do not throw or show an error toast; they enqueue into `localStorage` outbox and display success/sync messages while retrying failing requests.
- **v2 Fix**: Normalized `workout_sets` SQL writes inside a single transaction (<5ms), no analytics/XP recomputation on save, explicit `!res.ok` error parsing with visible error toasts, and page-scoped fetches.

---

## 7. AI Onboarding & Edit Existing Plan

### Onboarding Prompt (Copied by User into Their Own AI Chat)
Short, clear, single copy button on `/ai` (and `/onboarding`):

```text
Ask me 4 quick questions first: height (cm), weight (kg), age, and years of training.
Then ask me to describe my current workout split (I may send text, voice transcript, or a screenshot).
Once I reply, return ONLY valid JSON matching this schema (no extra prose):
{
  "profile": { "heightCm": 178, "weightKg": 78, "age": 26, "trainingYears": 3, "unit": "kg" },
  "schedule": {
    "name": "My Split",
    "days": [
      {
        "label": "Push",
        "isRestDay": false,
        "exercises": [
          {
            "name": "Barbell Bench Press",
            "trackingType": "weight_reps",
            "targetSets": 3,
            "targetRepsMin": 6,
            "targetRepsMax": 8,
            "targetWeightKg": 80,
            "restSeconds": 150,
            "notes": ""
          }
        ]
      },
      { "label": "Rest", "isRestDay": true, "exercises": [] }
    ]
  }
}
Allowed trackingType values: weight_reps, bodyweight_reps, weighted_bodyweight, assisted_bodyweight, time, weight_time, distance, distance_time.
For time exercises use "targetTimeSeconds" instead of reps; for distance use "targetDistanceM".
Put days in exact rotation order (no weekday names needed).
```

### Edit Existing Plan Prompt ("Copy edit prompt" Button)
Client builds a concise prompt containing the user's current profile + current `schedule.days` JSON + list of custom exercises:

```text
Here is my current LiftItUp profile and rotation split JSON:
<CURRENT_JSON>

I want to modify my plan: [describe your changes here].
First show me a concise Before -> After summary of what changes, then output the complete updated JSON in the exact same schema (valid JSON block only for the code block).
```

### Strict Validation & Import Flow
1. **Empty initial state**: Paste box is empty; preview area is completely empty until text is pasted (no sample payload preloaded).
2. **Paste**: User taps **"Paste AI result"** (reads clipboard) or pastes manually.
3. **Validate (`src/lib/ai/importSchema.ts`)**: Strips markdown code fences if present, parses JSON, validates every field against strict rules:
   - `profile`: finite positive numbers for `heightCm` (100–250), `weightKg` (25–300), `age` (12–100), `trainingYears` (0–80).
   - `schedule.days`: non-empty array; each day has `label`; non-rest days have ≥1 exercise; each exercise has `name`, valid `trackingType` enum, `targetSets` (1–20), `restSeconds` (0–600), and type-appropriate targets (`targetReps` or `targetRepsMin/Max` for rep types; `targetTimeSeconds` for `time`/`weight_time`; `targetDistanceM` for `distance`/`distance_time`).
   - Returns exact field-path errors (e.g. `schedule.days[0].exercises[2].trackingType: invalid value "reps"`).
4. **Preview**: Renders each rotation day and exercise; matches exercise `name` case-insensitively against `EXERCISE_CATALOG` + user's custom exercises (`name` and `aliases`). Unmatched names display a `"New custom"` badge.
5. **Confirm**: `POST /api/ai/import` (`mode: 'confirm'`) inside one SQLite transaction: updates `users` profile fields, inserts unmatched exercises as `exercises (is_custom = 1)`, creates new active `schedules` + `schedule_days` + `schedule_day_exercises`, and sets `rotation_anchor_date = today, rotation_anchor_index = 0`.

---

## 8. Export Format & MCP Tools

### JSON Export (`GET /api/export?format=json`)
Nested, AI-ready document:
```json
{
  "schemaVersion": 2,
  "exportedAt": "2026-11-15T19:00:00Z",
  "user": { "username": "...", "heightCm": 178, "weightKg": 78, "age": 26, "trainingYears": 3, "unit": "kg" },
  "activeSchedule": {
    "id": "...", "name": "...", "anchorDate": "2026-11-01", "anchorIndex": 0,
    "days": [{ "position": 0, "label": "Push", "isRestDay": false, "exercises": [ ... ] }]
  },
  "exercises": { "custom": [ ... ], "hiddenIds": [ ... ] },
  "scheduleEvents": [ ... ],
  "sessions": [
    {
      "id": "...", "sessionDate": "2026-11-15", "title": "Push",
      "isJolly": false, "jollyMode": null, "durationMinutes": 52, "userWeightKg": 78, "notes": "...",
      "appleHealth": { "kcal": 380, "avgHr": 128, "maxHr": 162 },
      "exercises": [
        {
          "exerciseId": "barbell-bench-press", "name": "Barbell Bench Press", "trackingType": "weight_reps",
          "orderIndex": 0, "notes": "...",
          "sets": [
            { "setNumber": 1, "weightKg": 80, "reps": 8, "timeSeconds": null, "distanceM": null, "restSeconds": 150, "executionQualityPct": 90, "repQualities": [{ "repIndex": 3, "qualityPct": 70 }] }
          ]
        }
      ]
    }
  ]
}
```

### CSV Tidy Export (`GET /api/export?format=csv`)
One row per set (pandas/R ready):
```text
session_id,session_date,session_title,is_jolly,jolly_mode,duration_minutes,user_weight_kg,session_notes,exercise_order,exercise_id,exercise_name,tracking_type,exercise_notes,set_number,weight_kg,reps,time_seconds,distance_m,rest_seconds,execution_quality_pct,is_completed
```

### MCP Tools (`POST /api/mcp`, strictly per-user via API key, 401 if invalid)
- **Read tools**:
  - `get_profile` — user profile & preferences
  - `get_schedule` — active rotation queue + 14-day projected calendar
  - `get_workout_history` — sessions with exercises, sets, `executionQualityPct`, and notes (args: `from?`, `to?`, `exerciseId?`, `limit?`)
  - `list_exercises` — visible catalog + custom exercises (args: `query?`, `category?`, `trackingType?`, `includeHidden?`)
  - `export_data` — full nested JSON export
- **Write tools**:
  - `upsert_custom_exercise` — create/update user custom exercise
  - `hide_exercise` — hide or unhide a catalog exercise for the user
  - `import_plan` — validate & apply AI JSON plan (same logic as `/api/ai/import`, auto-creating unknown exercises)
  - `log_workout_session` — log a completed workout session respecting `trackingType`, notes, and optional `executionQualityPct`

---

## 9. Phase 2 / 3 Work Breakdown (Strict File Ownership)

> Shared files (`src/types/domain.ts`, `src/lib/db/*`, `src/lib/auth/*`, `src/lib/logger.ts`, `src/lib/exercises/repository.ts`) belong exclusively to **WP1 (Foundation)**. Parallel feature packages (WP2–WP7) only edit their owned routes/components/lib files. Reference `src/lib/exercises/catalog.ts` (`@catalog`, already separate) without modifying it.

| Package | Difficulty | Depends On | Strict Owned Files / Directories | Acceptance Criteria |
|---|---|---|---|---|
| **WP1: Foundation (DB v2, Auth, Guest Sandbox, Logger, Types)** | **High** | `@catalog` (`catalog.ts` types) | `src/types/domain.ts`, `src/lib/logger.ts`, `src/lib/api/handler.ts`, `src/lib/db/**`, `src/lib/auth/**`, `src/lib/exercises/repository.ts`, `src/app/api/auth/**`, `src/app/api/settings/**` | Schema v2 creates all tables + syncs `EXERCISE_CATALOG`; `requireAuth` returns `401` with zero demo fallback; hashed session tokens + per-user encrypted/hashed API keys; guest sandbox creates fictional copy and purges after 24h inactivity; `tsc --noEmit` passes on foundation. |
| **WP2: Rotation-Queue Engine & Calendar Home** | **High** | WP1 | `src/lib/schedule/queue.ts`, `src/lib/schedule/__tests__/**`, `src/app/api/calendar/**`, `src/app/api/schedule/**`, `src/components/shell/AppHeader.tsx`, `src/components/shell/BottomNav.tsx`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/welcome/page.tsx`, `src/app/onboarding/page.tsx`, `src/components/calendar/**` | Pure `projectCalendar()` passes all 5 worked test cases (normal, missed Sunday→Monday, postpone 1/2/3, skip vs jolly extra/instead, reset); single bottom nav + minimal top bar; `/` renders minimal calendar + queue actions; `/welcome` & `/onboarding` work end-to-end. |
| **WP3: Workout View & Active Logger** | **High** | WP1, WP2 | `src/app/workout/**`, `src/app/api/workouts/**`, `src/components/workout/ExerciseLoggerCard.tsx`, `src/components/workout/SetQualityPopover.tsx`, `src/components/workout/VariationSwapSheet.tsx`, `src/components/workout/FloatingRestTimer.tsx`, `src/lib/offline/outbox.ts` | `/workout/[date]` never auto-starts (explicit **Start** button); `/workout/[date]/log` renders stacked mobile-friendly set inputs per all 8 `TrackingType`s; reorder/delete/add/swap exercises; workout + exercise notes; set-quality popover hidden when setting OFF & colors rows when ON; save completes in <50ms with error toast on `!res.ok`; deletes `PlateCalculatorModal.tsx`, `SessionDebriefModal.tsx`, `HeroTodayCard.tsx`, `ActiveSessionSheet.tsx`, `ExerciseSlotCard.tsx`, `WorkoutTabView.tsx`. |
| **WP4: Split View & Split Editor** | **Medium** | WP1, WP2 | `src/app/split/**`, `src/components/split/**` (deletes `ScheduleBuilderSheet.tsx`) | `/split` displays read-only rotation queue with **Edit** and **Reset** buttons; `/split/edit` allows adding/removing/reordering rotation days and exercises inside each day with targets/rest/notes; persists via `PUT /api/schedule`. |
| **WP5: Exercise Library Pages** | **Medium** | WP1 | `src/app/exercises/**`, `src/app/api/exercises/**`, `src/components/exercises/**` | `/exercises` searches/filters built-in + custom exercises, hides/unhides built-ins; `/exercises/new` & `/exercises/[id]/edit` create/edit/delete custom exercises with `TrackingType`. |
| **WP6: AI Plan Import, MCP & Export** | **High** | WP1 | `src/lib/ai/importSchema.ts`, `src/lib/export/**`, `src/lib/mcp/server.ts`, `src/app/api/ai/**`, `src/app/api/export/**`, `src/app/api/mcp/route.ts`, `src/app/ai/page.tsx`, `src/components/ai/**` (deletes `compilerSchema.ts`, `AiRoutineCompiler.tsx`, `McpConnectPanel.tsx`, `IntegrationsTabView.tsx`) | `/ai` has 1 short onboarding prompt copy, 1 edit prompt copy (w/ current data), empty paste/preview until pasted, clear field errors, auto-creates custom exercises on confirm; `/api/export` serves nested JSON & tidy CSV; `/api/mcp` enforces `401` and exposes all 9 read/write per-user tools. |
| **WP7: Progress Charts, Settings, Apple Health & Cleanup** | **Medium** | WP1 | `src/app/progress/page.tsx`, `src/app/api/progress/route.ts`, `src/components/progress/**`, `src/app/settings/page.tsx`, `src/components/integrations/AppleFitnessPanel.tsx`, `src/app/api/integrations/apple-health/route.ts` | `/progress` shows clean graphs only (respecting `trackingType`, frequency, weekly volume, bodyweight); `/settings` edits profile, `enableSetQuality` toggle, Apple Health, MCP key regenerate, Export links, Logout; deletes `DashboardTabView.tsx`, `MuscleRecoveryMap.tsx`, `PrTrophyRoomCard.tsx`, `VolumeLandmarksCard.tsx`, `ShareableWorkoutCard.tsx`, `ProgressionChartCard.tsx`, `ProfileAuthModal.tsx`, `src/lib/gamification/**`, `src/lib/audio/**`, `src/lib/hypertrophy/**`, `src/lib/db/seed.ts`, `src/app/api/analytics/**`. |

### Execution Order
1. **Phase 2**: WP1 (Foundation) — Coordinator reviews schema, auth, and sandbox isolation.
2. **Phase 3a (parallel)**: WP2 (Schedule/Calendar), WP5 (Exercises), WP6 (AI/MCP/Export), WP7 (Progress/Settings/Cleanup).
3. **Phase 3b (after WP2 interfaces settle)**: WP3 (Workout Logger), WP4 (Split View/Edit).
4. **Phase 4 (Integration)**: Full `npm run typecheck && npm run build`, end-to-end click-through, `docs/QUICKSTART.md` & `docs/GUIDE.md`, deploy + wipe DB.


---

## 10. Coordinator Review — BINDING AMENDMENTS (override anything above)

**Git.** All work happens on branch `v2-rework` (pushed to origin regularly; merged to `main` only at the
end, so a half-done app is never deployed). Small commits, `git add <your own paths>` only, conventional
messages (`feat(schedule): …`, `fix(auth): …`). If `git commit` hits `index.lock`, wait a few seconds and retry.
All workers share one working copy; respect file ownership strictly. When you run `npx tsc --noEmit`,
fix errors in YOUR files only; report errors you see in others' files to their owner by name.

**A. Legacy code removal happens first (WP1).** WP1 moves every v1 file that is rewritten/deleted into
`legacy/` at repo root (excluded in `tsconfig.json` `exclude`) so the tree compiles at each step and later
packages can still read old code for reference. Files later packages will *edit* (FloatingRestTimer,
VariationSwapSheet, AppleFitnessPanel, outbox, apple-health route) also move to `legacy/`; the owning
package re-creates them under `src/`. `src/app/page.tsx` becomes a minimal placeholder until WP2.
`legacy/` is deleted in Phase 4.

**B. Schedule algorithm fixes (WP2).**
1. Simulate from `rotation_anchor_date`; a `reset` event does NOT start the simulation — when the loop
   reaches the reset date it sets `qIdx = 0` and continues. History before a reset must stay visible.
2. Completing a planned session advances the pointer to `(position(session.schedule_day_id) + 1) % N`
   (not blindly `+1`), so a session logged for a specific queue day keeps the queue consistent.
3. Missed past training days: only the FIRST missed day of a given queue item is status `skipped`
   (counted once); further consecutive empty past days while the same item is still pending are `idle`
   (shown neutral, not counted). Skip statistics count each missed queue item once.
4. Editing the split (`PUT /api/schedule`) must preserve day/exercise ids where possible (diff by id),
   and re-anchor: compute the pointer for today, then store `rotation_anchor_date = today`,
   `rotation_anchor_index = pointer mapped to the new positions`. Days before the anchor display only
   logged sessions and events (no projection).
5. "Today" is the user's local date: add `users.timezone TEXT NOT NULL DEFAULT 'UTC'` (set from the
   browser at register/guest creation, editable in settings). Client pages pass `today=YYYY-MM-DD`;
   MCP uses the stored timezone.
6. `queue.ts` is a pure module (no DB, no `@/` imports, relative imports only) with tests run by
   `node --test` (Node 26 strips TS natively). Add the worked examples above + the rules here as tests.

**C. Home stays minimal (WP2).** `/` = week calendar + one "today" card (planned day label, **Start** / **Open**)
+ one `⋯ Plan` button opening a sheet with: Postpone +1 / +2 / +3, Skip, Jolly day (extra / instead), Reset.
No other text blocks.

**D. Auth details (WP1).**
- Passwords: `crypto.scrypt` with per-user random salt, `timingSafeEqual`.
- Session cookie: random 32 bytes, store SHA-256 hash, `httpOnly`, `sameSite=lax`, `secure` in production, 30-day sliding expiry.
- **API keys are shown once** on (re)generation; only the hash + prefix are stored. Drop `key_encrypted`.
  Settings shows prefix + "Regenerate". (No reliance on `SESSION_SECRET` for key storage.)
- Guest purge runs at most once per hour per process (not on every request).
- `SESSION_SECRET` default in docker-compose must be removed; production must fail fast if unset (only if still used).

**E. Body weight history.** Add `body_metrics (id, user_id, measured_on TEXT, weight_kg REAL, source TEXT)`;
settings weight changes, onboarding import and Apple Health weight write rows. `/progress` charts it.

**F. Export.** CSV gets an extra `rep_qualities` column formatted `3:70;4:50` (empty if none). Volume
(`weight × reps`) is only computed for `weight_reps` / `weighted_bodyweight` (added load) in charts — never stored.

**G. MCP.** Must be a spec-compliant MCP Streamable HTTP endpoint (`initialize`, `notifications/initialized`,
`tools/list`, `tools/call`, `ping`; JSON responses to POST; GET → 405), Bearer API-key auth only, 401 otherwise,
so Claude/ChatGPT/other MCP clients can connect. Settings shows a copyable config snippet.

**H. Shared types during Phase 3.** WP1's worker stays available as owner of `src/types/domain.ts` and
`src/lib/db/**`. Other packages that need a new query/type ask `@foundation` on the board, or keep
package-local types/queries inside their own owned files (preferred for package-specific queries:
e.g. `src/lib/schedule/repo.ts` owned by WP2).

**I. UI copy rule (all UI packages).** No explanatory paragraphs. Labels, short headings, icons, empty
states of ≤ 5 words. Explanations go to `docs/GUIDE.md`. Keep the notebook look; colours only for
status/progression. Mobile-first: inputs ≥16px font, tap targets ≥44px.

**J. Errors (all packages).** Every client mutation shows a visible toast on failure with the server
message; never silently enqueue a failing (4xx) request into the outbox. Server: `withApiHandler` + logger on every route.
