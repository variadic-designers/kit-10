# Shapes & Drawing — long-term plan for KIT•10

**Phase 1 (parametric shapes) SHIPPED 2026-08-06.** `kit10-scene` v0.2.3, Vellum (`taf_can_do` master), Charter, and the editor TS layer all landed together; both wasm artifacts rebuilt and copied. WebCodium export for Shape was NOT built (documented v1 scope cut in `plugins/webcodium/src/{css.rs,html.rs}` - no cheap real-CSS equivalent for polygon/star). A "Shapes Stage" demo panel was added to `taf_can_do`'s `vellum_demo` binary (`cargo run --release` from `taf_can_do/`) showing one of each `ShapeKind` with fill+stroke, animated by the existing tween/motion-path demo acts. Phase 2 (freeform paths) is still just this plan - not started.

## Context

KIT•10 renders exactly three primitives today: `Box`, `Text`, `Img`. There is **no vector/path/shape rendering anywhere** — everything Vellum draws is an axis-aligned rounded/squircle rectangle, a glyph quad, or an image quad. Yet the foundation roadmap repeatedly names a **stroked vector-path primitive** as the missing piece that unlocks DrawSVG, MorphSVG, MotionPath, and text-on-path (`resources/animations-transitions.md` §8.4, `resources/text.md` §8, `resources/foundation.md` Pillar C). The infrastructure was written *expecting* this work; shapes are largely "name the primitive, wire it, and reuse Pillars B/C" rather than a greenfield subsystem.

This plan adds a `Shape` primitive as a **first-class, fully axis-resolvable** member of the existing 2D-UI `kit10-scene` dialect (not a separate paradigm), phased **parametric-first, freeform-second**, with freeform paths eventually rendered via an **SDF-texture atlas** (mirroring the existing glyph atlas). It honors the resolution thesis: shape geometry (fill, stroke, sides, radius, points) resolves per axis/view and is tokenizable, never baked.

### Decisions locked (user-confirmed)
- **Scope:** both, phased. Phase 1 parametric shapes (analytic SDF); Phase 2 freeform paths on the same wire primitive.
- **Freeform GPU render:** SDF-texture atlas (glyph-atlas-style), reusing AA / Oklab / SDF math. Not lyon tessellation.
- **Resolvability:** fully resolvable geometry — shape params are ordinary `render_entries`/tokens, resolved per axis/view, Layer-conditionable.
- **Dialect:** extend `UiNode` (a 2D-box-positioned shape fits the existing dialect per `kit10-scene/src/lib.rs:7-13`), not a new scene crate.

### Sequencing vs the foundation roadmap
Phase 1 is a `kit10-scene` wire bump. **Batch it with or right after M5** (`foundation-execution.md`) — M5 is the one near-term wire bump already scheduled (the `Deform` enum + arc-length, `v0.2.3`), and it pays the same dual-wasm-rebuild ritual. Landing `ShapeData` in the same tag avoids a second expensive bump. Phase 2 (freeform paths) is a direct consumer of M5's arc-length `Path` and Pillar C deform variants.

---

## Phase 1 — Parametric shape primitive (analytic SDF)

Ships: rect / ellipse / line / regular-polygon / star as a real creatable primitive, fill+stroke, resolvable per axis, rendered by a new analytic-SDF branch reusing the quad-instanced pipeline.

### 1a. Wire contract — `kit10-scene` (`/dat/Documents/A-Work/kit10-scene/src/lib.rs`)
- Add `ShapeData` struct via the `wire!` macro (near `lib.rs:582`): `kind: ShapeKind`, sizing box (mirror `BoxData`'s width/height/min/max), `fill: OklabColor`, `stroke: OklabColor`, `stroke_width: f32`, `opacity`, `selected: u8`, `hovered: bool`, `parent_id`, `extra: BoxExtra` (so shapes flex/grid + carry `NodePosition`).
- `ShapeKind` enum: `Rect | Ellipse | Line | Polygon { sides: u32 } | Star { points: u32, inner_ratio: f32 }`. Design it so Phase 2's `Path { ... }` variant slots in without breaking the tag.
- Add `Shape(ShapeData)` to `UiNode` (`lib.rs:586-591`) — externally tagged → `{"Shape":{…}}` free.
- Regenerate `generated/wire-schema.json` (`UPDATE_WIRE_SCHEMA=1`); update `tests/conformance.rs:19` (`nodes.len() == 3` count + `fixtures/wire-golden.json`).
- Tag `v0.2.3` (shared with M5's `Deform` if co-landing); bump `tag=` in Charter **and** Vellum `Cargo.toml`.

### 1b. Renderer — Vellum (`/dat/Documents/A-Work/taf_can_do/`)
- **Layout** (`src/layout/mod.rs`): new arms in the variant-matching sites the map identified — OR-pattern sites `node_parent`:338 / `node_selected`:346 / `node_hovered`:354 (just extend the `|`); real arms in `node_style`:380 (supply sizing) and `node_rect`:437 (fill/stroke/radius); the `walk_tree` leaf-emit switch **:749-811** (the core spot — emit shape geometry); `build_node`:582 (apply `BoxExtra`) and the positioned-root split :622.
- **Geometry container:** add `LayoutResult::shapes` (`layout/mod.rs:657`) parallel to `rects`/`text_areas`/`images`, or overload `rects` with a shape-kind tag. Prefer a dedicated vec for a clean draw call.
- **GPU** (`src/render/`): `ShapeInstance` in `types.rs` (kind enum + params + fill/stroke, paralleling `RectInstance`:30); `shape.wgsl` with analytic SDFs — reuse `sd_box`-style structure, add `sd_ellipse`/`sd_ngon`/`sd_star`/`sd_segment`; `create_shape_pipeline` in `pipeline.rs` (through the `wgsl()` wrapper for Display-P3); a shape draw call in `draw_scene_content`:3213; a `to_instances`-style builder + buffer in `write_frame`:2732.
- **Overlays & interaction:** shapes get rectangular selection/hover + bbox `hit_test` **for free** (all keyed on `LayoutRect.index`). Add an `Img`-like "skip box-model hatch" arm at `build_hatch_instances`:2251 and the Box-only guards `build_grid_line_instances`:2332 / `grid_line_labels`:2368. `measure_node`:780 arm if shapes have intrinsic size (parametric shapes are size-declared, so likely echo the sizing box like Box, not measure). Precise (non-bbox) shape hit-testing/selection outline is a deliberate later refinement.
- Dynamic-animation layer (`render_affines`) rides along automatically via `LayoutRect.index` — shapes are animatable from day one.
- Rebuild **both** wasm artifacts and copy: Vellum via the `wasm-pack ... --no-default-features --no-opt` command (AGENTS.md), Charter via `cargo build --target wasm32-unknown-unknown --release` → `static/charter.wasm`.

### 1c. Translation — Charter (`plugins/charter/src/lib.rs`)
- `detect_primitive`:1847 — add a `"shape"` branch (trigger on a `kind`/`shape` property), placed before the text/box fallthrough.
- `CREATABLE_PRIMITIVES`:398 — add a `shape` entry; it flows into `container_item_ops`:2742 and `views_header_ops`:2758 automatically (the box/text/image trio is one canonical table).
- `build_shape_node` alongside `build_box_node`:1517 etc.; emit `UiNode::Shape`. Reuse `extract_paint_props`:1227 for fill/border where it maps; add a small stroke helper if needed.
- `render_view_nodes`:2218 — new `"shape"` branch (leaf, or child-bearing if a shape can contain children — recommend leaf for Phase 1) alongside :2272/:2317/:2330.
- `shape_categories()` alongside `box_categories()`:1946 etc.; branch in `build_categories`:2659.
- Field schema: `kind` as a `select` inputType; `sides`/`points`/`inner_ratio` as `number`/`slider`; `fill`/`stroke` as `color`; `stroke-width` as existing spacing/number. **No new inputType needed for Phase 1** — all reuse existing widgets. Resolvability is automatic because these are ordinary `FieldDef`s → `render_entries`/tokens.

### 1d. Editor (`src/lib/`)
- `plugins/types.ts` — mirror the `UiNode` union addition (`:176-229`, add `UiShapeNode`) and the `add-child` primitive discriminator (`:301`, add `"shape"`); update the drift-guard node-variant list in `generate-plugin-docs.test.ts:80`.
- `Views.svelte` `dispatchOp` add-child (`:165-186`, +header ~290) already writes `hints.charter.primitive` for non-box; `"shape"` flows through unchanged. Add a `provisionShapeKit` analogous to `provisionBoxKit`:125 (auto-attach a blank kit so the shape has Styles fields + a default `kind`).
- All field commits already route through `field-commit.ts` `commitFieldValue` — token-aware, primitive-neutral, no change.
- **No manager/DB/migration changes** — a view is primitive-agnostic; primitive is purely a Charter hint.

---

## Phase 2 — Freeform paths (pen tool + SDF-atlas render)

Builds on Phase 1's primitive + authoring shell. Adds arbitrary editable geometry and the illustration surface.

### 2a. Geometry — reuse & extend `kit10-motion::Path` (promote to `kit10-geom` if it grows)
`kit10-motion/src/path.rs` already has arc-length parameterization, cubic-bezier flatten, and tangent frames (`sample_at(s) → (point, angle)`) — the three consumers (MotionPath, DrawSVG, text-on-path) are already named in its doc. **Extend, don't reinvent:** multi-segment paths, a `d`-string parser, quadratics/arcs, close/fill notion, stroke width, and a **shape-morph interpolator** (point-count-matched — the one genuinely net-new piece MorphSVG needs). Per `foundation.md:134`, promote to the reserved **`kit10-geom`** sibling crate once geometry utilities outgrow motion paths.

### 2b. Wire — extend `ShapeKind` (no new primitive)
Add `ShapeKind::Path { segments, fill_rule, closed }` on the existing `Shape(ShapeData)` variant. Another `kit10-scene` tag bump, same ritual. Point data is resolvable (a token/render-entry-backed property), satisfying the "fully resolvable geometry" decision — e.g. a star whose point count or a path whose points vary per axis.

### 2c. Render — SDF-texture atlas (mirror the glyph atlas)
Follow `taf_can_do/src/text/atlas.rs` + `msdf.rs` — the closest existing precedent for "arbitrary 2D coverage from an SDF texture." Rasterize each resolved path to an SDF/coverage texture, draw as a unit quad sampling coverage in the fragment shader; strokes/fills/AA/Oklab fall out of the existing SDF machinery. Cache keyed on resolved path geometry (re-bake on point edits — the known weak spot; acceptable since edits are discrete, not per-frame). Reuse `shape.wgsl`/`create_shape_pipeline` from Phase 1 with an atlas-sampling branch.

### 2d. Authoring — pen tool + point editor (editor)
New inputType(s) in `plugins/types.ts` (e.g. `'path'`) + a `PathField.svelte` point/segment editor in `src/lib/editor/panels/` (follow the `ResizeField`/`GridTracksField` pattern: a friendly editor + a raw `d`-string escape hatch, with a TS parser mirroring Charter's, per the grid-tracks precedent so the two never drift). A `PathKeys`/`StrokeKeys` side-channel struct (mirror `ArrangeKeys`:162 / `ResizeKeys`) carries companion property keys so the editor never hardcodes them. A canvas-level pen/draw interaction mode in `Viewport.svelte` (new, sits beside the existing drag/create modes).

**The pen tool's own input pipeline (raw pointer noise → committed vector path) is a separate, generalized architecture, not a one-off for this tool** — see `resources/pen-brush-architecture.md`. That doc covers signal smoothing, point simplification, live-preview vs. finalization curve fitting, and (the part that matters for §2's "generalized" requirement) the plugin seam that lets a plugin define its own brush: its own smoothing/fit tolerance, and its own stroke rendering as either a filled `ShapeKind::Path` (vector brush) or a stamped SDF-atlas raster brush (§2c's atlas, reused). `kit10-geom` (§2a) is where the shared, non-pluggable geometry math (RDP, Catmull-Rom→Bézier, Schneider fit) lives.

### 2e. Motion consumers (fall out of M5 + Phase 2)
Once a stroked path primitive + arc-length exist: **DrawSVG** (animate visible fraction over arc-length), **MorphSVG** (the 2b morph interpolator), **text-on-path** (M5's first consumer, per-glyph placement via `GlyphTransform`) — all reuse Pillar C deform variants, not a private warp system (`text.md` §8 step 3 forbids a private warp before the shared contract).

---

## Explicitly deferred
- Precise (non-bbox) shape hit-testing and shape-hugging selection outlines — Phase 1 ships rectangular selection + bbox hit-test, which is correct and free.
- SDF far-future (Pillar E): filled/stroked boolean vector art via the raymarch engine + `sdf3d.md`'s CSG (`min`/`max`/`smin`). Every 2D shape must always degrade to the flat SDF-atlas path without the raymarch engine (`text.md` §4 — Pillar E is never load-bearing).
- Freeform shapes containing child views (Phase 1 shapes are leaves).
- SVG *import* as editable shapes (distinct from today's SVG-as-`Img`-asset in `assetStore.ts`).

---

## Verification

**Phase 1, per layer:**
- `kit10-scene`: `cargo test` (conformance round-trip + `schema_matches_committed`); confirm `{"Shape":{…}}` serializes/deserializes.
- Vellum: `cargo test` (native host target — layout arms, SDF ground-truth tests à la `squircle_sdf_tests`); validate `shape.wgsl` with `naga` before shipping (shaders aren't compiled by `cargo build`); confirm no derivative ops in non-uniform control flow.
- Charter: `cargo test`; assert on **serialized JSON key names** for any boundary struct (camelCase discipline), not just Rust fields.
- Editor: `npm test` (must pass — `test:wire-schema` + drift-guard node-variant list); `npm run generate-docs` if an inputType is added.
- **End-to-end (ask the user to drive — do not self-verify UI):** rebuild+copy both wasm artifacts, then in the running app: create a shape view (Views panel add-child → Shape), confirm it renders (ellipse/polygon/star), edit `sides`/`fill`/`stroke` in the Render panel and confirm live update, put `kind`/`sides` on a Layer conditioned by an axis and confirm the shape changes with the axis (proves resolvability), tokenize `fill` and confirm the token badge + shared update. Confirm selection/hover/drag/animate work on the shape.

**Phase 2:** add pen-tool authoring of a path, confirm SDF-atlas render fidelity vs a reference, confirm a resolvable/tokenized path point set varies per axis, then a DrawSVG/MorphSVG/text-on-path proof-of-life.

## Key files (representative)
- Wire: `kit10-scene/src/lib.rs`, `tests/conformance.rs`, `generated/wire-schema.json`
- Renderer: `taf_can_do/src/layout/mod.rs` (`walk_tree`:749, `node_style`/`node_rect`), `src/render/{types.rs,mod.rs,pipeline.rs}`, `src/render/shader.wgsl` (+ new `shape.wgsl`), `src/text/{atlas.rs,msdf.rs}` (Phase 2 precedent)
- Charter: `plugins/charter/src/lib.rs` (`detect_primitive`:1847, `CREATABLE_PRIMITIVES`:398, `render_view_nodes`:2218, `build_categories`:2659)
- Editor: `src/lib/plugins/types.ts`, `src/lib/editor/panels/{Views.svelte,Styles.svelte,field-commit.ts}`, new `PathField.svelte` (Phase 2)
- Geometry (Phase 2): `kit10-motion/src/path.rs` (→ `kit10-geom`)
