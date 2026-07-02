# Editor Lifecycle

## Phase 1: Navigation

User navigates from `/` (landing) to `/edit`.

- Cross-document view transition fires
- Browser captures hero SVG (`.hero-glyph`) with `view-transition-name: kit10-logo`
- `/edit` page renders with Viewport already in the DOM (always mounted)
- Viewport's `.logo-overlay` has matching `view-transition-name: kit10-logo`
- Browser morphs hero logo into Viewport overlay

## Phase 2: Editor Loading

Editor.svelte mounts. `editorLoading` starts as `undefined`.

- Layout renders `dash` (Viewport) and `unloadedDash` (empty) overlaid
- Layout does NOT render management/console/configurable panels yet
- `Nav` renders with loading state
- Viewport begins vellum initialization (dynamic import of WASM module)

## Phase 3: Vellum Initialization

Viewport's `onMount` fires:

```
import vellum_renderer.js
vellum.default()     -- instantiate WASM
wait for canvas size > 0
vellum.initialize()  -- WebGL context + internal buffers
initialized = true
applyColors()
ResizeObserver starts
```

The canvas size guard polls via `requestAnimationFrame` until `clientWidth > 0 && clientHeight > 0`. This prevents Firefox's WebRender from crashing on 0-size WebGL resources.

## Phase 4: Editor Ready

Async initialization completes, `editorLoading` is set to `EditorState`.

- `pluginManager` is created and `charter.wasm` plugin loaded
- Layout switches to show all panels
- `unloadedDash` overlay is removed (but Viewport overlay remains)
- `nav`, `management`, `console`, `configurable` panels render
- Resolved kits are computed reactively
- Plugin manager resolves viewport data

## Phase 5: Data Arrives

`pluginManager.viewportData` is set, flowing to Viewport as `data` prop.

Viewport's `$effect` on `data` fires:

```
vellum.set_data(json)
hasData = true
render loop starts (requestAnimationFrame)
.fade overlay fades out
```

The overlay's `class:ready` toggles, triggering CSS `opacity: 0` transition (0.4s ease). After this, the canvas is fully interactive.

## Phase 6: Runtime

- Render loop runs at vsync (requestAnimationFrame)
- ResizeObserver re-initializes canvas on layout changes (guarded against 0-size)
- Theme changes propagate via `$theme` effect to `vellum.set_colors()`
- Pointer/wheel events drive pan, zoom, selection via vellum API

## State Machine Summary

```
[Landing Page]
     |  navigation + view transition (kit10-logo)
     v
[Viewport mounted] -- logo-overlay visible
     |  vellum loading + WASM init
     v
[initialized = true] -- logo-overlay still visible
     |  wait for data
     v
[hasData = true] -- logo-overlay fades out
     |  render loop starts
     v
[Runtime] -- interactive canvas
```
