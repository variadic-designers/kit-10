# KIT•10 — Implementation Milestone Checklist

This document tracks the migration from prototype code to a fully manager-integrated editor, aligned with the [CONCEPTS.md](../CONCEPTS.md) model.

---

## M1: Schema Expansion

The `DB2026_06_07` schema supports the full concept model via a single V1 migration.

### [x] M1.1 — Expand `axes` table

| Column          | Type                              | Notes                                    |
| --------------- | --------------------------------- | ---------------------------------------- |
| `id`            | `uuid` PK                         |                                          |
| `project_id`    | `uuid` FK → projects.id, RESTRICT |                                          |
| `name`          | `text`                            | e.g. "Dark Mode", "Density"              |
| `description`   | `text`                            | human-readable                           |
| `kind`          | `text`                            | `'categorical'`, `'range'`, `'discrete'` |
| `hint`          | `jsonb`                           | string array of suggested values         |
| `default_value` | `jsonb`                           | default axis arg value                   |

### [x] M1.2 — Create `axis_values` table

Replaces the planned `axis_variants` table. Values are stored as typed jsonb supporting three shapes: literal, range, discrete.

| Column    | Type                         | Notes              |
| --------- | ---------------------------- | ------------------ | ------- | ------------------ |
| `id`      | `uuid` PK                    |                    |
| `axis_id` | `uuid` FK → axes.id, CASCADE |                    |
| `value`   | `jsonb`                      | `{ type: 'literal' | 'range' | 'discrete', ... }` |

### [x] M1.3 — Create `layers` table

| Column          | Type                         | Notes                     |
| --------------- | ---------------------------- | ------------------------- |
| `id`            | `uuid` PK                    |                           |
| `kit_id`        | `uuid` FK → kits.id, CASCADE | which Kit owns this layer |
| `last_modified` | `timestamptz`                |                           |

No `style` column — properties live in `render_entries` via `render_snippets`.

### [x] M1.4 — Create `layer_axis_values` junction

Replaces the planned `layer_axes` junction. Links layers to `axis_values` (not axis_variants).

| Column          | Type                                 | Notes        |
| --------------- | ------------------------------------ | ------------ |
| `layer_id`      | `uuid` FK → layers.id, CASCADE       | composite PK |
| `axis_value_id` | `uuid` FK → axis_values.id, RESTRICT | composite PK |

No axis values in the condition = null layer (always matches).

### [x] M1.5 — `render_snippets` + `render_entries` tables

Render snippets point to layers (1:1 via unique constraint). Entries declare individual properties as either a literal value or a token reference (check constraint enforces mutual exclusivity).

**render_snippets:**

| Column          | Type                                   | Notes                 |
| --------------- | -------------------------------------- | --------------------- |
| `id`            | `uuid` PK                              |                       |
| `layer_id`      | `uuid` FK → layers.id, CASCADE, UNIQUE | one snippet per layer |
| `last_modified` | `timestamptz`                          |                       |

**render_entries:**

| Column       | Type                                    | Notes                        |
| ------------ | --------------------------------------- | ---------------------------- |
| `id`         | `uuid` PK                               |                              |
| `snippet_id` | `uuid` FK → render_snippets.id, CASCADE |                              |
| `property`   | `text`                                  | e.g. "background", "padding" |
| `value`      | `text`                                  | literal value (nullable)     |
| `token_id`   | `uuid` FK → tokens.id, SET NULL         | token reference (nullable)   |

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

### [x] M3.3 — `resolveManySlowPath()` (originally `resolveMany`)

Multi-kit resolution with kit precedence. Later renamed `resolveManySlowPath` when the batched hot path (`fetchResolutionRows` + `resolveViewsFromRows`) was added in M9.5. Gathers axis args per kit, resolves each, then runs token substitution (Pass 2).

- Input: `db, viewId`
- Output: `ResolvedKit[]` with `kitId`, `kitName`, `properties` (each `ResolvedProperty` carries `viewRefs` for a `view-list` value — see M11)

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

Given resolved properties from the resolver (`resolveManySlowPath`/`resolveManyViews`), produce structured output matching a target format.

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

### [x] M8.6 — Percentage-based sizing

The box **sizing** fields (`width`/`height`/`min_*`/`max_*`) became an `Extent` enum (`Auto | Px(f32) | Percent(f32)`) through the wire format, mirroring taffy `Dimension` — the same wire-enum pattern as `TrackSize`. Charter's `parse_extent` handles `N%`/`Npx`/`auto`; `extent_dim` in `layout/mod.rs` maps to taffy for `size`/`min_size`/`max_size`. `padding`/`gap`/`margin` stay `parse_px`-only (percent there is niche); `em` still unsupported everywhere. `fr` deliberately stayed OUT of `Extent` — it's a grid-track/`flex_grow` concern, not a self-declared size.

### [x] M8.7 — min/max width and height

Shipped as part of the `Extent` conversion (M8.6): `min_width`/`min_height` added to the wire format (Box only), `max_*` converted from the `0.0`-means-auto sentinel to `Extent::Auto`, Charter maps `min-width`/`min-height`/`max-width`/`max-height`, and `apply_box_extra`/`build_node` wire taffy `Style.min_size`/`max_size`. min-size is what gives percent widths a usable floor (percent of an auto parent otherwise collapses to 0).

### [~] M8.8 — Overflow / clipping

**Images now clip**: `object-fit: cover` (and any oversized image) is clipped to the node box CPU-side in `prepare_images` (geometry+UV intersection) — there's no scissor in that pass, so without it a cover image bled outside its bounds. **Boxes still don't clip** — content can render outside a box's own bounds with no way to clip it (the "clip-to-frame" designer control is the remaining piece, tied to the resizing model M8.11).

### [ ] M8.9 — Real absolute positioning

`CharterHints.position` exists but is explicitly vestigial/ignored (see Charter section above) — a leftover from the old absolute-positioning architecture. Needs a real `position: "relative" | "absolute"` + `inset`/`top`/`left`/`right`/`bottom` on `BoxExtra`, mapped to taffy's `Style.position`/`inset`.

### [ ] M8.10 — Box shadow exposed through Charter

Vellum's renderer already supports shadows end-to-end (`BoxShadow`, blur/spread/inset — used today for the disabled-state glow and selection overlay), but Charter hardcodes `shadow: None` at both `BoxData` construction sites and never reads a `box-shadow`-style kit property. Unlike M8.6–M8.9 this isn't a taffy/renderer gap — the renderer-side plumbing exists; only Charter's property mapping is missing.

### [x] M8.11 — Figma-style resizing (Fixed / Hug / Fill)

Charter's first opinionated sizing layer (`compile_resize`): `width`/`height` accept `fill`/`hug` keywords compiled to taffy primitives (Fill → grow/shrink/`flex_basis:0`/`min:0` on the main axis, `align-self:stretch` on the cross axis; Hug → grow/shrink 0). Direction-aware via a parent-main-axis threaded through `render_view_nodes`; no flex parent → Fill degrades to auto. Added `flex_basis` to `BoxExtra` (what makes Fill an equal share, not content+leftover). Editor exposes it via `FieldDef inputType: "resize"` → a Fixed/Hug/Fill segmented control in `StyleField.svelte`. Retired the raw item-flex fields (`flex-grow`/`flex-shrink`/`align-self`) and `margin` from the panel; container-arrangement fields stay until they get their own control. Non-regressive: only explicit `fill`/`hug` engage; lengths keep prior CSS behavior.

### [x] M8.12 — Correct flex text min-content

`measure_text_node` now distinguishes taffy's `MinContent` probe (longest word) from `MaxContent` (full unwrapped line) instead of collapsing both to natural width. A flex item's automatic minimum size resolves to min-content, so the old collapse gave text-bearing children an automatic minimum equal to their whole width — they couldn't shrink or wrap and overflowed. `TextMeasureKey` gained a `width_mode` discriminant so min/max don't collide in the measure cache. Prerequisite for M8.11 to actually fit content.

### [x] M8.13 — Image object-fit fix

Charter emits `fit: String` (`cover`/`contain`/`fill`) — the field name Vellum reads — instead of a `cover: bool` that Vellum silently dropped (so every image rendered as the `cover` default). Paired with the M8.8 cover-clip.

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

`kit10_log`, `kit10_kv_get`, `kit10_kv_set`, `kit10_get_resolution`, `kit10_write_render_entry_to_layer`.

### [x] M9.5 — resolveManyViews → batched fetch + row-level dedup

Originally 4-round-trip resolution for all project views, replacing the per-view `resolveMany` O(views) approach, with output fingerprint (`kitFingerprint`) dedup. Optimized: `resolveManyViews` now wraps `fetchResolutionRows` (single batched UNION ALL query, 1 IPC crossing) + `resolveViewsFromRows` (pure sync). Dedup moved from output fingerprint to input-row key (`rowsKey`) — immune to the field-omission class of bug the output fingerprint had (it silently dropped `children` view-list changes and `kitName` updates). `resolveMany` renamed to `resolveManySlowPath` to signal cost. `RESOLUTION_RELEVANT_TABLES` exported and tested against the live-query JOIN (`resolve-live-query.test.ts`) — caught and fixed a missing `kits` JOIN that caused stale `kitName` on kit rename. Parity verified: `batched-fetch.test.ts` asserts the batched path produces identical output to `resolveManySlowPath`.

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

## M11: Composition — children, name-neutral resolution, clone-per-view

Turned view composition (which views nest inside which) into a first-class, plugin-agnostic system, and built the component/instance model on top. See CLAUDE.md's Common Pitfalls (children/composition bullets) for the load-bearing contracts.

### [x] M11.1 — Pointer drag-and-drop view nesting

`src/lib/editor/dnd.svelte.ts` gained a `tree` drop mode (before/after/`into` bands); each Views-panel row is a drag source + tree drop zone. `Views.svelte`'s `handleViewDrop`/`setViewChildren` reorder, nest, cross-parent-move, and un-nest, with a cycle guard.

### [x] M11.2 — Correct per-view children write path

`api.upsertViewToken(projectId, viewId, alias, value)` — find-or-create a View-scoped token in one transaction. A view's children (any per-view override) is written here, **never** through the resolved property's `tokenId` (that's the declaring entry's token, often a shared kit-scoped base). Shared by `ChildViewField.svelte` and the DnD path.

### [x] M11.3 — Box is a pure container

Charter's `box_categories()` declares no `content` field and `render_view_nodes` has no inline-text fallback — a Box never renders its own text; a design nests a Text primitive. `content` is Text-only.

### [x] M11.4 — Name-neutral resolver

The resolver no longer hardcodes `children` (a Charter field key — a boundary break). `ResolvedProperty.viewRefs` carries the referenced view ids for **any** `view-list`-typed value (gated on the value type, not a name); `ResolvedKit.childViewIds` and `tryParseChildViewIds` are gone. The "children means nest" opinion lives in the plugins: Charter reads its own `children` field's `viewRefs` (`collect_child_view_ids`) and reports `composition_field_keys` view-independently on `on_resolve`; the editor nests off `pluginManager.compositionFieldKeys` (`inputType: 'children'`).

### [x] M11.5 — Self-declaring view-scope references

`applySelfDeclaredViewRefs` (both resolve paths): a view's own `view-list` token materializes a property named after its alias, carrying `viewRefs`, even with no kit render entry — so a per-view composition override needs no shared kit-layer anchor. Only the view's own token self-declares; kit/project-scope does not.

### [x] M11.6 — Clone-per-view (kit default children)

The component/instance model. A kit ships defaults as a kit-scope `view-list` token (template subtree; no render entry). `api.instantiateKitDefaults(viewId)` fires eagerly on compose (`Compose.attachKit`) and, for every kit-scope view-list default, deep-clones the template via `api.cloneViewSubtree` (view + compositions + axis args + view-scope tokens, recursing same-aliased refs, DFS cycle guard) into fresh per-instance views written as the view's own token. Each instance owns unique children; template views stay top-level editable masters. Idempotent; a pure DB op, never in `resolve.ts`. Eager, so kit-default edits don't retro-propagate (a "push to instances" is future work). Seed: `Button` kit's default child is `Label: Default` + a `Button (cloned default)` demo view.

### [x] M11.7 — Composition UI

Row-based `Content.Children` (one row per view, `+` add, `×` remove) and `view-list` tokens shown as rows in the Variables panel; a child row click navigates to that view. All three (Render panel, Views tree, Variables) are read-only-or-editing views of the same resolved `viewRefs` — single source of truth.

### [ ] M11.8 — Deferred

Conditional (axis-varying) kit-default children; "push kit-default edits to existing instances"; template-view visibility/segregation from the top-level grid; parent → child axis-arg parameterization; a committed end-to-end (browser) test suite for the above.

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

| Symbol | Meaning            |
| ------ | ------------------ |
| `[ ]`  | Not started        |
| `[~]`  | In progress        |
| `[x]`  | Done               |
| `[-]`  | Deferred / blocked |

---

## M12: Post-M11 Shipped Work

Landed on `main` after the M11 composition work. Durable contracts for each live in CLAUDE.md; this section is the progress record only.

### [x] M12.1 — Composition-alias decoupling

`tokens.composition_alias` now drives `view`-typed composition membership independently of `tokens.alias` (display name). `removeViewRef` detaches by clearing `composition_alias`, never deleting the row.

### [x] M12.2 — Specificity-aware cross-kit resolution

`flattenKitResults` / Charter `merge_kits`: for a property two composed kits both declare, the higher `conditionCount` wins outright regardless of composition order; kit order only breaks a `conditionCount` tie.

### [x] M12.3 — Axis-override cascade + linked axis args

Right-click Kit → Axis → Value cascade plus drag-to-link (new `ArgValue` `linked` variant). Per-token axis overrides via `token_axis_overrides`; `resolveViewsFromRows` merges them into the resolving axis-arg record.

### [x] M12.4 — Occurrence-aware selection

A view referenced by multiple active `view` tokens renders and selects independently. Occurrence keys (`ViewOccurrence`) drive click/hover selection end to end (Charter `occurrence_map` / `node_occurrence_ids`, editor `selectedOccurrence*`); "active" stays view-level for the Render/Axes/Tokens panels.

### [x] M12.5 — Multi-kit composition CSS export (WebCodium)

A view composing 2+ kits emits one class and base rule per kit, with cross-kit contested properties disambiguated via `synthesize_contested_rules` + a `composition_signature_class`. Static/`.is-` variant rules are made reachable via `kit10_get_view_axis_args`; project-scope tokens export as `:root` custom properties.

### [x] M12.6 — Grid mastery

Full Grid vocabulary shipped (`kit10-scene@v0.2.0`): arbitrary `minmax()`, `%`/`fit-content()`/`repeat(auto-fill,…)` tracks, named lines, `grid-template-areas`, `grid-auto-flow`, `justify/align` controls. Charter parsing, editor track builder / area painter, WebCodium export parity, and the Vellum grid-line overlay all included.

### [x] M12.7 — Box-model hatch overlay

Line-aware gap strips, real 2D Grid gutters via taffy `detailed_layout_info`, and a desaturated-blue unused-space hatch. Toggleable via `canvas.toggleBoxModel`.

### [x] M12.8 — Single-transaction seed

`initEditorDB` runs the whole seed (builtin plugins + demo projects) inside one transaction via `withTransaction`, cutting first-load time.

### [x] M12.9 — Focus View keybind + Projects panel loading gate

`camera.focus`-style Focus View keybind; per-switch disable + throbber on Projects panel rows during a project switch.

### [ ] M12.10 — Deferred

Named-line *declaration* UI, a per-item grid span control, the overlay's child-line-span highlight; host-side gamut mapping + panel fallback UI for Display-P3; resolving `linked` axis values before the static-export filter (locked-axis export gap).
