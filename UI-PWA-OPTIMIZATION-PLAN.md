# Momentum — UI & PWA Optimization Plan

**Scope:** website (browser tabs) + installed PWA + Capacitor Android shell, with a special focus on **Firefox for Android (Fenix)**.
**Date:** 2026-09-19 · **Stack:** TanStack Start (React 19), Tailwind 4, Radix/shadcn, Supabase, Cloudflare (nitro), Capacitor wrapper.

---

## 1. Current state (audited)

### What already works well

| Area | Evidence |
|---|---|
| Safe-area handling | `AppShell.tsx` header `pt-[env(safe-area-inset-top)]`, main `pb-[max(1.25rem,env(safe-area-inset-bottom))]`; offline banner too |
| Dark theme consistency | `#0b0d11` meta `theme-color` matches `--background` oklch; manifest `theme_color`/`background_color` in sync; iOS splash set covers all common devices |
| Service worker | `public/sw.js` (v4): precached shell, cache-first hashed `/assets`, network-first navigations with offline fallback, Supabase/`_serverFn` bypass |
| Update flow | `PwaStatus.tsx` prompts "Update available → Reload" via `registration.waiting`/`updatefound`, never on first install |
| Offline indicator | `navigator.onLine` + online/offline events → bottom pill |
| Mobile nav | Horizontally scrollable pill row, hidden scrollbar, edge-bleed, `md:` restores inline layout |
| Inputs | `Input` renders `text-base` on mobile (`md:text-sm`) → 16px floor avoids focus-zoom |
| Chromium install | `beforeinstallprompt` handled, remembered dismissal, `appinstalled` cleanup |

### Key gaps (summary)

1. **Firefox has no `beforeinstallprompt`** → the entire install UX silently never appears for Firefox users (desktop *and* Android).
2. Firefox Android "Add to home screen" creates a **shortcut that opens in a normal browser tab** — no `display-mode: standalone`, so any standalone-only polish (safe-area padding, "app feel") never applies on Firefox.
3. Small touch targets (h-7/h-8 buttons, `py-1` nav pills, tiny day cells) and lots of `text-[10px]` labels.
4. Desktop-style centered dialogs with `max-h-[90vh]` break under the mobile keyboard; 4 hand-rolled modals in `routines.tsx` bypass Radix entirely (no focus trap / scroll lock / Esc).
5. `vaul` (drawer) is installed and `ui/drawer.tsx` exists but is **used nowhere** — the perfect primitive for mobile is unused.
6. Several viewport-height usages (`min-h-screen` = `100vh`, dialog `90vh`) misbehave with Firefox Android's dynamic toolbar and keyboard.
7. Dense data screens (routines matrix `min-w-[950px]`, habits grid `min-w-[650px]`) rely on bare horizontal scroll with no affordance.
8. Render-blocking Google Fonts; two very large route files (index 1.7k lines, routines 3.2k lines) shipped to a JS engine that is slower on mobile Firefox than Chrome.

---

## 2. Firefox mobile reality check (what we must design for)

| Capability | Firefox Android today | Impact on Momentum |
|---|---|---|
| `beforeinstallprompt` / programmatic install | ❌ Not supported | Chromium-only install toast never fires → need **manual install guide** |
| Manifest-driven "Add to home screen" | ✅ (menu ⋮ → Add to home screen) | Icon comes from manifest (192/512 + maskable) ✅ |
| Standalone window from shortcut | ❌ Opens in a browser **tab** | `display-mode: standalone` never matches; status bar is Firefox's own; our `theme-color` still colors the toolbar ✅ |
| Service worker + offline | ✅ | Offline shell + banner work as-is |
| `dvh`/`svh` viewport units | ✅ (since FF 101) | Safe to replace `100vh`/`90vh` |
| `overflow-x: clip` | ✅ (FF 81+) | Already used correctly |
| `oklch()` colors | ✅ (FF 113+) | Design system safe |
| Backdrop-filter | ✅ but can be janky over large sticky areas | Keep blur small / add solid fallback |
| 300 ms tap delay | Removed when `width=device-width` viewport is set (ours is) | Still add `touch-action: manipulation` for double-tap-zoom safety on dense controls |
| Font inflation / text autosizing | Active on Android | Add `text-size-adjust: 100%` to keep custom typography from being inflated |

> **Design stance:** treat Firefox Android as a *first-class tab experience with shortcut install*, and Chromium/installed PWA as the *full standalone experience*. All improvements below are progressive — nothing should degrade Chromium.

---

## 3. Workstreams & detailed changes

### A. Install & "app presence" (highest Firefox impact)

**A1. `usePlatform()` + `useInstallState()` helpers** — *new file `src/hooks/use-platform.ts`*
- Detect: `isStandalonePWA` (matchMedia `display-mode: standalone` / iOS `navigator.standalone`), `isFirefoxAndroid`, `isFirefoxDesktop`, `isIOSSafari`, `isChromium`.
- Reuse inside `PwaStatus.tsx` instead of ad-hoc checks.

**A2. Manual install guide for non-Chromium browsers** — *new `src/components/InstallGuideDialog.tsx`*
- When no `beforeinstallprompt` support and not installed: show a one-time toast/dialog "Install Momentum" → opens a dialog with **per-browser illustrated steps**:
  - Firefox Android: ⋮ menu → **Add to home screen** → *Add*. Note: "opens in a tab, just like a browser".
  - iOS Safari: Share → Add to Home Screen.
  - Firefox desktop: friendly no-op ("Momentum works great right here — bookmark it").
- Reuse the existing `INSTALL_KEY = "momentum:install-prompt"` dismissal logic and the Radix `Dialog`.
- Entry point: keep automatic toast (once per session max) + add a subtle **"Install" affordance in the header/AppShell** so it is reachable later.

**A3. Manifest hardening** — `public/manifest.webmanifest`
- Add `"display_override": ["standalone", "minimal-ui", "browser"]`.
- Add `"screenshots"` (narrow ~540×1140 + wide) → richer install sheet on Chromium; harmless in Firefox.
- Add `"launch_handler": { "client_mode": "navigate-existing" }` (Chromium; ignored elsewhere).
- Keep `orientation: portrait-primary` only if tablet lock is desired — recommend removing to avoid awkward landscape prompts.

**A4. Standalone/tab mode split**
- Since Firefox shortcuts always run in tabs, verify no UI *requires* standalone: safe-area paddings already resolve to 0 in tabs (correct). Add `data-mode="standalone|tab"` on `<html>` (from A1) for any future CSS forks.

**Acceptance:** Firefox Android user can find and complete "install" via in-app guide; Chromium flow unchanged; desktop Firefox shows bookmark nudge instead of nothing.

---

### B. Layout, viewport & Firefox rendering

**B1. Dynamic viewport units**
- Replace `min-h-screen` with `min-h-dvh` in `AppShell.tsx`, `__root.tsx`, `useAuth.tsx`, `auth.tsx`, `reset-password.tsx`.
- Replace dialog `max-h-[90vh]` with `max-h-[90dvh]` in `ui/dialog.tsx` (+ the hand-rolled routines modals until they are migrated per C2).
- Rationale: Firefox Android's dynamic URL bar and software keyboard resize the *visual* viewport, not `vh`.

**B2. Text & tap rendering hygiene** — `src/styles.css` `@layer base`
```css
html { text-size-adjust: 100%; }            /* stops Firefox font inflation */
button, [role="button"], a, select, label { touch-action: manipulation; }
html { -webkit-tap-highlight-color: transparent; }
@media (prefers-reduced-motion: reduce) {   /* respect OS setting incl. Firefox */
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

**B3. Sticky header performance on Firefox Android**
- `backdrop-blur` over the full-width header can stutter while scrolling long lists. Options: reduce blur area (`bg-background/95` + smaller blur), or feature-detect low-power. Recommend: keep blur but bump opacity to `/90` and add `transform: translateZ(0)`-free plain fallback first — measure before further changes.

**B4. 7-day switcher cells** (`routes/index.tsx` ~line 715)
- On a 360 px screen, `grid-cols-7` cells are ~44 px wide but cramped with exam + today + complete icons. Changes:
  - Keep the grid, but shorten weekday to 2 letters below `sm:` (`WEEKDAY_NAMES[i].slice(0, 2)` already slices to 3 — use a `MOBILE_WEEKDAY` alias).
  - Raise cell min-height to ~64 px so the whole cell is a comfortable target; add `select-none`.
  - Add a hairline scroll-snap alternative if QA still finds it cramped: `overflow-x-auto snap-x` container of fixed-width cells (pattern already proven by the stats row at `index.tsx:1444`).

**B5. Horizontal-scroll affordances for data tables**
- Routines matrix (`routines.tsx:1747`, `min-w-[950px]`) and habits heat-grid (`habits.tsx:162`, `min-w-[650px]`):
  - Wrap in a shared `<ScrollHint>` that shows a right-edge gradient + "swipe" hint that fades after first scroll.
  - Matrix already has sticky first column; additionally make the **header row sticky within the scroll container** (`thead th { position: sticky; top: 0 }`) so scrolling down + right keeps context; give the corner cell double-sticky treatment.
  - `overscroll-behavior-x: contain` on these containers so horizontal swipes don't trigger Firefox's back-swipe/overscroll chain.

---

### C. Navigation & modals on mobile

**C1. Optional bottom tab bar (recommended, medium effort)**
- One-handed reach beats the top pill row; today the sign-out + streak row also push content down on small screens.
- Add `md:hidden` fixed bottom bar (Tasks · Routines · Habits · Goals · More), `h-14` + `env(safe-area-inset-bottom)`, active state = primary tint; add matching bottom padding to `<main>` when bar is present. Top pills remain on `md+`.
- Keep the sign-out behind "More" (sheet) on mobile — currently it sits in the header next to streak stats and is an easy mis-tap.

**C2. Adopt `vaul` drawers as the mobile modal primitive**
- `ui/drawer.tsx` exists but is unused. Add a `ResponsiveModal` wrapper: `Drawer` (bottom sheet, grab handle) below `md`, existing `Dialog` at `md+`.
- **Migrate the 4 hand-rolled modals** in `routines.tsx` (lines ~2538, ~2801, ~2865, ~2982) to Radix `Dialog`/`ResponsiveModal`. They currently lack focus trapping, scroll lock, `aria-modal`, Esc handling, and safe-area-aware footers — real a11y bugs on Firefox (Tab key escapes into background page).
- Move long form dialogs (`habits.tsx:146`, `ExamScheduleDialog`, `WeeklyReviewDialog`) onto the wrapper so mobile gets a bottom sheet that never hides behind the keyboard.

**C3. Toaster**
- `ui/sonner.tsx` offsets handle top safe area; ensure bottom-positioned toasts (if any future) also get `env(safe-area-inset-bottom)`; cap toast width to `calc(100vw - 2rem)` on small screens.

---

### D. Touch ergonomics & forms

**D1. 44 px minimum hit targets**
- Audit list of sub-44 px interactive elements found: nav pills (`py-1`, ~28 px) → `py-2` on touch; `h-7`/`h-8` outline buttons in routines move-popover; day-off toggle `h-5 w-5` (keep visual, expand hit area with a `::before -inset-2` pseudo-element); routine day-letter buttons; habits row action buttons.
- Keep visual size; expand hit area via pseudo-elements or `after:-inset-2` (pattern already used in `ui/sidebar.tsx:457`).

**D2. Keyboard-friendly inputs**
- Add `inputMode="numeric"` / `"decimal"` + `enterKeyHint` to all `type="number"` fields (`goals.tsx:840`, `index.tsx:1291`, `history.tsx:550`, `WeeklyReviewView.tsx:259`) — Firefox Android respects `inputmode`.
- Fix sub-16px inputs that trigger focus-zoom: `goals.tsx:847` (`h-6 w-16 text-[10px]`) → `text-sm` (14 px is under Firefox's zoom threshold on Android; use ≥16 px or `inputmode` + explicit non-zoom).
- Native `<select>` elements (many across habits/routines/index) render Firefox's own picker — fine on mobile, but give them consistent `h-10`+ and `appearance-none` + chevron for visual parity on desktop; keep native on mobile (best UX).
- `date`/`time` inputs (`goals.tsx:489`, `ExamScheduleDialog`) are native — verify Firefox Android shows its date picker; it does. Ensure labels wrap (done) and the field is ≥44 px tall.

**D3. Double-confirm destructive actions stay dialogs on mobile** — `AlertDialog` (history reset, routines/goals deletes) already correct; do not convert to swipe gestures.

---

### E. Typography & density

- Set a mobile floor of **12 px** for the many `text-[10px]` badges (badges only; body labels already `text-xs`/12–14 px). Suggest defining `--text-2xs` tokens (`text-2xs` = 11 px, `text-[10px]` → `text-2xs` sweep) to make future changes one-line.
- `text-rose-300/70` line-through day-off labels (routines day strip) fail contrast — raise to `/90` or `text-rose-200`.
- Consider a compact light "density" pass *only* on `md+`; keep current airy spacing on mobile.

---

### F. PWA shell polish

- **F1.** SW: bump `CACHE` to `v5` in the deploy that ships this plan (precache list unchanged unless new splash/icon files are added); keep the documented bump discipline from `sw.js` header comment.
- **F2.** SW: add a `visibilitychange`/`focus` → `registration.update()` tick (e.g., at most once per 30 min) so long-lived Firefox tabs (the norm there, since shortcuts open tabs) see updates without a cold start.
- **F3.** Offline fallback page: navigations fall back to cached `/`; add a tiny branded `public/offline.html` precached and used as final fallback so deep links offline show Momentum branding instead of a browser error.
- **F4.** Keep `apple-touch-startup-image` set; regenerate only if theme color ever changes (documented in `__root.tsx`).
- **F5.** Capacitor build (`vite.config.android.ts`) unaffected by all of the above; verify `PwaStatus` still skips SW registration in the WebView (logic already handles `localhost` no-port).

---

### G. Performance (perceived speed on mobile Firefox is ~1.5–2× worse than Chrome)

- **G1.** Route-level code splitting: index (1.7k LoC) and routines (3.2k LoC) — use TanStack Router's code-based splitting or `React.lazy` for the recharts views (index chart, history charts, routines analytics) so first paint of Tasks doesn't ship the chart bundle.
- **G2.** Fonts: Google Fonts CSS is render-blocking cross-origin. Self-host subset WOFF2 (Space Grotesk 400/500/600/700, JetBrains Mono 400/500) with `font-display: swap` + `preload`; keeps Firefox Android first paint fast on flaky networks and removes a third-party dependency.
- **G3.** Recharts `ResponsiveContainer` recalcs on every Firefox Android toolbar show/hide; wrap chart sections in `content-visibility: auto` / fixed-height containers to reduce layout thrash while scrolling.
- **G4.** Images: only icons today — fine. Add `fetchpriority="high"` to nothing; no LCP image exists (text-first app ✅).

---

### H. Accessibility quick wins (Firefox mobile screen reader users included)

- Streak pill: wrap numbers in `<span aria-label>` or keep text ("day streak" already text ✅).
- Add `aria-current="page"` to active nav pill (TanStack `activeProps` currently visual-only).
- Day-switcher buttons: add `aria-pressed`/`aria-label` including date + completion ("Tue Sep 15, 2 of 5 done, today").
- Ensure `title=""` tooltips (used on day cells, matrix toggles) are duplicated in `aria-label` — Firefox Android has no hover.

---

## 4. Prioritized roadmap

| Phase | Items | Effort | Why now |
|---|---|---|---|
| **P0 — Firefox install & correctness** | A1, A2, A3, B1, B2, F1 | ~1 day | Fixes the "no install path at all on Firefox" gap + viewport bugs; tiny diffs |
| **P1 — Touch & mobile ergonomics** | C2 (ResponsiveModal + routines migration), D1, D2, B4, B5 | ~2–3 days | Biggest day-to-day feel improvement on phones |
| **P2 — Structure & polish** | C1 (bottom tabs), E (type floor/contrast), H, F2, F3 | ~2 days | Long-term navigation model + a11y |
| **P3 — Performance** | G1, G2, G3 | ~2 days | Measurable TTI gains on mobile; do after UI settles |

**Definition of done (per item):** no regression on Chromium desktop/Android; verified on Firefox Android (real device or `about:debugging` + Fenix), iOS Safari, and desktop Chrome/Firefox; `npm run lint` + typecheck clean.

## 5. Test matrix

- **Firefox Android (Fenix, real device):** install via guide steps → shortcut icon/label; back-swipe vs. matrix horizontal scroll; keyboard + bottom-sheet dialogs; offline reload; update toast after deploy.
- **Chromium Android:** `beforeinstallprompt` toast unchanged; richer install sheet with screenshots; standalone safe-areas.
- **iOS Safari:** splash screens, standalone, drawer gestures.
- **Desktop Firefox/Chrome:** layouts byte-identical (`md+` untouched except explicit changes); reduced-motion honored.
- **Lighthouse PWA + a11y** before/after each phase; `web.dev` install criteria pass.

---

## Appendix: exact touch-point file index

| Concern | Files |
|---|---|
| Install/SW lifecycle | `src/components/PwaStatus.tsx`, `public/sw.js`, `public/manifest.webmanifest` |
| Shell/nav | `src/components/AppShell.tsx`, `src/routes/__root.tsx` |
| Design tokens/base CSS | `src/styles.css` |
| Dialog/sheet primitives | `src/components/ui/dialog.tsx`, `src/components/ui/drawer.tsx` (unused), `src/components/ui/sonner.tsx` |
| Dense screens | `src/routes/routines.tsx`, `src/routes/index.tsx`, `src/routes/habits.tsx`, `src/routes/goals.tsx`, `src/routes/history.tsx` |
| Forms | `src/components/ui/input.tsx`, `src/routes/auth.tsx`, `src/components/ExamScheduleDialog.tsx`, `src/components/WeeklyReviewView.tsx` |
| Platform helpers (new) | `src/hooks/use-platform.ts`, `src/components/InstallGuideDialog.tsx` |
