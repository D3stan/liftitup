# Liftitup feature plan: workout UX, body tracking, settings, integrations, admin, MCP

This is a brief for an implementing agent. It describes **what** to build and the decisions already taken. How to build it is yours to decide, except where a section is marked **Sensitive**: those points are constraints, not suggestions.

## 0. Ground rules

- **Stack as found:** Next.js 15 / React 19, Postgres via `DATABASE_URL` (`src/lib/db/connection.ts`), schema in `src/lib/db/schema.ts`, tests are `node:test` files running on `pg-mem`.
- **Schema changes:** Postgres only, additive (new nullable columns, new tables). New columns go in both the table DDL and an idempotent `ADD COLUMN IF NOT EXISTS` line in `initSchema`, which is how migrations run today (at every boot). The single approved exception to "additive" is the duplicate clean-up in phase 5.
- **One phase = one pull request.** An orchestrator sequences them; do not split or merge phases yourself.
- **Reuse before adding:** the UI kit in `src/components/ui` (Sheet, Button, toast, apiFetch), `withApiHandler` / `requireAuth` / `ApiError` for routes, `withTransaction` for multi-statement writes, `SvgLineChart` / `SvgBarChart` for charts, the theme tokens in `src/styles/tokens.css`. No new dependencies without a stated reason.
- **Every new stored field must also reach:** the domain types (`src/types/domain.ts`), the JSON and CSV export (`src/lib/export/exportData.ts`), and the MCP server (`src/lib/mcp/server.ts`) where the equivalent existing field is already exposed.
- **Units:** the user's unit is `kg` or `lb` (`users.unit`). Storage stays in kg. In the workout logger use its own helpers `kgToDisplay` / `displayToKg` (`src/components/workout/trackingFormat.ts`); the split editor has separate ones.
- **Drafts:** the workout logger persists a draft in the browser's localStorage. There is no working offline mode and none is to be built. Anything new the logger records must survive a page reload mid-workout.
- **API keys:** `requireAuth` accepts an API key on every route today. Narrowing that globally is **not part of this plan**. Only where a phase says "session cookie only" must a route refuse keys.
- **Guest sandbox users** expire and are deleted. Where a section says "not for guests", hide the feature rather than half-supporting it.
- **Mobile first:** verify every screen at 375px width, in all themes, with touch targets of at least 44px.
- **Tests:** each phase adds tests for its non-trivial logic (listed per phase). UI-only changes need no unit tests but must be checked in the running app.

## 1. Phase order and dependencies

| Phase | Feature | Depends on |
|-------|---------|------------|
| 0 | Clean-up: dead code, test command | none |
| 1 | Settings categories, search, danger zone, user-scoped drafts | 0 |
| 2 | Rest stopwatch, session clock, rest alerts | 1 |
| 3 | Actual rest recorded, fully editable logs, rest in history | 2 |
| 4 | +/− steppers with per-exercise step sizes | 1 |
| 5 | Apple Health section: strict ingest, bodyweight, last received, tests | 1 |
| 6 | Imports: Strong, Hevy, Liftitup restore; AI import entry in Settings | 1, 3, 4 |
| 7 | Body tab with weight tracking; AI tab removed from the nav | 1, 4, 6 |
| 8 | Progress photos: capture, overlay, compare, export | 7 |
| 9 | Focus mode in the workout logger | 2, 3, 4 |
| 10 | Admin area | 1, and reads data from all earlier phases |
| 11 | MCP expansion: full user tools and admin tools | 1 to 10 |

---

## Phase 0: Clean-up

**Goal:** remove code that misleads, before building on top of it.

- Delete dead code. Known: the offline outbox retry functions in `src/lib/offline/outbox.ts` (`enqueueNetworkRetryOp`, `flushOfflineOps`) have no callers; keep only what the draft storage actually uses. Sweep the rest of `src` for exports with no callers and remove them.
- `SCHEMA_VERSION` is written but never read. Either remove it or leave it clearly documented as informational; do not build a migration system.
- Add a `test` script to `package.json` that runs the existing test files, and state the command in the README.

**Sensitive:** before deleting anything, prove it has no callers (including dynamic imports, tests and the MCP server). Behaviour must be unchanged; this PR contains deletions and the script only.

**Done when:** the build and all tests pass with the dead code gone.

---

## Phase 1: Settings categories, search, danger zone

**Goal:** Settings stops being one long screen. It becomes an index of categories, each on its own page, so later phases have a clear home for their options.

**Categories:**

| Category | Contents |
|----------|----------|
| Profile | Name, unit, account details (what the Profile card holds today; body weight moves to the Body tab in phase 7) |
| Appearance | The existing theme selector |
| Training | Empty shell now; phases 2, 4 and 9 add to it |
| Data | Export (existing). Phase 6 adds imports here |
| Apple Health | The existing Apple Fitness panel, moved as-is. Phase 5 rebuilds it |
| Integrations | MCP and API key (existing) |
| Danger zone | New, see below |

**Behaviour:**
- `/settings` shows the category list with a one-line description of each. Each category has its own URL so it can be linked and the back button works.
- A search field on the index filters across all individual settings, not just category names. Typing "theme", "export" or "delete" shows the matching setting and takes the user to it. Search is client-side over a static list of setting names and keywords; later phases add their settings to that list.
- The existing behaviour of every moved control is unchanged.

**Danger zone actions and what each removes:**

| Action | Removes | Keeps |
|--------|---------|-------|
| Delete all workout history | Sessions with their exercises, sets and rep qualities; session swaps; Apple Health workouts' links to those sessions | Split, custom exercises, body data, Apple Health workouts themselves |
| Delete all body data | Body metrics; after phase 8, all photos (offer the photo archive first). Resets the profile weight to its default | Everything else |
| Reset split | All schedules (active and inactive), their days, day exercises and schedule events | Sessions (they lose their schedule link), exercises |
| Delete account | Everything belonging to the user, then ends the session | Nothing |

- Each action shows this list, offers the JSON export first, and requires typing a confirmation word.
- Not shown to guest users.

**User-scoped drafts:**
- Workout draft keys in localStorage currently carry no user id, so a second person on the same device is offered the previous person's draft. New draft keys include the user id.
- Logout, delete account and delete workout history clear that user's drafts.
- On first load after this ships, an existing un-scoped draft is adopted by the logged-in user once, then stored under the new key, so nobody loses a workout in progress.

**Sensitive:**
- Danger-zone routes are **session cookie only**. An API key must not be able to delete data.
- Deletion is scoped by `user_id` on every statement and runs in one transaction per action.
- **Deletion order:** references from session exercises and split-day exercises to `exercises` are `ON DELETE RESTRICT`, while a user's custom exercises cascade from the user row. Deleting a user whose custom exercise is used in a session or split can therefore be blocked. Delete in explicit child-to-parent order inside the transaction; do not rely on the cascade from `users`. The existing guest purge uses the same single delete and may have the same problem: check it and fix it the same way.
- Catalog exercises are shared rows with no owner; no action may touch them.
- `pg-mem` may not enforce this the way Postgres does. Verify delete account once against a real Postgres with a user whose custom exercise is used in both a session and the split.

**Tests:** each action removes only the calling user's rows and leaves a second user intact; API-key auth is rejected; delete account with a used custom exercise; draft keys are per user and cleared on logout.

**Done when:** every existing setting is reachable in its category, search finds each one, the four destructive actions work as tabled, and a second user on the same device never sees the first user's draft.

---

## Phase 2: Rest stopwatch, session clock, rest alerts

**Goal:** during a workout, show time elapsed since the last set finished, counting up; make session duration something the user controls; make rest alerts actually work where the platform allows.

**Rest clock:**
- New option in Settings › Training: rest clock mode, **Stopwatch** (default) or **Countdown** (today's behaviour).
- In stopwatch mode the clock starts automatically when a set is marked complete and counts up with no upper limit.
- The planned rest for that set stays visible as a target. When elapsed time reaches it, the clock changes colour and the alert fires once; the clock keeps counting.
- The clock has an explicit stop action for "I'm starting my next set now" (phase 3 uses it).
- Minimise, dismiss and the manual start from the header keep working. In stopwatch mode the preset and ±seconds controls adjust the target, or are hidden.
- Both modes are derived from a stored start time, so they survive a reload and the phone locking.

**Session clock:**
- Session duration is **always user-driven**, never measured from when the page was opened. The session starts when the user taps a Start button, or when they complete their first set, whichever comes first. It ends when they finish the workout.
- The elapsed session time is visible during the workout.
- Start time and duration are editable afterwards (see phase 3).

**Rest alerts:**
- Settings › Training gets a "Rest alerts" block: a button that requests notification permission, the current state (allowed, blocked, not supported on this device), and a **Send test alert** button that fires exactly what a finished rest would fire.
- If permission is blocked, explain how to re-enable it in the browser.

**Sensitive:**
- The rest start time and the session start time must be saved in the draft, otherwise a reload silently loses what phase 3 depends on.
- **iOS limits, to verify on a real iPhone:** Safari on iOS has no vibration; notifications work only when the app is installed to the home screen and may require a service worker; nothing fires while the phone is locked unless delivered as a push. Do not promise more than the device does: the status line must say "not supported on this device" when that is the case, and the colour change on returning to the app is the guaranteed signal. Building push delivery is out of scope; if a minimal service worker is needed purely to show a notification, that is acceptable, but it must not cache pages.

**Tests:** elapsed time derived from stored start; session start chosen as the earlier of Start tap and first completed set.

**Done when:** both clock modes work and survive a reload, session duration reflects the user's start and finish, and the test alert button reports honestly on desktop, Android and iPhone.

---

## Phase 3: Actual rest, fully editable logs, rest in history

**Goal:** the history shows how long the user really rested, per set and per session, and the user can edit everything in a logged workout. The user called the rest history essential.

**Data:**
- `workout_sets.rest_seconds` holds the **planned** rest. Keep it with that meaning.
- Add **actual rest** (nullable; null means not measured) and an **approximate** flag per set.
- The draft records, per set, when it was completed and, if the user tapped it, when the rest ended. Rest is computed once, at save.

**Definition of actual rest (Sensitive):**
- Rest belongs to the set it **follows**: the value on set N is the pause between finishing set N and starting the next set.
- If the user stopped the clock explicitly, that elapsed time is the rest and it is exact.
- Otherwise it is the time between completing set N and completing the next set, flagged approximate because it includes the next set's working time. Show approximate values with a "~".
- The pause between the last set of one exercise and the first set of the next counts as rest for that last set.
- The final set of the workout has no rest.
- Sets completed through "check all", sets un-ticked and re-ticked, and sets completed out of order get no measured rest.
- Values longer than 15 minutes are stored as not measured.

**Editing (decided by the user): everything in a log is editable.**
- From the history, the user can edit a saved session completely: date, start time and duration, exercises and their order, every set's values, planned rest, **actual rest**, set quality, and notes. Sets and exercises can be added and removed.
- A rest value typed by the user is stored as exact (the approximate flag is cleared). Clearing the field stores "not measured".
- **Sensitive:** the edit flow today deletes and re-inserts every exercise and set of the session. It must carry actual rest, the approximate flag and all other per-set data through unchanged for anything the user did not touch. An edit that only fixes a typo in a note must not alter or erase any measured rest. The same applies to loading a saved session back into the editor.

**Where it shows:**
- History / day view (`src/app/workout/[date]/page.tsx`): actual rest next to each set, with planned rest alongside when they differ; per-session total rest and average rest; working time versus rest time, where working time is the session duration (phase 2) minus total rest. Show that split only when every rest in the session has a value; otherwise show the totals and say some rests were not measured.
- During the workout: next to the running clock, "last time: 2:10" for the same exercise and the same position among completed sets, from the most recent completed session. If that session has no value for that set, show nothing rather than searching further back.
- Reuse the existing last-performance query (`getLastPerformanceByExerciseIds` in `src/lib/db/workouts.ts`) and the prefill payload the logger already receives; no new endpoint.
- Export (JSON and CSV) and MCP session output include actual rest and the approximate flag.

**Tests:** rest computation for the explicit-stop case, the fallback case, the exercise boundary, the final set, check-all, re-tick, out-of-order and the 15-minute cutoff; an edit that changes only a note preserves every rest value; a user-edited rest is stored exact; "last time" matches by position.

**Done when:** a logged workout shows real rest per set and session totals, every field of a past session can be edited without losing untouched data, and the next workout shows "last time" values.

---

## Phase 4: +/− steppers with per-exercise step sizes

**Goal:** adjust weight and reps with one tap while keeping typed input.

**Behaviour:**
- Each numeric field in the set row (weight, reps, and the time/distance fields for other tracking types) gets a minus button on the left and a plus button on the right. The field in the middle stays a normal editable text input with the same keyboard as today.
- Holding a button repeats the step.
- Values never go below zero. Stepping from an empty field starts from the prefilled or previous set's value, otherwise from zero.
- Default steps: reps 1; weight 2.5 kg or 5 lb depending on the user's unit; time 5 s; distance left to your judgement.

**Step size model (decided by the user):**
- **Default on the exercise:** a nullable `weight_step_kg` column on `exercises`. A custom exercise stores its owner's value directly there.
- **Override table:** a small `user_exercise_prefs` table keyed by `(user_id, exercise_id)` with a `weight_step_kg` column. A row is created only when a user changes the step on an exercise they do not own.
- **Lookup order:** user override, then the exercise default, then the user's global default from Settings › Training (2.5 kg or 5 lb).
- **Reset:** "back to default" deletes the override row rather than writing the default value into it, so later catalog changes still reach that user.

**Catalog defaults:** the catalog has about 410 entries and no step field. Do not annotate them by hand. `syncExerciseCatalog` derives `weight_step_kg` from the exercise's equipment (dumbbell 1.25; other equipment left empty so the global default applies), with an optional per-entry value in the catalog where a rule is wrong (for example leg press 5).

**Where the step is edited:**
- Custom exercises: in the existing exercise edit form, and from the logger card.
- Catalog exercises have no edit form. Their step is edited only from a small control on the logger card, which writes the override.
- The global default: Settings › Training.

**Sensitive:**
- A user changing the step on a catalog exercise must write to `user_exercise_prefs`, never to the shared row.
- The catalog sync must update `weight_step_kg` on catalog rows without touching override rows or custom exercises. It currently updates a fixed column list; extend that list.
- Steps are stored in kg. A user in lb picks from a fixed list (1, 2.5, 5, 10 lb), and a kg default is shown as the nearest entry of that list, never as a converted decimal such as 2.7558.
- The draft holds values as text in the display unit. Stepping operates on that displayed value and must not produce floating-point noise (62.50000001): round to the step's precision after each change, and convert to kg only at save with the logger's existing helper.

**Layout constraint:** the row must not overflow or wrap badly at 375px with three-digit weights and decimals. Inputs keep a font size of 16px or more so iOS does not zoom on focus.

**Tests:** step arithmetic in kg and lb, rounding, zero floor, the three-level lookup order, reset deletes the override row, catalog sync sets equipment defaults and leaves overrides intact.

**Done when:** all tracking types can be adjusted by tap or by typing, and a custom step on one exercise does not affect another user or another exercise.

---

## Phase 5: Apple Health section

**Goal:** Apple Health gets its own settings category with a guided Shortcut setup, a strict and honest ingest endpoint, bodyweight sync, and working tests.

**What exists:** `POST /api/integrations/apple-health` accepts one or many workouts, authenticates with a session or an API key, stores rows in `apple_health_workouts`, and copies heart rate and calories onto a session of the same date. It never rejects input and invents values for missing fields. The panel has an enable toggle, a webhook URL with copy button, and a file import.

**Endpoint changes (decided by the user):**

1. **Validate first.** One validation step runs before anything is stored. Each item must be either a workout (start time, duration) or a weight reading (weight, date). Anything else is rejected with a 400 naming the bad field, for example "workouts[0].startedAt is missing". Use the existing `ApiError.validation` pattern.
2. **No invented numbers.** Remove the fallbacks that fill in 50 minutes, 350 kcal and "now". Start time and duration are required for a workout. Calories and heart rate are optional and stored empty when absent; `active_calories` therefore becomes nullable.
3. **Weight-only items.** An item with a weight and no workout fields writes only to `body_metrics` and stops; it must not create a workout row or touch a session. Reuse `parseOptionalWeight` and its plausible-range check. A workout that also carries weight does both.
4. **Retries do not duplicate.** Add a unique index on user, start time and workout type, and make the insert an upsert, so a retry overwrites the same row.
5. **The toggle is enforced.** When the integration is disabled, ingest returns 403 "integration disabled" before storing. The toggle request itself and the file import from the settings screen stay allowed.
6. **Linking from both sides.** One shared "find the match" function based on time overlap, with a tolerance of 15 minutes either side, called in two places: when a Health workout arrives, and when a session is saved (looking for an unlinked Health workout that overlaps it). Whichever arrives second does the linking. This matters because the Shortcut usually fires before the user taps Finish.
7. **Dry run.** A `dryRun: true` field makes the endpoint authenticate, validate and reply "ok, key belongs to <name>, payload valid" without storing anything.
8. **Last received.** A timestamp, and what the payload contained, stored on the user row and updated on every real ingest, including weight-only ones.

**Settings › Apple Health:**
- **Setup guide:** numbered steps to create the iOS personal automation that runs when an Apple Watch workout ends, reads the workout from Health, and POSTs it. Include the exact JSON the endpoint expects, copy buttons for the URL, and how to add bodyweight.
- The Shortcut's **first action sends a dry run** with its key and shows the reply as a notification, which catches a wrong key on the phone.
- **Last received** line with timestamp, content (workout, weight or both) and whether it was linked to a session, so the user can run the Shortcut and watch it land.
- A browser button labelled **Check payload format**, which sends a sample through validation as a dry run. It is labelled that way because, being authenticated by cookie, it cannot test the key.
- The existing file import and toggle stay.

**Sensitive:**
- **Approved destructive step:** existing duplicate rows (same user, start time, workout type) must be removed before the unique index can be created. Keep the newest of each. This is the one non-additive migration in the plan; make it idempotent and log how many rows it removed.
- Existing Shortcuts that relied on the lenient behaviour will start getting 400s. Say so in the release notes and in the panel.
- The Shortcut uses the user's single API key, which is shared with MCP; regenerating it for one breaks the other. State this next to the "generate key" control. The key is shown once and stored hashed: the guide never displays a stored key. A published, shareable Shortcut must ask for the key on import and never embed one.
- A dry run must be unable to write anything, including the last-received timestamp.
- Session matching must not overwrite heart rate or calories a session already has from another Health workout unless the new one overlaps better; define the rule and test it.

**Tests:** each validation failure names its field; weight-only item creates no workout; retry updates in place; disabled returns 403; overlap matching with two sessions in one day; linking when the session is saved after the Health workout arrived; dry run stores nothing; duplicate clean-up keeps the newest.

**Done when:** a user can follow the guide on an iPhone, finish a watch workout, and see heart rate, calories and bodyweight appear with the last-received line updated. This needs a check on a real device; say so in the PR if it was not done.

---

## Phase 6: Imports

**Goal:** Settings › Data becomes the single place for getting data in and out.

**AI import:** add an entry for the existing AI import screen under Settings › Data, and make `/ai` redirect there. **Do not remove the AI tab from the bottom navigation in this phase**; that happens in phase 7 together with adding Body, so the nav never has an empty slot.

**New imports:**

| Source | Input | Brings in |
|--------|-------|-----------|
| Strong | Its CSV export | Sessions, exercises, sets, notes |
| Hevy | Its CSV export | Sessions, exercises, sets, notes |
| Liftitup | This app's own JSON export | What the export contains: sessions, the active split, custom exercises, body metrics |

**Behaviour, all three:**
- Upload, then a **preview** before anything is written: number of sessions, date range, exercises found, rows that could not be read. Reuse the validate-then-confirm pattern and the exercise name matcher that the AI import already has (`src/lib/ai`, `AiImportView`).
- **Exercise matching:** each imported name is matched against the catalog and the user's custom exercises by name, then alias. Unmatched names are listed for the user to map to an existing exercise or create as custom. Nothing is created silently.
- Units are detected from the file or asked once.
- The result screen states what was imported and what was skipped, with reasons.
- The Liftitup restore offers **two modes, chosen by the user**:
  - **Merge** (default): existing records are kept, missing ones are added, nothing is deleted.
  - **Replace:** the account's current data is removed and replaced by the file's contents.
- Replace shows a warning that lists exactly what will be deleted, including data the file cannot bring back (inactive splits, Apple Health workouts, and anything logged after the export was made), offers a fresh export first, and requires typing a confirmation word. Photos are not touched by either mode.
- The UI states plainly that a restore covers what the export contains: the active split only, and no Apple Health workouts.

**Identity and dedupe (decided by the user, Sensitive):**
- **Never reuse ids from an imported file.** Ids are global keys; reusing them collides across accounts.
- A session's identity for dedupe is `cid = 'import:<source>:<source session key>'`, under the existing unique index on user and cid. Importing the same file twice therefore changes nothing.
- Imported sessions carry **no schedule link** and must not change the current split rotation. The rotation logic reads completed sessions (`src/lib/schedule/queue.ts`); make sure imported ones are invisible to it, and add a test.

**Sensitive:**
- Uploaded files are untrusted: enforce an 8 MB limit before parsing (requests pass through middleware that caps bodies at 10 MB), parse defensively, and never let a field from the file choose the owner. Every row is written under the authenticated user, ignoring any user identifier inside the file.
- The whole import is one transaction; a failure leaves nothing half-written. For Replace this is critical: the delete and the import are the **same** transaction, the file is fully validated before anything is deleted, and a failure at any point leaves the account exactly as it was. Replace reuses the deletion code of the phase 1 danger zone rather than a second implementation.
- Verify the real column layout of current Strong and Hevy exports before writing the parsers. Do not rely on memory of the format; ask the user for sample files.
- The restore must round-trip the fields added in phases 3 and 4 (actual rest, approximate flag, step sizes).

**Tests:** a fixture file per source; second import of the same file is a no-op; Replace removes old data and a forced failure mid-import leaves the account unchanged; Replace never touches another user or photos; unmatched-exercise flow; a foreign user id inside a Liftitup export is ignored; ids in the file are not reused; imported sessions do not move the rotation; oversize and malformed files are rejected cleanly.

**Done when:** each of the three files imports into a clean account with correct sessions, and a second import of the same file changes nothing.

---

## Phase 7: Body tab and weight tracking

**Goal:** a fifth bottom-nav tab, **Body**, for weight now and photos in phase 8.

**Navigation:** in this same PR the AI tab is removed and Body takes its place: Calendar, Split, Exercises, Progress, Body.

**What exists:** the `body_metrics` table (date, weight, source; no uniqueness, and several rows per day already exist because Settings and Apple Health each insert on every save), `recordBodyMetric` / `listBodyMetrics`, and a bodyweight series returned by the progress API. Separately, `users.weight_kg` holds the profile weight, and that is what gets stamped on a session.

**Behaviour:**
- Quick entry: today's weight in the user's unit, using the phase 4 stepper with a 0.1 step.
- Chart: one point per day plus a 7-day moving average, with range switches (1 month, 3 months, 1 year, all).
- Summary: current weight, change over 7 and 30 days.
- History list with edit and delete, showing each entry's source.
- The weight field leaves Settings › Profile and links here instead.

**One value per day (Sensitive):**
- **Do not add a unique index**; existing data already violates it and the plan forbids destructive migration here.
- One function resolves a day's value everywhere it is needed: manual beats Apple Health beats import; within the same source, the latest wins. The existing source value `settings` counts as manual.
- A Body-tab entry updates that user's manual row for that date rather than inserting another.
- "Today" is the user's local date, using the existing timezone helper.
- Every write, edit and delete re-syncs `users.weight_kg` to the latest resolved value, so the weight stamped on new sessions and used for bodyweight-exercise load stays right.

**Tests:** the resolver's precedence with mixed sources on one day; manual entry updates in place; moving average; `users.weight_kg` follows edits and deletes.

**Done when:** weight can be logged in two taps, the trend is visible, Shortcut-synced weights from phase 5 appear in the same chart, and the profile weight never disagrees with the latest entry.

---

## Phase 8: Progress photos

**Goal:** private progress photos on the Body tab, with a ghost overlay and grid when shooting, a slider to compare two dates, and export.

**Storage (decided by the user):** photos are stored **in Postgres** as binary data. Only if that proves unworkable for a concrete, stated reason, fall back to files on a volume the user will mount (path from an environment variable); ask before taking the fallback. Never a third-party cloud, never browser-only.

**Capture:**
- Add a photo by taking one in the app or picking from the library. Each photo has a date and a pose (front, side, back), and attaches to that day's weight when one exists.
- All photos are cropped to a fixed **3:4 portrait** frame at capture and at upload, so any two can be overlaid and compared.
- **Ghost overlay**, with an on/off toggle: the previous photo of the same pose shown semi-transparent over the live camera view as a reference, with adjustable opacity.
- **Grid lines**, with their own on/off toggle, over the live view.
- **Self-timer** of 3 or 10 seconds, since these are usually taken alone.
- The front-camera preview is mirrored; the saved image is not.
- Where the in-app camera is unavailable or permission is denied, fall back to the normal file picker, without overlay or grid.

**Gallery and compare:**
- Grid by date, filter by pose. The grid loads thumbnails only.
- **Compare:** pick two photos of the same pose; a draggable divider reveals one over the other. Side-by-side is the alternative. Each side shows its date and weight.
- Delete a photo, with confirmation.

**Export:** the user can download all their photos as one archive from the Body tab and from Settings › Data. Files are named by date and pose, with a small index (date, pose, weight that day). A single photo can also be saved on its own.

**Not available to guest users.**

**Who does what (decided by the user):**
- **The browser does the image work:** crop, resize (long edge about 2000px, well under 1 MB), re-encode to JPEG, which also drops EXIF and location data, and generate a thumbnail of about 300px that is uploaded alongside.
- **The server does not inspect images.** No image library, no EXIF check. A malformed upload only harms the uploader's own private gallery.
- The server enforces exactly two things, because they protect the server and the app rather than the uploader:
  1. A hard **size limit** (2 MB per photo, checked both from the declared length and the bytes actually read), plus the quota below.
  2. A **fixed JPEG content type** when serving a photo, never one taken from the upload, together with a no-sniff header. Otherwise a crafted file could be served as a web page and run scripts in the app's origin.

**Sensitive (the most sensitive part of this plan):**
- These are intimate images. They are served only through a route that checks the session and that the photo belongs to the caller. A logged-in user gets "not found" for another user's photo id. No public or lasting shareable URLs; the only link that works without a session is the expiring signed link of phase 11.
- All photo **web routes**, including the archive, are **session cookie only**: an API key presented to them is refused. The single exception is the short-lived signed download link issued by the MCP tools of phase 11, which needs neither cookie nor key and is bounded as described there. The Shortcut has no use for photos and gets no route to them.
- Photo responses are private and not stored by any shared cache.
- Image bytes live in their own table, separate from photo metadata. No query selects the bytes except serving one photo and building the archive.
- The archive is streamed, not built in memory. One small, well-maintained dependency for archive creation is acceptable.
- Deleting a photo, "delete all body data" and "delete account" remove the image data too. If the volume fallback is used, that means the files, and filenames on disk are server-generated.
- Photos stay out of the JSON/CSV data export; the data export UI points to the photo archive. Through MCP they are available individually to their owner (phase 11), never in bulk.
- Camera access requires HTTPS (production has it; localhost works in development). iOS may re-ask for camera permission in an installed web app.

**Quota and backups (proposal, confirm the number):**
- **300 photos per user**, shown in the UI as "used / limit". At under 1 MB each that caps one user at roughly 300 MB. Phase 10 lets an admin change it per user.
- The README states that database backups now contain private photos and must be stored and shared accordingly, and that `POSTGRES_PASSWORD` must be set to a real value (the compose file currently falls back to a default).

**Test database (Sensitive):** `pg-mem` 3.0.14 corrupts binary data on read-back (bytes above 0x7F come back altered). **Fix this as part of the phase** so photo storage is genuinely tested: either make the in-memory setup binary-safe, or run the photo storage tests against a real Postgres (the compose file already defines one). A byte-for-byte round-trip test must exist and pass. Do not work around it by storing images as text.

**Tests:** byte-for-byte round trip; owner can fetch, other user gets not found; API-key auth refused on the web fetch and archive routes; served content type is always JPEG regardless of upload; oversize rejected; quota enforced; deleting the account removes image data; the archive contains only the caller's photos.

**Done when:** a photo taken with overlay and grid appears in the gallery, two dates can be compared with the slider, all photos download as one archive, and the access tests pass.

---

## Phase 9: Focus mode

**Goal:** an alternative workout view that shows one exercise at a time, to test whether it is easier than the scrolling list.

**Behaviour:**
- A toggle in the workout logger header switches between **List** (today's view) and **Focus**. The default for new workouts is set in Settings › Training and starts as List. Both views edit the same draft; switching mid-workout loses nothing.
- Focus view shows one exercise per screen: its name and target, the sets done and remaining, the set inputs with phase 4 steppers, the phase 2 rest clock inline (the floating clock is hidden in this view), the phase 3 "last time" rest, and one large primary button to complete the current set.
- **Peek at the next exercise:** a strip at the edge shows the next exercise's name and first target set. Tapping it moves there.
- **Swipe** left for the next exercise, right to go back and correct an earlier one. Going back never discards data.
- **Auto-advance:** completing the last planned set of an exercise moves to the next exercise after about two seconds. It is cancellable, and "add a set" stays available.
- A progress indicator shows "exercise 3 of 6" and opens a jump list, from which exercises can also be **reordered**.
- After the last exercise, a summary screen: total time, total rest and working time, volume, and the finish/save action.
- Everything the list view can do stays reachable: add exercise, swap variation, reorder, check all, notes, set quality, delete set.
- Respect reduced-motion preferences for the transitions.

**Sensitive:**
- Focus mode is a second **view** over the existing draft state, not a second copy of the logging logic. Saving, draft restore, the session clock and rest measurement behave identically in both views.
- The draft stores the view mode and the current exercise, so a reload returns to the same place.
- The horizontal swipe must not fight the iOS back-swipe or vertical scrolling inside a long exercise: ignore swipes that start at the screen edge, and let vertical movement scroll.

**Done when:** a full workout can be logged start to finish in Focus without returning to List, the saved session is identical to one logged in List, and a reload mid-workout returns to the same exercise.

---

## Phase 10: Admin area

**Goal:** a private area where the instance owner sees how the app is used, how much storage each user takes, whether the system is healthy, and can act on accounts. It is built last because it reads data from every earlier phase.

The proposal behind this phase was checked against the code. The corrections from that check are folded in below and marked **(verified)** where they change what the original proposal assumed.

### Access

- **Separate surface:** pages under `/admin`, data under `/api/admin/*`.
- **Who is admin:** there is no admin concept today **(verified)**. Use an `ADMIN_USER_IDS` environment variable; add it to the compose file and the README. Guests can never be admin.
- **Session cookie only:** the admin pages and `/api/admin/*` routes refuse API keys. Build one "session only" check and use it here and for the danger-zone and photo routes of earlier phases if they do not already share one. Agent access to admin functions is provided separately and deliberately, through the admin MCP tools of phase 11, not by opening these routes to keys.
- **Hidden, not just locked:** non-admins get "not found" on both pages and data routes. **(verified)** Today the middleware redirects a visitor without a cookie to `/welcome` and only checks that a cookie exists, so this needs a server-side check in the `/admin` layout as well as in the API. There is no page-side auth helper yet; add one.
- **Audit log:** every admin action and every opening of a user-detail page is recorded (who, what, which user, when). The audit log and the events table below must **not** be deleted when a user is deleted, or deleting a user erases the trail.

### Overview dashboard

- **Users:** total, registered versus guest, new per day and week.
- **Active users:** in the last 1, 7 and 30 days. **(verified)** `last_active_at` holds only the latest value, so today this is a "right now" figure with no history; trends and stickiness (daily ÷ monthly) come from the daily snapshot below. API-key calls also update `last_active_at`, so Shortcut and MCP traffic counts as activity: show app activity and key activity separately once events exist.
- **Guest-to-registered conversion:** **(verified) not measurable today.** Registering always creates a new user row and purged guests leave no trace. Make registration record, as an event, that it came from a guest session; conversion is then counted from the day this ships.
- **Retention:** cohort table by signup week showing who logged a workout in week 1, 2, 4, 8.
- **Churn list:** registered users with no session in 14 and 30 days.
- **Volume:** sessions, sets and total kg logged per day.
- **Storage:** database size, size per table, growth over time, largest users.

### Per-user storage

- **Row counts per user:** sessions, session exercises, sets, rep-quality rows, custom exercises, schedules, body metrics, Apple Health workouts.
- **Estimated bytes per user:** from Postgres row sizes. It is an estimate: indexes and shared overhead are not attributed.
- **Photos per user:** count and exact bytes. Store each photo's byte size in its metadata when it is uploaded (phase 8), so the admin area **never reads image data** to compute this.
- **Quota:** percentage of photo quota used, users near the limit. The per-user quota becomes a stored value so it can be adjusted.
- **Guest footprint:** storage held by guest sandboxes and how much the next purge will free.

### Per-user detail page

- **Account:** signup date, last active, unit, timezone, guest flag, theme, login sessions that have not expired (**(verified)** expired rows linger in the table, so filter on expiry).
- **Training:** sessions per week, current and longest streak, average session duration, jolly sessions, swaps made, skipped and postponed days (**(verified)** these are schedule events of type skip and postpone). Planned versus completed days depends on the rotation logic in application code, not on a query; compute it there.
- **Logging behaviour:** sets per session, average actual rest (available only from phase 3; planned rest is not a substitute), share of sets with quality ratings, most-used exercises, custom exercises created.
- **Features used:** MCP (key exists, last used), Apple Health (**(verified)** the "enabled" flag defaults to on, so it says nothing; use the last-received timestamp from phase 5), and from the events table: AI import, file imports, export, photo archive export, focus mode, clock mode.
- **Timeline:** recent events in order.

### Feature adoption

- **Per feature:** users who ever used it and users in the last 30 days: AI import, file imports, MCP, Apple Health, export, custom exercises, themes, focus mode, stopwatch versus countdown, photos.
- **Exercise catalog:** most and least logged exercises, catalog entries nobody uses, most common custom exercise names (candidates for the catalog).
- **Split shapes:** days per week, rest-day patterns, average exercises per day.

### System health

- **Requests:** count, error rate and latency per route. **(verified)** `withApiHandler` wraps 23 of the 24 route files with a name and already measures status and duration; only the health check is outside it. It is the one place to record this.
- **Errors:** recent failures with route and message. **(verified)** The logger writes only to the console, so there is nothing to read back today; failures must be stored.
- **Database:** connection pool usage and slow queries. The pool is private to the connection module and all queries pass through one function there; expose what is needed from that module.
- **Ingest:** Apple Health payloads received, rejected and left unlinked.
- **Guest purge:** last run and users removed. **(verified)** The purge runs opportunistically inside request handling, throttled in memory, and records nothing; store its last run and count.

### Admin actions

- **Disable or re-enable a user.** **(verified)** Nothing like this exists; it needs a stored flag that is checked on cookie auth, on API-key auth and at login.
- **Force logout** by revoking the user's sessions (a function for this exists).
- **Revoke API key** (no delete exists today; add it).
- **Delete user**, through the same code path as the danger zone's delete account from phase 1, including its explicit deletion order.
- **Purge expired guests now** (the existing purge can already be forced).
- **Adjust photo quota** per user.
- **Export a user's data** for a support or data-access request, using the existing export builders. This is the one action that reaches content; see the privacy rules.
- **Reset a user's password.** Accounts have no email, so today a forgotten password has no way back. Provide it in two forms that share one implementation:
  - a **script** the owner runs from the container's terminal (for example the Dokploy terminal);
  - an **admin MCP tool** (phase 11).
  There is no reset button in the admin web pages.

### New tracking

| What | Why it is not available today |
|------|-------------------------------|
| Logins and failed logins | Not stored; failed logins are only a console line |
| Feature-use events: export, AI import, file import, photo archive, theme change, mode switches, registration from a guest session | Only current state is stored, not the event |
| Request counts, latency and errors per route | Measured, then only printed |
| Admin audit log | Does not exist |
| Daily snapshot: active users, storage per table and per user | `last_active_at` and table sizes have no history |

- One small **events** table (user, type, timestamp, optional detail) covers logins, feature use and the user timeline. Event detail holds identifiers and counts, never content.
- The instrumentation points live in code written in earlier phases (imports, exports, photos, focus mode, Apple Health ingest); add them here.

### Privacy rules

- Admin sees counts, sizes and timestamps, not content. No viewing of progress photos, session notes, weights or workout details from the admin area.
- The single exception is **Export a user's data**: it requires a typed reason, is written to the audit log with that reason, and never includes photos.
- Every user-detail view goes in the audit log.
- If anyone other than the owner uses this instance, the app states that usage metrics are collected.

### Sensitive

- **Cost:** per-user byte estimates, cohorts, catalog usage and "largest users" each scan whole tables. Compute them in the daily snapshot or cache them; never on every page load.
- **Request metrics** must not add a database write to every request. Aggregate in memory and flush periodically; losing a few minutes of metrics on restart is acceptable.
- **Timestamps are stored as text** in ISO form throughout the schema, so date arithmetic in queries needs explicit conversion.
- **Testing:** `pg-mem` lacks the Postgres size and statistics functions and several date functions these queries need. Run the admin query tests against a real Postgres (the same set-up phase 8 introduces), and keep the access-control tests on the normal suite.
- **Snapshot scheduling:** there is no scheduler in the app; the guest purge piggybacks on requests. Use the same approach for the daily snapshot (run when due, at most once a day) unless the user wants an external cron.
- **Exemption from ground rules:** admin tables (events, audit log, snapshots, request metrics) are **not** added to the user data export or to the ordinary user MCP tools. They are reachable only through the admin MCP tools of phase 11.
- **Password reset:** the script must be present and runnable in the production image (the Dockerfile copies only the standalone build today, so it has to be included deliberately). It never takes a password on the command line, where it would land in shell history and process lists: it generates a temporary password and prints it once. The reset revokes all of that user's sessions, marks the account as "must choose a new password at next login", and writes an audit entry. It cannot target a guest. Passwords are hashed with the same function registration uses.
- A disabled user must be rejected on all three auth paths; a disabled user's existing sessions are revoked at the moment of disabling.
- Admin write actions are POST requests from the admin pages only; confirm cross-site request protection for them rather than assuming it.

### Build order inside the phase

1. Admin gate with "not found" for everyone else, audit log, overview and user list with storage, all from existing tables.
2. Per-user detail page and admin actions.
3. The events table and its instrumentation, then adoption and timeline.
4. System health and the daily snapshot.

**Tests:** non-admin and API-key callers get "not found" on every admin page and route; guests cannot be admin; each admin action is audited; a password reset revokes sessions, forces a new password at next login and is audited; a disabled user is rejected by cookie, key and login; deleting a user keeps their audit and event history; export of a user's data requires a reason and excludes photos; no admin route returns photo bytes, notes or weights.

**Done when:** the owner can open `/admin`, see current usage and per-user storage, drill into a user without seeing their content, perform each action with an audit entry, and every other account gets "not found".

---

## Phase 11: MCP expansion

**Goal:** the owner's agent can do everything the owner can do in the app and the admin area, and more where an agent is better placed than a person, without weakening the privacy and safety rules of earlier phases.

**What exists:** an MCP server at `/api/mcp`, API-key only, with nine tools: get profile, get schedule, get workout history, list exercises, export data, upsert custom exercise, hide exercise, import plan, log workout session.

### Part A: user tools (the agent acts on the key owner's own account)

Cover every capability the app offers after phases 1 to 9. Group and name the tools consistently with the existing nine; a few well-shaped tools per area are better than one per field.

| Area | The agent can |
|------|---------------|
| Profile and settings | Read and change unit, timezone, theme, rest clock mode, default step size, focus-mode default |
| Split and calendar | Read the split and the calendar; edit days and their exercises; skip, postpone and swap; start a jolly session |
| Sessions | Read one session in full; log a session (exists); **edit any field of a saved session** including actual rest (phase 3); delete a session |
| Rest and progress | Read rest statistics per session and per exercise; read progress series and personal records |
| Exercises | List, create, edit and hide (exist); read, set and reset the per-exercise step size (phase 4) |
| Body | Log, edit and delete a weight entry; read history and trend (phase 7) |
| Photos | Work with the owner's photos in three steps (see "Photos through MCP" below): list by metadata, browse thumbnails, get a download link; delete a photo (two-step) |
| Apple Health | Read status and last received; list Health workouts and their links; run a payload dry run; re-link or unlink a workout |
| Imports and export | Validate then confirm a Strong, Hevy or Liftitup file, including the choice of merge or replace; export data (exists) |
| Danger zone | The four actions of phase 1, through the two-step confirmation below |

### Part B: admin tools (only when the key owner is an admin)

Everything the admin area of phase 10 shows and does:

- **Read:** overview figures; user list with storage; one user's detail; feature adoption; exercise catalog usage; split shapes; system health (requests, errors, database, ingest, guest purge); the audit log; the events timeline; storage and activity snapshots over time.
- **Act:** disable and re-enable a user; force logout; revoke an API key; reset a password; adjust photo quota; purge expired guests; delete a user; export a user's data with a reason.

**Beyond the admin pages, where an agent is useful:**
- **Ad-hoc reporting:** a read-only query tool over a fixed set of reporting views, so the agent can answer questions the dashboard does not anticipate. The views expose counts, sizes, timestamps and identifiers only (see Sensitive).
- **Digest:** one tool that returns a compact health-and-usage summary for a period, with what changed since the previous period, suited to a scheduled check.
- **Anomaly hints:** users near quota, error-rate spikes per route, Health payloads being rejected, guest purge not running, unusual storage growth.
- **Catalog suggestions:** custom exercise names many users created, as candidates to add to the catalog, and catalog entries nobody uses. Read-only; the catalog itself stays in code.
- **Run now:** trigger the daily snapshot and the guest purge on demand.

### Sensitive

- **Same key, same endpoint (decided by the user):** there is one API key per user and one MCP endpoint. Admin tools appear in the tool list, and can be called, only when the key's owner is listed in `ADMIN_USER_IDS`; for everyone else they are absent, not merely refused. Membership is checked on every call, so removing a user from the list takes effect at once. Consequence to state plainly in the admin area and next to the key control: the owner's key is also the one inside the iOS Shortcut, so anyone who obtains that Shortcut's key holds admin power over the instance. Regenerating the key is the remedy, and it must be quick to do. The two-step confirmation and the audit log below are the main protection against misuse.
- **Two-step confirmation for destructive tools** (delete session in bulk, restore in replace mode, the danger-zone actions, delete user, reset password, revoke key, disable user): the first call returns a description of exactly what will happen and a short-lived, single-use confirmation value bound to that action, that target and that key; only a second call carrying it executes. This protects against an agent acting on a misread instruction.
- **Tool annotations:** mark each tool as read-only or destructive using the MCP protocol's own annotations, so clients can ask the human before destructive calls.
- **Audit:** every admin tool call, and every destructive user tool call, is written to the phase 10 audit log with the key that made it.
- **Privacy rules of phase 10 apply unchanged to the agent.** Admin tools return counts, sizes and timestamps, not other users' workout content, notes or weights. The audited "export a user's data with a reason" is the single exception, as in the admin pages.
- **Photos through MCP (decided by the user): a three-step flow.**
  1. **List by metadata:** date, pose, weight that day, quota used, filtered by date range and pose. No image data. Most requests end here, including "two photos six months apart".
  2. **Browse thumbnails** of chosen candidates (the roughly 300px rendition stored in phase 8, a few tens of KB each), returned as images, a limited number per call. Used only when the choice depends on appearance.
  3. **Get a download link** for one or more chosen photos, so the agent can download the full image with curl or similar **without the image passing through its conversation**. Full-size images are never returned inline.
- **Rules for all three steps:** only the key owner's own photos, ever; being an admin gives no access to anyone else's photos, and no admin tool returns image data or links; no archive or "all photos" tool; guests have none; thumbnail views and link creation are recorded as events. Thumbnails do enter the agent's conversation and from there go to whichever AI provider the owner's agent uses: say so in the tool description.
- **Download links are the one place a photo is reachable without a session cookie**, so they are tightly bounded: each link is for one photo, unguessable, signed by the server, expires within minutes, and stops working after that with "not found". It is served with the same fixed JPEG content type, no-sniff and no-store headers as every other photo response. The link reveals nothing about the user or the photo in its visible parts. The signing secret comes from the environment and is documented in the README; without it the tool is unavailable rather than insecure. Link creation is capped per call and rate-limited.
- **The reporting query tool** must be unable to reach password hashes, API-key hashes, session tokens, photo data, notes, or any table outside the reporting views; it runs read-only, with a row limit and a time limit. Do not offer raw SQL over the real tables.
- **Text written by users reaches the agent.** Usernames, exercise names and notes are free text chosen by other people, and an agent may read them as instructions. Admin tools return such text only where it is the point of the tool (for example custom exercise names), clearly as data fields, and never mixed into prose the server generates.
- **A password reset through MCP** returns the temporary password in the tool result, which means it enters the agent's conversation. State that in the tool description; the script is the route for a reset that should not pass through an agent.
- Guests get no new tools beyond what they have today, and can never be admin.
- The MCP tools call the same service functions as the web routes. No second implementation of any rule; in particular validation, ownership checks, quota and deletion order are shared.

**Tests:** a key whose owner is not an admin cannot list or call any admin tool; admin tools vanish for a user removed from `ADMIN_USER_IDS`; each destructive tool refuses without a valid confirmation and refuses a reused or mismatched one; every admin call is audited; thumbnails and download links are issued only for the caller's own photos and "not found" for another user's id, including for an admin; a download link works without a cookie, serves exactly one photo, and returns "not found" after expiry or if altered; no tool returns a full-size image inline; no admin tool returns photo data; the reporting tool cannot read the excluded tables or columns; user tools act only on the key owner's data.

**Done when:** through MCP alone an agent can log and fully edit a workout, manage the split, body data and settings, run an import, and, when the key's owner is an admin, read every admin figure and perform every admin action with an audit entry, while any other user's key sees none of the admin tools.

---

## 2. Decisions already made by the user

- Stopwatch is the default rest clock; countdown remains selectable.
- Show last session's rest during the workout.
- Session duration is always user-driven: Start button or first completed set.
- Everything in a logged workout is editable, including rest between sets.
- Rest alerts: a permission request and a test button. No sound cue, no screen wake lock.
- Step sizes: default on the exercise, per-user override table, global default last.
- Settings gets search and a danger zone.
- Global narrowing of API-key access is not relevant now.
- Imports in the first version: Strong, Hevy, Liftitup's own export. No generic CSV mapper. Ids from files are never reused; dedupe by `cid`.
- Apple Health is its own settings section; the ingest endpoint becomes strict, as specified in phase 5.
- Photos are stored in Postgres; a user-mounted volume is the fallback only. The browser does the image work; the server enforces only size and a fixed JPEG content type.
- Photos can be exported as an archive.
- Photo capture has a ghost overlay toggle and grid lines.
- Navigation gains a Body tab; AI import moves into Settings › Data.
- Focus mode includes a peek at the next exercise and swipe back.
- Dead code is deleted (phase 0).
- Phases are not split further; an orchestrator handles them.
- Liftitup restore: the user chooses merge or replace, with a warning.
- Password reset: by a script run in the container terminal, or by an admin MCP tool.
- The MCP server is extended so the owner's agent can do everything the owner can, including admin functions, and more where useful.

## 3. Assumptions confirmed

1. **Photo quota:** 300 photos per user, 2 MB per photo.
2. **API key:** the Shortcut shares the single existing key with MCP.
3. **Focus mode default:** List, until the user has tried Focus.
4. **Weight precedence:** manual over Apple Health over import for the same day.
5. **Photo poses:** front, side, back. No free-form tags.
6. **Photos for guests:** disabled.
7. **Liftitup restore:** merge or replace, chosen by the user, with a warning before replace.
8. **Danger zone:** no undo window; "delete all body data" resets the profile weight to its default.
9. **Rest cutoff:** a measured rest longer than 15 minutes is stored as not measured.
10. **Admin identity:** an `ADMIN_USER_IDS` environment variable, not an in-app role.
11. **Admin export of a user's data:** kept, as an audited exception that needs a typed reason. The alternative is to drop it so the admin area never touches content.
12. **Admin password reset:** by a script run from the container terminal, or by an admin MCP tool. No reset button in the admin pages.
13. **Daily snapshot:** runs opportunistically inside the app, like the guest purge, not from an external cron.

### Confirmed for phase 11

14. **Admin access:** the same API key and the same MCP endpoint; admin tools are available when the key's owner is in `ADMIN_USER_IDS`.
15. **Photos and the agent:** the owner's own photos through MCP in three steps: list by metadata, browse thumbnails, get an expiring download link. Full images are never returned inline; never other users' photos, never in bulk.
16. **Destructive tools:** available to the agent, behind a two-step confirmation.
17. **Reporting query tool:** read-only, over fixed reporting views, no raw SQL.

## 4. Out of scope

Generic CSV import, body measurements, plate calculator, goal weight line, heart-rate recovery analysis, weekly reminders, rest sound cue, screen wake lock, push notifications, offline mode, sharing workouts, native app or direct HealthKit access, global restriction of API-key access.
