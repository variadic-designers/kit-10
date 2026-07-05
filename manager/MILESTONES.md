# KIT•10 — Implementation Milestone Checklist

This document tracks the migration from prototype code to a fully manager-integrated editor, aligned with the [CONCEPTS.md](../CONCEPTS.md) model.

---

## M1: Schema Expansion

The `DB2026_06_07` schema supports the full concept model via a single V1 migration.

### [x] M1.1 — Expand `axes` table

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` PK | |
| `project_id` | `uuid` FK → projects.id, RESTRICT | |
| `name` | `text` | e.g. "Dark Mode", "Density" |
| `description` | `text` | human-readable |
| `kind` | `text` | `'categorical'`, `'range'`, `'discrete'` |
| `hint` | `jsonb` | string array of suggested values |
| `default_value` | `jsonb` | default axis arg value |

### [x] M1.2 — Create `axis_values` table

Replaces the planned `axis_variants` table. Values are stored as typed jsonb supporting three shapes: literal, range, discrete.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` PK | |
| `axis_id` | `uuid` FK → axes.id, CASCADE | |
| `value` | `jsonb` | `{ type: 'literal' | 'range' | 'discrete', ... }` |

### [x] M1.3 — Create `layers` table

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` PK | |
| `kit_id` | `uuid` FK → kits.id, CASCADE | which Kit owns this layer |
| `last_modified` | `timestamptz` | |

No `style` column — properties live in `render_entries` via `render_snippets`.

### [x] M1.4 — Create `layer_axis_values` junction

Replaces the planned `layer_axes` junction. Links layers to `axis_values` (not axis_variants).

| Column | Type | Notes |
|--------|------|-------|
| `layer_id` | `uuid` FK → layers.id, CASCADE | composite PK |
| `axis_value_id` | `uuid` FK → axis_values.id, RESTRICT | composite PK |

No axis values in the condition = null layer (always matches).

### [x] M1.5 — `render_snippets` + `render_entries` tables

Render snippets point to layers (1:1 via unique constraint). Entries declare individual properties as either a literal value or a token reference (check constraint enforces mutual exclusivity).

**render_snippets:**

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` PK | |
| `layer_id` | `uuid` FK → layers.id, CASCADE, UNIQUE | one snippet per layer |
| `last_modified` | `timestamptz` | |

**render_entries:**

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` PK | |
| `snippet_id` | `uuid` FK → render_snippets.id, CASCADE | |
| `property` | `text` | e.g. "background", "padding" |
| `value` | `text` | literal value (nullable) |
| `token_id` | `uuid` FK → tokens.id, SET NULL | token reference (nullable) |

Check constraint: `(value IS NOT NULL) != (token_id IS NOT NULL)`

### [-] M1.6 — `axis_sets` table

Deferred. Axis args per view+kit handle per-instance parameterization. Named reusable axis sets are not needed for v1.

---

## M2: Manager API — Mutation Layer

Full CRUD for all entities plus scoped token queries.

### [x] M2.1 — Axis CRUD

- `createAxis`, `renameAxis`, `deleteAxis`
- `createAxisValue`, `deleteAxisValue`
- `getAxesByProjectId`, `getAxesByKitId`

### [x] M2.2 — Axes Consumed CRUD

- `consumeAxis`, `unconsumeAxis`, `reorderAxesInKit`
- `getConsumedAxesByKitId`

### [x] M2.3 — Axis Args CRUD

- `setAxisArg` (upsert), `getAllAxisArgs`

### [x] M2.4 — Layer CRUD

- `createLayer`, `deleteLayer`
- `addAxisValueToLayer`, `removeAxisValueFromLayer`
- `getLayersByKitId`

### [x] M2.5 — Render Snippet + Entry CRUD

- `createRenderSnippet`, `deleteRenderSnippet`
- `createRenderEntry`, `updateRenderEntryValue`, `deleteRenderEntry`
- `getRenderSnippetsByLayerId`, `getRenderEntriesBySnippetId`, `getRenderEntriesByLayerId`

### [x] M2.6 — Token CRUD (scoped)

- `createToken(projectId, alias?, value?, scope?)` — scope is `{ kitId }` or `{ viewId }` or project-level
- `updateTokenValue`, `updateTokenAlias`, `deleteToken`
- `getTokensByProjectId` (project-scoped only)
- `getTokensByKitId(kitId | null)` — null returns empty set via impossible UUID
- `getTokensByViewId(viewId | null)` — null returns empty set via impossible UUID

### [x] M2.7 — Kit management

- `renameKit`, `deleteKit`, `getKitsByProjectId`

### [x] M2.8 — View management

- `renameView`, `toggleViewLock`, `toggleViewHide`
- `createViewInProject`, `deleteView`
- `getViewsByProjectId`

### [x] M2.9 — Composition management

- `attachKitToComposition`, `detachKitFromComposition`
- `getKitCompositionByViewId`, `getKitsExceptFromViewId`

### [x] M2.10 — Workspace & Project management

- `createWorkspace`, `renameWorkspace`, `deleteWorkspace`
- `createProjectInWorkspace`, `renameProject`, `deleteProject`
- `exportProject`

---

## M3: Cascade Engine Rewrite

Replaced `cascadeAxesMap.ts` with a manager-backed engine implementing the three-tier specificity model.

### [x] M3.1 — Specificity model

Three-tier, non-overlapping: `(kit_priority, axis_count, compounded_axis_order)`.
Implemented as lexicographic comparison of `[count, ...priorityIndex]` arrays.
Higher tiers always win regardless of lower-tier values.

### [x] M3.2 — `resolve()`

Pure function of DB state. Queries layers + conditions + entries, calculates specificity per layer, filters by axis arg matching, sorts by specificity, merges per-property overrides.

- Input: `db, kitId, axisArgs`
- Output: `Map<string, ResolvedProperty>` with `value`, `sourceLayerId`, `isToken`, `tokenAlias`

### [x] M3.3 — `resolveMany()`

Multi-kit resolution with kit precedence. Gathers axis args per kit, resolves each, then runs token substitution (Pass 2).

- Input: `db, viewId`
- Output: `ResolvedKit[]` with `kitId`, `kitName`, `properties`, `childViewIds`

Supporting functions: `gatherScopedTokens()` (project > kit > view precedence), `substituteTokens()`, `flattenKitResults()`, `matchesArg()` (interval overlap semantics for ranges).

### [x] M3.4 — Remove `cascadeAxesMap.ts`

Deleted. No imports remain.

---

## M4: Frontend Migration

All panels wired to manager via `liveQuery`. No legacy prop drilling.

### [x] M4.1 — Axes panel

`Axes.svelte` + `Axis.svelte` use `liveQuery(getConsumedAxesByKitId)` and `getAllAxisArgs` / `setAxisArg`. Axis definitions rendered from DB. Axis creation/deletion/attach UI present.

### [x] M4.2 — Styles (Render) panel

`Styles.svelte` + `StyleField.svelte` display resolved properties passed in from the editor's live-query loop. Per-property trace data shown. No in-memory style mutations.

### [x] M4.3 — Variables (Tokens) panel

`Variables.svelte` uses `liveQuery(getTokensByProjectId/getTokensByKitId/getTokensByViewId)` with three scope sections. Token CRUD via formalized API. Inline rename, context menu, scoped color icons.

### [x] M4.4 — Editor resolution pipeline

`Editor.svelte` calls `resolveManyViews()` reactively via a single live-query loop. No `kitsPool`/`viewsPool`/`ComponentFlat`/`ComponentView` prop drilling. No `Component.svelte` or `Viewport.svelte`.

### [x] M4.5 — Delete legacy panel stubs

Removed: `tokens.ts`, `views.ts`, `axes.ts` stubs, old `Axes.svelte`, `Component.svelte`, `Viewport.svelte`, `[title]` route, `libraries/colours.ts` + `colours.json`.

### [x] M4.6 — Selection standardization

All panels use `class:selected={condition}` on list items. No hidden `<input type="radio">` or `:has()` CSS selectors. Consistent pattern: `.selected { background: var(--color-surface-alt); color: var(--color-primary); &:hover color: var(--color-primary-hover); }`

---

## M5: Editor Route Overhaul

### [x] M5.1 — Route restructuring

- `/` = landing page (was `/landing`)
- `/edit` = editor (was `/edit/[title]`)
- Deleted `/landing` route and `+page.server.ts` redirect

### [x] M5.2 — Landing page

Hero with Satoshi fonts, theme toggle (DarkModeToggle), favicon SVG glyph, about section with 3 feature cards, donate CTA, sticky nav. Theming via `theming-declare-schemes-basic()` with `<style global>` and `data-compel-color-scheme`.

### [x] M5.3 — Editor initialization

`Editor.svelte` self-bootstraps from manager state via `editorActivity`. No `Kit10ProjectEditor` prop dependency. `selectWorkspace` early-returns if workspace already selected.

### [x] M5.4 — Delete `src/lib/types.ts`

Legacy `ComponentFlat`, `ComponentView`, `Token`, `TokenLibrary`, `Kit10ProjectTokens`, `Kit10ProjectCore`, `Kit10Project`, `Kit10ProjectEditor` types removed.

---

## M6: Render Token Output

### M6.1 — Expand render snippet schema

Current `render_snippets` is a 1:1 mapping to layers with no output metadata. Needs:

- `name` column — output name (e.g. `"button--primary"`)
- `target_format` column — format identifier (e.g. `"css"`, `"tailwind"`)
- Relax `one_snippet_per_layer` unique constraint to `one_snippet_per_layer_format` on `(layer_id, target_format)` so a layer can produce output in multiple formats

### M6.2 — Render snippet resolver

Given resolved properties from `resolveMany()`, produce structured output matching a target format.

### M6.3 — Export formats

- CSS custom properties export
- Style Dictionary JSON export
- Tailwind config export (stretch)

---

## M7: Cleanup

### [x] M7.1 — Delete `src/lib/core/`

Removed entirely.

### [x] M7.2 — Remove `axesBuiltIn.ts`

Deleted. Axis definitions come from DB.

### [x] M7.3 — Remove legacy cascade files

`cascadeAxesMap.ts` deleted.

### [x] M7.4 — Remove legacy token files

`colours.ts` and `colours.json` deleted.

### [x] M7.5 — Remove `src/routes/edit/[title]/+page.ts`

Deleted. Route restructured to `/edit`.

---

## Dependency Order

```
M1 (schema) ──► M2 (API) ──► M3 (cascade) ──► M4 (frontend) ──► M5 (routes) ──► M6 (render) ──► M7 (cleanup)
                                        │
                                        └── M4.1, M4.2 depend on M3
                                        └── M4.3 depends on M2.6
                                        └── M4.4 depends on M3
                                        └── M5 depends on M4
```

M1 and M2 can partially overlap (write API as schema stabilizes).
M4 panels can be migrated in parallel once their respective M2 + M3 deps are done.
M7 can happen incrementally as each legacy artifact's replacement goes live.

---

## Status Key

| Symbol | Meaning |
|--------|---------|
| `[ ]` | Not started |
| `[~]` | In progress |
| `[x]` | Done |
| `[-]` | Deferred / blocked |