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

**Owns:** Translating resolved kit data into a flat `UiNode[]` render tree. Layout grid logic. Selection highlighting. Field category definitions.

**Must NOT:** query the DB directly, hold cross-call mutable state beyond Extism `var` storage, or do text measurement (emit `width:0, height:0` for Text nodes; Vellum measures them).

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

**Selection highlighting:** when `sel == 2` (active or primary), the box border is overridden to blue (`[0, 0.48, 1, 1]`, 2px). When `sel == 1` (secondary), gray 1px border.

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

**Owns text measurement.** Text nodes arrive with `width:0, height:0`; Vellum measures them during the layout pass using cosmic-text constrained by available space from the parent.

**`UiNode[]` contract:**
- Nodes are a flat array. Parent-child relationships use `parent_id: number | null` (index into the array).
- `Box{width:0, height:0}` → auto-size to children + padding. Vellum's layout engine handles this.
- `Text{width:0, height:0}` → Vellum measures during layout. Do not pre-patch text dimensions in the host.
- `max_width: 0` and `max_height: 0` → no constraint (not "max is 0px").
- `flex_direction` on Box controls child stacking: `"Row"` | `"Column"` | `"RowReverse"` | `"ColumnReverse"`.

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
