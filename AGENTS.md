# KIT•10 — Agent Instructions

## Project Overview

KIT•10 is a design system framework resolved by a three-tier specificity engine with scoped tokens. Design intent flows through:

```
Views ← Layers [Kits ← Axes] ← Tokens
            │         │          │
            │         │          └─ scoped: project > kit > view
            │         └─ consumed per-kit, ordered by priority
            └─ conditions match axis args; per-property override
```

## Key Constraints

### Style
- No em dashes (—) in UI copy or markdown files. Use hyphens or reword.
- No serif fonts in UI. Always use `@use '_index' as *;` and `@include fonts-stack('Satoshi-Light'|'Satoshi-Regular'|'Satoshi-Bold', sans)`. Satoshi font family: Regular, Medium, Bold, Light variants. No Satoshi Mono exists.
- Button text: `color: white` (not `var(--color-pure)`) on primary buttons to beat `impose-interactive` link color override.
- Landing page uses `<style global>` for theming; button classes need `#landing` nesting for specificity.
- Panel selection: use `class:selected={condition}` on list elements. No hidden `<input type="radio">` or `:has()` CSS selectors.

### Svelte 5
- `$effect` only tracks reactive reads on `$state`/`$derived`/`$bindable`. Destructured props are local copies and NOT tracked.
- No `|modifier` event syntax. Use `(e) => e.stopPropagation()` instead.
- `class directive` uses `class:name={expr}` syntax, not string concatenation.

### Data Layer
- PGlite with OPFS-AHP. `PGliteWorker.close()` must be called before creating a new instance.
- OPFS unavailable in Firefox incognito — fallback to `memory://`.
- `idb://` storage is prohibitively slow — never use it for PGlite.
- Manager API uses Kysely query builders. All panel data comes via `liveQuery()` from `Editor.svelte`.
- `getTokensByKitId(null)` / `getTokensByViewId(null)` return empty sets via impossible UUID (`00000000-...`).

### Resolution Engine
- Two-pass: Pass 1 resolves Layer specificity (tokens compete as opaque references), Pass 2 substitutes token values with scoped precedence (view > kit > project).
- Render entries: `value` XOR `token_id` — enforced by DB check constraint. Never both, never neither.
- Null Layers (zero axis conditions) always match — baseline defaults.
- Layer override is per-property, not per-Layer.
- Specificity: (1) axis_count, (2) compounded_axis_order, (3) kit_priority. Implemented as lexicographic comparison of `[count, ...priorityIndex]`.
- Range matching: ArgRange `min: null` = -∞, `max: null` = +∞. Overlap semantics, not equality.

### Testing
- Run `npx vitest run` from `manager/` to run all manager tests.
- Test DB uses PGlite in-memory via `createTestDb()`.

### Schema
- Single V1 migration at `manager/src/migrations/2026-04-21/index.ts`. No production migration files during iteration — fold changes into V1.
- `render_snippets` has `layer_id` unique constraint (one snippet per layer, currently).
- `tokens` have check constraint: exactly one of (kit_id, view_id) is non-null, or both null (project scope).

## File Map

- `manager/src/schema.ts` — TypeScript DB schema types
- `manager/src/api/index.ts` — query builder, CRUD API, scoped token queries
- `manager/src/resolve/resolve.ts` — resolve, resolveMany, matchesArg, gatherScopedTokens, substituteTokens
- `manager/src/migrations/2026-04-21/index.ts` — V1 migration
- `manager/src/seed.ts` — demo project seed with scoped tokens
- `manager/src/worker.ts` — PGlite worker with OPFS-AHP + memory fallback
- `src/lib/editor/Editor.svelte` — main editor, resolveMany, editorActivity state
- `src/lib/editor/Layout.svelte` — editor layout with theming
- `src/lib/editor/panels/` — all panel components (Views, Compose, Axes, Styles, Variables, Project, Plugins)
- `src/lib/components/Renameable.svelte` — inline edit with font inheritance
- `src/lib/components/DarkModeToggle.svelte` — 3-state theme toggle (dark/light/auto)
- `src/routes/+page.svelte` — landing page
- `src/routes/edit/+page.svelte` — editor route
- `CONCEPTS.md` — single source of truth for terminology and constraints
- `FAQ.md` — FAQ for the project
- `manager/MILESTONES.md` — implementation progress tracker