# KIT•10 — Implementation Milestone Checklist

This document tracks the migration from prototype code to a fully manager-integrated editor, aligned with the [CONCEPTS.md](../CONCEPTS.md) model.

---

## M1: Schema Expansion

The `DB2026_04_21` schema needs columns and tables to support the full concept model.

### [x] M1.1 — Expand `axes` table

Currently `axes` has only `id` + `project_id`. It needs shape:

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` PK | existing |
| `project_id` | `uuid` FK → projects.id | existing |
| `name` | `text` | e.g. "Dark Mode", "Density" |
| `description` | `text` | human-readable |
| `category` | `text` | `'Static'` or `'Dynamic'` |
| `kind` | `text` | `'categorical'`, `'numeric'`, `'ranged'` |
| `default_value` | `jsonb` | default axis value |

### [x] M1.2 — Create `axis_variants` table

Variant definitions move from hardcoded `axesBuiltIn.ts` into the DB.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` PK | |
| `axis_id` | `uuid` FK → axes.id, CASCADE | |
| `name` | `text` | e.g. "Light", "Hover" |
| `slug` | `text` | machine-friendly key |
| `tooltip` | `text` | |
| `priority` | `integer` | ordering within the axis |

### [x] M1.3 — Create `layers` table

Replaces in-memory `StyleSource[]` in `cascadeAxesMap.ts`.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` PK | |
| `kit_id` | `uuid` FK → kits.id, CASCADE | which Kit owns this layer |
| `style` | `jsonb` | CSS property dict `{ padding: "1rem", ... }` |
| `last_modified` | `timestamptz` | |

### [x] M1.4 — Create `layer_axes` junction

Defines the AxesSet condition for each layer (the "selector").

| Column | Type | Notes |
|--------|------|-------|
| `layer_id` | `uuid` FK → layers.id, CASCADE | composite PK |
| `axis_id` | `uuid` FK → axes.id, RESTRICT | composite PK |
| `variant_id` | `uuid` FK → axis_variants.id, RESTRICT | the value it matches |

No axis in the condition = wildcard (any variant matches).

### M1.5 — Design `render_snippets` table

Currently typed `never`. This is the Render Token output shape — backend-opinionated output structures.

Shape TBD, but must encode at minimum:
- Which Kit owns it
- An output name (e.g. `"button--primary"`)
- A template or shape definition (JSON)
- A target format/backend identifier

### M1.6 — Design `axis_sets` table

Currently typed `never`. This is for grouping Axes into named sets (reusable axis combinations). TBD whether this is needed for v1 or can stay deferred.

---

## M2: Manager API — Mutation Layer

The manager `Api` interface needs full CRUD for all tables.

### [x] M2.1 — Axis CRUD

- `createAxis(projectId, name, description, category, kind, default_value)` → axis
- `renameAxis(axisId, newName)`
- `deleteAxis(axisId)`
- `createVariant(axisId, name, slug, tooltip, priority)` → variant
- `deleteVariant(variantId)`
- `getAxesByProjectId(projectId)` → query builder (axis + variants)
- `getAxesByKitId(kitId)` → query builder (via axes_consumed join)

### [x] M2.2 — Axes Consumed CRUD

- `consumeAxis(kitId, axisId)` → insert into `axes_consumed` with auto-priority
- `unconsumeAxis(kitId, axisId)` → delete from `axes_consumed`
- `reorderAxesInKit(kitId, axisId, newPriority)` → update priority_index
- `getConsumedAxesByKitId(kitId)` → query builder (join axes + variants)

### [x] M2.3 — Axis Args CRUD

- `setAxisArg(viewId, kitId, axisId, value)` → upsert into `axis_args`
- `getAxisArg(viewId, kitId, axisId)` → query builder
- `getAllAxisArgs(viewId, kitId)` → query builder

### [x] M2.4 — Layer CRUD

- `createLayer(kitId, style)` → layer
- `updateLayerStyle(layerId, style)`
- `deleteLayer(layerId)`
- `addAxisToLayer(layerId, axisId, variantId)` → insert into `layer_axes`
- `removeAxisFromLayer(layerId, axisId)` → delete from `layer_axes`
- `getLayersByKitId(kitId)` → query builder (layers + layer_axes + axis_variants)

### [x] M2.5 — Token CRUD (formalize)

Currently `Variables.svelte` writes directly via `dialect.insertInto('tokens')`. Formalize:

- `createToken(projectId, alias?, value?)` → token
- `updateTokenValue(tokenId, value)`
- `updateTokenAlias(tokenId, alias)`
- `deleteToken(tokenId)`
- `getTokensByProjectId(projectId)` → query builder

### [x] M2.6 — Kit management (formalize)

- `renameKit(kitId, newName)`
- `deleteKit(kitId)` — must check: no compositions reference it, or CASCADE compositions
- `getKitsByProjectId(projectId)` → query builder

### [x] M2.7 — View management (formalize)

- `renameView(viewId, newName)`
- `toggleViewLock(viewId, locked)`
- `toggleViewHide(viewId, hidden)`

---

## M3: Cascade Engine Rewrite

Replace `cascadeAxesMap.ts` with a manager-backed engine implementing the three-tier specificity model.

### M3.1 — Replace `calculateSpecificity`

Current: `axisCount * 100 + axisRankSum` (tiers overlap).

New: three non-overlapping tiers as defined in CONCEPTS.md:

```
specificity = (kit_priority × 10000) + (axis_count_in_layer × 100) + (max_axis_order_position)
```

- `kit_priority` from `compositions.priority_index`
- `axis_count_in_layer` = number of rows in `layer_axes` for that layer
- `max_axis_order_position` = highest `axes_consumed.priority_index` among axes in the layer condition

### M3.2 — Move `resolve()` to manager

The resolution function should query layers + layer_axes, calculate specificity per layer, sort, and merge styles. It must be a pure function of DB state.

- Input: `kitId`, `axisArgs: { axisId → variantId }`
- Output: `{ finalStyle, trace[] }` (same shape as current `CascadeResult`)

### M3.3 — Move `resolveMany()` to manager

Multi-kit resolution with kit precedence:

- Input: `viewId`
- Output: `{ finalStyle, trace[], crossOverrides[] }`

Algorithm:
1. Fetch kit composition for view (ordered by `priority_index` DESC)
2. For each kit, fetch consumed axes and axis args for this view
3. Resolve each kit via `resolve()` (M3.2)
4. Merge results: higher kit priority wins for conflicting properties

### M3.4 — Remove `cascadeAxesMap.ts`

After M3.2 and M3.3 are proven working, delete `src/lib/cascadeAxesMap.ts` and all its imports.

---

## M4: Frontend Migration

Wire the Svelte UI to manager queries and mutations.

### M4.1 — Axes panel (`panels/Axes.svelte` + `panels/Axis.svelte`)

- Replace `kitsPool[...].sets.axisRank` reads with `liveQuery(getConsumedAxesByKitId)`
- Replace `viewsPool[...].resolve[...].params` reads/writes with `getAllAxisArgs` / `setAxisArg`
- Render axis definitions from DB (name, description, variants) instead of `builtinAxes`
- Add axis creation/deletion UI (add axis to project, consume axis into kit)

### M4.2 — Styles panel (`panels/Styles.svelte` + `panels/StyleField.svelte`)

- Replace `cascadeAxesMap.resolve()` / `.trace()` calls with manager-backed resolution
- Replace in-memory style mutations (`layer.style[key] = ...`) with `updateLayerStyle()`
- Display trace data from manager resolution result

### M4.3 — Variables panel (`panels/Variables.svelte`)

- Replace `tokenLibraries` prop with `liveQuery(getTokensByProjectId)`
- Use formalized token CRUD from M2.5
- Remove legacy `colours.ts` / `colours.json` dependency

### M4.4 — Viewport rendering (`Component.svelte` + `Viewport.svelte`)

- Replace `kitsPool` / `viewsPool` prop drilling with `liveQuery` calls to manager
- `Component.svelte`: resolve styles via manager's `resolveMany()` per view
- Remove dependency on `Kit10ProjectEditor` legacy type

### [x] M4.5 — Delete legacy panel stubs

- Remove `panels/tokens.ts` (stale context menu defs)
- Remove `panels/views.ts` (stale helper functions)
- Remove `panels/axes.ts` (empty stub)
- Remove empty shell files: `Styles.svelte`, `Axes.svelte`, `Tools.svelte` in `editor/`

---

## M5: Editor Route Overhaul

### M5.1 — Replace mock data route

`src/routes/edit/[title]/+page.ts` currently has 615 lines of hardcoded `Kit10Project[]` objects.

Replace with a proper load function that queries the manager for the project by slug/ID, or redirects to workspace/project selection.

### M5.2 — Add `/edit` route functionality

Currently `edit/+page.svelte` and `edit/+page.ts` are empty. Implement a project picker or redirect to most recent project.

### M5.3 — Update Editor.svelte initialization

Remove dependency on `Kit10ProjectEditor` prop type. Editor should self-bootstrap from manager state using `editorActivity` (workspaceId, projectId, viewId, kitId) from reactive context.

### M5.4 — Delete `src/lib/types.ts`

After all consumers are migrated, remove the legacy `Kit10Project*` type definitions.

---

## M6: Render Token Output

### M6.1 — Define render snippet schema

Design the `render_snippets` table (see M1.5) to encode target-specific output shapes.

A render snippet should at minimum declare:
- Which CSS properties / tokens it emits
- What structure/component it maps to (e.g., a CSS class, a Svelte component, a JSON token blob)
- Target format hint (CSS, Tailwind, CSS-in-JS, Style Dictionary, etc.)

### M6.2 — Implement render snippet resolver

Given a resolved kit/view style, produce render snippets matching the selected backend.

### M6.3 — Add export formats

- CSS custom properties export
- Style Dictionary JSON export
- Tailwind config export (stretch)

---

## M7: Cleanup

### [x] M7.1 — Delete `src/lib/core/`

The entire directory is a stale, unused duplicate of `manager/`. Remove it.

### M7.2 — Remove `axesBuiltIn.ts`

After M4.1, axis definitions come from the DB. Remove `src/lib/axesBuiltIn.ts`.

### M7.3 — Remove legacy cascade files

After M3.4, remove `src/lib/cascadeAxesMap.ts`.

### M7.4 — Remove legacy token files

After M4.3, remove `src/lib/libraries/colours.ts` and `src/lib/libraries/colours.json`.

### M7.5 — Remove `src/routes/edit/[title]/+page.ts`

After M5.1, the hardcoded mock data file is dead.

---

## Dependency Order

```
M1 (schema) ──► M2 (API) ──► M3 (cascade) ──► M4 (frontend) ──► M5 (routes) ──► M6 (render) ──► M7 (cleanup)
                                        │
                                        └── M4.1, M4.2 depend on M3
                                        └── M4.3 depends on M2.5
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
