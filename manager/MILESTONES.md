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

## M8: Vellum Renderer

Integrated the Rust/WASM GPU renderer into the editor viewport.

### [x] M8.1 — Vellum WASM build + initialization

Compiled with `wasm-pack --target web --no-default-features --no-opt`. Loaded dynamically at editor startup with a canvas-size guard (Firefox zero-size workaround). `--no-default-features` required to gate out the `standalone` winit/pollster feature that strips `#[wasm_bindgen]` exports.

### [x] M8.2 — Render loop, pan/zoom, resize

`requestAnimationFrame` loop starts only after data arrives. `ResizeObserver` re-initializes the renderer on layout changes. Pointer and wheel events drive pan, zoom, and selection via the Vellum API.

### [x] M8.3 — Theme-aware colors

`vellum.set_colors()` called on mount and on theme changes. Grid and background colors adapt to dark/light/auto.

### [x] M8.4 — Text-responsive layout

Text nodes emitted by Charter with `width:0, height:0`. Vellum measures text during the taffy layout pass using cosmic-text constrained by parent available space. Host does not pre-patch text dimensions.

### [x] M8.5 — Flexbox: alignment, wrap, grow/shrink, margin

`BoxExtra` gained `align_items`/`justify_content`/`flex_wrap` (container), `flex_grow`/`flex_shrink`/`align_self` (item), and uniform `margin` — mapped 1:1 onto taffy's `Style` (taffy already implemented all of it; the gap was purely the wire schema + Charter's property mapping). `Option`-typed fields mean "leave taffy's own default" when unset, verified with unit tests against the real `Style` struct. Charter maps these from kit properties of the same CSS name. Auto-margin centering deliberately not exposed — `align-items`/`justify-content` on the parent is the more direct modern equivalent.

### [ ] M8.6 — Percentage-based sizing

`width`/`height`/`padding`/`margin` are `parse_px`-only today — percentages, `auto`, `em` all silently become `0.0`. Needs a real dimension type (not a bare `f32`) through the wire format, Charter's property parsing, and `apply_box_extra`/`node_style`.

### [ ] M8.7 — min/max width and height

`max_width`/`max_height` already exist on `UiNode` (`0.0` = no constraint) but Charter hardcodes them to `0.0` always — never reads a kit property into them. `min_width`/`min_height` don't exist in the wire format at all yet. Needs: wire fields for min, Charter mapping for both min and max (`min-width`, `min-height`, `max-width`, `max-height`), and taffy `Style.min_size`/`max_size` wiring in `apply_box_extra`/`node_style`.

### [ ] M8.8 — Overflow / clipping

No overflow or scroll semantics. Content can currently render outside a box's own bounds with no way to clip it.

### [ ] M8.9 — Real absolute positioning

`CharterHints.position` exists but is explicitly vestigial/ignored (see Charter section above) — a leftover from the old absolute-positioning architecture. Needs a real `position: "relative" | "absolute"` + `inset`/`top`/`left`/`right`/`bottom` on `BoxExtra`, mapped to taffy's `Style.position`/`inset`.

### [ ] M8.10 — Box shadow exposed through Charter

Vellum's renderer already supports shadows end-to-end (`BoxShadow`, blur/spread/inset — used today for the disabled-state glow and selection overlay), but Charter hardcodes `shadow: None` at both `BoxData` construction sites and never reads a `box-shadow`-style kit property. Unlike M8.6–M8.9 this isn't a taffy/renderer gap — the renderer-side plumbing exists; only Charter's property mapping is missing.

---

## M9: Plugin System

Charter WASM plugin and Plugin Manager infrastructure.

### [x] M9.1 — Plugin Manager serial queue

All plugin calls (`on_resolve`, `on_selection_change`, `on_field_update`) chained on `pluginQueue` to prevent concurrent calls into the non-reentrant Extism worker.

### [x] M9.2 — Debounce + generation guard

`setData` increments `selectionGen` and debounces `runResolve`. `setSelection` captures `selectionGen` at enqueue time; if `setData` fires before execution, the captured generation won't match and `runSelectionChange` is skipped. Prevents stale selection results from overwriting a concurrent resolve.

### [x] M9.3 — Charter plugin

Charter translates resolved kit data into a flat `UiNode[]` render tree. `on_resolve` stores `last_resolve_input` in Extism var storage. `on_selection_change` patches the three selection fields and re-runs `build_viewport` without a full re-resolve round-trip.

### [x] M9.4 — Host functions

`kit10_log`, `kit10_kv_get`, `kit10_kv_set`, `kit10_get_resolution`, `kit10_write_render_entry_to_layer`, `kit10_resolve_view`.

### [x] M9.5 — resolveManyViews

4-round-trip resolution for all project views, replacing the per-view `resolveMany` O(views) approach. Fingerprint comparison (`kitFingerprint`) skips Svelte re-renders when resolved data didn't change.

### [x] M9.6 — Field editing

`StyleField.confirmUpdateStyle`/`confirmSuggestionPick` call `onFieldUpdate`, wired in `Editor.svelte` to `pluginManager.fieldUpdate` → `on_field_update` → `kit10_write_render_entry_to_layer`. No longer a stub.

---

## M10: Selection & Interaction UX

Selection previously only flowed one direction (Views panel click → Charter `on_selection_change` → Vellum draws an outline), and two things in that path were broken/missing.

### [x] M10.1 — Text & nested-view selection fix

Charter's `TextData` had no `selected` field (unlike `BoxData`), so a view whose top-level primitive was Text never got marked selected — even though Vellum's `UiNode::Text` already supported `selected` and would render the outline correctly if Charter set it. Same root cause silently dropped selection for a child-only view that happened to be the active view: the recursive `render_view_nodes` call always passed a hardcoded `selection: 0` for child views instead of checking whether that child's own `view_id` matched the active/primary/secondary selection. Both are fixed via a shared `compute_selection(view_id, ctx)` helper, reused for both top-level views and recursion. No Vellum/wasm rebuild was needed for this half — `UiNode::Text`/`UiNode::Img` already carried `selected: u8`.

### [x] M10.2 — Click-to-select in the viewport

Vellum already exported a hit-test (`get_selection(x, y) -> Option<usize>`), but nothing called it — `Viewport.svelte` had no click handler. Now wired up: `LayoutRect` gained a real `index` field (set from the original `&[UiNode]` position during tree traversal) so `hit_test`'s returned index is guaranteed to match the array `set_data` was given, not just coincide with it (traversal/append order and array order aren't the same thing — a unit test proves this with a deliberately reversed parent/child array order). Charter returns a parallel `node_view_ids` side-map (`OnResolveResult`/`OnSelectionChangeResult`, same length/order as `viewport_data`) rather than tagging `UiNode` itself with view identity — view id has no rendering relevance, so it never crosses into the wire format Vellum deserializes; Vellum stays unaware of what a "view" is altogether. A shared `selectView`/`deselectView` helper (`src/lib/editor/selection.ts`) keeps the Views panel and the Viewport's click handler from drifting apart; clicking empty canvas deselects, same as the existing "Deselect" context-menu action. Shift-click / multi-select into `selectedViewSecondary` is out of scope — nothing populates that today from any UI.

### [x] M10.3 — Hover highlight border

New `hovered: bool` wire field on every `UiNode` variant, independent from `selected` (a view can be hovered while a different view stays selected) — rendered as a separate, thinner overlay with no corner handles (handles are a selection-specific affordance). Charter's `on_selection_change` payload gained a `hovered_view_id`, patched into `last_resolve_input` and stamped the same way `selected` is, reusing the existing patch-and-rebuild-`build_viewport` pattern rather than a new plugin export. Hover state (`hoveredViewId`) is shared between the Views panel (row `mouseenter`/`mouseleave`) and the Viewport (`pointermove` + hit-test, throttled to one hit-test per animation frame), so hovering either one highlights the other.

---

## Dependency Order

```
M1 (schema) ──► M2 (API) ──► M3 (cascade) ──► M4 (frontend) ──► M5 (routes) ──► M6 (render output)
                                        │
                                        └── M4.1, M4.2 depend on M3
                                        └── M4.3 depends on M2.6
                                        └── M4.4 depends on M3
                                        └── M5 depends on M4

M7 (cleanup) runs incrementally alongside M4–M5.

M8 (renderer) and M9 (plugins) run in parallel once M4 is done.
M9.6 (field editing) depends on M9.3 and M6.
M10 (selection/interaction UX) depends on M8 (renderer) and M9.3 (Charter plugin).
```

M1 and M2 can partially overlap (write API as schema stabilizes).
M4 panels can be migrated in parallel once their respective M2 + M3 deps are done.

---

## Status Key

| Symbol | Meaning |
|--------|---------|
| `[ ]` | Not started |
| `[~]` | In progress |
| `[x]` | Done |
| `[-]` | Deferred / blocked |