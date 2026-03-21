# Token Tracker Dashboard — Quality Audit Report

**Date:** 2026-03-19
**Scope:** Dashboard UI components (`dashboard/src/ui/`)
**Files Audited:** 12 core components + config files
**Methodology:** Static analysis across accessibility, anti-patterns, performance, responsive design

---

## Anti-Patterns Verdict: FAIL

**Would a designer say "AI made this?" — Yes, immediately.**

| Tell | Evidence |
|------|----------|
| Hero metric template | `UsageOverview.jsx:111-148` — big centered number, small label, colored cost below |
| Card-everything pattern | `rounded-xl border border-oai-gray-200 dark:border-oai-gray-800 bg-white dark:bg-oai-gray-900` repeated in 9+ files |
| Uniform `gap-4` spacing | Every container uses `gap-4` — zero spatial rhythm variation |
| Staggered FadeIn on every section | `FadeIn delay={0.1}` through `delay={0.5}` — animation for animation's sake |
| System font stack called "design system" | `-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif` |
| Near-pure black/white | `#0a0a0a` / `#fafafa` — technically not `#000` but functionally identical |
| Identical heading treatment | Every `<h3>` uses same class string — no hierarchy |

---

## Executive Summary

| Severity | A11y | Anti-Pattern | Performance | Responsive | **Total** |
|----------|------|-------------|-------------|------------|-----------|
| Critical | 8 | 0 | 0 | 0 | **8** |
| High | 8 | 4 | 4 | 5 | **21** |
| Medium | 9 | 9 | 3 | 4 | **25** |
| Low | 4 | 2 | 2 | 1 | **9** |
| **Total** | **29** | **15** | **9** | **10** | **63** |

**Most critical issues (top 5):**

1. **Dark mode text contrast failures** — `text-oai-gray-400`/`text-oai-gray-500` on dark backgrounds fail WCAG 4.5:1 in 20+ locations
2. **Tab groups missing ARIA** — Period tabs and Daily/Projects tabs have no `role="tab"`, `aria-selected`, or keyboard navigation
3. **Toggle button missing switch ARIA** — Public/private toggle has no `role="switch"` or `aria-checked`
4. **Provider cards missing expanded state** — Expandable buttons lack `aria-expanded`, `aria-controls`
5. **Touch targets too small** — Cost "?" button is 20x20px, toggle is 28x16px (need 44x44px)

---

## Detailed Findings

### CRITICAL Issues (8)

#### C1. Dark mode text contrast failures — 20+ locations
- **Files:** `StatsPanel.jsx`, `TrendMonitor.jsx`, `ActivityHeatmap.jsx`, `DataDetails.jsx`, `DashboardView.jsx`, `UsageOverview.jsx`
- **WCAG:** 1.4.3 Contrast (Minimum) — Level AA
- **Issue:** `text-oai-gray-400` (~oklch 70%) and `text-oai-gray-500` (~oklch 55%) on dark backgrounds (`oklch 12-25%`) yield ~3.2:1 to 4.2:1 contrast ratio. Below the 4.5:1 minimum for normal text. Worst at `text-[10px]` sizes in StatsPanel and ActivityHeatmap.
- **Impact:** Low-vision users cannot read labels, captions, and secondary text in dark mode.
- **Fix:** Use `dark:text-oai-gray-300` (oklch 83%+) for small text on dark backgrounds.
- **Command:** `/harden` — improve resilience through better contrast

#### C2. Period tabs missing ARIA tab pattern
- **File:** `UsageOverview.jsx:88-102`
- **WCAG:** 4.1.2 Name, Role, Value — Level A
- **Issue:** Tab buttons have no `role="tablist"`, `role="tab"`, `aria-selected`, or arrow-key navigation.
- **Impact:** Screen readers see unrelated buttons, not a tab interface. Keyboard users can't navigate with arrow keys.
- **Fix:** Add `role="tablist"` container, `role="tab"` + `aria-selected` + `tabIndex` on buttons.
- **Command:** `/harden`

#### C3. Daily/Projects tabs missing ARIA tab pattern
- **File:** `DataDetails.jsx:41-63`
- **WCAG:** 4.1.2 Name, Role, Value — Level A
- **Issue:** Same as C2 — no tab semantics.
- **Impact:** Same as C2.
- **Fix:** Same pattern as C2.
- **Command:** `/harden`

#### C4. Project limit select missing label
- **File:** `DataDetails.jsx:66-74`
- **WCAG:** 1.3.1 Info and Relationships — Level A
- **Issue:** `<select>` has no `<label>`, `aria-label`, or `aria-labelledby`.
- **Impact:** Screen readers announce "combobox" with no description.
- **Fix:** Add `aria-label="Number of projects to display"`.
- **Command:** `/harden`

#### C5. Public/private toggle missing switch ARIA
- **File:** `DashboardView.jsx:165-180`
- **WCAG:** 4.1.2 Name, Role, Value — Level A
- **Issue:** Toggle button has no `role="switch"`, `aria-checked`, or accessible label.
- **Impact:** Screen readers announce unlabeled button. No indication of on/off state.
- **Fix:** Add `role="switch"` `aria-checked={publicViewEnabled}` `aria-label="Public view"`.
- **Command:** `/harden`

#### C6. Provider cards missing expanded state
- **File:** `UsageOverview.jsx:178-200`
- **WCAG:** 4.1.2 Name, Role, Value — Level A
- **Issue:** Expandable provider buttons have no `aria-expanded`, `aria-controls`, or descriptive `aria-label`.
- **Impact:** Screen reader users don't know these are expandable or what state they're in.
- **Fix:** Add `aria-expanded={isExpanded}` `aria-controls={...}` `aria-label="..."`.
- **Command:** `/harden`

#### C7. Refresh button uses inaccessible Unicode
- **File:** `UsageOverview.jsx:39-57`
- **WCAG:** 4.1.2 Name, Role, Value — Level A
- **Issue:** `↻` Unicode character read inconsistently by screen readers. No `aria-label`.
- **Fix:** Add `aria-label="Refresh data"`. Mark icon `aria-hidden="true"`.
- **Command:** `/harden`

#### C8. ThemeToggle missing aria-label
- **File:** `ThemeToggle.jsx:83-144`
- **WCAG:** 4.1.2 Name, Role, Value — Level A
- **Issue:** Has `title` (Chinese) but no `aria-label`. SVG icons not `aria-hidden`.
- **Impact:** Screen readers attempt to read SVG paths as text.
- **Fix:** Add `aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}`.
- **Command:** `/harden`

---

### HIGH Issues (21)

#### A11y High (8)

| # | Issue | File:Line | WCAG | Fix |
|---|-------|-----------|------|-----|
| H1 | Provider distribution bar no accessible label | `UsageOverview.jsx:154` | 1.1.1 | Add `role="img"` + `aria-label` with provider percentages |
| H2 | Trend bar chart no accessible alternative | `TrendMonitor.jsx:64-93` | 1.1.1 | Add `role="img"` + `aria-label` summary, or hidden text table |
| H3 | Heatmap no accessible data representation | `ActivityHeatmap.jsx:219-243` | 1.1.1, 1.3.1 | Add `role="grid"`/`role="gridcell"` + `aria-label` per cell |
| H4 | Shell logo SVG missing accessible text | `Shell.jsx:12` | 1.1.1 | Add `aria-hidden="true"` (adjacent text serves as label) |
| H5 | ThemeToggle SVGs missing accessible names | `ThemeToggle.jsx:43-78` | 1.1.1 | Add `aria-hidden="true"` to both SVGs |
| H6 | Project links missing descriptive names | `DataDetails.jsx:82` | 2.4.4 | Add `aria-label` with project name + token count |
| H7 | Light mode `text-oai-gray-500` contrast ~4.2:1 | Multiple | 1.4.3 | Use `text-oai-gray-600` for small text on light bg |
| H8 | Light mode `text-oai-gray-400` contrast ~3.2:1 | Multiple | 1.4.3 | Replace with `text-oai-gray-500` minimum on light bg |

#### Anti-Pattern High (4)

| # | Issue | File:Line | Impact |
|---|-------|-----------|--------|
| H9 | Near-pure black `#0a0a0a` / white `#fafafa` | `styles.css:13-14` | Harsh contrast, halation in dark mode |
| H10 | Everything wrapped in cards (9+ files) | `Card.jsx:14` + 9 components | Visual monotony — every section identical |
| H11 | Hero metric template (big centered number) | `UsageOverview.jsx:111` | Most recognizable AI dashboard pattern |
| H12 | Uniform `gap-4` everywhere | `DashboardView.jsx:113` | Zero spatial rhythm |

#### Performance High (4)

| # | Issue | File:Line | Impact |
|---|-------|-----------|--------|
| H13 | `width` animation on provider bar | `UsageOverview.jsx:158` | Layout thrash — most expensive animation type |
| H14 | Missing `React.memo` on DashboardView | `DashboardView.jsx:11` | 80+ props cause full tree re-render on any state change |
| H15 | `TrendBar` not memoized | `TrendMonitor.jsx:56` | 30+ motion components recreated each render |
| H16 | `activityHeatmapBlock` not useMemo'd | `DashboardPage.jsx:922` | Expensive heatmap re-renders unnecessarily |

#### Responsive High (5)

| # | Issue | File:Line | Impact |
|---|-------|-----------|--------|
| H17 | Cost "?" button 20x20px | `UsageOverview.jsx:137` | Untappable on mobile (need 44px) |
| H18 | Toggle 28x16px | `DashboardView.jsx:165` | Untappable on mobile |
| H19 | Heatmap cells 12x12px | `ActivityHeatmap.jsx:229` | Untappable, hover tooltip useless on touch |
| H20 | Table no mobile layout (6 cols) | `DataDetails.jsx:119` | Horizontal scroll on 320px viewport |
| H21 | Heatmap 750px fixed width | `ActivityHeatmap.jsx:157` | Page-level horizontal scroll on mobile |

---

### MEDIUM Issues (25)

#### A11y Medium (9)

| # | Issue | File:Line | Fix |
|---|-------|-----------|-----|
| M1 | Heading hierarchy gap (no h1, jumps to h3) | `Shell.jsx`, `Card.jsx:18` | Add page `<h1>`, make Card accept `headingLevel` prop |
| M2 | Card always renders h3 regardless of context | `Card.jsx:18` | Accept `headingLevel` prop |
| M3 | Data table missing `<caption>` | `DataDetails.jsx:120` | Add `<caption className="sr-only">` |
| M4 | Expanded provider details missing region role | `UsageOverview.jsx:206` | Add `role="region"` + `aria-label` |
| M5 | Empty states not in live regions | `TrendMonitor.jsx:152`, `ActivityHeatmap.jsx:150` | Wrap in `role="status"` `aria-live="polite"` |
| M6 | Cost button label too generic "Cost info" | `UsageOverview.jsx:137` | Change to "View cost analysis breakdown" |
| M7 | motion.button missing explicit type="button" | `DashboardView.jsx:190` | Add `type="button"` |
| M8 | Heatmap legend not semantically grouped | `ActivityHeatmap.jsx:250` | Wrap in `role="img"` with label |
| M9 | Modal focus trap reliability untested | `CostAnalysisModal.jsx:54` | Manual keyboard testing needed |

#### Anti-Pattern Medium (9)

| # | Issue | File:Line | Fix |
|---|-------|-----------|-----|
| M10 | System default font stack | `styles.css:69` | Pick a distinctive typeface |
| M11 | Emerald monochrome = subtle AI palette | `styles.css:32-46` | Introduce unexpected accent color |
| M12 | Everything centered | `UsageOverview.jsx:111` | Use left-aligned asymmetric layouts |
| M13 | Glassmorphism (`backdrop-blur`) | `CostAnalysisModal.jsx:62`, 3 others | Remove or reduce blur |
| M14 | Sparklines as decoration | `Sparkline.jsx:5-47` | Remove or make interactive |
| M15 | Glow text for "impact" | `CostAnalysisModal.jsx:73` | Remove inline textShadow |
| M16 | Staggered FadeIn on every section | `DashboardView.jsx` | Reduce to 1-2 strategic moments |
| M17 | Identical heading treatment everywhere | `TrendMonitor.jsx:119`, 3 others | Create heading hierarchy |
| M18 | Neon green Matrix aesthetic | `LandingView.jsx`, `Sparkline.jsx` | Soften or contextualize |

#### Performance Medium (3)

| # | Issue | File:Line | Fix |
|---|-------|-----------|-----|
| M19 | `transition-all duration-500` too broad | `UsageOverview.jsx:248` | Scope to `transition-[width,opacity]` |
| M20 | Modal backdrop blur persists during close | `CostAnalysisModal.jsx:61` | Conditionally apply blur |
| M21 | Barrel import pulls unused components | `DashboardView.jsx:3` | Use direct imports |

#### Responsive Medium (4)

| # | Issue | File:Line | Fix |
|---|-------|-----------|-----|
| M22 | Refresh button ~32px (needs 44px) | `UsageOverview.jsx:43` | Increase to `w-10 h-10` |
| M23 | No tablet breakpoint (mobile → lg only) | `DashboardView.jsx:113` | Add `md:grid-cols-12` |
| M24 | Counter text overflow on narrow screens | `UsageOverview.jsx:113` | Use `text-4xl sm:text-5xl md:text-6xl` |
| M25 | Provider cards min-w causes mobile overflow | `UsageOverview.jsx:181` | Reduce to `min-w-[100px] sm:min-w-[140px]` |

---

### LOW Issues (9)

| # | Category | Issue | File:Line | Command |
|---|----------|-------|-----------|---------|
| L1 | A11y | Color-only distinction in provider bar | `UsageOverview.jsx:154` | `/colorize` |
| L2 | A11y | Distribution bar animation ignores reduced-motion | `UsageOverview.jsx:158` | `/harden` |
| L3 | A11y | Custom buttons missing focus ring styles | `UsageOverview.jsx`, `DataDetails.jsx` | `/harden` |
| L4 | A11y | Card lacks `aria-labelledby` with title | `Card.jsx:6` | `/harden` |
| L5 | Anti | Cards nested inside cards (provider buttons) | `UsageOverview.jsx:178` | `/distill` |
| L6 | Anti | Generic hover-lift shadow utility | `styles.css:556` | `/normalize` |
| L7 | Perf | Missing `will-change` on animated elements | `FadeIn.jsx:19` | `/optimize` |
| L8 | Perf | Barrel import hygiene | `DashboardView.jsx:3` | `/optimize` |
| L9 | Responsive | 4-col rolling stats no responsive variant | `StatsPanel.jsx:72` | `/adapt` |

---

## Patterns & Systemic Issues

### 1. Contrast debt (20+ locations)
`text-oai-gray-400` and `text-oai-gray-500` are used as "muted" text everywhere but fail WCAG AA in both light and dark modes. This is a systemic palette issue, not a per-component fix. The design tokens need adjustment.

### 2. Card-everything pattern (9+ components)
The `Card` component is the universal layout primitive. Every section: `<Card><Header/><Body/></Card>`. This creates visual monotony where every data section looks identical. Sections with different importance levels should use different containers.

### 3. Missing ARIA on all custom interactive patterns (6+ components)
Tab groups, toggle switches, expandable sections, and charts all lack proper ARIA. The codebase uses semantic HTML elements (`<button>`, `<select>`) correctly, but the interactive *patterns* built on top of them (tabs, switches, accordions) have no ARIA glue.

### 4. No mobile adaptation (5+ components)
The dashboard assumes desktop viewport. Tables, heatmaps, provider cards, and touch targets all break on mobile. There is no mobile-specific layout — only the single-column fallback from the `lg:` breakpoint.

### 5. Uniform spacing (`gap-4` everywhere)
Every container uses `gap-4` (16px). There is no spatial rhythm — tight groupings within sections, generous separations between sections. The result feels flat and undifferentiated.

---

## Positive Findings

| What's Good | Where |
|-------------|-------|
| Semantic HTML foundation | `<button>`, `<select>`, `<table>`, `<main>`, `<header>` used correctly |
| `prefers-reduced-motion` respected | `useReducedMotion()` in TrendBar, FadeIn, ThemeToggle |
| Dark mode support via CSS variables | Full light/dark theme with `dark:` variants |
| OKLCH color system | Perceptually uniform palette (good foundation, needs contrast fix) |
| Tree-shakeable component structure | Individual component files, not monolithic |
| Animated Counter component | Sophisticated digit animation — distinctive and functional |
| Empty states exist | "No data yet" messages in TrendMonitor, ActivityHeatmap, DataDetails |
| Table has sortable columns | Proper `aria-sort` attributes on table headers |
| `tabular-nums` on numbers | Prevents layout shift from digit width variation |

---

## Recommendations by Priority

### Immediate (Critical WCAG A violations)
1. Fix all dark mode contrast failures — change `text-oai-gray-400`/`500` to `text-oai-gray-300` in dark mode (20+ locations)
2. Add ARIA tab pattern to UsageOverview period tabs and DataDetails tab switcher
3. Add `aria-label` to the project limit `<select>`
4. Add `role="switch"` `aria-checked` to public/private toggle
5. Add `aria-expanded` `aria-controls` to provider expandable cards
6. Add `aria-label` to refresh button and ThemeToggle

**Commands:** `/harden` (batch — ARIA + contrast fixes)

### Short-term (High usability impact)
7. Fix touch targets: cost button, toggle, heatmap cells → 44x44px minimum
8. Add mobile table layout (card-per-row for DataDetails)
9. Add tablet breakpoint (`md:grid-cols-12`)
10. Replace `width` animation with `scaleX` on provider bar
11. Add `React.memo` to DashboardView and TrendBar

**Commands:** `/adapt` (responsive), `/optimize` (performance), `/harden` (touch targets)

### Medium-term (Quality improvements)
12. Break card-everything pattern — use different containers for different section types
13. Introduce spatial rhythm (varied gap sizes instead of uniform `gap-4`)
14. Reduce staggered FadeIn to 1-2 strategic moments
15. Pick a distinctive typeface instead of system defaults
16. Introduce an unexpected accent color to break emerald monochrome
17. Add heading hierarchy (h1 → h2 → h3)

**Commands:** `/distill` (layout simplification), `/normalize` (design system alignment), `/colorize` (palette enrichment)

### Long-term (Polish & delight)
18. Remove glassmorphism from modals
19. Make sparklines interactive or remove them
20. Add `aria-label` to chart/heatmap components with text alternatives
21. Create a mobile-first responsive strategy

**Commands:** `/polish` (final quality pass), `/delight` (memorable touches), `/critique` (UX evaluation)

---

## Suggested Commands Summary

| Command | Addresses | Issue Count |
|---------|-----------|-------------|
| `/harden` | ARIA, contrast, touch targets, resilience | ~25 issues |
| `/adapt` | Responsive design, mobile layouts | ~10 issues |
| `/optimize` | Performance, memoization, animations | ~9 issues |
| `/distill` | Card-everything pattern, layout simplification | ~5 issues |
| `/normalize` | Design system tokens, heading hierarchy | ~5 issues |
| `/colorize` | Palette enrichment, contrast fixes | ~3 issues |
| `/polish` | Final quality pass, focus indicators | ~3 issues |
| `/delight` | Remove generic patterns, add personality | ~2 issues |
| `/critique` | UX evaluation of simplified layout | 1 issue |

---

*Report generated by systematic code analysis. All line numbers reference the current HEAD state.*
*63 total issues: 8 Critical, 21 High, 25 Medium, 9 Low.*
