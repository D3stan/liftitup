# LiftItUp User Guide

LiftItUp keeps the UI minimal—almost no explanatory text appears on screen. This guide is the complete reference for every page, button, and workflow.

---

## 1. Navigation & Guest Sandbox

- **Top Bar**: **LIFTITUP** (links to `/`), optional **`SAMPLE · Sign up`** pill (only in guest mode; links to `/welcome?mode=register`), and **Settings** gear icon (`/settings`).
- **Bottom Nav** (5 tabs): **Calendar** (`/`), **Split** (`/split`), **Exercises** (`/exercises`), **Progress** (`/progress`), **AI** (`/ai`).

### Guest Sandbox (`Explore as sample user`)
- Creates an isolated temporary account (`is_guest = 1`) pre-loaded with a fictional 6-day Push / Pull / Legs / Rest / Upper / Lower rotation, ~3 weeks of workout history, bodyweight entries, and a custom exercise (`Ring Tempo Push-Up`).
- You can freely edit, log, and test everything without affecting any other user.
- Sandboxes inactive for more than **24 hours** are automatically deleted.

---

## 2. Pages & Controls

### `/welcome` — Sign In / Register / Sample
- **Log in** / **Register** toggle:
  - **Username** (3–32 chars), **Password**, and optional **Name** (on Register).
  - **Register** sends you to `/onboarding`; **Log in** sends you to `/`.
- **Explore as sample user**: creates a 24h guest sandbox and opens `/`.

### `/onboarding` — First-Time Setup
- **AI onboarding** → `/ai` (generate your profile + split in your own AI chat and paste JSON).
- **Empty setup** → `/` (start with a blank slate and build your split later).

### `/` — Calendar Home
- **Week Bar**: `<` (previous week), **`Today`** (appears when viewing another week), `>` (next week).
- **7 Day Cells**: tap any day to open `/workout/[date]`. Cell colours show status: green (completed), gold/cream (planned), beige (rest), red (skipped), dashed beige (`Off` / postponed), blue (`Jolly` / `Jolly+`).
- **Today Card**: shows today's planned or logged workout.
  - **Start** → opens `/workout/[date]/log` (workouts never auto-start).
  - **Open** → opens `/workout/[date]` when not startable (e.g., completed, rest, postponed, skipped).
  - **Plan** → opens the **Plan today** sheet:
    - **Postpone (`+1d`, `+2d`, `+3d`)**: shifts the rotation by 1, 2, or 3 days.
    - **Jolly day**: optional **Label** input + **Extra** (do a free workout without consuming today's planned slot) or **Instead** (replace today's planned workout; hidden on Rest days).
    - **Skip**: skips today's planned day and advances the queue.
    - **Reset** (tap twice to confirm): resets the rotation pointer to position 1 starting today.
    - **Undo today** (shown when today has events): removes today's schedule events.

### `/workout/[date]` — Day View (Read-Only)
- Shows the day's status badge, planned exercises (with target sets/reps/weight/rest), or completed sessions (with logged sets, notes, and Apple Watch metrics if linked).
- **Start**: begins logging the planned workout at `/workout/[date]/log`.
- **Skip**: marks the day skipped (on today/planned).
- **Jolly**: opens a sheet to start a **Jolly Extra** or **Jolly Instead** workout.
- **Edit** / **Delete**: modify or delete an existing logged session.

### `/workout/[date]/log` — Active Workout Logger
- **Workout Title** & **Duration (min)** / **Notes** toggle (notes stay hidden until you tap to add one).
- **Exercise Cards**:
  - **↑ / ↓** reorder exercises; **Swap** opens the variation picker (shows your last logged numbers for candidates); **Trash** removes the exercise from this session; **Notes** adds an exercise-specific note.
  - **Set Rows**: stacked, mobile-friendly inputs tailored to the exercise's tracking type, plus a **✓** completion checkbox.
  - **Execution Quality %** (only visible if enabled in `/settings`): tap the quality badge on a set to open the quality popover (presets, slider/stepper, or **Per-rep** mode).
  - **Rest Timer**: tap the timer icon on an exercise or top bar to open the floating wall-clock countdown (`60s`, `90s`, `120s`, `180s`, `-15s`/`+15s`, dismiss). Uses vibration/browser notification if permitted—no sound effects.
- **Add Exercise**: opens the exercise picker.
- **Save**: saves the session transactionally (drafts are persisted locally in `localStorage` until saved).

### `/split` & `/split/edit` — Rotation Split
- **`/split`** (read-only): lists every day in rotation order (`1..N`), rest-day badges, exercises, targets, and notes.
  - **Reset**: sets the rotation anchor back to Day 1 starting today.
  - **Edit** → `/split/edit`.
- **`/split/edit`**:
  - Edit **Split Name**, **Add Day**, reorder days (**↑ / ↓**), remove days, or toggle **Rest Day**.
  - Inside each training day: **Add Exercise**, reorder (**↑ / ↓**), remove, and edit **Sets**, **Reps / Min–Max / Time (s) / Distance (m)**, **Weight**, **Rest (s)**, and **Notes**.
  - **Save**: persists the rotation and anchors it.

### `/exercises`, `/exercises/new`, `/exercises/[id]/edit` — Exercise Library
- **`/exercises`**: search by name or alias, filter by **Category** (`push`, `pull`, `legs`, `core`, `cardio`, `full_body`, `skill`, `other`) or **Tracking Type**, toggle **Show hidden**, and tap **Eye** to hide/unhide any exercise from pickers.
- **`/exercises/new`**: create a custom exercise with **Name**, **Tracking Type**, **Category**, **Equipment**, and **Default Rest (s)** (`0–600`).
- **`/exercises/[id]/edit`**: edit or delete a custom exercise (exercises already used in a workout or split cannot be deleted—hide them instead).

### `/progress` — Progress Charts
- Filter by **Exercise** and range (**`4w`**, **`12w`**, **`All`**).
- Displays SVG charts tailored to the selected exercise's tracking type (e.g. Best Weight, Best Added Load, Min Assistance, Best Reps, Best Hold, Best Distance), **Volume** (for `weight_reps` and `weighted_bodyweight`), **Sessions / Week**, **Sets / Week**, and **Body Weight**.

### `/ai` — AI Onboarding & Plan Editor
- **Copy onboarding prompt**: copies the onboarding prompt for a new plan.
- **Copy edit prompt**: copies your current profile + rotation JSON with instructions for your AI to show a **Before → After** summary and return updated JSON.
- **Paste AI result** + textarea: paste the AI's reply (raw JSON or markdown with a ` ```json ` block—the last fenced block is extracted automatically).
- **Preview**: stays empty until valid JSON is pasted; shows field-path validation errors if invalid, or the parsed profile, days, and any unknown exercises that will be auto-created as custom exercises.
- **Confirm**: atomically saves your profile, creates custom exercises, and activates the new rotation anchored today.

### `/settings` — Profile, Integrations & Export
- **Profile**: **Name**, **Weight**, **Height (cm)**, **Age**, **Training Years**, **Unit** (`kg` / `lb`), **Timezone** (with **Auto** button), **Save Profile**.
- **Execution Quality %**: toggle `ON` / `OFF` (default `OFF`).
- **MCP**: view **Endpoint** (`/api/mcp`), **Regenerate** personal API key (shown once), and copy **Client Config**.
- **Export**: download **JSON** or **CSV**.
- **Apple Health**: toggle `ON` / `OFF`, copy **Webhook URL**, or **Import XML / JSON / CSV**.
- **Log out**: ends the current session and returns to `/welcome`.

---

## 3. Rotation Queue Rules

LiftItUp uses a **queue of days** (`position 0..N-1`) rather than fixed Monday–Sunday weekdays.

- **Missed day → carries forward**: if you do not log a planned training day, the queue pointer does **not** advance. The missed workout automatically carries forward to the next day.
- **What counts as skipped**:
  - Manually tapping **Skip** on a day advances the pointer past that day (`skipped`).
  - Leaving a past training day empty marks **only the first** missed day of that pending workout as `skipped` (showing what was missed), while any further empty past days before you resume show as `idle` (`—`). When you finally train, you pick up right where you left off.
- **Postpone (`+1d`, `+2d`, `+3d`)**: inserts 1–3 `postponed` (`Off`) days without advancing the queue pointer. Logging a planned workout early on a postponed day clears the remaining postpone window.
- **Jolly Extra**: logs an unscheduled workout (`is_jolly = 1, jolly_mode = 'extra'`). On a training day, the planned workout defers to the next day; on a rest day, the queue advances past the rest day.
- **Jolly Instead**: logs a free workout in place of today's planned workout (`jolly_mode = 'instead'`) and advances the queue by 1. (Not available on rest days.)
- **Reset**: sets the queue pointer back to position `0` (Day 1) starting on the reset date.

### Example: `P-P-L-Rest-P-L`
Suppose your 6-day queue is **Push → Pull → Legs → Rest → Push → Legs**. You complete **Push** on Friday and **Pull** on Saturday, then miss **Legs** on Sunday:
1. **Sunday**: empty → marked `skipped` (Legs), pointer stays on **Legs**.
2. **Monday**: **Legs** carries forward and is planned for Monday. You log Legs → pointer advances to **Rest**.
3. **Tuesday**: **Rest** is planned (the rest day is preserved, not broken).
4. **Wednesday**: **Push** is planned, **Thursday**: **Legs**, and the cycle continues.

---

## 4. Tracking Types & Set Quality

### 8 Tracking Types
| Type | Logged Fields | Example |
|---|---|---|
| `weight_reps` | Weight + Reps | Barbell Bench Press (`80 kg × 8`) |
| `bodyweight_reps` | Reps | Pull-Up, Muscle-Up (`10 reps`) |
| `weighted_bodyweight` | Added Weight + Reps | Weighted Dip (`+15 kg × 8`) |
| `assisted_bodyweight` | Assistance + Reps | Assisted Pull-Up (`−20 kg × 10`) |
| `time` | Duration (s) | Plank, L-Sit (`45s`) |
| `weight_time` | Weight + Duration (s) | Farmer's Walk (`32 kg × 40s`) |
| `distance` | Distance (m) | Sled Push (`40m`) |
| `distance_time` | Distance (m) + Duration (s) | Rowing (`500m · 1m 45s`) |

### Execution Quality % (Optional)
Disabled by default (`Settings → Execution Quality %`). When enabled:
- Completed sets default to `100%` (stored as `NULL` until adjusted).
- Tap the quality badge on a set row to set an overall % (`100% Clean`, `85% Minor`, `70% Assisted`, `50% Partial`, or custom `0–100%`), or toggle **Per-rep** to tap individual reps (cycles `100 → 85 → 70 → 50`) and store the average + per-rep overrides.
- **Set row colours**:
  - Uncompleted: cream (`#fbf5e4`)
  - `100%` (or feature OFF): **Green** (`#cde6c0`)
  - `80–99%`: **Yellow** (`#fef0c3`)
  - `50–79%`: **Orange / Peach** (`#fbd5b5`)
  - `< 50%`: **Red** (`#f9c6bf`)

### Notes
Both **workout sessions** and **individual exercises** support optional text notes. Note inputs stay hidden in the logger until you tap to add one, appear in history (`/workout/[date]`), and are included in JSON/CSV exports and MCP tools.

---

## 5. AI Prompts & JSON Schema

### Onboarding Prompt
Copyable from `/ai` (**Copy onboarding prompt**):
1. Your AI asks 4 quick questions: height (cm), weight (kg), age, years of training.
2. You describe your split (text, voice transcript, or screenshot).
3. Your AI returns JSON matching the schema below; paste it into `/ai` and tap **Confirm**.

### Edit Prompt
Tap **Copy edit prompt** on `/ai`. It includes your current `profile` and `schedule` JSON and asks your AI to:
1. Show a concise **Before → After** summary of your requested changes.
2. Output the complete updated JSON in a single valid JSON block.

Paste the AI's response back into `/ai` (the parser extracts the last fenced JSON block automatically) and **Confirm**.

### Import JSON Schema & Example
```json
{
  "profile": {
    "heightCm": 178,
    "weightKg": 78,
    "age": 26,
    "trainingYears": 3,
    "unit": "kg"
  },
  "schedule": {
    "name": "PPL Rotation",
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
            "notes": "Controlled 2s eccentric"
          }
        ]
      },
      {
        "label": "Rest",
        "isRestDay": true,
        "exercises": []
      }
    ]
  }
}
```
- Unknown exercise names are automatically created as custom exercises for your account.
- Use `targetReps` (exact) or `targetRepsMin` / `targetRepsMax` (range) for rep exercises; `targetTimeSeconds` for `time` / `weight_time` / `distance_time`; `targetDistanceM` for `distance` / `distance_time`.

---

## 6. MCP Setup (Per User)

Each user has an isolated **Streamable HTTP** MCP endpoint at `/api/mcp` authenticated via `Authorization: Bearer <YOUR_API_KEY>`.

1. Go to `/settings` → **MCP** and tap **Regenerate**.
2. **Copy your API key immediately**—it is hashed in the database and **shown only once** when generated. (Regenerating invalidates the previous key.)
3. Copy the **Client Config** snippet into your MCP client (e.g. Claude Desktop, Cursor, ChatGPT):

```json
{
  "mcpServers": {
    "liftitup": {
      "type": "http",
      "url": "https://lift.0xpuddu.com/api/mcp",
      "headers": {
        "Authorization": "Bearer liuk_your_key_here"
      }
    }
  }
}
```

### Available MCP Tools (9)
| Tool | Description |
|---|---|
| `get_profile` | User profile stats, unit, timezone, set-quality setting, and bodyweight history. |
| `get_schedule` | Active rotation schedule + projected calendar (`daysAhead`, default 14, max 60). |
| `get_workout_history` | Logged sessions with exercises, sets, `executionQualityPct`, `repQualities`, and notes (`from`, `to`, `exerciseId`, `limit`). |
| `list_exercises` | Search/filter built-in and custom exercises (`query`, `category`, `trackingType`, `includeHidden`). |
| `export_data` | Full nested JSON export for the authenticated user. |
| `upsert_custom_exercise` | Create or update a custom exercise. |
| `hide_exercise` | Hide or unhide an exercise (`hidden: true/false`). |
| `import_plan` | Validate and apply an AI onboarding/edit JSON plan. |
| `log_workout_session` | Log a completed workout session with sets, notes, and optional quality %. |

---

## 7. Data Export (`/settings` → Export)

### JSON (`/api/export?format=json`)
Returns `schemaVersion: 2` with:
- `exportedAt`
- `user`: `username`, `displayName`, `heightCm`, `weightKg`, `age`, `trainingYears`, `unit`, `timezone`, `enableSetQuality`
- `activeSchedule`: `id`, `name`, `anchorDate`, `anchorIndex`, `days[]`
- `exercises`: `{ custom: [...], hiddenIds: [...] }`
- `bodyMetrics[]`
- `scheduleEvents[]`
- `sessions[]`: each with `exercises[]` → `sets[]` (including `notes`, `executionQualityPct`, `repQualities`, and `appleHealth`).

### CSV (`/api/export?format=csv`)
Tidy long format—**one row per set**—with 22 columns:
`session_id`, `session_date`, `session_title`, `is_jolly`, `jolly_mode`, `duration_minutes`, `user_weight_kg`, `session_notes`, `exercise_order`, `exercise_id`, `exercise_name`, `tracking_type`, `exercise_notes`, `set_number`, `weight_kg`, `reps`, `time_seconds`, `distance_m`, `rest_seconds`, `execution_quality_pct`, `rep_qualities` (`repIndex:pct` joined by `;`), `is_completed`.

```python
import pandas as pd

df = pd.read_csv("liftitup-export.csv")
bench = df[df["exercise_name"] == "Barbell Bench Press"]
print(bench.groupby("session_date")["weight_kg"].max())
```

---

## 8. Apple Health (`/settings/apple-health`)

- Toggle Apple Health **ON / OFF** (when paused, webhook requests return `403` `"Apple Health integration disabled"`, while toggle and session-authenticated file import stay available).
- **Webhook URL**: `POST /api/integrations/apple-health` (requires your session cookie or `Authorization: Bearer <API_KEY>` / `x-api-key` header). Note: your single API key is shared with MCP — regenerating it breaks the other until updated.
- **Siri / AI Shortcut Prompt & iCloud Shortcut Link**: copy the self-contained **Copy Prompt for Siri / AI** directly from `/settings/apple-health` to generate an iOS Shortcut with your exact endpoint URL, auth header, and JSON schema; optionally set `APPLE_HEALTH_SHORTCUT_URL` in `.env` to display a ready-to-install iCloud Shortcut link in the UI (read at runtime on the server).
- **Strict validation (breaking change)**: every item must be either a workout (`startedAt` + positive `durationMinutes`) or a weight reading (`bodyweightKg` between 25–300 kg + `measuredOn` in `YYYY-MM-DD` / ISO-8601, `date`, or `startedAt`). Older Shortcuts relying on lenient defaults now receive `400` errors. Calories (`activeCalories`) and heart rate (`avgHeartRate`, `maxHeartRate`) are optional and stored as `null` when absent.
- **Dry run (`dryRun: true`)**: validates payload and API key ownership (`"ok, key belongs to <name>, payload valid"`) without writing any rows.
- **Bidirectional session linking**: matches workouts and sessions by time overlap (±15 minutes tolerance) regardless of whether the Shortcut or workout save arrives first, and updates **Last Received** status.
- **Import XML / JSON / CSV**: upload an Apple Health `export.xml` or a `.json`/`.csv` file directly from your device (up to 100 items per import, validated strictly).

---

## 9. Troubleshooting

- **Errors in the app**: every failed action displays a **toast notification** with the server or validation message.
- **Server logs**: the backend writes structured **JSON lines** to stdout/stderr (`ts`, `level`, `requestId`, `route`, `method`, `userId`, `status`, `durationMs`, `msg`, `err`). Inspect them with:
  ```bash
  docker logs -f liftitup
  ```
- **401 / Logged out**: sessions expire after 30 days of inactivity, and guest sandboxes expire after 24 hours. Sign back in at `/welcome`.
