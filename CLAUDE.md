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
- `resolveMany(db, viewId)` — resolve all kits for one view (~8 round-trips). Used for single-view use cases.
- `resolveManyViews(db, projectId)` — resolve ALL project views in 4 round-trips total. This is the hot path used by the editor's live-query loop.
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

**`resolveManyViews` round-trips:**
- RT1: all views for the project
- RT2 (parallel): compositions + axis_args + project tokens + view tokens
- RT3 (parallel): kit tokens + all layers
- RT4 (parallel): layer conditions + layer entries

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
- A single 10-table JOIN query watches all resolution-relevant tables.
- On any write, `scheduleReResolve` debounces and calls `resolveManyViewsManager`.
- Fingerprint comparison (`kitFingerprint`) skips Svelte re-renders when resolved data didn't actually change.
- A `cancelled` flag + `reResolveVersion` counter ensures stale async results from a previous project are discarded.

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

**`width: 0.0` semantics (important):**
- `Box{width:0}` → Vellum auto-sizes this box to its children + padding.
- `Text{width:0, height:0}` → Vellum measures during layout (cosmic-text, constrained by parent available space). Charter must always emit 0 for text dimensions.

**Host functions (Charter → Host calls):**
| Function | Description |
|---|---|
| `kit10_log` | Structured log forwarded to browser console with level/color |
| `kit10_kv_get` / `kit10_kv_set` | Per-plugin key-value store (in-memory) |
| `kit10_get_resolution` | Returns current `resolvedKits` JSON to Charter |
| `kit10_write_render_entry_to_layer` | Writes a field value back to DB via Manager API |
| `kit10_set_viewport_data` | Direct viewport update bypass (legacy, avoid) |

---

### 5. Charter Plugin (`plugins/charter/src/lib.rs`)

**Owns:** Translating resolved kit data into a flat `UiNode[]` render tree. Layout grid logic. Marking which nodes are selected. Field category definitions.

**Must NOT:** query the DB directly, hold cross-call mutable state beyond Extism `var` storage, or do text measurement (emit `width:0, height:0` for Text nodes; Vellum measures them).

**Charter does not have to 1:1-expose every CSS-like capability Vellum gains as a literal render-panel property.** As Vellum's layout engine grows (flex-grow, alignment, wrap, margin, etc.), Charter is free to have its own opinion about what a designer should actually need to set by hand versus what it infers/defaults sensibly — it's an opinionated translation layer (VISION.md 1st Principle), not a raw CSS pass-through. Don't treat "Vellum can do X" as "therefore the Render panel must expose a literal `X` property."

**Entry points:**

| Function | Trigger | Input | Output |
|---|---|---|---|
| `on_init` | Plugin load | `{name}` | `"ok"` |
| `on_resolve` | Data change | `OnResolveInput` | `OnResolveResult` (viewport + categories) |
| `on_selection_change` | Selection change only | `{primary, secondary, activeViewId}` | `{viewport_data}` |
| `on_field_update` | User edits a field | `FieldUpdate` | `WriteRenderEntryResult` |

**`on_resolve` stores its full input payload** in Extism `var` storage as `last_resolve_input`. `on_selection_change` reads this, patches the three selection fields (`selected_view_primary`, `selected_view_secondary`, `active_view_id`), and re-runs `build_viewport`. This avoids a full re-resolve round-trip for selection-only changes.

**`build_viewport` layout:**
```
Root Column (padding: 40px all sides)
  Row (padding-bottom: 32px gap)
    Cell Column (padding-right: 32px gap)  ← one per view, max 4 per row
      View Box (width:0 auto, bg, border, radius, padding)
        [child views rendered recursively, or nothing if no content]
```

**Primitive detection (`detect_primitive`):**
- If props have only text properties (`color`, `font-size`, etc.) → `"text"` → emit `Text` node directly.
- Otherwise → `"box"` → emit `Box` node, recurse into `child_view_ids`.

**Fallback text in box primitive:** only fires when `child_ids` is empty AND the kit has an explicit `content` property. **Never fires on `color` alone** — boxes always have `color` (their text color) but only emit inline text when they own the actual string content.

**Selection marking:** Charter sets `BoxData.selected` (0 = none, 1 = secondary, 2 = primary/active) and otherwise leaves the node's own `border_color`/`border_width` untouched. **Do not go back to overriding border fields for selection** — Vellum owns the actual selection visuals (see its section below) as a separate overlay, keyed off this field.

**`CharterHints` (from view `hints.charter` JSON):**
- `primitive: "box" | "text"` — override auto-detection
- `child_only: bool` — exclude from top-level grid, only render as a child of another view
- `position: [f32; 2]` — vestigial from old absolute-positioning architecture, now ignored

---

### 6. Vellum (`src/lib/vellum/`)

**Owns:** GPU rendering, camera (pan/zoom), layout engine (flex-direction, auto-sizing).

**Rebuilding the wasm binary** (source in `taf_can_do/`):
```
wasm-pack build --target web --no-default-features --no-opt --out-dir ../kit10/src/lib/vellum
```
`--no-default-features` is **required** — the `standalone` feature (desktop winit/pollster) gates out all `#[wasm_bindgen]` exports. Building without it produces a ~17KB stub with no exports. `--no-opt` bypasses wasm-opt, which fails on bulk-memory ops in the bundled wasm-opt version.

**`taf_can_do/` is a separate, private repo — do not push it.** Only the compiled `vellum_renderer_bg.wasm` (and the generated JS/`.d.ts` glue) get committed into `kit10`; the Rust source changes stay local to that repo.

**Glyph atlas needs a padding gutter between packed glyphs** (`taf_can_do/src/text/atlas.rs`, `GLYPH_PADDING`). The glyph sampler uses bilinear filtering (`taf_can_do/src/text/mod.rs`); packing glyphs edge-to-edge with no gap means sampling near a glyph's border blends in a texel from whatever's packed next to it — visible as thin lines/fringes bleeding off characters. `ClampToEdge` only guards the whole atlas texture's outer border, not the seams between individual packed glyphs — it does not prevent this.

**Owns text measurement.** Text nodes arrive with `width:0, height:0`; Vellum measures them during the layout pass using cosmic-text constrained by available space from the parent.

**`UiNode[]` contract:**
- Nodes are a flat array. Parent-child relationships use `parent_id: number | null` (index into the array).
- `Box{width:0, height:0}` → auto-size to children + padding. Vellum's layout engine handles this.
- `Text{width:0, height:0}` → Vellum measures during layout. Do not pre-patch text dimensions in the host.
- `max_width: 0` and `max_height: 0` → no constraint (not "max is 0px").
- `flex_direction` on Box controls child stacking: `"Row"` | `"Column"` | `"RowReverse"` | `"ColumnReverse"`.
- `BoxExtra` also carries `align_items`/`justify_content`/`flex_wrap` (container), `flex_grow`/`flex_shrink`/`align_self` (item), and `margin` (uniform, all four sides) — full taffy fields, mapped 1:1 in `apply_box_extra` (`taf_can_do/src/layout/mod.rs`). `None` on the `Option`-typed ones means "don't touch it, leave taffy's own CSS-matching default" rather than "set to some zero value" — `flex_shrink: None` still ends up `1.0` (taffy's default), not `0.0`. Auto-margin centering is deliberately not exposed; use `align_items`/`justify_content` on the parent instead. Charter maps these from kit properties of the same CSS name (`align-items`, `justify-content`, `flex-wrap`, `flex-grow`, `flex-shrink`, `align-self`, `margin`) — see the note in the Charter section above about not needing to 1:1-expose every capability as a literal render-panel property; these were exposed directly because there's no clearer "smarter default" for general-purpose layout primitives yet.
- Every `Box`/`Text`/`Img` variant has a `selected: u8` field (0/1/2 = none/secondary/primary). Charter sets it; Vellum owns everything about how it's drawn.

**Selection is a separate overlay, not a border override.** `Graphics.selection_decorations` (`taf_can_do/src/render/mod.rs`) captures the layout rect + `selected` kind of every selected node after each layout pass. `rebuild_selection_instances`, called every frame from `write_frame` (not just on scene change), turns those into an outline `RectInstance` (transparent fill, colored border, sitting *outside* the element via an outward offset) plus 4 corner-handle instances, reusing the existing box shader/pipeline — no shader changes needed. The element's own `border_color`/`border_width` are never touched.

**Why every frame, not just on selection/scene change:** `border_width`, the outset gap, and the handle size are all expressed in world units as `desired_screen_px / view_zoom`, so they render as a constant number of screen pixels regardless of zoom. But `pan`/`zoom_in_at`/`zoom_out_at`/`set_zoom` only update `view_zoom`/`view_offset` and the uniform buffer — they never touch `instance_buffer` or re-run `update()`. If the selection instances were only rebuilt on scene change, they'd go stale (wrong on-screen thickness) the moment the user zoomed without also re-selecting something. Rebuilding cheaply every frame in `write_frame` sidesteps having to hook every current and future zoom/pan mutator individually.

**API surface used:**
```ts
vellum.initialize(canvasId, w, h)  // once on mount
vellum.set_data(json)              // update UiNode[] — text nodes may have zero dimensions
vellum.render()                    // draw one frame (called from rAF loop)
vellum.resize(w, h)                // on canvas resize
vellum.set_pan(dx, dy)             // pan delta
vellum.zoom_in_at(cx, cy)          // zoom toward point
vellum.zoom_out_at(cx, cy)         // zoom away from point
vellum.set_colors(...)             // grid + background colors (for light/dark theme)
```

---

## Data Flow

### Resolve flow (axis change or view selection)

```
DB write (axis_args or render_entries)
  → PGlite live query fires
  → scheduleReResolve (debounce 0ms)
  → resolveManyViewsManager(db, projectId)   [4 round-trips]
  → resolvedViews updated (fingerprint check)
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

1. **Do not call `resolveMany` per-view in the live-query loop.** `resolveManyViews` covers all project views in 4 round-trips. `resolveMany` is the per-view pre-optimization path and is O(views).

2. **Cancelled + version on async resolve.** The resolution `$effect` sets `cancelled = true` on cleanup and checks `version === reResolveVersion` before writing `resolvedViews`. Fast project switching cannot cause stale data to overwrite fresh data.

3. **Charter is stateless except `last_resolve_input`.** Everything else is rebuilt each call from the payload. KV store (`kit10_kv_get/set`) is for plugin-scoped persistence, not cross-call state.

---

## Common Pitfalls

- **`parse_px` only handles pixel values.** CSS values like `auto`, `%`, `em` silently return `0.0` in Charter. Store only plain numbers or `NNpx` strings in render entries for box sizing properties.

- **`transparent` color is not handled by `parse_color`.** Only hex (`#rrggbb`, `#rrggbbaa`) and `rgb(r,g,b)` are supported. Named CSS colors become black. Store hex values.

- **Do not add views to `project_views` without a `hints` object.** Charter assumes `hints` is a JSON object; missing hints default to an empty map, which is fine, but `child_only` will default to false and the view will appear in the top-level grid.

- **Child-only views must have `charter.childOnly: true` in their hints.** Otherwise they appear as standalone frames in the viewport grid AND as children of their parent view (double rendering).

- **The `render_entries` constraint** (`value` or `token_id`, exactly one) means you cannot have a render entry with both a literal value and a token. The `children` property always uses a literal value (JSON array string).

- **PGlite is single-threaded.** `Promise.all` for multiple queries does not parallelize them — they queue behind each other. The parallelism in `resolveManyViews` is logical (code clarity) but executes sequentially inside PGlite's worker.

- **`#[host_fn]` declarations must use typed structs, never raw `u64`.** extism-pdk's macro always routes non-`()` params/returns through `ToMemory`/`FromBytes`. A parameter typed `u64` gets treated as a plain value and re-serialized into a *new* memory block (its raw bytes), not passed through as the offset you intended — silently corrupting the call instead of erroring. Declare host functions like `fn kit10_write_render_entry_to_layer(input: WriteRenderEntryInput) -> WriteRenderEntryResult;` with both structs deriving `ToBytes, FromBytes` + `#[encoding(Json)]`, and let the macro handle memory marshaling. Also remember every struct that crosses the JS/Rust boundary needs `#[serde(rename_all = "camelCase")]` — Rust's default is snake_case, JS sends camelCase, and a mismatch fails deserialization silently (`unwrap_or_default()` swallows the error).

- **Vellum's box shader (`taf_can_do/src/render/shader.wgsl`) assumes an opaque fill wherever a border is drawn.** `composite_border` blends border/fill alpha using the fill's own alpha as the base — a `Box`/`RectInstance` with a transparent fill (`color.a == 0`) and an opaque colored border renders **completely invisible, border included**, not just a transparent center. Any hollow/outline-only box (as used for Vellum's own selection outline) needs the fixed alpha-compositing formula (blend the "border over fill" alpha, not just RGB) — don't reintroduce the old fill-alpha-only version.

- **`cargo build` does not validate embedded WGSL.** Shader source is loaded as a plain string (`include_str!` or similar) and only actually compiled by wgpu at runtime in the browser — a syntax or type error in `.wgsl` files will build fine and only surface as a runtime failure. Validate with `naga` before shipping a shader change you can't visually test: a throwaway crate depending on `naga = { version = "...", features = ["wgsl-in"] }` (match the version already pinned in the target crate's `Cargo.lock`) calling `naga::front::wgsl::parse_str` then `naga::valid::Validator::validate` catches most of what wgpu itself would reject.
