# Editor Lifecycle

This document describes how the editor initializes from navigation through to an interactive session. Each phase boundary is intentional - crossing a boundary before its prerequisites are met produces the failures noted below.

---

## Key dependencies

**Vellum** is the GPU renderer that powers the viewport. It is a Rust library compiled to WebAssembly and loaded dynamically at editor startup. It requires a WebGL context and a non-zero canvas size before it can initialize. Vellum does not produce a blank canvas - it waits for data before rendering anything.

**PGlite** is the in-browser PostgreSQL instance that stores all project data. It runs in a Web Worker and persists to OPFS (Origin Private File System, a browser-native sandboxed storage API). In Firefox private mode, OPFS is unavailable and the worker falls back to in-memory storage.

---

## Phase 1: Navigation

User navigates from `/` to `/edit`. A cross-document view transition fires, morphing the hero logo (`.hero-glyph`) into the viewport's logo overlay (`.logo-overlay`) via the shared `view-transition-name: kit10-logo`. Both elements must carry this name for the morph to work.

The Viewport component is always present in the DOM on `/edit`. Its logo overlay remains visible throughout initialization.

---

## Phase 2: Editor Loading

`Editor.svelte` mounts. `editorLoading` starts as `undefined`.

Layout renders the Viewport and a blank overlay only. Management panels, console, and configurable panels are withheld.

**Why:** panels depend on DB-backed live queries. Mounting them before the PGlite worker is ready would fire queries against an uninitialized database.

---

## Phase 3: Vellum Initialization

The Viewport's `onMount` fires and begins the Vellum startup sequence:

1. Dynamic import of `vellum_renderer.js`
2. `vellum.default()` - instantiates the WASM module
3. Wait for canvas dimensions > 0, polled via `requestAnimationFrame`
4. `vellum.initialize()` - creates the WebGL context and allocates GPU buffers
5. `applyColors()` - pushes the current theme colors to the renderer
6. `ResizeObserver` starts

**Why the canvas size guard:** Firefox's compositor does not guarantee a non-zero layout size synchronously at mount time. Calling `vellum.initialize()` on a 0×0 canvas causes a WebGL context failure and a renderer crash. The guard polls until a valid size is confirmed before proceeding.

At the end of this phase, `initialized = true`. The logo overlay is still visible.

---

## Phase 4: Editor Ready

Async initialization completes. `editorLoading` is set to `EditorState`.

- The plugin manager is created and `charter.wasm` is loaded
- All panels become visible
- The blank overlay is removed
- Live queries begin populating panel data
- Resolved kits are computed reactively

**Why Vellum must be initialized before data arrives:** `vellum.set_data()` requires an active WebGL context. If data arrived before Phase 3 completed, the call would fail silently and the render loop would never start.

---

## Phase 5: Data Arrives

`pluginManager.viewportData` is set and flows to the Viewport as the `data` prop.

The Viewport's reactive effect on `data` fires:

1. `vellum.set_data(json)` - passes resolved kit data to the renderer
2. `hasData = true`
3. Render loop starts via `requestAnimationFrame`
4. The logo overlay's `class:ready` toggles, triggering a CSS opacity transition (0.4s ease)

**Why the render loop starts here and not at initialization:** Vellum does not render a blank canvas - starting the loop before data arrives produces nothing and wastes GPU cycles. The overlay hides the canvas until there is something to show.

---

## Phase 6: Runtime

- Render loop runs at vsync via `requestAnimationFrame`
- `ResizeObserver` re-initializes the canvas on layout changes, guarded against 0-size for the same reason as Phase 3
- Theme changes propagate to `vellum.set_colors()`
- Pointer and wheel events drive pan, zoom, and selection via the Vellum API

---

## State machine

```
[Landing Page]
     |  navigation + view transition (kit10-logo morph)
     v
[Viewport mounted] -- logo overlay visible
     |  WASM load + canvas size > 0 + WebGL init
     v
[initialized = true] -- logo overlay still visible
     |  PGlite ready, plugin manager loaded, panels mounted
     v
[EditorState] -- panels active, live queries running
     |  resolveMany() produces viewport data
     v
[hasData = true] -- logo overlay fades out (0.4s)
     |  render loop starts
     v
[Runtime] -- interactive canvas
```

---

## Known platform issues

**Firefox compositor (Phase 3):** Firefox does not guarantee a non-zero layout size synchronously at mount. The canvas size guard exists specifically for this. Do not remove it without testing in Firefox.

**Firefox private mode (Phase 2):** OPFS is unavailable in Firefox private browsing. The PGlite worker detects this and falls back to `memory://`. All editor functionality works, but data is not persisted beyond the session.
