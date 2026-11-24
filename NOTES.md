# NOTES

Working log for the Frutiger Aero theme task on `agent/liftitup-frutiger-aero`.

## What was done

- Added a new theme id `frutiger-aero` to LiftItUp, mirroring how other non-variant themes
  (`lofi-art`, `future-funk`) are wired across the app.
- `src/types/domain.ts`: added `'frutiger-aero'` to the `AppTheme` union.
- `src/lib/theme.ts`: registered `frutiger-aero` in `APP_THEMES`
  (name `Frutiger Aero`, subtitle `Glossy aqua & sunlit glass`, `supportsVariants: false`),
  accepted it in `isValidAppTheme`, and returned its glossy aqua `theme-color` `#cfeef7`
  from `getThemeColor()`.
- `src/app/layout.tsx`: extended the inline `THEME_BOOTSTRAP_SCRIPT` to validate and colour
  `frutiger-aero` (`#cfeef7`).
- `src/styles/tokens.css`: defined every CSS custom property that existing themes define for
  `[data-theme="frutiger-aero"]` — a late-2000s glossy aqua / sky-blue / fresh-green /
  sunlit glassmorphic palette with readable text contrast, clean rounded geometry
  (`--wob: 18px`, `--wob-sm: 14px`) and rounded Trebuchet-style fonts.
- `src/styles/notebook.css`: added `[data-theme="frutiger-aero"]` surface/geometry overrides —
  sunlit sky→meadow body gradient, glossy translucent glass cards, and zero wobble
  (removed the notebook hand-drawn wobble rotations in favour of clean rounded glossy cards).
- `src/components/settings/ThemeSelector.tsx`: added `FrutigerAeroMiniPreview` (inline SVG
  sky / rolling hills / glossy aqua bubbles) and wired it in for `meta.id === 'frutiger-aero'`.
- `src/lib/settings/registry.ts`: updated the appearance settings item description and added
  `frutiger aero`, `glossy`, and `aqua` to its keywords.
- `src/lib/db/schema.ts`: added `frutiger-aero` to the `users.theme` CHECK constraint (DDL +
  idempotent ALTER path).
- `src/lib/settings/profileSettings.ts`: extended the `theme` validation error message.
- `src/lib/settings/__tests__/theme.test.ts` (new): unit tests for `frutiger-aero` in
  `APP_THEMES`, `isValidAppTheme`, `getThemeColor`, `validateSettingsPatch`,
  `filterSettingsItems('frutiger aero')`, and the Postgres `users.theme` CHECK constraint.
  Registered in the `npm test` script (`package.json`).

## Aesthetic decisions

- Brand `theme-color` is the sunlit sky tone `#cfeef7` (matches `--paper`).
- Ink `#0c2a3d` keeps strong contrast on the light surfaces, cards, pills, inputs, progress
  bars, and buttons.
- Wobble removed (`transform: none`) for hero cards / notes / brand, matching the other
  non-variant themes; rounded radius used instead of the notebook hand-drawn shape.

## What is left / open questions

- None blocking. Full suite (`npm run typecheck && npm test`) verified green.
