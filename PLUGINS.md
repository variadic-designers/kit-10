# KIT•10 — Plugin System

KIT•10 has two kinds of plugins with different roles and different levels of system access.

---

## Two-tier architecture

```
┌──────────────────────────────────────────────────────────┐
│  Editor (host)                                           │
│  ├── Core renderer  ◄── wasm-bindgen (Vellum)           │
│  │     └── owns WGPU canvas, drives the render loop     │
│  └── Data plugins   ◄── Extism sandbox                  │
│        └── interpret resolved data, push UiNode trees   │
└──────────────────────────────────────────────────────────┘
```

**Core renderer (Vellum)** — a single Rust/WGPU crate compiled to WebAssembly via `wasm-bindgen`. It owns the GPU canvas and is loaded directly by the editor. It is not an Extism plugin and cannot be replaced by third parties for now. Vellum integration should not get in the way of future renderers.

**Data plugins (Extism)** — sandboxed WASM modules written in any language with an Extism PDK. They receive resolved design data and decide what to draw and what fields to show. This is where all third-party extensibility lives: viewport interpreters, render targets (CSS, SCSS, JSON), domain-specific renderers.

**Utility plugins** — a third category, called on demand rather than participating in the `on_resolve`/`on_selection_change`/`on_field_update` lifecycle at all. Loaded via the editor's `loadUtilityPlugin` (not `loadPlugin`) so they coexist with the active viewport-interpreter plugin instead of replacing it, and invoked with `callUtilityPlugin(name, fn, payload)` whenever something needs them — no continuous resolve loop. Extism's `allowedHosts` capability (requires `runInWorker: true`) lets a utility plugin make sandboxed HTTP requests, restricted to an explicit host allowlist. `plugins/fontavious/` (fetches WOFF2 font files from vendor CDNs) is the first example — its exports are `on_init` plus three on-demand functions (`search_fonts`, `fetch_font`, and `variant_url` — a cheap, no-HTTP catalogue lookup answering "which URL would `fetch_font` use for this request", so a caller can dedupe against already-loaded URLs without asking the renderer to introspect font internals), no viewport/resolve entry points at all.

**Adding a new suggestion-backed field type (fonts are just the first case):**
1. Write a utility plugin exposing a search function returning `Vec<{ value, label }>` JSON (substring/fuzzy match against whatever catalogue it owns), and optionally a fetch function taking `{ value }` and returning raw bytes if picking a suggestion needs to fetch/produce something (fonts do; a plain autocomplete wouldn't need this).
2. In the plugin that *defines* the field (e.g. Charter), set `FieldDef.inputType` to a name for the kind (e.g. `"font"`, `"icon"`) — nothing more. **Never put the provider plugin's name in the defining plugin's source** — that's the lock-in this whole mechanism exists to avoid (see VISION.md's 1st Principle).
3. Register the mapping in `src/lib/plugins/suggestion-providers.ts`: `inputType → { plugin, searchFn, fetchFn? }`. This is the one place "which plugin currently serves this kind" lives — editable without recompiling any plugin.
4. `StyleField.svelte`'s `SuggestField.svelte` handles the rest generically (search-as-you-type, keyboard nav, fetch-on-pick). If the fetched bytes need special handling (like `vellum.load_font()` for `"font"`), that goes in `StyleField.svelte`'s `confirmSuggestionPick`, keyed off `inputType` — that's the one place allowed to have an opinion about what a specific *kind* means, since `SuggestField` itself stays fully generic.

---

## Plugin functions

These are the functions a plugin must or may export. All inputs and outputs are JSON strings.

### `on_init(input: string) -> string`

Called once when the plugin loads.

Input:
```json
{ "name": "my-plugin" }
```

Return any string to confirm initialization.

---

### `on_resolve(input: string) -> string`

Called every time the resolution updates — when axis args change, a layer is edited, a token changes, or the active view changes.

Input (`OnResolveInput`):
```json
{
  "activeViewId": "uuid | null",
  "resolvedKits": [ResolvedKit],
  "viewHints": { "<plugin-name>": { ...plugin-specific data } },
  "projectViews": [ResolvedView],
  "selectedViewPrimary": "uuid | null",
  "selectedViewSecondary": ["uuid"]
}
```

Output (`OnResolveResult`):
```json
{
  "categories": [FieldCategory],
  "viewport_data": [UiNode],
  "node_view_ids": ["uuid"],
  "font_requests": [{ "family": "Lato", "weight": 700, "style": "normal" }],
  "viewport_data_binary": "base64…"
}
```

`categories` populates the render panel. `viewport_data` is a `UiNode` tree passed
directly to Vellum. `node_view_ids` is parallel to `viewport_data` (same length/order) —
which view each node belongs to (`""` for structural grid scaffolding), used to map a
viewport click-hit index back to a view id. `font_requests` (optional) is the concrete
post-snapping `(family, weight, style)` set the editor's font scan fetches.
`viewport_data_binary` (optional) is a MessagePack+base64 encoding of `viewport_data`;
when present the host base64-decodes it and calls `vellum.set_data_binary()` instead of
the JSON path — avoids the JSON-parse wall at ~10k views.

Keys are plain snake_case (Charter-authored output) — do **not** add
`#[serde(rename_all = "camelCase")]` to this struct; the host reads these exact names.

---

### `on_field_update(input: string) -> string`

Called when the user edits a field in the render panel.

Input (`FieldUpdate`):
```json
{
  "layerId": "uuid",
  "property": "background",
  "value": "#3b82f6",
  "tokenId": null
}
```

Exactly one of `value` or `tokenId` must be non-null.

Typically delegates to `kit10_write_render_entry_to_layer` to persist the change.

---

### `on_selection_change(input: string) -> string`

Called when only the selection changes — no axis args, layers, or tokens were modified. This is a fast path that avoids a full re-resolve by patching the selection fields into the last known resolve input and re-running layout.

Input:
```json
{
  "primary": "uuid | null",
  "secondary": ["uuid"],
  "activeViewId": "uuid | null"
}
```

Output (`{ viewport_data: UiNode[] }`):
```json
{
  "viewport_data": [UiNode]
}
```

If `on_resolve` has not been called yet in the session, this function should be a no-op (no stored state to patch).

---

### `preferences(input: string) -> string`  *(optional)*

Called by the editor's Settings menu (opened from the profile picture) to discover the **global editor preferences** this plugin wants surfaced. Purely declarative — the same "declare capability as data, host renders + stores it" idiom as `FieldDef.inputType` and `composition_field_keys`. Any plugin (interpreter or utility) may export it; a plugin that doesn't simply contributes nothing to the menu (the host's aggregation, `collectPreferences` in `manager.svelte.ts`, swallows the missing-function error per-plugin).

Input: `"{}"` (reserved for future scoping).

Output (`PreferenceDef[]`) — the real shipped case is Fontavious's license-tier toggles:
```json
[
  {
    "id": "include-tier-ofl",
    "label": "Include OFL fonts",
    "kind": "toggle",          // "toggle" | "select" | "number"
    "group": "Licensing",       // optional section header; defaults to the plugin name
    "default": "true"           // string-encoded (bools as "true"/"false")
  }
]
```
`"number"` may add `"min"`/`"max"`; `"select"` adds `"options": [{ "value", "label" }]`.

Only declare something here if it's genuinely a **global, user-level** preference. A plugin's own structural opinions (e.g. Charter's auto-grid columns/gap) are not preferences and stay internal constants — don't surface them just because they're tunable numbers.

The plugin **never stores the value** — it stays stateless (Key Invariant #3). The host persists values to `localStorage` (`src/lib/plugins/preferences.ts`) and is responsible for feeding them back to the plugin through its normal call inputs (the same pattern `fontFacts` uses to ride `on_resolve`'s input — a value change must force a re-resolve, since preference values are not DB rows and the `rowsKey` dedup never sees them). Wiring a specific preference's value back into `on_resolve` is per-preference work; the discovery/menu half is generic and already in place.

Host preferences that are **not** plugin-owned (theme, reduced motion, and canvas input mappings — pan gesture, zoom-invert — since Vellum is wasm-bindgen, not an Extism plugin) are declared the same way, as data: `editor/host-preferences.ts` is a registry of `PreferenceBinding` entries (a `PreferenceDef` joined to its store + codec). Host and plugin preferences merge into one list and render through a single generic control (`editor/PreferenceControl.svelte`) — the Settings menu has **no per-preference markup**, so adding either kind is a data entry, never a new row. Add a host preference by appending to `host-preferences.ts`; add a plugin preference by exporting it here.

---

## Host functions

These are callable from inside any data plugin. All are in the `extism:host/user` namespace.

### `kit10_log(input: string)`

Emit a log message to the editor console.

```json
{ "level": "debug | info | warn | error", "message": "..." }
```

---

### `kit10_kv_get(key: string) -> string`

Read a value from the plugin's local key-value store. Returns an empty string if the key does not exist. The store is scoped to the plugin instance and persists across `on_resolve` calls within a session.

---

### `kit10_kv_set(input: string) -> string`

Write a value to the plugin's local key-value store.

```json
{ "key": "my-key", "value": "my-value" }
```

Returns `true`.

---

### `kit10_get_resolution() -> string`

Returns the current resolved kits for the active view as `ResolvedKit[]`. Useful when you need resolution data outside of `on_resolve`.

---

### `kit10_write_render_entry_to_layer(input: string) -> string`

Write or update a property on a layer's render snippet. Creates the entry if it does not exist; updates it if it does.

Input (`WriteRenderEntryInput`):
```json
{
  "layer_id": "uuid",
  "property": "background",
  "value": "#3b82f6",
  "token_id": null
}
```

Output (`WriteRenderEntryResult`):
```json
{
  "success": true,
  "entry_id": "uuid",
  "error": null
}
```

Exactly one of `value` or `token_id` must be non-null.

---

### `kit10_set_viewport_data(input: string)`

Push a `UiNode[]` JSON string to the viewport directly. Alternative to returning `viewport_data` from `on_resolve` — useful when you want to update the viewport independently of a resolve cycle.

---

### `kit10_font_cache_get(url: string) -> bytes`

Read cached font bytes for a resolved URL from the persistent IndexedDB byte cache
(`src/lib/plugins/font-cache.ts`). Returns empty bytes on a miss. Best-effort: any cache
fault degrades to empty. Used by Fontavious's `fetch_font` to check the cache before a
vendor CDN, so reloads are network-free/offline.

---

### `kit10_font_cache_put(metaJson: string, bytes: bytes)`

Store font bytes after a CDN miss. `metaJson` carries `{ url, licenseTier, family, … }`
(the `licenseTier` is retained for a future export-only-OFL guard); `bytes` is the raw
WOFF2. Errors are swallowed — a cache-write fault never breaks font fetching.

---

### `kit10_get_project_export(input: string) -> string`

Exposes Manager's `exportProject` (a full project data dump — views, kits, axes, layers,
render entries, tokens) to any plugin on demand, so export-target plugins pull the same
data without the host pre-marshaling a per-plugin payload.

```json
// in:  { "project_id": "uuid" }
// out: { "success": true, "data": { ... } }
```

---

### `kit10_import_project_data(input: string) -> string`

Inverse of `kit10_get_project_export` — wraps Manager's `importProjectData`, creating a
brand-new project (fresh ids throughout) from an export-shaped payload. All id generation
and remapping happen in Manager.

```json
// in:  { "workspace_id": "uuid", "data": { ... } }
// out: { "success": true, "project": { ... } }
```

---

### `kit10_panel_publish(input: string)`

Publish a `PanelManifest` (see below) into the editor's `$state` map, keyed by
`panel_id`. Any editor panel that derives off `pluginManager.panelManifest(id)`
re-renders. Decoupled from `on_resolve`'s return shape on purpose — a plugin can refresh
its own panel without a full resolve cycle. Charter calls this from inside `on_resolve`
to ship the Views panel topology.

```json
{ "panel_id": "views", "manifest": PanelManifest }
```

---

## Data types

### `ResolvedKit`
```json
{
  "kitId": "uuid",
  "kitName": "Button",
  "properties": {
    "background": {
      "property": "background",
      "value": "oklch(62% 0.19 260)",
      "sourceLayerId": "uuid",
      "kitId": "uuid",
      "isToken": false,
      "tokenAlias": null,
      "tokenId": null,
      "conditionCount": 1,
      "keys": ["axis-uuid"],
      "conditionValues": [{ "axisId": "axis-uuid", "value": "dark" }],
      "viewRefs": null
    }
  }
}
```

There is **no `childViewIds`** on `ResolvedKit` — the resolver is name-neutral about
composition. A property whose value is a `view-list` token carries the referenced view
ids in **`viewRefs`** (otherwise `null`), gated on the value *type*, never on a property
*name* like `children`. A consumer that wants to treat some property as nested
composition identifies it by its own field-kind convention (Charter declares
`composition_field_keys` on its panel manifest; see below), not off any name here.
`keys`/`conditionValues` describe which axes (and matched values) the winning layer
conditioned on. `tokenId` is the render entry's own token row id, for in-place token
edits.


### `ResolvedView`
```json
{
  "viewId": "uuid",
  "viewName": "Dark Compact",
  "hints": { "my-plugin": { ...plugin-specific } },
  "resolvedKits": [ResolvedKit]
}
```

### `FieldCategory`
```json
{
  "name": "layout",
  "fields": [
    {
      "key": "padding",
      "displayText": "Padding",
      "inputType": "text",
      "layerId": "uuid"
    }
  ]
}
```

`inputType` selects the render-panel widget. The table below is GENERATED from the
`InputType` union in `src/lib/plugins/types.ts` (run `npm run generate-docs`) — edit the
union's `@doc:` comments, not this table.

<!-- BEGIN GENERATED: input-types (source: src/lib/plugins/types.ts) — do not edit by hand -->

| `inputType`  | Widget                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------- |
| `color`      | OKLCH color picker — L/C/H/alpha sliders, live swatch, and a legacy hex/rgb/hsl paste row.        |
| `text`       | Plain text input. The default when `inputType` is omitted.                                        |
| `number`     | Numeric input.                                                                                    |
| `select`     | Dropdown over the field's `options` list.                                                         |
| `slider`     | Range slider.                                                                                     |
| `font`       | Suggestion-backed family picker (search-as-you-type). Provider mapped in suggestion-providers.ts. |
| `children`   | View-composition field — the child view list.                                                     |
| `asset`      | Asset picker.                                                                                     |
| `resize`     | Fixed / Hug / Fill segmented control, plus contextual min/max limits via `resizeKeys`.            |
| `arrange`    | Stack / Cluster / Split / Center / Grid tab row, with follow-on fields via `arrangeKeys`.         |
| `spacing`    | Numeric stepper — a scalar, or a CSS T/R/B/L shorthand ladder per `spacingMode`.                  |
| `weight`     | Named-weight segmented control, filtered to the resolved family's real weights.                   |
| `align`      | Left / Center / Right / Justify segmented control.                                                |
| `decoration` | None / Underline / Line-through segmented control.                                                |

<!-- END GENERATED: input-types -->

A plugin that *defines* a field only names the `inputType`; it never names a provider
plugin (see the suggestion-field note above and VISION.md's 1st Principle). Adding a new
`inputType` currently also requires editor-side widget support (`Styles.svelte` /
`StyleField.svelte`) — the set is editor-owned, not yet plugin-extensible.

`layerId` tells the render panel which layer to target when the field is edited.

### Wire type reference (generated)

Field-by-field tables for the `UiNode` wire structs, GENERATED from Charter's schemars-derived
JSON Schema (`plugins/charter/generated/wire-schema.json`, produced by `cargo test --features
schema`; rendered by `npm run generate-docs`). This is the machine-truth contract — the JSON
examples in the sections below are illustrative. `Required: —` means the field is optional
(Rust `#[serde(default)]`); `T?` is a nullable/optional type.

<!-- BEGIN GENERATED: wire-types (source: plugins/charter/generated/wire-schema.json) — do not edit by hand -->

#### `BoxData`

| Field            | Type         | Required |
| ---------------- | ------------ | -------- |
| `bg_color`       | OklabColor   | ✓        |
| `border_color`   | OklabColor   | ✓        |
| `border_width`   | number       | ✓        |
| `corner_radius`  | number       | ✓        |
| `extra`          | BoxExtra     | —        |
| `flex_direction` | FlexDir      | ✓        |
| `height`         | Extent       | ✓        |
| `hovered`        | boolean      | —        |
| `max_height`     | Extent       | —        |
| `max_width`      | Extent       | —        |
| `min_height`     | Extent       | —        |
| `min_width`      | Extent       | —        |
| `opacity`        | number       | ✓        |
| `padding`        | [number × 4] | ✓        |
| `parent_id`      | integer?     | —        |
| `selected`       | integer      | —        |
| `shadow`         | BoxShadow?   | —        |
| `show_border`    | boolean      | ✓        |
| `width`          | Extent       | ✓        |

#### `TextData`

| Field             | Type               | Required |
| ----------------- | ------------------ | -------- |
| `bg_color`        | OklabColor         | ✓        |
| `border_color`    | OklabColor         | ✓        |
| `border_width`    | number             | ✓        |
| `content`         | string             | ✓        |
| `corner_radius`   | number             | ✓        |
| `font_family`     | string             | ✓        |
| `font_size`       | number             | ✓        |
| `font_style`      | FontStyle          | ✓        |
| `font_weight`     | integer            | ✓        |
| `height`          | Extent             | ✓        |
| `hovered`         | boolean            | —        |
| `line_height`     | number             | —        |
| `opacity`         | number             | ✓        |
| `padding`         | [number × 4]       | ✓        |
| `parent_id`       | integer?           | —        |
| `selected`        | integer            | —        |
| `show_border`     | boolean            | ✓        |
| `text_align`      | TextAlign          | —        |
| `text_color`      | OklabColor         | ✓        |
| `text_decoration` | TextDecorationKind | —        |
| `width`           | Extent             | ✓        |

#### `ImgData`

| Field             | Type         | Required |
| ----------------- | ------------ | -------- |
| `fit`             | string       | —        |
| `height`          | Extent       | ✓        |
| `hovered`         | boolean      | —        |
| `object_position` | [number × 2] | —        |
| `parent_id`       | integer?     | —        |
| `selected`        | integer      | —        |
| `source`          | ImageSource  | ✓        |
| `width`           | Extent       | ✓        |

#### `AlignValue`

One of: `"Start"`, `"End"`, `"FlexStart"`, `"FlexEnd"`, `"Center"`, `"Baseline"`, `"Stretch"`

#### `BoxExtra`

| Field                   | Type                 | Required |
| ----------------------- | -------------------- | -------- |
| `align_items`           | AlignValue?          | —        |
| `align_self`            | AlignValue?          | —        |
| `flex_basis`            | Extent?              | —        |
| `flex_grow`             | number               | —        |
| `flex_shrink`           | number?              | —        |
| `flex_wrap`             | FlexWrapValue        | —        |
| `gap`                   | number               | —        |
| `grid_auto_columns`     | TrackSize[]          | —        |
| `grid_auto_rows`        | TrackSize[]          | —        |
| `grid_column`           | [GridLine, GridLine] | —        |
| `grid_row`              | [GridLine, GridLine] | —        |
| `grid_template_columns` | TrackSize[]          | —        |
| `grid_template_rows`    | TrackSize[]          | —        |
| `justify_content`       | JustifyValue?        | —        |
| `margin`                | number               | —        |
| `position`              | NodePosition         | —        |

#### `BoxShadow`

| Field           | Type       | Required |
| --------------- | ---------- | -------- |
| `blur_radius`   | number     | ✓        |
| `color`         | OklabColor | ✓        |
| `inset`         | boolean    | ✓        |
| `offset_x`      | number     | ✓        |
| `offset_y`      | number     | ✓        |
| `spread_radius` | number     | ✓        |

#### `Extent`

One of:

- `string`
- `{ "Px": number }`
- `{ "Percent": number }`

#### `FlexDir`

One of: `"Row"`, `"Column"`, `"RowReverse"`, `"ColumnReverse"`

#### `FlexWrapValue`

One of: `"NoWrap"`, `"Wrap"`, `"WrapReverse"`

#### `FontStyle`

One of: `"Normal"`, `"Italic"`, `"Oblique"`

#### `GridLine`

One of:

- `"Auto"`
- `{ "Line": integer }`
- `{ "Span": integer }`

#### `ImageSource`

One of:

- `"None"`
- `{ "Bytes": integer[] }`
- `{ "Ref": string }`

#### `JustifyValue`

One of: `"Start"`, `"End"`, `"FlexStart"`, `"FlexEnd"`, `"Center"`, `"Stretch"`, `"SpaceBetween"`, `"SpaceEvenly"`, `"SpaceAround"`

#### `NodePosition`

One of:

- `"Relative"`
- `{ "Absolute": object }`

#### `OklabColor`

| Field   | Type   | Required |
| ------- | ------ | -------- |
| `a`     | number | ✓        |
| `alpha` | number | ✓        |
| `b`     | number | ✓        |
| `l`     | number | ✓        |

#### `TextAlign`

One of: `"Left"`, `"Center"`, `"Right"`, `"Justify"`

#### `TextDecorationKind`

One of: `"None"`, `"Underline"`, `"LineThrough"`

#### `TrackSize`

One of:

- `"Auto", "MinContent", "MaxContent"`
- `{ "Px": number }`
- `{ "Fr": number }`
- `{ "AutoFit": number }`

<!-- END GENERATED: wire-types -->

### `UiNode`

A flat array of nodes. Parent-child relationships are expressed via `parent_id` (index into the array). Nodes with `parent_id: null` are roots.

Vellum renders these in index order. Parent layout is computed before children.

Size fields (`width`/`height`/`min_width`/`min_height`/`max_width`/`max_height`) are an **`Extent` enum**, not bare numbers: `"Auto"`, `{ "Px": 200.0 }`, or `{ "Percent": 0.5 }` (0.5 = 50%). `min`/`max` are Box-only.

**Box node:**
```json
{
  "Box": {
    "parent_id": null,
    "width": { "Px": 200.0 },
    "height": { "Px": 80.0 },
    "min_width": "Auto",
    "min_height": "Auto",
    "max_width": "Auto",
    "max_height": "Auto",
    "padding": [8.0, 8.0, 8.0, 8.0],
    "bg_color": { "l": 0.55, "a": 0.02, "b": -0.16, "alpha": 1.0 },
    "flex_direction": "Column",
    "show_border": false,
    "border_color": { "l": 0.0, "a": 0.0, "b": 0.0, "alpha": 1.0 },
    "border_width": 0.0,
    "corner_radius": 8.0,
    "opacity": 1.0,
    "shadow": null,
    "selected": 0,
    "hovered": false
  }
}
```
(`extra: BoxExtra` — gap/align/flex/`flex_basis`/grid/position — is omitted here; it defaults when absent. `selected` is `0|1|2` = none/secondary/primary — Charter sets it, Vellum owns how it's drawn; `hovered` is independent of selection.)

**Text node:**
```json
{
  "Text": {
    "parent_id": 0,
    "width": "Auto",
    "height": "Auto",
    "padding": [0.0, 0.0, 0.0, 0.0],
    "bg_color": { "l": 0.0, "a": 0.0, "b": 0.0, "alpha": 0.0 },
    "show_border": false,
    "border_color": { "l": 0.0, "a": 0.0, "b": 0.0, "alpha": 1.0 },
    "border_width": 0.0,
    "corner_radius": 0.0,
    "opacity": 1.0,
    "content": "Label",
    "font_size": 14.0,
    "font_family": "Satoshi",
    "font_weight": 400,
    "font_style": "Normal",
    "text_color": { "l": 1.0, "a": 0.0, "b": 0.0, "alpha": 1.0 },
    "text_align": "Left",
    "text_decoration": "None",
    "line_height": 21.0,
    "selected": 0,
    "hovered": false
  }
}
```
`text_align` is `"Left" | "Center" | "Right" | "Justify"`; `text_decoration` is
`"None" | "Underline" | "LineThrough"` (Vellum enum-variant names verbatim).
`line_height` is an absolute px value; `0.0` reads as "not provided" (Vellum falls back
to its own ratio). Text nodes must always emit `width: "Auto", height: "Auto"` — Vellum
measures text during layout.

**Image node:**
```json
{
  "Img": {
    "parent_id": 0,
    "width": "Auto",
    "height": { "Px": 200.0 },
    "source": { "Url": "https://..." },
    "fit": "cover",
    "object_position": [0.5, 0.5],
    "selected": 0,
    "hovered": false
  }
}
```
`fit` is `"cover"` | `"contain"` | `"fill"` (object-fit); `cover` clips to the node box. (An earlier `cover: bool` field was wrong — Vellum reads `fit`.)

`source` is one of: `"None"`, `{ "Url": "..." }`, `{ "Bytes": [u8 array] }`, or `{ "Ref": "..." }` (an asset reference).

**`flex_direction`**: `"Row"` | `"Column"` | `"RowReverse"` | `"ColumnReverse"`

**`font_style`**: `"Normal"` | `"Italic"` | `"Oblique"`

**Colors** are an **`OklabColor` object** — `{ "l", "a", "b", "alpha" }`, Oklab, **not**
the old `[r,g,b,a]` sRGB array. `l` is perceptual lightness (`0.0–1.0`), `a`/`b` are the
opponent-color axes (roughly `-0.4–0.4`), `alpha` is `0.0–1.0`. Charter's `parse_color`
parses `oklch()`/`oklab()` first-class and accepts hex/`rgb()`/`hsl()`/`transparent` as
legacy input, converting to Oklab on ingest. The object shape is deliberate: a stale
build sending the old array fails to deserialize loudly instead of silently
reinterpreting sRGB floats as Oklab. Full architecture: `resources/oklch.md`.

**`padding`** is `[top, right, bottom, left]`.

**`width` / `height`** of `0.0` means auto-size to content.

**`shadow`:**
```json
{
  "offset_x": 2.0,
  "offset_y": 4.0,
  "blur_radius": 8.0,
  "spread_radius": 0.0,
  "color": { "l": 0.0, "a": 0.0, "b": 0.0, "alpha": 0.4 },
  "inset": false
}
```

---

### `PanelManifest`

Published via `kit10_panel_publish`. The editor's panels are **generic renderers** over
this shape: the plugin declares topology + available operations; the editor computes tree
topology host-side and joins live metadata (view names, locked/hidden state) from its own
DB query against each item's `id` at render time. Wire keys are snake_case.

```json
{
  "panel_id": "views",
  "composition_field_keys": ["children"],
  "items": [PanelItem],
  "header_ops": [PanelOp]
}
```

`composition_field_keys` is Charter's *entire* nesting opinion — "this field's `viewRefs`
are the children." The host walks `resolvedViews` for these keys to build the DAG; root
detection, ordering, and cycle-guarding are generic graph math done host-side, so they do
**not** ride the manifest. The manifest also does not carry `icon` (read from
`hints.view_icon`) or `child_ids`/`is_root` (host-derived).

**`PanelItem`**
```json
{
  "id": "view-uuid",
  "write_alias": "children",
  "ops": [PanelOp]
}
```
`write_alias` is the token alias to upsert when DnD writes this item's child list; `null`
when the item's primitive has no `children` field (Text/Image), so the panel hides the
nest affordance.

**`PanelOp`** — one self-describing context-menu operation. The plugin owns *which* ops
an item offers; the editor owns *how* to execute each (switch on `name`).
```json
{
  "name": "add-child",
  "label": "Box",
  "icon": "fa-square",
  "kind": "box"
}
```
`name` is the dispatch key (`rename`/`clone`/`lock`/`hide`/`deselect`/`delete`/`add-child`).
`kind` is an op-specific payload — today only `add-child` uses it to carry the primitive
to create (`"box"|"text"|"image"`); other ops leave it `null`.

---

## Hints

Each View has a `hints` object where plugins can store per-view metadata. The key is the plugin name; the value is any JSON object the plugin defines.

```json
{
  "hints": {
    "charter": {
      "primitive": "box",
      "position": [120.0, 80.0]
    }
  }
}
```

Hints are read in `on_resolve` via `view.hints["my-plugin"]`. Writing hints back to the database is done via the standard render entry API or a future hints API.

---

## Building a plugin (Rust)

```toml
[package]
name = "my-plugin"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
extism-pdk = "1"
serde = { version = "1", features = ["derive"] }
serde_json = "1"

[profile.release]
opt-level = "s"
lto = true
```

Compile to `wasm32-unknown-unknown`:
```
cargo build --target wasm32-unknown-unknown --release
```

The output `.wasm` can be loaded by the editor directly or hosted remotely and referenced by URL in the plugin manifest.

---

## Render target plugins

A render target plugin does not produce `viewport_data`. Instead, `on_resolve` returns an empty `viewport_data` array and uses `kit10_write_render_entry_to_layer` (or a future export API) to serialize the resolved properties into the target format.

The vite-kit10-plugin.js in this repository is an example render target skeleton for SvelteKit projects — it receives resolved properties and emits SCSS files into `.kit10/`.
