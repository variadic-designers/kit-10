# KIT•10 — Architecture & Component Boundaries

## Maintaining this doc

When a factual error is identified in any project MD — either called out by the user or spotted during a task — update the affected file in the same response. Do not defer doc corrections to a follow-up. This applies to CLAUDE.md, CONCEPTS.md, PLUGINS.md, FAQ.md, LIFECYCLE.md, and manager/MILESTONES.md.

---

## Overview

KIT•10 is a design-system editor that models components as **kits** (style systems), **axes** (dimensions like theme/density/state), and **views** (specific axis configurations). The editor stores everything in an in-browser PostgreSQL database (PGlite), resolves kit properties at runtime, and renders previews via a GPU renderer. A sandboxed WASM plugin (Charter) translates resolved data into a flat render tree.

---

## Stack

```
┌─────────────────────────────────────────┐
│  Svelte 5 UI  (src/lib/editor/)         │  Editor shell, panels, reactivity
├─────────────────────────────────────────┤
│  Manager  (manager/src/)                │  TypeScript library: DB, resolve, API
├─────────────────────────────────────────┤
│  PGlite  (Web Worker + OPFS)            │  In-browser PostgreSQL, live queries
├─────────────────────────────────────────┤
│  Charter  (plugins/charter/src/)        │  Extism/WASM plugin: resolve → UiNode[]
├─────────────────────────────────────────┤
│  Vellum  (src/lib/vellum/)             │  Rust/WASM GPU renderer: UiNode[] → pixels
└─────────────────────────────────────────┘
```

---

## Component Boundaries

### 1. PGlite (Database Layer)

**Owns:** All persistent state — workspaces, projects, views, kits, axes, axis values, axis args, compositions, layers, layer_axis_values, render snippets, render entries, tokens.

**Must NOT:** do any resolution logic, hold derived/computed state, or be accessed directly from Charter or Vellum.

**Key contracts:**

- `render_entries.value` is a plain `text` column — JSON strings (e.g. for `children`) are stored as text and must be parsed by the caller.
- `tokens.value` is `jsonb` with type `TokenValue = { type: 'scalar', value: string } | { type: 'view', view_id: string }`.
- `axis_values.value` and `axis_args.value` are `jsonb` with types `AxisValueType` and `ArgValue` respectively.
- Live queries (`editor.core.live.query`) track table access from the query plan — include all resolution-relevant tables in the live query JOIN so writes to any of them fire the callback.

---

### 2. Manager (`manager/src/`)

**Owns:** Database access (Kysely + PgliteDialect), kit resolution logic, API surface, DB migrations and seed.

**Must NOT:** know about Svelte reactivity, the Charter plugin, or Vellum rendering format.

**Key exports:**

- `resolveManySlowPath(db, viewId)` — resolve all kits for one view (~3 round-trips). SLOW PATH: do NOT use in the editor's live-query loop. Use `fetchResolutionRows` + `resolveViewsFromRows` (or the `resolveManyViews` wrapper) instead.
- `resolveManyViews(db, projectId)` — convenience wrapper: `fetchResolutionRows` + `resolveViewsFromRows`. Resolves ALL project views. This is the hot path used by the editor's live-query loop.
- `fetchResolutionRows(db, projectId)` — async: fetches all 9 resolution rowsets in a single batched UNION ALL query (one IPC crossing into the PGlite worker). Returns `ResolutionRows`.
- `resolveViewsFromRows(rows)` — pure sync: resolves `ResolutionRows` → `ResolvedViewData[]`. No db, no await. Split out so the editor can dedup on the rows (input) before paying for the resolve + serialize + plugin call when nothing changed.
- `rowsKey(rows)` — stable string derived from every column of every rowset in `ResolutionRows`. Used for input-level dedup: if two fetches produce the same key, `resolveViewsFromRows` (pure) produces identical output, so the editor skips the resolve entirely. Immune to the field-omission class of bug an output fingerprint has.
- `RESOLUTION_RELEVANT_TABLES` — the explicit list of tables the resolver reads. The editor's live-query JOIN is tested against this list (`resolve-live-query.test.ts`) so adding a resolution-relevant table without joining it is a caught failure, not silent staleness.
- `flattenKitResults(kits)` — merge all kit properties into a single Map, later-kit properties winning.
- `matchesArg(condition, arg)` — pure matching function, re-exported for the Axes panel UI.
- `queryBuilder(dialect)` — typed Kysely instance (the `Api` type), used throughout the UI.

**Resolution algorithm (`resolve.ts`):**

1. Fetch all layers for the kit.
2. For each layer, fetch its conditions (axis values it matches) and entries (property values it sets).
3. Match layers against the current axis args using specificity (condition count + axis priority indices).
4. Sort matched layers by specificity ascending — later entries overwrite earlier ones.
5. Substitute token aliases with their resolved scalar values.

**Specificity:** `[conditionCount, priority1, priority2, ...]` sorted descending. Higher specificity always wins.

**`fetchResolutionRows` — single batched query:** one UNION ALL query returns all 9 rowsets tagged (`views`, `compositions`, `kits`-joined `kit_name`, `axis_args`, project/kit/view `tokens`, `layers`, `conditions`, `entries`). Two leading CTEs — `project_view_ids` (the project's views) and `project_kit_ids` (kits composed into any of them) — compute the `viewIds`/`allKitIds` filters once; every branch references them by name instead of repeating the `compositions JOIN views WHERE project_id` subquery, so `projectId` is bound twice (the view-id CTE + the project-tokens branch) rather than per-branch, and no intermediate round-trip is needed to learn the filters. Replaces the original 4-sequential-await layout (RT1→RT2→RT3→RT4). Compositions are sorted by `priority_index` client-side (UNION ALL doesn't preserve per-branch ORDER BY).

---

### 3. Editor UI (`src/lib/editor/`)

**Owns:** Svelte 5 reactivity, panel layout, user interaction, live-query subscriptions, orchestrating Manager calls.

**Must NOT:** contain resolution logic (use Manager), render geometry (use Vellum via viewportData), or know Charter's internal data format.

**Key reactive state in `Editor.svelte`:**

```
editorLoading: EditorState          — set once on mount
editorActivity: EditorActivity      — active workspace/project/view/kit IDs
selection: EditorSelection          — selected view IDs (primary + secondary)
resolvedViews: ResolvedView[]       — all project views with resolved kits, updated by live query (typed as ResolvedView from src/lib/plugins/types.ts; manager exports the structurally identical ResolvedViewData — Editor.svelte casts between them)
resolvedKits: derived               — resolvedViews entry for activeViewId
pluginManager: PluginManager        — Charter plugin wrapper
```

**Live-query loop (`$effect` in Editor.svelte):**

- A single JOIN query (`RESOLVE_LIVE_QUERY_SQL` in `resolve-live-query.ts`) watches all resolution-relevant tables. Its table set is tested against `RESOLUTION_RELEVANT_TABLES` in `resolve-live-query.test.ts`.
- On any write, `scheduleReResolve` debounces and calls `fetchResolutionRows` (single batched UNION ALL query, one IPC crossing).
- Row-level dedup (`rowsKey`): the fetched rows are hashed; if the key matches the previous fetch's key, the resolve + serialize + plugin call are skipped entirely. This replaces the old output fingerprint (`kitFingerprint`) — it cannot omit a field because it serializes the raw rows, not a hand-picked subset of output fields. Svelte 5's reference-based reactivity cannot do content-based dedup on its own, so this dedup at the input is what prevents no-op re-renders.
- `resolveViewsFromRows` (pure sync) runs only when the rows actually changed.
- A `cancelled` flag + `reResolveVersion` counter ensures stale async results from a previous project (or a newer fetch issued before this one completes) are discarded — latest-wins, guarding the single async fetch window.

**Two separate plugin effects:**

```ts
$effect(() => pluginManager.setData(resolvedKits, viewHints, activeViewId, resolvedViews));
$effect(() => pluginManager.setSelection(selectedViewPrimary, selectedViewSecondary));
```

Keeping these separate lets selection changes use the fast `on_selection_change` path instead of a full `on_resolve`.

**Axes panel layer-combo indicators (`Axes.svelte`, `Axis.svelte`, `layer-color.ts`):**

- Each categorical axis value shows one dot per distinct Layer **key-set** (its sorted axis-id set) it belongs to — not one per literal Layer. Different Layers can share the same key-set (e.g. `theme:dark;density:compact` and `theme:light;density:compact` are both `{theme,density}`); since axis values within one axis are mutually exclusive, at most one can ever be active, and they're visually identical anyway, so `Axes.svelte`'s `valueLayerCells` dedupes by key-set. A group is "active" if any Layer in it currently matches the selected axis args.
- **Scope boundary:** the null layer (0 conditions) is excluded — it isn't attached to any specific axis value, it applies unconditionally to the whole kit. That concept belongs in the Render panel (`StyleField`'s `conditionCount === 0 → fa-circle-dot`) and Tokens panel, not here. Single-axis Layers (1 condition) **are** included — they're real, value-specific rules, and `StyleField` colors properties sourced from them with a real (non-muted) hue, so excluding them would leave a Render-panel color with no corresponding dot to match against. The exclusion test is `conds.length === 0`, not `conds.length < 2`.
- **Color = hash of the axis key-set** (`layerDotColor`/`axisSetHue` in `layer-color.ts`), shared identically between the Axes panel dots and the Render panel's `StyleField` track color (`trackColor`) — this is what lets a user visually correlate "this property's color" with "this Layer's dot" across panels. Changing the formula in one call site without the other reintroduces the mismatch.
- **Shape = the active kit's own icon** (`kitShape`, assigned by composition order — same `shapeIcon`/`SHAPE_ICONS` system `Styles.svelte`'s `kitIconMap` uses), never per-axis or per-Layer. Only hue distinguishes combos; shape always just identifies the kit.
- **Column alignment:** `Axis.svelte`'s `keySetColumns` computes the union of key-sets across all of an axis's own values (sorted by magnitude) and renders one fixed-width slot per column per value row (empty if that value has no Layer for that key-set) — so the same key-set always lands in the same horizontal position across every value of the axis, instead of packing left.

---

### 4. Plugin Manager (`src/lib/plugins/manager.svelte.ts`)

**Owns:** Charter plugin lifecycle, call serialization, host functions.

**Must NOT:** do resolution (use Manager), write DB state directly (only via `kit10_write_render_entry_to_layer`), or expose Svelte reactivity to Charter.

**Serial queue:** all plugin calls (`on_resolve`, `on_selection_change`, `on_field_update`) are chained on `pluginQueue` so they never run concurrently. The Extism worker is not re-entrant.

**Debounce + generation guard:**

- `setData` increments `selectionGen`, cancels any pending selection timer, and debounces `runResolve`.
- `setSelection` captures `selectionGen` at enqueue time; if `setData` fires before execution, the captured generation won't match and `runSelectionChange` is skipped.
- This prevents stale `on_selection_change` results from overwriting a concurrent `on_resolve`.

**Utility plugins (`loadUtilityPlugin`/`callUtilityPlugin`):** a second, separate plugin category alongside Charter's viewport-interpreter lifecycle. `activePlugin` is a single variable — `loadPlugin` unconditionally overwrites it, so a second `loadPlugin` call would silently evict Charter. Utility plugins are stored in their own `Map<string, Plugin>` instead, never touch `activePlugin`/`on_resolve`/`on_selection_change`/`on_field_update`, and are only ever called on demand by name (`callUtilityPlugin(name, fn, payload)`). **Fontavious** (`plugins/fontavious/`) is the first one — it owns a bare, static font catalogue and fetches WOFF2 files from vendor CDNs via Extism's built-in HTTP capability (`allowedHosts` in the `loadUtilityPlugin` options, e.g. `['fonts.gstatic.com']` — requires `runInWorker: true`, already the default here), handing the resulting bytes to `vellum.load_font()`. Its three exports: `search_fonts` (catalogue substring search, for `SuggestField.svelte`), `fetch_font` (returns raw bytes, not JSON — the caller reads them via the JS SDK's `.bytes()`), and `variant_url` (JSON in/out, no HTTP — resolves a `{value, weight, style}` request to the URL `fetch_font` would use, without fetching it).

**`Editor.svelte`'s resolve-time font scan asks Fontavious "which URL", never Vellum "is this weight loaded".** Whether two different weights of a family are the same file (a variable font, one URL covers a range) or genuinely different files (a static font, one URL per weight) is a fact Fontavious's catalogue already has — `weightMin`/`weightMax` per variant. Vellum used to be asked to answer this by introspecting a loaded font's actual variable-axis range (via `swash`, briefly a direct dependency); that duplicated a fact one layer up already knew, and made Vellum's font-loading API font-catalogue-shaped instead of just "load bytes, render them". Now the scan calls `variant_url` (cheap, no I/O) to get the URL a `(family, weight)` request would resolve to, and keeps its own plain `Set<string>` of URLs already fetched+loaded — same URL as something already loaded means skip, different URL means fetch. Vellum's only font-membership export is back to the family-only `is_font_loaded`.

**Charter never names Fontavious.** `FieldDef.inputType: "font"` on the `font-family` field only claims _what kind_ of field it is — Charter has no `suggestionsFrom`/plugin name in its source at all. `src/lib/plugins/suggestion-providers.ts`'s `resolveSuggestionSource(inputType, explicit)` is the one place that maps `inputType → { plugin, searchFn, fetchFn }` (currently `font → fontavious`), consulted by `Styles.svelte` before handing `suggestionsFrom` to `StyleField.svelte`. Swapping which plugin serves a given `inputType` is a one-file edit here, never a Charter rebuild. A `FieldDef` can still set an explicit `suggestionsFrom` itself as an escape hatch (always wins over the default), but the common case should stay inputType-only.

**Fontavious's catalogue (`plugins/fontavious/catalogue.json`) models weight as a range** (`weightMin`/`weightMax` per variant), not a single `weight` — a variable font genuinely covers a continuous range from _one_ URL (confirmed against Google Fonts' live CSS2 API: requesting `wght@400..700` returns one `font-weight: 400 700;` face for a true variable font, vs. discrete single-weight faces for a static-only one), and a static font is just the degenerate `weightMin == weightMax` case. Most catalogued families are variable; a few (Lato, Poppins, confirmed per-family against the live API, not assumed) have no variable version and keep one URL per discrete weight. Vellum's `is_font_variant_loaded(name, weight)` checks the font's _actual_ variable-axis range (via `swash`'s `variations().find_by_tag("wght")` — `swash` is named as a direct dependency in `taf_can_do/Cargo.toml` purely so this can compile, even though it's already pulled in transitively by cosmic-text) rather than fontdb's single static `weight` metadata field, which only ever reports one value (e.g. a variable font's default instance) regardless of what range it can really render. Without this, a loaded variable font would look "not loaded" for every weight but its default and trigger a pointless re-fetch of the exact same file.

**Not every font has every weight, even for a catalogued family.** Lato and Poppins, for example, only ship 400/700 from Google Fonts — no in-between weight like 600 exists to fetch, variable or otherwise. Asking for one is expected to fail (`fetch_font` returns a "no variant" error) and is logged via `console.warn` in `Editor.svelte`'s resolve-time fallback scan — never surfaced as a user-facing error, since this is a real, permanent limitation of the font, not a bug to fix. Actual rendering still degrades gracefully: cosmic-text's own font matching (used during real shaping, separate from `is_font_variant_loaded`'s strict check) substitutes the closest already-loaded weight of the same family rather than falling through to an unrelated font.

**`width: 0.0` semantics (important):**

- `Box{width:0}` → Vellum auto-sizes this box to its children + padding.
- `Text{width:0, height:0}` → Vellum measures during layout (cosmic-text, constrained by parent available space). Charter must always emit 0 for text dimensions.

**Host functions (Charter → Host calls):**

| Function                            | Description                                                  |
| ----------------------------------- | ------------------------------------------------------------ |
| `kit10_log`                         | Structured log forwarded to browser console with level/color |
| `kit10_kv_get` / `kit10_kv_set`     | Per-plugin key-value store (in-memory)                       |
| `kit10_get_resolution`              | Returns current `resolvedKits` JSON to Charter               |
| `kit10_write_render_entry_to_layer` | Writes a field value back to DB via Manager API              |
| `kit10_set_viewport_data`           | Direct viewport update bypass (legacy, avoid)                |

---

### 5. Charter Plugin (`plugins/charter/src/lib.rs`)

**Owns:** Translating resolved kit data into a flat `UiNode[]` render tree. Layout grid logic. Marking which nodes are selected. Field category definitions.

**Must NOT:** query the DB directly, hold cross-call mutable state beyond Extism `var` storage, or do text measurement (emit `width:0, height:0` for Text nodes; Vellum measures them).

**Charter does not have to 1:1-expose every CSS-like capability Vellum gains as a literal render-panel property.** As Vellum's layout engine grows (flex-grow, alignment, wrap, margin, etc.), Charter is free to have its own opinion about what a designer should actually need to set by hand versus what it infers/defaults sensibly — it's an opinionated translation layer (VISION.md 1st Principle), not a raw CSS pass-through. Don't treat "Vellum can do X" as "therefore the Render panel must expose a literal `X` property."

**Entry points:**

| Function              | Trigger               | Input                                | Output                                    |
| --------------------- | --------------------- | ------------------------------------ | ----------------------------------------- |
| `on_init`             | Plugin load           | `{name}`                             | `"ok"`                                    |
| `on_resolve`          | Data change           | `OnResolveInput`                     | `OnResolveResult` (viewport + categories) |
| `on_selection_change` | Selection change only | `{primary, secondary, activeViewId}` | `{viewport_data}`                         |
| `on_field_update`     | User edits a field    | `FieldUpdate`                        | `WriteRenderEntryResult`                  |

**`on_resolve` stores its full input payload** in Extism `var` storage as `last_resolve_input`. `on_selection_change` reads this, patches the three selection fields (`selected_view_primary`, `selected_view_secondary`, `active_view_id`), and re-runs `build_viewport`. This avoids a full re-resolve round-trip for selection-only changes.

**`build_viewport` layout:** views split into two groups per view. Views with a `hints.vellum.position` each become their own independent root node (`extra.position = Absolute { x, y }` on their cell), floating at that literal world coordinate — they never join a shared flex parent, so one view's content size can never push another view around. Views without a position keep flowing through the legacy auto-grid:

```
Root Column (padding: 40px all sides)
  Row (padding-bottom: 32px gap)
    Cell Column (padding-right: 32px gap)  ← one per view, max 4 per row
      View Box (width:0 auto, bg, border, radius, padding)
        [child views rendered recursively, or nothing if no content]
```

Charter can't pre-compute a packed fallback position for unpositioned views (it doesn't know their content size — Vellum measures text during its own layout pass), so the auto-grid stays the only option for views without an explicit position.

**Primitive detection (`detect_primitive`):**

- If props have only text properties (`color`, `font-size`, etc.) → `"text"` → emit `Text` node directly.
- Otherwise → `"box"` → emit `Box` node, recurse into `child_view_ids`.
- **`has_box_props` must only include genuinely structural properties** (`width`, `height`, `display`, `flex-direction`, `gap`, `grid-template-columns`, `grid-template-rows`) — properties `Text` has nowhere to put, or that imply this node arranges children. **Do not add fill/border/radius/padding back to this list.** They used to be there and it was a real bug: real CSS text can have a background, a border, and padding without stopping being text (a highlighted/pill label), so a property that's purely paint was silently swapping the whole node's sizing algorithm (Text's direct cosmic-text auto-measurement vs. Box's auto-size-to-children) the moment a designer added so much as a background color to a label.

**`Text` nodes carry their own paint properties** (`build_text_node` via the shared `extract_paint_props` helper, also used by `build_box_node`): `background`/`border`/`border-radius`/`padding` are read and applied directly onto `TextData`'s `bg_color`/`show_border`/`border_color`/`border_width`/`corner_radius`/`padding` fields — Vellum's `node_rect()` already draws these for `Text` exactly like it does for `Box` (confirmed in `taf_can_do`), so a text label never needs to become a `Box` just to get a highlight behind it. A `Text` node with no declared fill stays fully transparent (`default_bg = [0.0; 4]`) — unlike `Box`, which falls back to a visible neutral placeholder, since `Text` isn't a container by default.

**A Box never renders inline text — it is a pure container.** A design that wants text inside a box nests a `Text` primitive as one of the box's children; there is no `content` fallback in `render_view_nodes` (a childless box just renders empty) and **`box_categories()` deliberately declares no `content` field** (only `children`), unlike `text_categories()`. `content` is a Text-only property. This is asserted by `box_categories_does_not_declare_a_content_field`. (Earlier Charter did emit fallback inline text for a childless box with a `content` property; that blurred the Box/Text split and is gone.)

**Selection marking:** Charter sets `BoxData.selected` (0 = none, 1 = secondary, 2 = primary/active) and otherwise leaves the node's own `border_color`/`border_width` untouched. **Do not go back to overriding border fields for selection** — Vellum owns the actual selection visuals (see its section below) as a separate overlay, keyed off this field.

**`CharterHints` (from view `hints.charter` JSON)** — hints Charter interprets with its own judgment:

- `primitive: "box" | "text"` — override auto-detection

**A view is never declared "top-level" or "child" — that's derived, not stored.** `build_viewport` unions `collect_child_view_ids` across every view's `resolved_kits` in the whole project into one `referenced` set, and excludes a view from the top-level grid iff its id shows up there. There is no `childOnly` hint (removed) and no `views.is_template` column (removed) — a view sits unclaimed and renders top-level for exactly as long as nothing's `children` property lists it, and stops the moment something does, automatically, with nothing to keep in sync by hand.

**`VellumHints` (from view `hints.vellum` JSON)** — hints passed straight through to Vellum's `UiNode` wire fields with no Charter-side interpretation, kept in a separate namespace from `CharterHints` for exactly that reason:

- `position: [f32; 2]` — places the view's top-level cell at that literal world coordinate via `NodePosition::Absolute`, escaping the auto-flow grid entirely (see `build_viewport` above). Reactivated plumbing — `manager/src/seed.ts` already seeds every demo view with tiled coordinates.

---

### 6. Vellum (`src/lib/vellum/`)

**Owns:** GPU rendering, camera (pan/zoom), layout engine (flex-direction, auto-sizing).

**Rebuilding the wasm binary** (source in `taf_can_do/`):

```
wasm-pack build --target web --no-default-features --no-opt --out-dir ../kit10/src/lib/vellum
```

`--no-default-features` is **required** — the `standalone` feature (desktop winit/pollster) gates out all `#[wasm_bindgen]` exports. Building without it produces a ~17KB stub with no exports. `--no-opt` bypasses wasm-opt, which fails on bulk-memory ops in the bundled wasm-opt version.

**`taf_can_do/` is a separate, private repo — do not push it.** Only the compiled `vellum_renderer_bg.wasm` (and the generated JS/`.d.ts` glue) get committed into `kit10`; the Rust source changes stay local to that repo.

**Canvas backing store is DPR-aware; `canvas_size`/world-space stays logical (CSS px) everywhere else.** `create_graphics_for_canvas` (`taf_can_do/src/render/mod.rs`) sizes the actual WebGPU surface to `devicePixelRatio` more physical texels than the logical `width`/`height` Viewport.svelte passes in (`canvas.clientWidth`/`Height`) — this is what makes box borders/radii and the grid render crisply on HiDPI displays instead of upscaled-blurry. Everything else — `Graphics.canvas_size`, `view_zoom`, pan/zoom-toward-cursor math, hit-testing, and the box/glyph vertex shaders' NDC math — deliberately stays logical/CSS-px. The box shader's ratio-based `view_pos / canvas_size` clip-space mapping is resolution-independent by construction (the GPU rasterizes the same NDC quad into however many physical texels the render target actually has), so it — and glyph vertex _placement_ — needed zero changes to benefit from the bigger backing store. Only two things actually read `device_pixel_ratio`:

- **`grid_shader.wgsl`** — the only shader that touches `frag_coord` directly (always physical texels), so it's the only one that needs the ratio to convert back to logical world space (`world_pos()`) and to keep line thickness pinned to ~1 _physical_ pixel rather than 1 logical pixel (which would render `device_pixel_ratio`× too thick on HiDPI).
- **`TextRenderer::shape_area`** (`taf_can_do/src/text/mod.rs`) — shapes/lays out text at the normal logical `font_size` (glyph positions, line wrapping, `canvas_size`-relative placement all stay logical, so on-screen text size/position don't change), but requests the _rasterized bitmap_ from swash at `font_size * device_pixel_ratio` for a sharper atlas entry, then divides `img.placement`'s resulting physical-pixel metrics back down by `device_pixel_ratio` before building the on-screen quad. The UV rect stays in the bitmap's raw (physical) texel dimensions — that's genuinely how many texels got written into the atlas.

Native/standalone (`create_graphics`, feature-gated behind `standalone`, not part of the shipped web build) hardcodes `device_pixel_ratio: 1.0` — it already renders in raw physical pixels end-to-end via winit's `PhysicalSize`/`PhysicalPosition`, with no separate logical layer to reconcile, so there's nothing to scale.

**MSAA is off on the shipped web build — `SAMPLE_COUNT == 1` for `target_arch = "wasm32"` (native/standalone alone gets `4`).** Box/text/grid anti-aliasing on web comes entirely from per-fragment SDF math (`fwidth`-based `aa_half` in `shader.wgsl`, `smoothstep`-based coverage in the grid shaders), not hardware multisampling. This means `draw()`'s `if msaa_on { &self.msaa_view } ... else { ... }` branches (`msaa_on = SAMPLE_COUNT > 1`) are dead code at every one of their call sites on web — `msaa_texture`/`msaa_view` are never actually selected as a render target there. `create_msaa`'s callers therefore go through `msaa_dims(width, height)` first, which collapses the requested size down to a negligible `(1, 1)` on that path rather than allocating a full physical-canvas-size `RENDER_ATTACHMENT` texture for nothing every session (worse after DPR-awareness, since the real size would now be `device_pixel_ratio²` bigger) — real VRAM on the integrated GPUs this matters most for. Native/standalone (`SAMPLE_COUNT == 4`) is unaffected — `msaa_dims` returns the real size there.

**Discrete, snapped zoom levels — 10% to 3000%.** `ZOOM_LEVELS` (`taf_can_do/src/render/mod.rs`) is a fixed array that `set_zoom`/`zoom_in_at`/`zoom_out_at` snap to (`snap_zoom`) rather than allowing continuous zoom — each wheel-notch steps exactly one array entry. Steps are coarser at the extremes (10%/15%/20%… near the bottom, 16.0/22.0/30.0 near the top) and finer around 100%.

**Macro grid (`grid_shader.wgsl`, `fs_main`).** Sparse crosshairs at 16-world-unit intervals, drawn _first_ in the content pass, right after the clear, so scene content paints over it. Opacity fades with `view_zoom` alone. Uses a `world_pos()` helper to convert `frag_coord` back to logical world space (needs `view_zoom * device_pixel_ratio`, see DPR-awareness above).

**Rendering is two passes only above 1600% zoom — one pass otherwise.** `draw()` (`taf_can_do/src/render/mod.rs`) branches on `view_zoom >= 16.0` (matching `composite_shader.wgsl`'s own fade threshold exactly):

- **Below 1600%** — a single "Main Pass" straight to the swapchain, same shape as before the pixel-grid-overlay feature existed: `draw_scene_content` (macro grid, rects, images, text) then `draw_overlays` (hover, selection). No offscreen texture, no second pass — this is the overwhelmingly common case, so it isn't worth paying for.
- **1600% and above** — two passes, since the overlay needs to be content-aware (see below): **Content pass** — `draw_scene_content` resolved into an offscreen `content_texture`/`content_view` instead of the swapchain. **Composite pass** — a full-screen triangle (`composite_shader.wgsl`, `composite_pipeline`) reads `content_texture` back via `textureLoad`, writes the real swapchain target with the pixel-grid overlay applied, then `draw_overlays` draws hover/selection on top of _that_.

`draw_scene_content`/`draw_overlays` are shared helpers (`&self, pass: &mut wgpu::RenderPass`) so the two branches can't drift out of sync with each other — same pattern `render_images_into` already uses.

The overlay needs the second-pass readback because it draws differently depending on what's underneath it: over empty canvas it's the same faint translucent 16-line as always; over actual view content (a box, text, image) it inverts the content's own color instead (see below), so the line stays visible regardless of what color the content happens to be. A discard-based single-pass overlay (the old `fs_pixel_overlay`/`grid_overlay_pipeline`, now removed) only ever sees _its own_ output, with no way to know what got drawn underneath it without a readback like this. "Is there a view here" is approximated in the shader by comparing the sampled content pixel against `background_color` (mirrored into `SceneUniforms` for exactly this) — not airtight (a view whose fill color exactly matches the canvas background reads as empty), but a rare coincidence, not a correctness bug. The invert is capped at 0.8 contrast × 0.6 opacity (not a full 1.0 mix), tuned down from an initial too-harsh full invert. Ramped in 1600%→2000% zoom, same as the plain-line case.

**`content_texture` is sized lazily, not always kept at full physical resolution.** `sync_content_texture_size` grows it to the real physical canvas size the moment `view_zoom` first crosses 16.0 (the pixel-grid overlay's own activation threshold) and shrinks it back to a negligible `(1, 1)` stub the moment it drops back below — called from every `view_zoom` mutator (`set_zoom`/`zoom_at`/`zoom_in_at`/`zoom_out_at`), not every frame in `draw()`, since zoom only actually changes on discrete user actions. Most sessions never zoom past 1600%, so holding a full HiDPI-scaled render-attachment texture in VRAM for the whole session for a feature that's inactive nearly all the time would waste real memory on exactly the lower-end/integrated-GPU hardware this matters most for — same shape of problem `msaa_dims` already solves for the MSAA target (see below), except this one genuinely does need to grow sometimes, so it can't be a compile-time constant. `resize_wh` only resizes `content_texture` if it's currently in its full-size state (`content_is_full`) — if it's the stub, a resize leaves it a stub; the next zoom crossing sizes it correctly whenever that happens.

**Glyph atlas needs a padding gutter between packed glyphs** (`taf_can_do/src/text/atlas.rs`, `GLYPH_PADDING`). The glyph sampler uses bilinear filtering (`taf_can_do/src/text/mod.rs`); packing glyphs edge-to-edge with no gap means sampling near a glyph's border blends in a texel from whatever's packed next to it — visible as thin lines/fringes bleeding off characters. `ClampToEdge` only guards the whole atlas texture's outer border, not the seams between individual packed glyphs — it does not prevent this.

**Owns text measurement.** Text nodes arrive with `width:0, height:0`; Vellum measures them during the layout pass using cosmic-text constrained by available space from the parent.

**`UiNode[]` contract:**

- Nodes are a flat array. Parent-child relationships use `parent_id: number | null` (index into the array).
- `Box{width:0, height:0}` → auto-size to children + padding. Vellum's layout engine handles this.
- `Text{width:0, height:0}` → Vellum measures during layout. Do not pre-patch text dimensions in the host.
- `max_width: 0` and `max_height: 0` → no constraint (not "max is 0px").
- `flex_direction` on Box controls child stacking: `"Row"` | `"Column"` | `"RowReverse"` | `"ColumnReverse"`.
- `BoxExtra` also carries `align_items`/`justify_content`/`flex_wrap` (container), `flex_grow`/`flex_shrink`/`align_self` (item), and `margin` (uniform, all four sides) — full taffy fields, mapped 1:1 in `apply_box_extra` (`taf_can_do/src/layout/mod.rs`). `None` on the `Option`-typed ones means "don't touch it, leave taffy's own CSS-matching default" rather than "set to some zero value" — `flex_shrink: None` still ends up `1.0` (taffy's default), not `0.0`. Auto-margin centering is deliberately not exposed; use `align_items`/`justify_content` on the parent instead. Charter maps these from kit properties of the same CSS name (`align-items`, `justify-content`, `flex-wrap`, `flex-grow`, `flex-shrink`, `align-self`, `margin`) — see the note in the Charter section above about not needing to 1:1-expose every capability as a literal render-panel property; these were exposed directly because there's no clearer "smarter default" for general-purpose layout primitives yet.
- `BoxExtra` also carries `position: NodePosition` — `Relative` (default) or `Absolute { x, y }`. Unlike the other `BoxExtra` fields above, this is **not** exposed as a kit render-panel property — Charter never sets it from kit properties, only from a view's own `hints.vellum.position` when building that view's top-level cell (`absolute_box` in `plugins/charter/src/lib.rs`). **It is never mapped onto taffy's own `Style.position`/`inset`** (`apply_box_extra` in `taf_can_do/src/layout/mod.rs` deliberately does not touch them) — an earlier version did exactly that via taffy's `Position::Absolute`, and it invokes CSS's shrink-to-fit intrinsic-sizing algorithm for auto-sized boxes, which is an unrelated concern that ended up corrupting box sizing (see the Common Pitfalls entry below). Instead, `build_taffy_tree` gives any root-level `Absolute` node its own fully independent taffy tree — no parent edge to the shared virtual root at all — sized via the exact same ordinary auto-sizing every other root uses, and `compute_layout` applies `(x, y)` as a pure post-layout world-space translation on that subtree's rects/text_areas/images. Position only ever answers "where"; it never influences "how big."
- Every `Box`/`Text`/`Img` variant has a `selected: u8` field (0/1/2 = none/secondary/primary). Charter sets it; Vellum owns everything about how it's drawn.

**Selection is a separate overlay, not a border override.** `Graphics.selection_decorations` (`taf_can_do/src/render/mod.rs`) captures the layout rect + `selected` kind of every selected node after each layout pass. `rebuild_selection_instances`, called every frame from `write_frame` (not just on scene change), turns those into an outline `RectInstance` (transparent fill, colored border, sitting _outside_ the element via an outward offset) plus 4 corner-handle instances, reusing the existing box shader/pipeline — no shader changes needed. The element's own `border_color`/`border_width` are never touched.

**Why every frame, not just on selection/scene change:** `border_width`, the outset gap, and the handle size are all expressed in world units as `desired_screen_px / view_zoom`, so they render as a constant number of screen pixels regardless of zoom. But `pan`/`zoom_in_at`/`zoom_out_at`/`set_zoom` only update `view_zoom`/`view_offset` and the uniform buffer — they never touch `instance_buffer` or re-run `update()`. If the selection instances were only rebuilt on scene change, they'd go stale (wrong on-screen thickness) the moment the user zoomed without also re-selecting something. Rebuilding cheaply every frame in `write_frame` sidesteps having to hook every current and future zoom/pan mutator individually.

**API surface used:**

```ts
vellum.initialize(canvasId, w, h)  // once on mount
vellum.set_data(json)              // update UiNode[] — text nodes may have zero dimensions
vellum.render()                    // draw one frame (called on demand — see below)
vellum.resize(w, h)                // on canvas resize
vellum.set_pan(dx, dy)             // pan delta
vellum.zoom_in_at(cx, cy)          // zoom toward point
vellum.zoom_out_at(cx, cy)         // zoom away from point
vellum.set_colors(...)             // grid + background colors (for light/dark theme)
vellum.ensure_index_visible(index) // pan (never zoom) the node at this index into view iff it isn't already visible; returns whether it panned
```

**Rendering is on-demand, not a perpetual `requestAnimationFrame` loop.** `Viewport.svelte` calls `vellum.render()` only in response to something that actually changed — `requestRender()` schedules at most one rAF-deferred call, and `rafId` doubles as an "already scheduled" guard that coalesces bursts of calls (e.g. rapid `pointermove` while panning) into a single paint. Every state mutation that affects what's on screen has to call it explicitly: `data`/theme `$effect`s, the wheel handler (zoom), pointer-move-while-panning (pan), and the `ResizeObserver` callback all do. `vellum.load_font()` is the one mutation that happens _outside_ Viewport.svelte entirely (`Editor.svelte`'s resolve-time font scan, `StyleField.svelte`'s font picker, both via `getVellumInstance()`) — those call `requestVellumRender()` (`vellum-instance.ts`), a tiny module-level indirection to Viewport's own `requestRender` (registered via `setRenderRequester` on mount) so code outside Viewport's component instance can still ask for a repaint. **Adding a new call site that mutates Vellum-visible state must pair it with one of these two — otherwise the change applies in Rust but sits unpainted until some unrelated interaction happens to trigger the next frame.** `continuousMode` (a local flag in `Viewport.svelte`, currently always `false`, not yet exposed outside the component) is the intended hook for future continuous-animation work (something driving visual change frame over frame on its own, e.g. eased pan/zoom) — flipping it makes `renderFrame` reschedule itself every frame instead of stopping after one, restoring the old perpetual-loop behavior for as long as it's on.

**`requestRender()` is also gated on `hasData` — the first real `set_data()` call — not just "Vellum itself finished initializing."** Without this, calls that can legitimately fire before Charter/PGlite ever resolves anything (`ResizeObserver`'s own initial callback, the colors-applied-on-init call in `onMount`) would paint a background+grid frame that's visible through/around the `.logo-overlay`'s loading logo (it doesn't fully cover the canvas — see its CSS, no background-color on the wrapper, only the small centered glyph shape has one) while the DB layer is still catching up, instead of one clean reveal once real project data lands. Deliberate choice over the alternative (progressive rendering, showing background/grid as soon as possible) — this app's loading screen was designed around a single reveal moment, and an empty grid sitting there during a slow resolve reads as "stuck" more than "loading."

**Corollary: `create_graphics_for_canvas`'s initial `scene` must stay empty (`Vec::new()`), not `example_scene()`.** Before rendering was on-demand, `vellum.render()` was never called until _after_ the first real `set_data()` had already run (the old rAF loop only started inside that same effect), so whatever `Graphics` was constructed with was never actually visible — it was always overwritten before the first paint. On-demand rendering broke that guarantee: `applyColors`'s initial call and `ResizeObserver`'s own initial callback can both legitimately fire a render before the async PGlite/Charter pipeline delivers the first real `data` update. `example_scene()` (`api.rs`) is a Rust-side dev fixture — a literal bundled cat photo among other placeholder content — meant for the native/standalone demo binary (`create_graphics`, which has no JS side to hand it real data, so showing _something_ on launch is the point). Reusing it for the web path meant that fixture, cat photo included, could flash on screen for one frame before real project data arrived. If you ever see "the vellum demo" flash on reload, this is almost certainly it re-regressing — check whatever new early-render trigger reintroduced the race, and check this scene is still empty.

---

## Data Flow

### Resolve flow (axis change or view selection)

```
DB write (axis_args or render_entries)
  → PGlite live query fires
  → scheduleReResolve (debounce 0ms)
  → fetchResolutionRows(db, projectId)        [single batched UNION ALL query, 1 IPC crossing]
  → rowsKey(rows) == lastRowsKey? → skip entirely (input-level dedup)
  → resolveViewsFromRows(rows)                [pure sync, no db]
  → resolvedViews = result                    [new array ref → fires downstream $effect]
  → $effect: setData(resolvedKits, hints, viewId, resolvedViews)
  → debounce 0ms → enqueue(runResolve)
  → plugin.call('on_resolve', payload)        [Charter WASM, worker thread]
  → on_resolve stores last_resolve_input
  → returns OnResolveResult
  → viewportData = JSON                       [Svelte reactive state]
  → Viewport.$effect: vellum.set_data(d)     [next tick]
  → vellum.render()                          [rAF]
```

### Selection-only fast path

```
User clicks view in Views panel
  → setData(...) + setSelection(id, [])
  → setData cancels selection timer, increments selectionGen
  → only runResolve fires (setSelection sees dataTimer !== null)

User changes secondary selection only (no activeViewId change)
  → setSelection(primary, secondary)
  → selectionGen captured
  → enqueue(makeSelectionChangeRunner(gen))
  → gen check passes → plugin.call('on_selection_change', payload)
  → on_selection_change patches last_resolve_input selection fields
  → re-runs build_viewport → returns viewport_data
  → viewportData updated
```

### Field update flow (Styles panel → DB)

```
User edits a field value in StyleField, confirms (Enter)
  → confirmUpdateStyle() calls onFieldUpdate({layerId, property, value})
  → pluginManager.fieldUpdate(update)
  → enqueue(on_field_update)
  → on_field_update calls kit10_write_render_entry_to_layer
  → host writes render_entry to DB via Manager API
  → DB write triggers resolve flow above
```

**Future (not yet built): hover/preview intermediary value.** The idea is to let the renderer show a value live while the user is still interacting with a suggestion (e.g. hovering a dropdown option) before it's committed to the DB. Don't implement this as mutable cross-call state in Charter — it already has exactly one exemption to "stateless per call" (`last_resolve_input`, used by `on_selection_change` to patch-and-rebuild without a full resolve). The natural fit is a sibling entry point, e.g. `on_field_preview`, that patches the property value into a copy of `last_resolve_input` and reruns `build_viewport`, the same way `on_selection_change` does — never writing the DB and never mutating the stored `last_resolve_input` itself. Keep this in mind before refactoring the `on_selection_change` patch-and-rebuild pattern away, since a future preview path would reuse it.

---

## Key Invariants

1. **Do not call `resolveManySlowPath` per-view in the live-query loop.** `fetchResolutionRows` + `resolveViewsFromRows` (or the `resolveManyViews` wrapper) resolves all project views in a single batched fetch. `resolveManySlowPath` is the per-view pre-optimization path and is O(views) — its name signals its cost.

2. **Cancelled + version on async resolve.** The resolution `$effect` sets `cancelled = true` on cleanup and checks `version === reResolveVersion` before writing `resolvedViews`. Fast project switching cannot cause stale data to overwrite fresh data. The version counter guards the single async fetch window (one IPC crossing); `resolveViewsFromRows` is sync, so there is no second window to guard.

3. **Charter is stateless except `last_resolve_input`.** Everything else is rebuilt each call from the payload. KV store (`kit10_kv_get/set`) is for plugin-scoped persistence, not cross-call state.

---

## Common Pitfalls

- **Charter and Vellum are two separate WASM builds — editing one's Rust source doesn't rebuild or deploy either.** Charter (`plugins/charter/`) compiles via plain `cargo build --target wasm32-unknown-unknown --release`, and the output must be manually copied to `static/charter.wasm` (the URL the editor actually loads from — see `PLUGINS.md`). Vellum (`taf_can_do/`, a separate repo) compiles via the `wasm-pack` command documented in the Vellum section below, output copied into `src/lib/vellum/`. `cargo build`/`cargo test` inside either crate only builds a native host-target binary for running unit tests — it does **not** touch either deployed artifact. It's easy to edit Charter's `lib.rs`, run `cargo test`, see everything pass, and conclude the fix shipped — but the browser is still running whatever `.wasm` was last actually copied into place. After any Charter or Vellum Rust change meant to reach the running app, rebuild **and copy** the specific artifact that changed (both, if the change touches the contract between them) before testing in a browser.

- **A `#[serde(rename_all = "camelCase")]` added to a Charter struct that crosses into `manager.svelte.ts`'s snake_case reads (`parsed.viewport_data`, `parsed.node_view_ids`, etc.) silently breaks that field with zero errors anywhere.** Rust-side unit tests that only assert on struct fields (not the actual serialized JSON) will still pass — they never see the renamed key. The JS side just sees `undefined`, defaults to an empty fallback (e.g. `?? []`), and the feature quietly does nothing. Only `on_field_update`'s JS-authored input structs (`FieldUpdate`, `WriteRenderEntryInput`/`Result`) need camelCase, because JS is the one authoring that JSON; the JSON _this plugin authors_ for the editor to read back (`OnResolveResult`, `OnSelectionChangeResult`) must stay plain Rust snake_case, matching what `manager.svelte.ts` actually reads. When adding a field to one of these output structs, write a test that asserts on the serialized JSON string's key names, not just the Rust struct's fields — that's the only kind of test that would have caught this.

- **`parse_px` only handles pixel values.** CSS values like `auto`, `%`, `em` silently return `0.0` in Charter. Store only plain numbers or `NNpx` strings in render entries for box sizing properties.

- **`transparent` color is not handled by `parse_color`.** Only hex (`#rrggbb`, `#rrggbbaa`) and `rgb(r,g,b)` are supported. Named CSS colors become black. Store hex values.

- **A view referenced by nobody's `children` always renders top-level — there's no separate "hide this view" flag anymore.** Whether a view gets its own top-level grid cell or only renders as someone's child is derived by `build_viewport` from the composition graph itself (is this view's id in any box's `child_view_ids`?), not declared on the view. If a newly-created view is meant to only ever appear as a child, the fix is to actually put it in some box's `children` — there's nothing else to set.

- **The `render_entries` constraint** (`value` or `token_id`, exactly one) means you cannot have a render entry with both a literal value and a token. `children` can be either — Charter/resolve.ts treat a token-backed `children` and a literal JSON-array `children` identically — but the editor's own `ChildViewField` picker always routes through a View-scoped `view-list` token, never writes a literal, because a view's child list is inherently per-instance data. Only hand-authored seed data (`seed.ts`'s `setLayerChildren`) still uses the literal path.

- **View-scope `children` tokens are self-declaring — a view's children need no render entry at all.** `resolve.ts` (batched path) has a post-pass: if no kit layer declares `children` for a view, the view's own `children` view-list token (conventionally aliased `children`, matched in `tokensByView`) materializes `childViewIds` directly. Only the **view's own** token self-declares — a kit/project-scope `children` token does not, so a kit default can never force a children slot onto every view composing the kit (tested by `resolve.test.ts`'s self-declaring pair). When a kit layer *does* declare `children`, the same view token overrides it by alias (view-scope wins). Consequence: children are unconditional per view once a view-scope token exists (an instance override; see [[project_view_token_override_precedence]]) — conditional children are a kit/layer concern, not an instance one. **The seed declares no `children` render entry** for buttonKit; each button's labels come purely from its view-scope token.

- **Writing a per-view override (e.g. one view's `children`) goes through `api.upsertViewToken(projectId, viewId, alias, value)` — never through the resolved property's `tokenId`.** A View token overrides a same-named Kit/Project token during resolution (CONCEPTS.md §Tokens: "a View token overrides a Kit token of the same name"), matched by **alias** in `resolve.ts`'s `viewListTokenMap`/`tokenMap`. A resolved property's `tokenId` is instead the *declaring render entry's* token — for a kit-declared property that's a shared kit-scoped base, so writing it either moves every view at once or is silently shadowed. `upsertViewToken` (find-or-create the view-scoped token for the alias, in one transaction) is the whole write path — used by **both** `ChildViewField.svelte` and the Views panel's drag-and-drop nesting (`Views.svelte`'s `setViewChildren`), and needs no render entry (children self-declare, above). This bug hit both call sites before they shared the helper.

- **A per-frame cache split from the real scene data can go stale silently.** `Graphics::build_screen_texts`'s `text_cache` (in `taf_can_do/src/render/mod.rs`, reusing `Vec` allocations across frames) used to only set `content`/`font_family`/`font_weight`/`font_style` once, on a freshly-grown slot (`if cached.content.is_empty()`) — `position`/`size`/`color` resynced every frame correctly, but those four fields never did again once set. Editing a text node's font-family or font-weight while its array index stayed the same across resolves (the normal case — you're editing a property, not restructuring the tree) silently never reached the renderer: layout updated correctly (it reads `layout_result.text_areas`, built fresh, directly), so the box visibly resized, but the actual glyphs stayed frozen at whatever was first drawn. Always resync every field from the fresh layout data every frame (`resync_text_cache`) — a cache like this exists only to reuse the `Vec`'s allocation, never to freeze content.

- **PGlite is single-threaded.** `Promise.all` for multiple queries does not parallelize them — they queue behind each other. This is why `fetchResolutionRows` uses a single batched UNION ALL query (one IPC crossing) rather than multiple `Promise.all` groups that would queue sequentially inside the worker anyway.

- **Never map a "where is this node" concept onto taffy's `Position::Absolute` for an auto-sized box.** `Position::Absolute` in CSS/taffy bundles two unrelated things: "don't participate in the parent's flow" (what you probably want) and "compute your own size via CSS shrink-to-fit intrinsic sizing" (a probing algorithm you almost certainly don't). When top-level view placement (`NodePosition`, see the Vellum section) was first implemented via `Position::Absolute` + `inset`, taffy's shrink-to-fit sizing pass probed the intrinsic width by calling the text measure function with `available_space.width = Definite(0.0)` — not the `MinContent`/`MaxContent` enum variants — and `measure_text_node` (`taf_can_do/src/render/mod.rs`) treated that literally, wrapping text to a real width of 0. Taffy then adopted 0 as the box's final auto-width: a near-zero-width box whose text wrapped one glyph per line, ballooning height and spilling glyphs sideways. The fix was architectural, not a measurer patch: `build_taffy_tree` gives any positioned root its own independent tree (ordinary auto-sizing, no `Position::Absolute` involved at all), and placement is applied as a pure post-layout translation (`compute_layout`'s `offset` param). `measure_text_node` still defensively treats `Definite(w <= 0.0)` like `MinContent`/`MaxContent` as a second line of defense, since 0 is never a meaningful wrap instruction — but the real lesson is: if you need "don't affect siblings" without "resize yourself via shrink-to-fit," don't reach for `Position::Absolute` — decouple placement from sizing entirely.

- **`#[host_fn]` declarations must use typed structs, never raw `u64`.** extism-pdk's macro always routes non-`()` params/returns through `ToMemory`/`FromBytes`. A parameter typed `u64` gets treated as a plain value and re-serialized into a _new_ memory block (its raw bytes), not passed through as the offset you intended — silently corrupting the call instead of erroring. Declare host functions like `fn kit10_write_render_entry_to_layer(input: WriteRenderEntryInput) -> WriteRenderEntryResult;` with both structs deriving `ToBytes, FromBytes` + `#[encoding(Json)]`, and let the macro handle memory marshaling. Also remember every struct that crosses the JS/Rust boundary needs `#[serde(rename_all = "camelCase")]` — Rust's default is snake_case, JS sends camelCase, and a mismatch fails deserialization silently (`unwrap_or_default()` swallows the error).

- **Vellum's box shader (`taf_can_do/src/render/shader.wgsl`) assumes an opaque fill wherever a border is drawn.** `composite_border` blends border/fill alpha using the fill's own alpha as the base — a `Box`/`RectInstance` with a transparent fill (`color.a == 0`) and an opaque colored border renders **completely invisible, border included**, not just a transparent center. Any hollow/outline-only box (as used for Vellum's own selection outline) needs the fixed alpha-compositing formula (blend the "border over fill" alpha, not just RGB) — don't reintroduce the old fill-alpha-only version.

- **`cargo build` does not validate embedded WGSL.** Shader source is loaded as a plain string (`include_str!` or similar) and only actually compiled by wgpu at runtime in the browser — a syntax or type error in `.wgsl` files will build fine and only surface as a runtime failure. Validate with `naga` before shipping a shader change you can't visually test: a throwaway crate depending on `naga = { version = "...", features = ["wgsl-in"] }` (match the version already pinned in the target crate's `Cargo.lock`) calling `naga::front::wgsl::parse_str` then `naga::valid::Validator::validate` catches most of what wgpu itself would reject.

- **Vellum's `SceneUniforms` (Rust, `taf_can_do/src/render/types.rs`) is one shared uniform buffer read by several different WGSL shaders (`shader.wgsl`, `image_shader.wgsl`, `glyph_shader.wgsl`, `grid_shader.wgsl`, `composite_shader.wgsl`), each declaring only the struct fields it actually needs.** WGSL only requires a shader's declared `Globals`/`SceneUniforms` struct to be a byte-compatible _prefix_ of the real buffer, not the whole thing — `shader.wgsl`, for instance, doesn't declare `grid_color` at all despite it being in the same physical buffer. This means new fields must always be **appended at the end, never inserted in the middle** — inserting one shifts every subsequent field's byte offset out from under every _other_ shader still reading the old layout, silently corrupting their uniforms with zero compile-time or `naga`-validation error (naga only validates one shader file in isolation; it has no idea the buffer is shared, or by whom). Keep the Rust struct's total size a multiple of 16 bytes too (pad with an explicit trailing array) — uniform buffer bindings are picky about this on some backends.
  - **`vec3<T>` has 16-byte alignment in WGSL's uniform address space — Rust's `[f32; 3]` does not (it's plainly 4-byte-aligned).** Using `vec3<f32>` as an explicit WGSL-side padding field to mirror a Rust `_padding: [f32; 3]` field is a real bug, not just visual clutter: WGSL inserts _its own_ implicit padding before the vec3 to satisfy its 16-byte alignment, landing every field after it at a different offset than the identical-looking Rust struct actually has. If you want an explicit padding field in WGSL for documentation, match Rust's array padding with individual scalar fields (`_pad_a: f32, _pad_b: f32, _pad_c: f32`) — or simplest and least error-prone: don't declare a padding field in WGSL at all and let its automatic std140-like alignment insert the exact same padding implicitly (this is what `composite_shader.wgsl` does; verified against Rust with a `std::mem::offset_of!`-based unit test in `types.rs`, since `naga` validates a shader's internal consistency but has no way to know it's supposed to match some other language's struct layout).
