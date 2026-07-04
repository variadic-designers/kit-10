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

**Core renderer (Vellum)** — a single Rust/WGPU crate compiled to WebAssembly via `wasm-bindgen`. It owns the GPU canvas and is loaded directly by the editor. It is not an Extism plugin and cannot be replaced by third parties.

**Data plugins (Extism)** — sandboxed WASM modules written in any language with an Extism PDK. They receive resolved design data and decide what to draw and what fields to show. This is where all third-party extensibility lives: viewport interpreters, render targets (CSS, SCSS, JSON), domain-specific renderers.

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
  "allViews": [ResolvedView]
}
```

Output (`OnResolveResult`):
```json
{
  "categories": [FieldCategory],
  "viewport_data": [UiNode]
}
```

`categories` populates the render panel in the editor. `viewport_data` is a `UiNode` tree passed directly to Vellum to render.

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

## Data types

### `ResolvedKit`
```json
{
  "kitId": "uuid",
  "kitName": "Button",
  "properties": {
    "background": {
      "property": "background",
      "value": "#3b82f6",
      "sourceLayerId": "uuid",
      "kitId": "uuid",
      "isToken": false,
      "tokenAlias": null,
      "conditionCount": 1
    }
  }
}
```

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

`inputType` is one of: `color`, `text`, `number`, `select`, `slider`. If omitted, defaults to `text`.
`layerId` tells the render panel which layer to target when the field is edited.

### `UiNode`

A flat array of nodes. Parent-child relationships are expressed via `parent_id` (index into the array). Nodes with `parent_id: null` are roots.

Vellum renders these in index order. Parent layout is computed before children.

**Box node:**
```json
{
  "Box": {
    "parent_id": null,
    "width": 200.0,
    "height": 80.0,
    "max_width": 0.0,
    "max_height": 0.0,
    "padding": [8.0, 8.0, 8.0, 8.0],
    "bg_color": [0.22, 0.51, 0.98, 1.0],
    "flex_direction": "Column",
    "show_border": false,
    "border_color": [0.0, 0.0, 0.0, 1.0],
    "border_width": 0.0,
    "corner_radius": 8.0,
    "opacity": 1.0,
    "shadow": null
  }
}
```

**Text node:**
```json
{
  "Text": {
    "parent_id": 0,
    "width": 0.0,
    "height": 0.0,
    "padding": [0.0, 0.0, 0.0, 0.0],
    "bg_color": [0.0, 0.0, 0.0, 0.0],
    "show_border": false,
    "border_color": [0.0, 0.0, 0.0, 1.0],
    "border_width": 0.0,
    "corner_radius": 0.0,
    "opacity": 1.0,
    "content": "Label",
    "font_size": 14.0,
    "font_family": "Satoshi",
    "font_weight": 400,
    "font_style": "Normal",
    "text_color": [1.0, 1.0, 1.0, 1.0]
  }
}
```

**Image node:**
```json
{
  "Img": {
    "parent_id": 0,
    "width": 0.0,
    "height": 200.0,
    "source": { "Url": "https://..." },
    "cover": true
  }
}
```

`source` is one of: `"None"`, `{ "Url": "..." }`, or `{ "Bytes": [u8 array] }`.

**`flex_direction`**: `"Row"` | `"Column"` | `"RowReverse"` | `"ColumnReverse"`

**`font_style`**: `"Normal"` | `"Italic"` | `"Oblique"`

**Colors** are `[r, g, b, a]` with each channel in `0.0–1.0`.

**`padding`** is `[top, right, bottom, left]`.

**`width` / `height`** of `0.0` means auto-size to content.

**`shadow`:**
```json
{
  "offset_x": 2.0,
  "offset_y": 4.0,
  "blur_radius": 8.0,
  "spread_radius": 0.0,
  "color": [0.0, 0.0, 0.0, 0.4],
  "inset": false
}
```

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
