# LiftItUp — Production Architecture & Implementation Plan

> **LiftItUp** (`lift.0xpuddu.com`) is a self-contained, multi-user, gamified hypertrophy & gym schedule tracker PWA engineered for iPhone Home Screen & Desktop. It combines **science-based hypertrophy programming** (Precompiled Default Sessions, Smart Double-Progression, Biomechanical Exercise Variations & Bodyweight/Pulley Equivalence, MEV/MAV/MRV Volume Landmarks, 72-Hour Muscle Recovery Map) with the signature **"Ink-on-Paper / Hand-Drawn Cartoon Notebook" tactile UX** from `fit-or-pivot` and `myfood`, **Emil Kowalski (`emil-design-eng`) + Apple Fluid Interface (`apple-design`) + Mobile-Native (`mobile-native`) engineering standards**, a **Structured AI Routine & Session Compiler**, a **Built-in Streamable HTTP / JSON-RPC MCP Server (`/api/mcp`)**, and **Apple Fitness / Health Integration**.

---

## 1. Tech Stack & Self-Contained Deployment Architecture

### 1.1 Runtime & Framework Stack
- **Framework**: **Next.js 15 (App Router, TypeScript 5, React 19)** with `output: 'standalone'` for minimal, self-contained Docker images running on **Node 20 LTS** (`port 3000`, `HOSTNAME="0.0.0.0"`).
- **Database (Zero External DB Dependency)**: **SQLite** via `better-sqlite3` (`WAL` journal mode, `synchronous = NORMAL`, `foreign_keys = ON`).
  - Database file persisted at `process.env.DATABASE_PATH || '/app/data/liftitup.db'` in production Docker (`/app/data` volume) and `./data/liftitup.db` in local development.
  - Zero external Postgres/Redis containers required; automatic schema migration and idempotent demo data seeding run on server startup (`src/lib/db/index.ts` & `src/lib/db/seed.ts`).
- **Styling & Typography**:
  - **Tailwind CSS** + **Custom Design Token CSS (`src/styles/tokens.css`, `src/styles/notebook.css`)** implementing the exact `fit-or-pivot` / `myfood` **Ink-on-Paper / Hand-Drawn Cartoon Notebook** aesthetic.
  - **Self-Hosted Offline Fonts**: `@fontsource/permanent-marker` (headings, brand badges, KPI values, stepper numbers, rank titles) and `@fontsource/patrick-hand` (body copy, inputs, buttons, labels at `19px` base size so iOS Safari never auto-zooms on focus).
- **Motion, Icons & Multimodal Feedback**:
  - **CSS Custom Easing & Hardware-Accelerated Transitions** + **Framer Motion** (`motion/react`) strictly following `emil-design-eng` and `apple-design` rules.
  - **Lucide Icons** (`lucide-react`) paired with hand-drawn SVG accents and custom **Hand-Drawn SVG Polyline & Radar/Body Map Charts** (`stroke-width="4"`, `stroke-linejoin="round"`, dashed landmark lines).
  - **Web Audio API Procedural Synth (`src/lib/audio/soundEngine.ts`)** + **Haptics (`navigator.vibrate`)** synchronized on the exact same animation frame for set completion, PR fanfare, rest timer completion, and mechanical button clicks.

### 1.2 Production `Dockerfile` & `docker-compose.yml`
- **`Dockerfile`**:
  - Multi-stage `node:20-bookworm-slim` (or `node:20-alpine` with `python3 make g++` in builder stage for `better-sqlite3` native binding compilation).
  - Creates `/app/data` with full write permissions, copies `.next/standalone`, `.next/static`, and `public`, exposes `3000`, and starts `node server.js`.
- **`docker-compose.yml`**:
  ```yaml
  services:
    liftitup:
      build:
        context: .
        dockerfile: Dockerfile
      container_name: liftitup
      restart: unless-stopped
      ports:
        - "3000:3000"
      environment:
        - NODE_ENV=production
        - PORT=3000
        - HOSTNAME=0.0.0.0
        - DATABASE_PATH=/app/data/liftitup.db
        - SESSION_SECRET=${SESSION_SECRET:-liftitup-homelab-secret-key-2026}
        - NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL:-https://lift.0xpuddu.com}
      volumes:
        - liftitup-data:/app/data
  volumes:
    liftitup-data:
  ```

---

## 2. Multi-User Architecture, Auth & Pre-Seeded Hypertrophy Demo

### 2.1 Multi-User Isolation & Authentication Flow
Every table in SQLite that stores user state (`schedules`, `schedule_days`, `schedule_slots`, `workout_sessions`, `workout_sets`, `user_exercise_stats`, `user_muscle_xp`, `pr_records`, `bodyweight_logs`, `apple_health_workouts`, `outbox_events`) is strictly scoped by `user_id`.

1. ** Dual Authentication Modes**:
   - **Browser / PWA Session Cookie**: HTTP-only signed cookie (`liftitup_session`) set by `/api/auth/login`, `/api/auth/register`, and `/api/auth/switch`.
   - **Per-User API Key (`liu_<32-hex>`)**: Stored on `users.api_key`. Accepted via `Authorization: Bearer <api_key>`, `x-api-key: <api_key>`, or `?apiKey=<api_key>` for `/api/mcp` (MCP Server) and `/api/integrations/apple-health` (iOS Shortcut Webhook).
2. **Fast Gym-Partner Profile Switcher & 1-Tap Demo Login**:
   - Header HUD features a Profile Badge showing current user avatar, Level, and Rank.
   - Tapping opens the **Account & Profile Switcher Sheet**, allowing:
     - **1-Tap Switch** between registered local profiles on the device or instant **1-Tap "Switch to Demo Athlete (Alex)"**.
     - **Register New Athlete** (username, display name, password, bodyweight in kg, experience level, preferred unit `kg`/`lb`, Apple Fitness integration toggle).
     - **Login with Username & Password**.
     - **API Key Management**: View, copy, or rotate the user's `liu_...` API key.

### 2.2 Pre-Seeded Demo Athlete (`alex_hypertrophy`)
On first boot, `src/lib/db/seed.ts` automatically creates:
- **Demo User**: `username: "alex"`, `displayName: "Alex (Hypertrophy Pro)"`, `bodyweightKg: 78.5`, `level: 14`, `xp: 14850`, `rankTier: "Gold II"`, `currentStreak: 12`, `bestStreak: 19`, `streakShields: 2`, `apiKey: "liu_demo_alex_hypertrophy_key_2026"`, `appleFitnessEnabled: true`.
- **Active 5-Day Upper/Lower + Push/Pull/Legs Hypertrophy Schedule** (plus 4 ready-to-clone system templates: *Upper/Lower 4-Day*, *Push/Pull/Legs 6-Day*, *Arnold Split*, *Minimalist Full-Body 3-Day*).
- **8 Weeks of Historical Sessions (28 Completed Workouts, ~480 Sets)**:
  - Realistic progressive overload trajectories across Barbell Bench Press, Incline Dumbbell Press, Lat Pulldown (Pulley) **and** Weighted Chin-ups (demonstrating variation continuity!), Barbell Back Squat, Hack Squat, Romanian Deadlift, Cable Lateral Raises, Incline Cable Curl, Overhead Cable Tricep Extension, Seated Leg Curl, and Standing Calf Raise.
  - Pre-populated **PR Trophy Records**, **Muscle Group Mastery Levels**, **72-Hour Muscle Recovery State**, and **3 Synced Apple Watch Workouts** (kcal, avg/max HR, duration) so every chart, precompiled session, and variation swap works immediately on first load.

---

## 3. Core Hypertrophy, Schedule & Variation Equivalence Engine

### 3.1 Biomechanical Movement Slots & Exercise Library (`src/lib/hypertrophy/exercises.ts`)
36+ curated hypertrophy exercises grouped into **15 Biomechanical Movement Slots**:
1. `horizontal_press` (Barbell Bench Press, Flat Dumbbell Press, Converging Chest Press Machine, Weighted Push-ups)
2. `incline_press` (Incline Dumbbell Press, Incline Barbell Press, Smith Machine Incline Press, Low-to-High Cable Fly)
3. `chest_isolation` (Pec Deck / Machine Fly, Standing Cable Fly, Dumbbell Fly)
4. `vertical_pull` (**Lat Pulldown / Pulley**, **Weighted Chin-ups (Supinated)**, **Weighted Pull-ups (Pronated)**, Neutral-Grip Mag Pulldown, Dual-Handle Pulldown)
5. `horizontal_pull` (Chest-Supported T-Bar Row, Seated Cable Row, Barbell Bent-Over Row, Single-Arm Dumbbell Row, Machine High Row)
6. `vertical_press` (Seated Dumbbell Shoulder Press, Overhead Barbell Press, Machine Shoulder Press)
7. `lateral_delt` (Cable Lateral Raise, Dumbbell Lateral Raise, Machine Lateral Raise, Lu Raise)
8. `rear_delt` (Reverse Pec Deck, Rope Face Pull, Rear Delt Cable Fly)
9. `squat_pattern` (Barbell Back Squat, Hack Squat, Pendulum Squat, Leg Press, Bulgarian Split Squat)
10. `hinge_pattern` (Romanian Deadlift (RDL), Seated/45° Hyperextension, Barbell Conventional Deadlift, Hip Thrust)
11. `knee_extension` (Seated Leg Extension, Sissy Squat)
12. `knee_flexion` (Seated Leg Curl, Lying Leg Curl, Nordic Hamstring Curl)
13. `elbow_flexion` (Bayesian Cable Curl, Incline Dumbbell Curl, EZ-Bar Preacher Curl, Hammer Curl)
14. `elbow_extension` (Overhead Cable Tricep Extension, Rope Tricep Pushdown, Dip Machine / Weighted Dips, Skullcrushers)
15. `calf_core` (Standing Calf Raise, Seated Calf Raise, Cable Crunch, Hanging Leg Raise)

#### Exercise Schema & Volume Fractional Weighting
Each exercise defines:
- `id`: slug (e.g. `lat-pulldown-pulley`, `weighted-chin-up`, `barbell-bench-press`, `incline-db-press`)
- `name`: Display name
- `movementSlot`: One of the 15 slots above
- `primaryMuscle`: Primary muscle group (`chest`, `lats`, `upper_back`, `front_delts`, `side_delts`, `rear_delts`, `quads`, `hamstrings`, `glutes`, `biceps`, `triceps`, `calves`, `abs`) -> counts as **1.0 working set** toward weekly MEV/MAV/MRV landmarks.
- `secondaryMuscles`: Array of `{ muscle: MuscleGroup, factor: 0.5 }` (e.g., Weighted Chin-ups give `1.0` to `lats`, `0.5` to `biceps`, `0.5` to `upper_back`; Bench Press gives `1.0` to `chest`, `0.5` to `front_delts`, `0.5` to `triceps`).
- `loadType`: `'external'` (barbell/machine/cable), `'unilateral_db'` (weight entered is per single dumbbell), or `'bodyweight_plus'` (Weighted Chin-ups, Weighted Pull-ups, Weighted Dips).
- `bodyweightFactor`: For `'bodyweight_plus'` exercises, percentage of user bodyweight lifted (`0.95` for Chin-ups/Pull-ups, `0.90` for Dips, `0.0` for standard external loads).
- `canonicalEquivalenceRatio`: Conversion multiplier relative to the movement slot's canonical anchor exercise so loads translate accurately when swapping variations!
- `defaultStepKg`: `2.5` (or `1.25` for lateral raises / isolation, `5.0` for leg press).
- `formCues`: Short sticky-note coaching cues (e.g., *"Drive elbows down to hips; 1s stretch at top; stop 1 rep shy of failure"*).

### 3.2 Exercise Variation Swap & Bodyweight/Pulley Equivalence Math
A core requirement is **effortless variation swapping** (e.g., swapping **Lat Pulldown / Pulley** ↔ **Weighted Chin-ups**, or **Barbell Bench Press** ↔ **Incline DB Press**) for either **Today's Session Only** or **Permanently in the Weekly Schedule**, without losing progression tracking.

#### How Equivalence Works (`src/lib/hypertrophy/equivalence.ts`):
1. **Effective Total Load (`effectiveLoadKg`)**:
   - For standard external exercises (`loadType === 'external'`): `effectiveLoadKg = loggedWeightKg`
   - For dumbbell exercises (`loadType === 'unilateral_db'`): `effectiveLoadKg = loggedWeightKg * 2`
   - For weighted bodyweight exercises (`loadType === 'bodyweight_plus'`, e.g., Weighted Chin-ups):
     $$\text{effectiveLoadKg} = (\text{userBodyweightKg} \times \text{bodyweightFactor}) + \text{addedExternalWeightKg}$$
2. **Estimated 1RM (`e1RM` via Epley capped at 15 reps + RIR adjustment)**:
   $$\text{effectiveReps} = \text{loggedReps} + \text{loggedRir}$$
   $$\text{e1RM}_{\text{exercise}} = \text{effectiveLoadKg} \times \left(1 + \frac{\min(\text{effectiveReps}, 15)}{30}\right)$$
3. **Slot Canonical e1RM**:
   $$\text{e1RM}_{\text{slot}} = \frac{\text{e1RM}_{\text{exercise}}}{\text{canonicalEquivalenceRatio}}$$
4. **Target Weight Translation on Variation Swap**:
   - When the user swaps from Exercise $A$ (e.g., `lat-pulldown-pulley`, `canonicalEquivalenceRatio = 1.00`) to Exercise $B$ (e.g., `weighted-chin-up`, `canonicalEquivalenceRatio = 1.12`, `bodyweightFactor = 0.95`), the engine:
     - First checks if the user has recent direct history on Exercise $B$ within the last 21 days.
     - Also computes the translated equivalent target load from Exercise $A$'s latest slot e1RM for target reps $R$ and target RIR:
       $$\text{targetEffectiveLoad}_B = \frac{\text{e1RM}_{\text{slot}} \times \text{ratio}_B}{1 + \frac{R + \text{targetRir}}{30}}$$
     - For `weighted-chin-up`, converts `targetEffectiveLoad_B` into **Added Belt Weight**:
       $$\text{recommendedAddedWeightKg} = \text{roundToStep}\left(\max(0, \text{targetEffectiveLoad}_B - 0.95 \times \text{userBodyweightKg}), 1.25\right)$$
     - Displays a Sticky-Note Equivalence Banner on the swapped card:
       > *"Swapped from Lat Pulldown (80kg × 8). At 78.5kg BW, equivalent load is **BW + 12.5kg × 8** (91kg total effective pull)."*

### 3.3 Weekly Schedule & Precompiled Default Session Engine (`src/lib/hypertrophy/precompiler.ts`)
- **Weekly Schedule Structure**:
  - Maps Days of the Week (`0 = Monday` .. `6 = Sunday`) to either a **Scheduled Routine Day** (`Push A`, `Pull A`, `Legs A`, `Upper B`, `Lower B`, etc.) or `Rest Day`.
  - Users can reorder days, shift the entire split by $\pm 1$ day ("Life Happened / Shift Split" button), edit target sets/rep ranges/RIR per slot, or swap default exercises.
- **Precompiled Default Session (Zero-Typing Workout Launch)**:
  - Opening the app on any day immediately compiles **Today's Precompiled Session** (`GET /api/workouts/precompile?date=YYYY-MM-DD` or override `routineDayId`):
  - Every exercise slot is pre-populated with all sets (`Set 1..N`), exact `targetWeightKg`, `targetReps`, `targetRir`, `restSeconds`, and a **Smart Double-Progression Pill**:
    - `🚀 LOAD UP (+2.5kg)`: Triggered when the user hit the top of the rep range (`reps >= repRangeMax`) on all working sets last session at `RIR >= targetRir`. Target weight auto-increments by `defaultStepKg` and target reps reset to `repRangeMin`.
    - `📈 +1 REP TARGET`: Triggered when the user completed all sets within `[repRangeMin, repRangeMax - 1]`. Keeps the same weight and increments target reps by `+1`.
    - `🛡️ HOLD & OWN`: Triggered when the user missed `repRangeMin` on any set or hit `RIR 0` early. Keeps last session's weight/reps to consolidate hypertrophy stimulus.
    - `🔄 VARIATION EQUIV`: Triggered when the exercise was swapped from a sibling variation in the same movement slot.
  - **1-Tap Set Logging**: Because every set row is pre-filled with the smart recommendation, the athlete only taps the **`✔ LOG SET`** button (48×48px) to commit the set as-is, OR taps the tactile `−`/`+` steppers to adjust weight/reps/RIR in 1 second!

---

## 4. Frontier Minimal UX + Gamified Design System

### 4.1 Visual Language: Ink-on-Paper Cartoon Notebook (`fit-or-pivot` + `myfood`)
We adopt the user's signature visual language from `/Users/puddu/Documents/GitHub/fit-or-pivot` and `/Users/puddu/Documents/GitHub/myfood`:

#### Exact CSS Variables (`src/styles/tokens.css`)
```css
:root {
  --ink: #1d1a16;        /* Primary text, 3px solid borders, hard offset shadows */
  --paper: #ece2c6;      /* Warm vintage notebook paper background + PWA theme-color */
  --card: #fbf5e4;       /* Card, sheet, pill, and surface background */
  --muted: #5d5446;      /* Secondary text, labels, inactive tabs */
  --line: #1d1a16;       /* Border color */
  --red: #d9412b;        /* Brand accent, PR flame, high-intensity CTA, MRV warning */
  --red-bg: #f6cfc4;     /* Overreaching / fatigued warning card fill */
  --gold: #f2b632;       /* Primary CTA fill, Hero card fill, XP/Streak/Rank highlight */
  --green: #2e7d3a;      /* Positive delta, completed set, MAV optimal zone */
  --green-bg: #cde6c0;   /* Completed set row fill, PR badge background */
  --blue: #2b5fa8;       /* Variation swap badge, AI/MCP accent, recovery indicator */
  --blue-bg: #d4e3f7;    /* Secondary info badge fill */
  --note: #fff27a;       /* Sticky-note yellow for Coach Hints, PR notes, equivalence math */

  /* Hard Cartoon Offset Shadows (Never soft/blurry box-shadows) */
  --sh: 4px 4px 0 var(--ink);
  --sh-s: 3px 3px 0 var(--ink);
  --sh-l: 6px 6px 0 var(--ink);

  /* Hand-Drawn Wobbly Border Radius */
  --wob: 3px 10px 4px 12px / 10px 3px 12px 4px;

  /* Custom Easing Tokens (from emil-design-eng & apple-design) */
  --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
  --ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);
  --ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);

  /* Safe Area & Layout Chrome */
  --tabbar: 68px;
  --sat: env(safe-area-inset-top, 0px);
  --sab: env(safe-area-inset-bottom, 0px);
}
```

#### Signature Tactile Components
1. **Dotted Notebook Background**:
   `background: var(--paper) radial-gradient(rgba(29,26,22,.10) 1px, transparent 1.2px) 0 0 / 14px 14px;`
2. **Mechanical Depressing Buttons (`.btn`)**:
   - `border: 3px solid var(--ink); box-shadow: var(--sh); min-height: 44px; transition: transform 80ms var(--ease-out), box-shadow 80ms var(--ease-out);`
   - On pointer-down (`:active:not(:disabled)`): `transform: translate(3px, 3px); box-shadow: 1px 1px 0 var(--ink);` — instant physical depression on `pointerdown` (`apple-design` Rule #1).
3. **Hero Today Card (`.hero-card`)**:
   - Positioned at the top of the **Today (Train)** tab in `--gold` with `border: 3px solid var(--ink); box-shadow: var(--sh-l); transform: rotate(-0.5deg);` showing today's scheduled split (`PULL A — LATS & BI`), exercise chips, estimated duration, muscle targets, and a 1-tap **`START PRECOMPILED SESSION`** button.
4. **Tactile Weight / Reps / RIR Steppers**:
   - Large `44x44px` (`56x56px` in focus sheet) `−` and `+` buttons flanking a bold `Permanent Marker` number. Tapping the value opens direct numeric/decimal input (`font-size: 20px`, `inputmode="decimal"`, accepting both `.` and `,`).
5. **Sticky Notes with Masking Tape (`.note`)**:
   - `#fff27a` card with `transform: rotate(-0.6deg)` and a top-center translucent tape strip (`::before`) used for Smart Progression explanations, Variation Equivalence math, and Hypertrophy Execution Cues.
6. **12-Segment Candy-Striped XP & Session Progress Bar (`.bar`)**:
   - Top HUD bar showing current Level, Rank badge, Streak pill (`🔥 12d` + `🛡️ 2`), and segmented progress bar that fills with animated candy stripes as sets are logged.

### 4.2 Gamification Mechanics (`src/lib/gamification/engine.ts`)
1. **XP & Leveling System**:
   - **Set Logged**: `+25 XP` base + `+10 XP` if target reps/weight met (`Double-Progression Bonus`) + `+5 XP` for logging RIR within target zone (`1–3 RIR`).
   - **Session Completed**: `+150 XP` completion bonus + `+50 XP` Streak Multiplier (`+10%` per active weekly streak week, up to `+50%`).
   - **New PR Unlocked (e1RM, Weight-for-Reps, or Volume PR)**: `+200 XP` Boss Milestone Bonus!
   - **Level Curve**: $\text{XP}_{\text{next}}(L) = 500 \times L^{1.25}$.
2. **7 Hypertrophy Rank Tiers**:
   - `Iron` (Lv 1–3) → `Bronze` (Lv 4–7) → `Silver` (Lv 8–11) → `Gold` (Lv 12–16) → `Diamond` (Lv 17–22) → `Titan` (Lv 23–29) → `Olympian` (Lv 30+).
   - Each rank has a custom hand-drawn cartoon crest SVG badge in the HUD header.
3. **Per-Muscle-Group Mastery Ranks (4-Box Discrete Meter `.level`)**:
   - Every muscle group (`Chest`, `Lats`, `Upper Back`, `Side Delts`, `Quads`, `Hamstrings`, `Biceps`, `Triceps`, etc.) tracks cumulative hypertrophy sets & e1RM growth across a 4-tier mastery meter (`Novice` → `Intermediate` → `Advanced` → `Freak`).
4. **Weekly Consistency Streak & Streak Shields**:
   - Unlike rigid daily streaks that punish rest days, LiftItUp tracks **Scheduled Workout Adherence Streaks**: hitting your scheduled training days (or shifting a day within the week) increments your 🔥 Streak!
   - Completing a full week of scheduled workouts awards **+1 Streak Shield (`🛡️`, max 3)**, which automatically protects the streak if life forces a missed session.
5. **Post-Workout "What Your Session Did" Debrief Card (Impact Modal)**:
   - Inspired by `fit-or-pivot`'s end-of-round debrief: finishing a workout displays `Before → After` KPI tiles (Total Tonnage, e1RM Deltas, Weekly Muscle Volume Landmarks crossed into MAV, XP Gained, Level-Up banner) + a **1-Tap Shareable Cartoon Workout Summary Card**.
6. **Multimodal Audio-Haptic Synth (`src/lib/audio/soundEngine.ts`)**:
   - Pure Web Audio API oscillator synthesis (zero external MP3 files needed, works 100% offline):
     - `playMechanicalClick()`: Crisp 18ms woody tap on stepper/button press.
     - `playSetComplete()`: Satisfying two-note ascending chime (`C5 -> G5`) + `navigator.vibrate(25)` on set checkoff.
     - `playPrFanfare()`: 4-note arcade brass chord (`C5 -> E5 -> G5 -> C6`) + `navigator.vibrate([40, 30, 80])` when a set beats historical e1RM.
     - `playRestTimerDone()`: Distinct double-bell alert when the floating rest timer hits `00:00`.
   - Includes a persistent Mute/Unmute toggle in the top HUD bar.

### 4.3 Mandatory Rules from `emil-design-eng`, `apple-design`, and `mobile-native`
- **Viewport & PWA Meta**:
  - `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content" />`
  - `<meta name="theme-color" content="#ece2c6" />`
  - `<meta name="apple-mobile-web-app-capable" content="yes" />`
  - `<meta name="apple-mobile-web-app-status-bar-style" content="default" />`
  - `public/manifest.json` with `"display": "standalone"`, `"background_color": "#ece2c6"`, `"theme_color": "#ece2c6"`, and SVG/PNG app icons.
- **Mobile-Native Hard Rules (`src/styles/notebook.css`)**:
  - `html { -webkit-tap-highlight-color: transparent; -webkit-text-size-adjust: 100%; overscroll-behavior-y: none; }`
  - `button, a, [role="button"], .chip, .tab { touch-action: manipulation; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }`
  - `input, select, textarea { font-size: max(16px, 1rem); }` (`19px` in `Patrick Hand`). Never use `maximum-scale=1` or `user-scalable=no`.
  - All `:hover` effects strictly gated inside `@media (hover: hover) and (pointer: fine) { ... }`.
  - Safe-area insets applied to top HUD (`padding-top: calc(10px + var(--sat))`), bottom 4-tab bar (`padding-bottom: var(--sab)`), and bottom sheets (`max-height: 88dvh; overscroll-behavior: contain; padding-bottom: calc(18px + var(--sab))`).
- **Animation Restraint & Interruptibility**:
  - High-frequency actions (stepping weight/reps, checking sets) use `80ms–140ms var(--ease-out)` transitions on `transform` and `opacity` only.
  - Never animate from `scale(0)` — all popovers/modals enter from `scale(0.95)` and `opacity: 0`.
  - Respect `@media (prefers-reduced-motion: reduce)` globally.
- **Screen Wake Lock API + Offline-First Outbox**:
  - Active workout automatically requests `navigator.wakeLock.request('screen')` (with a `☀️ Screen Awake` badge indicator) so the iPhone screen stays on between sets.
  - Client-side **Optimistic Outbox (`src/lib/offline/outbox.ts`)** patterned after `myfood`: every logged set/swap is applied immediately in UI state, persisted in `localStorage` with a client UUID (`cid`), and synced idempotently to SQLite, with a dark `--ink` Toast + **1-Tap Gold `Undo` button**.

---

## 5. Progress Dashboard & Proactive Value-Add Features

Located in the **Progress (`📊`)** and **Train (`🏋️`)** tabs:

1. **Hypertrophy Volume Landmarks Tracker (MEV / MAV / MRV)**:
   - Displays weekly fractional working sets per muscle group (counting `1.0` for primary movers and `0.5` for secondary movers) against science-based hypertrophy landmarks:
     - **MV (Maintenance)**: `4–6 sets/wk`
     - **MEV (Minimum Effective Volume)**: `6–8 sets/wk`
     - **MAV (Maximum Adaptive Volume — Sweet Spot)**: `10–18 sets/wk` (highlighted in `--green-bg`)
     - **MRV (Maximum Recoverable Volume — Overreaching Warning)**: `20+ sets/wk` (highlighted in `--red-bg`)
2. **72-Hour Muscle Recovery & Fatigue Status Map**:
   - Interactive Anterior / Posterior Cartoon Anatomy SVG + Muscle Grid showing real-time recovery percentage (`0%–100%`) for all 13 muscle groups based on sets logged and RIR proximity in the last 72 hours (`🔴 Fatigued <45%`, `🟡 Recovering 45–84%`, `🟢 Fresh / Prime to Train 85–100%`).
3. **e1RM & Tonnage Progression Curves (Hand-Drawn SVG Polyline Charts)**:
   - Filterable by Movement Slot or specific Exercise. Plots historical e1RM and top-set performance over 8+ weeks, overlaying variation swaps on the same canonical slot trendline!
4. **PR Trophy Room & Boss Milestones**:
   - Displays all-time e1RM, Max Weight, and Rep PRs plus "Boss Achievements" (e.g., *1 Plate Overhead Press*, *2 Plate Bench*, *3 Plate Squat*, *+20kg Weighted Chin-up*, *10,000kg Single-Session Tonnage*).
5. **Interactive Barbell Plate Calculator Sheet**:
   - Accessible in 1 tap from any exercise card or top utility bar: enter or tap any target barbell weight (e.g., `102.5 kg`), select bar weight (`20kg` standard / `15kg` women's / `10kg` EZ-bar), and see a hand-drawn cartoon barbell sleeve diagram showing the exact plates to load per side (`25kg Red`, `20kg Blue`, `15kg Yellow`, `10kg Green`, `5kg White`, `2.5kg Black`, `1.25kg Silver`).
6. **Auto-Starting Floating Rest Timer Pill**:
   - Checking off a set automatically starts the exercise's countdown timer (`90s` / `120s` / `180s`) in a floating bottom pill above the tab bar with `-15s`, `+30s`, and `Skip` buttons, using wall-clock timestamps (`Date.now()`) so backgrounding the iPhone PWA never causes timer drift.
7. **Shareable Cartoon Workout Summary Card Generator**:
   - Renders a high-contrast Ink-on-Paper trading card (PNG canvas export + copyable summary text) showing Workout Title, Duration, Total Volume, Top Sets, PR Badges, XP Earned, and Current Rank.

---

## 6. Structured AI Routine & Session Compiler (External LLM Bridge)

For users who want to brainstorm with ChatGPT, Claude, or Gemini in browser/mobile chat and import the result directly into LiftItUp:

1. **1-Tap "Copy AI System Prompt & Schema"**:
   - Includes the user's current schedule summary, available 15 movement slots, 36+ exercise slugs, recent e1RMs, and a strict JSON Schema (`ScheduleCompilePayload` or `WorkoutLogCompilePayload`).
   - Users can also type a quick goal right in the modal (e.g., *"Switch me to a 4-day Upper/Lower focused on arm & lat specialization, using weighted chin-ups on Upper A and pulley on Upper B"*) which embeds their request directly into the copied prompt!
2. **Paste, Validate & Diff Preview**:
   - User pastes the AI's JSON response (even if wrapped in markdown ```json fences — the parser strips fences automatically).
   - Validates against the schema, resolves exercise names/slugs, shows a visual **Before → After Schedule / Session Diff**, and applies it with **1 Tap ("Import Schedule" or "Load as Today's Session")**.
3. **Instant Built-In Smart Presets**:
   - Also provides 1-tap offline AI-curated templates (*Jeff Nippard / RP Style Upper-Lower 4x*, *6-Day PPL Hypertrophy*, *Arnold Golden 6 Split*, *Joint-Friendly Cable/Machine Specialization*) for instant switching without leaving the app.

---

## 7. Built-In MCP Server Interface (`/api/mcp`)

LiftItUp includes a first-class, standards-compliant **Model Context Protocol (MCP) Server** over Streamable HTTP / JSON-RPC (`POST /api/mcp` and `GET /api/mcp` discovery) so AI agents (Claude Desktop, Cursor, Antigravity, custom agents) can inspect and manage the user's gym schedule, precompiled workouts, variations, and analytics directly.

### 7.1 Authentication & Multi-User Scoping
- Authenticated via `Authorization: Bearer <user_api_key>`, `x-api-key: <user_api_key>`, or `?apiKey=<user_api_key>`.
- Resolves the exact user (`user_id`) from `users.api_key`, ensuring strict multi-user isolation.

### 7.2 Exposed MCP Tools (`tools/list` & `tools/call`)
1. `get_schedule`: Returns the user's active weekly schedule, routine days, exercise slots, rep ranges, and target RIR.
2. `upsert_schedule`: Creates or updates the user's weekly split, routine days, and exercise slots from structured JSON.
3. `get_precompiled_session`: Runs the Smart Double-Progression Engine for a given `date` or `routineDayId` and returns the precompiled workout with target weights, reps, RIR, and progression reasons.
4. `log_workout_session`: Logs a complete or partial workout session (exercises, sets, weights, reps, RIR, notes), automatically calculating XP, level-ups, PRs, and muscle recovery impact.
5. `swap_exercise_variation`: Swaps an exercise slot to another variation in the same movement slot (`scope: "session" | "schedule"`), returning the auto-calculated equivalent weight (including bodyweight + added weight for chin-ups/dips).
6. `get_progress_analytics`: Returns weekly volume per muscle group vs MEV/MAV/MRV landmarks, 72h muscle recovery status, e1RM trends, PR records, and gamification stats.
7. `list_exercises`: Lists all exercises filterable by `movementSlot` or `primaryMuscle`, including equivalence ratios and bodyweight factors.

### 7.3 Exposed MCP Resources (`resources/list` & `resources/read`)
- `liftitup://user/profile` — Athlete profile, level, rank, streak, bodyweight.
- `liftitup://schedule/active` — Full active weekly schedule & movement slots.
- `liftitup://workout/today` — Today's precompiled session with double-progression targets.
- `liftitup://analytics/summary` — Weekly volume landmarks, recovery map, and recent PRs.

### 7.4 In-App "MCP & AI Connect" Hub
- Displays the user's personal API key, live endpoint URL (`https://lift.0xpuddu.com/api/mcp`), ready-to-copy `mcpServers` JSON config snippets for **Claude Desktop / Cursor / Antigravity**, and an **Interactive In-App MCP Test Console** so the user can test MCP tool calls live in the browser.

---

## 8. Apple Fitness / Health Integration (Pragmatic iOS PWA Strategy)

Because iOS Safari / Home Screen PWAs cannot call native `HealthKit` APIs directly from browser JavaScript, LiftItUp implements a **two-way pragmatic Apple Fitness integration** with a clean **Opt-Out / Hide Toggle**:

1. **Apple Watch / Health Webhook (`POST /api/integrations/apple-health`)**:
   - Accepts workout & biometric payloads authenticated with the user's `liu_...` API key:
     ```json
     {
       "workoutType": "Traditional Strength Training",
       "durationMinutes": 58,
       "activeCalories": 412,
       "avgHeartRate": 128,
       "maxHeartRate": 164,
       "bodyweightKg": 78.5,
       "startedAt": "2026-11-15T09:00:00Z"
     }
     ```
   - Automatically attaches the Apple Watch calories & heart rate telemetry to today's LiftItUp workout session (or logs a standalone conditioning/strength entry), updates `users.bodyweight_kg` if provided (which immediately updates Weighted Chin-up / Dip equivalence math!), and awards `+35 Bonus XP` for synced biometric telemetry.
2. **In-App "iOS Shortcut Automation Wizard"**:
   - Step-by-step visual guide showing how to set up a 60-second iOS Personal Automation (*"When Workout Ends on Apple Watch → Find Health Samples → Get Contents of URL `POST https://lift.0xpuddu.com/api/integrations/apple-health`"*), with 1-tap copyable URL, headers, and JSON body, plus a **"Send Test Apple Watch Sync"** button.
3. **Manual Apple Health Export Importer (XML / JSON / CSV)**:
   - Drag-and-drop or file-picker parser that imports Apple Health workout exports (`HKWorkoutActivityTypeTraditionalStrengthTraining`, `FunctionalStrengthTraining`, bodyweight samples) client-side and syncs them to the user's history.
4. **Clean Opt-Out Toggle**:
   - Users who don't use Apple Watch can toggle **"Enable Apple Fitness Integration"** OFF in Settings (or dismiss the card with "Skip Apple Fitness"), hiding all Apple Health UI elements cleanly.

---

## 9. Dokploy + Cloudflare Tunnel Deployment Plan (Strict Non-Intrusive Rule)

> **CRITICAL HOMELAB CONSTRAINT**: Do **NOT** touch Proxmox VMs, host OS configs, or any existing homelab services. Only deploy the `liftitup` project to Dokploy and add the `lift.0xpuddu.com` public hostname to the existing `DOKPLOY_HOME` Cloudflare Tunnel and DNS zone.

### 9.1 Verified Homelab & Cloudflare Parameters (from `@infra` & `@coordinator`)
- **Domain & Zone**: `0xpuddu.com` (Cloudflare Zone ID: `032f78b57e9a40185b10d72be58e9cce`)
- **Existing Tunnel**: `DOKPLOY_HOME` (Tunnel ID: `d612431c-5b1b-4fdc-b74e-2551e5222c38`)
- **Internal Service Target**: `http://dokploy-traefik:80` (matching `airml.0xpuddu.com` and `fitorpivot.0xpuddu.com`)
- **Public Subdomain**: `lift.0xpuddu.com`

### 9.2 Step-by-Step Non-Intrusive Deployment Recipe (Executed by `@coordinator` after build & verification)
1. **Git Repository Push**:
   - Initialize git repo in `/Users/puddu/Documents/GitHub/liftitup`, commit all verified code, and push to GitHub (`D3stan/liftitup`).
2. **Dokploy Project & Application Creation (`dokploy-mcp`)**:
   - Create Dokploy project `liftitup` (`project-create`).
   - Create application or compose stack `liftitup` in the project's production environment, connected to the GitHub repository (`Dockerfile` build on port `3000`, with persistent volume mount `/app/data`).
   - Attach Dokploy domain `lift.0xpuddu.com` -> container port `3000` (`http`, routed via `dokploy-traefik`).
   - Trigger deployment (`application-deploy` / `compose-deploy`) and verify container health.
3. **Cloudflare Tunnel Ingress & DNS CNAME**:
   - Add public hostname rule `lift.0xpuddu.com` -> `http://dokploy-traefik:80` to the existing `DOKPLOY_HOME` tunnel (`d612431c-5b1b-4fdc-b74e-2551e5222c38`) without modifying any existing ingress rules.
   - Create proxied DNS `CNAME` record `lift` -> `d612431c-5b1b-4fdc-b74e-2551e5222c38.cfargotunnel.com` on zone `032f78b57e9a40185b10d72be58e9cce`.
4. **End-to-End Live Verification**:
   - Verify `https://lift.0xpuddu.com`, `https://lift.0xpuddu.com/api/workouts/precompile`, and `https://lift.0xpuddu.com/api/mcp`.

---

## 10. Strict Non-Overlapping Swarm File Ownership Plan

To guarantee **zero file collisions** during parallel execution, the codebase is partitioned into 4 strictly isolated implementation slices plus 2 verification roles:

```
/Users/puddu/Documents/GitHub/liftitup/
├── package.json                          [foundation]
├── tsconfig.json                         [foundation]
├── next.config.ts                        [foundation]
├── postcss.config.mjs                    [foundation]
├── Dockerfile                            [foundation]
├── docker-compose.yml                    [foundation]
├── .dockerignore                         [foundation]
├── public/
│   ├── manifest.json                     [foundation]
│   └── icons/                            [foundation]
└── src/
    ├── types/
    │   └── domain.ts                     [foundation - Shared Canonical Contracts]
    ├── styles/
    │   ├── tokens.css                    [foundation]
    │   └── notebook.css                  [foundation]
    ├── lib/
    │   ├── db/
    │   │   ├── index.ts                  [foundation - SQLite schema & connection]
    │   │   ├── queries.ts                [foundation - All typed DB queries]
    │   │   └── seed.ts                   [foundation - Demo athlete & 8-wk history seed]
    │   ├── auth/
    │   │   └── session.ts                [foundation - Cookie + API key auth]
    │   ├── hypertrophy/
    │   │   ├── exercises.ts              [foundation - 36+ exercises & 15 slots]
    │   │   ├── equivalence.ts            [foundation - Pulley <-> Chin-up & slot math]
    │   │   ├── precompiler.ts            [foundation - Smart Double-Progression engine]
    │   │   └── analytics.ts              [foundation - MEV/MAV/MRV & 72h recovery math]
    │   ├── gamification/
    │   │   └── engine.ts                 [foundation - XP, Levels, 7 Ranks, Streaks]
    │   ├── audio/
    │   │   └── soundEngine.ts            [workout-ux - Web Audio synth & haptics]
    │   ├── offline/
    │   │   └── outbox.ts                 [workout-ux - Optimistic localStorage outbox]
    │   └── mcp/
    │       ├── server.ts                 [ai-mcp-integrations - MCP JSON-RPC handler]
    │       └── compilerSchema.ts         [ai-mcp-integrations - AI Prompt & JSON validator]
    ├── app/
    │   ├── layout.tsx                    [foundation - Root PWA layout & fonts]
    │   ├── page.tsx                      [foundation - Main 4-Tab App Shell & Auth Gate]
    │   └── api/
    │       ├── auth/
    │       │   └── route.ts              [foundation - login/register/switch/api-key/me]
    │       ├── schedule/
    │       │   └── route.ts              [foundation - GET/PUT weekly schedule & presets]
    │       ├── workouts/
    │       │   ├── precompile/route.ts   [foundation - GET precompiled session]
    │       │   ├── log/route.ts          [foundation - POST workout/set log & undo]
    │       │   └── swap/route.ts         [foundation - POST exercise variation swap]
    │       ├── analytics/
    │       │   └── route.ts              [foundation - GET dashboard & recovery metrics]
    │       ├── mcp/
    │       │   └── route.ts              [ai-mcp-integrations - Streamable HTTP MCP]
    │       └── integrations/
    │           └── apple-health/route.ts [ai-mcp-integrations - Apple Watch webhook & import]
    └── components/
        ├── shell/
        │   ├── TopHudBar.tsx             [foundation - Rank, XP bar, Streak, Profile pill]
        │   ├── BottomTabBar.tsx          [foundation - 4-tab mobile navigation]
        │   └── ProfileAuthModal.tsx      [foundation - Multi-user login/register/switch]
        ├── workout/
        │   ├── WorkoutTabView.tsx        [workout-ux - Main Train & Schedule tab]
        │   ├── HeroTodayCard.tsx         [workout-ux - Tilted gold precompiled hero card]
        │   ├── ActiveSessionSheet.tsx    [workout-ux - Live workout logger & WakeLock]
        │   ├── ExerciseSlotCard.tsx      [workout-ux - Set rows, steppers, RIR, cues]
        │   ├── VariationSwapSheet.tsx    [workout-ux - 1-tap swap & BW/Pulley equivalence]
        │   ├── ScheduleBuilderSheet.tsx  [workout-ux - Weekly split editor & preset picker]
        │   ├── FloatingRestTimer.tsx     [workout-ux - Auto countdown timer pill]
        │   ├── PlateCalculatorModal.tsx  [workout-ux - Interactive barbell sleeve loader]
        │   └── SessionDebriefModal.tsx   [workout-ux - Before->After impact & XP celebration]
        ├── dashboard/
        │   ├── DashboardTabView.tsx      [dashboard-ux - Main Progress & Analytics tab]
        │   ├── VolumeLandmarksCard.tsx   [dashboard-ux - Weekly sets vs MEV/MAV/MRV bars]
        │   ├── MuscleRecoveryMap.tsx     [dashboard-ux - 72h SVG anatomy & fatigue status]
        │   ├── ProgressionChartCard.tsx  [dashboard-ux - Hand-drawn SVG e1RM & volume curves]
        │   ├── PrTrophyRoomCard.tsx      [dashboard-ux - Boss milestones & PR records]
        │   └── ShareableWorkoutCard.tsx  [dashboard-ux - Cartoon summary card & PNG export]
        └── integrations/
            ├── IntegrationsTabView.tsx   [ai-mcp-integrations - AI, MCP & Apple Health hub]
            ├── AiRoutineCompiler.tsx     [ai-mcp-integrations - Prompt generator & JSON diff]
            ├── McpConnectPanel.tsx       [ai-mcp-integrations - MCP config & live test console]
            └── AppleFitnessPanel.tsx     [ai-mcp-integrations - iOS Shortcut wizard & XML/CSV import]
```

### 10.1 Worker Execution Sequence & Handoffs
1. **Stage 1 (`foundation` — Core Infrastructure, DB, Engine & App Shell)**:
   - Initializes `package.json`, installs dependencies (`next`, `react`, `react-dom`, `better-sqlite3`, `lucide-react`, `framer-motion`, `@fontsource/permanent-marker`, `@fontsource/patrick-hand`, `tailwindcss`), writes `next.config.ts` with `output: 'standalone'` and `serverExternalPackages: ['better-sqlite3']`, writes `src/types/domain.ts` (including explicit `WorkoutTabViewProps`, `DashboardTabViewProps`, and `IntegrationsTabViewProps`), `src/styles/tokens.css`, `src/styles/notebook.css`, SQLite schema & 8-week hypertrophy seed (`src/lib/db/*`), hypertrophy & gamification engines (`src/lib/hypertrophy/*`, `src/lib/gamification/*`), core API routes, and the App Shell (`src/app/layout.tsx`, `src/app/page.tsx`, `src/components/shell/*`).
   - Note: `src/app/page.tsx` renders the 4 tab views (`WorkoutTabView`, `DashboardTabView`, `IntegrationsTabView`, plus a Schedule sub-view or tab) cleanly via shared props defined in `src/types/domain.ts`.
2. **Stage 2 (Parallel Feature Workers: `workout-ux`, `dashboard-ux`, `ai-mcp-integrations`)**:
   - Once `foundation` lands `package.json` and `src/types/domain.ts`, the 3 feature workers build their isolated component and API directories in parallel without touching each other's files.
3. **Stage 3 (`code-verifier` & `ux-reviewer`)**:
   - `code-verifier`: Runs `npm run build` (`next build`), verifies TypeScript compilation, tests all API endpoints (`/api/workouts/precompile`, `/api/workouts/swap`, `/api/workouts/log`, `/api/mcp`, `/api/integrations/apple-health`), and verifies the Docker build.
   - `ux-reviewer`: Audits the UI against `fit-or-pivot`/`myfood` tokens, `emil-design-eng`, `apple-design`, and `mobile-native` checklists (producing the required `| Before | After | Why |` review table and verifying 0 mobile/animation anti-patterns).
4. **Stage 4 (`coordinator` Deployment)**:
   - Pushes repo to GitHub, deploys `liftitup` on Dokploy, and attaches `lift.0xpuddu.com` to the existing `DOKPLOY_HOME` Cloudflare Tunnel.
