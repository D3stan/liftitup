# LiftItUp — Rework Task List (working file, temporary)

> Source of truth for the swarm. Every worker reads this first. Coordinator keeps it updated.
> Status legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[?]` blocked / needs user

---

## 0. Process rules (from the user)

- Workers: **Gemini 4 Hydrogen (Medium)** by default; **Hydrogen (High)** for hard tasks
  (data model / auth / schedule engine / onboarding JSON schema). If Hydrogen runs out of quota →
  switch to **Gemini 3.8 Flash** (same effort level).
- Coordinator (Claude) spends as little as possible: plans, briefs, judges. Does not write code.
- Reviews: low-stakes tasks are reviewed by another Gemini worker (peer review). Critical tasks
  (auth/per-user isolation, DB schema + migration, schedule shifting logic, onboarding/import
  JSON schema, data export) are reviewed by the coordinator.
- Only stop to ask the user when really needed.
- **Do not create the user's account or load the user's personal data.** The user will onboard
  himself as a brand-new user.

## Current state (quick facts)

- Next.js 15 + React 19 PWA, Tailwind 4, framer-motion, SQLite via `node:sqlite` (`src/lib/db`).
- `src/lib/db/seed.ts` seeds a demo athlete "alex" with data; `resolveUserFromRequest` falls back
  to that demo user when unauthenticated → **MCP and API are effectively not per-user**.
- Session cookie stores the raw user id (insecure, spoofable).
- Gamification baked into schema (`xp`, `level`, `rank_tier`, streaks, shields) and UI
  (`src/lib/gamification`, TopHudBar, PR trophy room, debrief modal).
- Big screens: `WorkoutTabView` (910 lines), `DashboardTabView`, `ScheduleBuilderSheet`,
  `AiRoutineCompiler`, `McpConnectPanel`, `AppleFitnessPanel`.
- Deployed at lift.0xpuddu.com via Docker (DB in volume `/app/data/liftitup.db`).

---

## A. Accounts, guest mode, per-user isolation  (CRITICAL)

- [ ] A1. Remove seeded personal/demo data from the real DB path. No auto-created user.
- [ ] A2. First visit: choice screen → **Register / Log in** or **Explore as sample user**.
- [ ] A3. Sample (guest) user = fictional sample dataset, for viewing only (see Q2).
- [ ] A4. Real session tokens (signed / random token table), not raw user id in cookie.
- [ ] A5. No fallback to a default user anywhere: unauthenticated API/MCP → 401.
- [ ] A6. Each user has their **own MCP endpoint credentials** (personal API key, regenerate button)
      and MCP only ever sees that user's data.
- [ ] A7. Extensive server logging + user-visible error messages (toasts) on every mutation.
      Fix "Save current workout" being slow / appearing stuck in "Saving…".

## B. Onboarding (two-way setup)  (CRITICAL — JSON schema)

- [ ] B1. After registration: choose **Empty setup** or **AI onboarding**.
- [ ] B2. AI onboarding: one short copyable prompt for the user's own AI chat (external app).
      The AI asks: height, weight, age, years of training (simple), then asks the user to describe
      the split by voice message / transcript / screenshot / photo.
- [ ] B3. AI outputs one JSON: user profile + split assigned to correct weekdays and order, each
      exercise with sets, reps (or target), weight, rest between sets, tracking type, optional notes.
- [ ] B4. Paste box + **Import** button → validation with clear errors → preview → confirm.
      Unknown exercises are auto-created as custom exercises.

## C. AI integration page (paste/prompt)

- [ ] C1. Add a clear **"Paste AI result"** button / box (currently missing).
- [ ] C2. Preview is **empty** when nothing has been pasted.
- [ ] C3. Prompt section shorter: **one** example prompt, **one** copy button.
- [ ] C4. Remove in-app "before/after" section. Instead a **"Copy edit prompt"** button whose prompt
      includes the current data and instructs the AI to show before/after itself.
- [ ] C5. Strip long text; short phrases only.

## D. App structure / navigation / UI cleanup

- [ ] D1. Analyse current structure; propose a new information architecture (pages + routes).
- [ ] D2. Home = **calendar**, minimal. Clear where to edit things. More pages, less per page.
      Pattern: clean read-only view pages + an **Edit** button opening a separate edit page.
- [ ] D3. Remove duplicate navigation (Train/Split appear both top and bottom) → one nav.
- [ ] D4. Remove instructional/explanatory text from the UI. Move it to a user guide
      (`README.md` / `docs/USER_GUIDE.md`) the user reads before using the app.
- [ ] D5. Remove gamification: XP, levels, ranks, streaks, flames, "nice streak" messages,
      shields, XP on workout. Keep the visual game/notebook look; colours for progression only
      (e.g. better / same / worse than last time).

## E. Exercise library

- [ ] E1. Large built-in exercise repository (gym + calisthenics/bodyweight).
- [ ] E2. Page to browse all exercises; add custom exercises; remove/hide exercises.
- [ ] E3. Exercise library also editable via AI (text paste) and MCP tools.
- [ ] E4. **Tracking types** per exercise, designed properly (see Q1): e.g. weight × reps,
      bodyweight reps, weighted bodyweight (BW + added), assisted (BW − assistance),
      time/hold, reps toward a target / progression level, distance… combinations allowed.
      Logging UI, history, charts, export and MCP must all respect the tracking type.

## F. Workout logging (trainer UI)

- [ ] F1. Workout must **not auto-start** when opening a day; explicit **Start** button.
- [ ] F2. Fix cramped set rows (reps/weight inputs overlapping). Stacked, readable controls,
      mobile-friendly (big tap targets, no zoom on input focus).
- [ ] F3. Remove form cues. Remove target / muscle-group / other noise labels. Plain data only.
- [ ] F4. Delete an exercise from a given day's workout (clear button).
- [ ] F5. Add exercise to the day and **reorder** exercises (drag handle or up/down) without
      breaking the layout.
- [ ] F6. Optional **notes** per workout and per exercise; hidden when empty; visible later in
      history; included in export + MCP.
- [ ] F7. Remove the "live session tracker" (see Q4 for what else goes).

## G. Split / schedule editor

- [ ] G1. Reorder exercises inside a split day.
- [ ] G2. Split editing pages follow the view/edit pattern of D2.

## H. Schedule operations (home calendar)  (CRITICAL — logic)

- [ ] H1. **Skip** today's workout.
- [ ] H2. **Postpone 1 day**: shifts this and all following planned workouts by one day, no conflicts.
- [ ] H3. Missed workout recovery: e.g. plan P-P-L-Rest-P-L, missed Sunday legs → do legs Monday,
      continue sequence, without breaking the rest. Plus a **Reset** button to realign to the
      weekly template (see Q5).

## I. Progress / data

- [ ] I1. Remove advanced hard-coded analysis (recovery map, volume landmarks, rest analysis,
      equivalence formulas, etc.). The user draws conclusions himself or with his AI.
- [ ] I2. More graphs, less text: per-exercise history charts (respecting tracking type), volume
      over time, bodyweight, frequency.
- [ ] I3. Export all data in structured form: JSON (nested, AI-friendly) + CSV long/tidy format
      (one row per set, pandas-ready), incl. notes and tracking type.
- [ ] I4. MCP: read tools for full history, notes, exercises, schedule (per user).

## J. Docs

- [ ] J1. `docs/USER_GUIDE.md` (how to use, onboarding, AI prompt, MCP setup, export format).

---

## Open questions for the user

### User answers (binding)

- **Q1 "target" = execution quality of a rep/set.** E.g. a muscle-up done poorly vs cleanly both
  count as 1 rep but differ; a bench set of 3 where the last rep was spotter-assisted → that rep at
  e.g. 70%. Applies to **all** exercises, but is **optional and hidden** unless the user enables it
  (setting). UX: keep the set row clean; set quality via a small pop-up / long-press sheet; the set
  row changes **colour** when not executed "the usual way" (100%). Still also support proper
  tracking types per exercise (weight×reps, bodyweight reps, weighted BW, assisted BW, time/hold,
  distance…), designed like a professional app.
- **Q2 Sample user:** each visitor gets a **temporary sandbox copy** of a fictional sample dataset
  that they can edit; sandboxes are wiped automatically after a while (e.g. 24 h inactivity).
- **Q3:** code no longer seeds real users; on deploy the old DB is wiped so it starts empty.
- **Q4 Keep:** rest timer, Apple Health/Fitness integration, exercise swap/variation sheet.
  **Remove:** plate calculator, PR trophy room, shareable workout image card, sound effects.
  Future idea (not now): share a workout with another person → `docs/IDEAS.md`.
- **Q5 Schedule = rotation queue** (no fixed weekdays), but shown properly on the calendar week.
  Operations: **postpone by 1, 2 or 3 days**; **reset / start over** the rotation; **jolly day**
  (free workout: either an extra day added to the schedule, or done on top of / instead of a
  planned day). No "do missed workout" button. Workouts that were not done count as **skipped**.
  Must handle the example: P-P-L-Rest-P-L, Sunday legs missed → legs Monday, continue the
  sequence without breaking the rest.
- **Q6 Git:** incremental, well-described commits (easy rollback/review, no over-engineering);
  push to remote whenever ready. At the end: tell the user what to do, and write **two docs**:
  `docs/QUICKSTART.md` (short) and `docs/GUIDE.md` (detailed, the fallback reference).
