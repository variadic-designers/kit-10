# Vellum's general-purpose sprite-batch rendering capability

## Status

**PRIORITY 1 — this is the next implementation session's starting point.** User-approved via plan mode
2026-08-06, not started. Companion to `resources/pen-brush-architecture.md` (the brush/pen pipeline
that motivated this) and `resources/shapes-drawing-plan.md` (Phase 2, `ShapeKind::Path`, which this
plan's Part 0 depends on being finished). Scoped to Vellum's rendering capability only.

**Start here next session:** Part 0 (finish Phase 2's `ShapeKind::Path`/`PathAtlas`) and Part 1
(`SpriteBatch`) are independent and can be built in either order. Sequencing/dependencies section below
has the exact ordering constraints (kit10-scene tag bump gates both).

## Context

The brush/pen research (`resources/pen-brush-architecture.md`) needs Vellum to draw two things it
can't today: a filled arbitrary-boundary vector shape (the "vector brush" case) and a texture stamped
repeatedly along a path (the "rasterized brush" case). A first-draft plan for the second case baked
brush-specific concepts - pressure, arc-length spacing, tangent alignment, a `width_profile` - directly
into Vellum's wire dialect and Charter's translation layer. That's the wrong altitude: **Vellum
shouldn't know what a brush is.** Per VISION.md's 1st Principle (already the whole reason Charter is a
swappable "opinionated translation layer" rather than a hardcoded UI), the fix is to expose a
genuinely general GPU capability - "draw N positioned/rotated/tinted textured quads sampling a shared
atlas, in one batched draw call" - and let a brush be one thing a plugin builds ON TOP of it. The same
primitive then also serves particle effects, repeating decorative patterns, confetti, icon grids, or
anything else "many small stamped things" - none of which have anything to do with pens.

## The core redirection, stated precisely

- **Vector "brush" fills need no new Vellum design at all.** `shapes-drawing-plan.md`'s Phase 2
  (`ShapeKind::Path`, SDF-texture atlas, mirror the glyph atlas) was already general - a filled
  arbitrary path is just a filled arbitrary path, whether a plugin got there by hand-authoring points
  or by computing a pressure-driven offset boundary. Part 0 below flags this as "finish it as already
  scoped," not new work.
- **Rasterized "brush" stamping becomes a new general primitive: `SpriteBatch`.** No pressure, no
  spacing, no tangent-alignment, no width-profile anywhere in the wire dialect or in Charter. A
  `SpriteBatch` node just carries an already-computed `Vec<SpriteInstance>` - flat position/rotation/
  size/color/opacity/sprite-id data, no path or brush concept attached. *Whoever* computes that list
  (a brush-pen plugin walking a fitted centerline with `kit10-geom` math, a particle-system plugin, a
  pattern-tiling plugin) owns 100% of that opinion; Vellum and Charter only move already-resolved
  instance data.

## Part 0 - Vector fills: no Vellum changes beyond finishing Phase 2

`ShapeKind::Path { segments, fill_rule, closed }` (already locked in `shapes-drawing-plan.md` §2b/§2c)
renders via a new `PathAtlas` (copy `GlyphAtlas`'s shelf-packer + texture-ownership pattern from
`text/atlas.rs` near-verbatim - it's already content-agnostic) baking each resolved path's SDF via
`fdsm`'s existing distance-field pipeline (`fdsm::shape::{Shape,Contour}` built from `Segment::line/
quad/cubic`, then `generate_sdf` - single-channel, not MTSDF, so the glyph-atlas nick-artifact lesson
never applies here in the first place). `shape.wgsl` gains one more branch in its existing kind-ladder
(`kind == 5.0 = Path`, samples the atlas instead of calling `sd_polygon_generic`) - `outer_alpha`, the
stroke-erosion trick, and `composite_border` all fall through unchanged, since `d` is still just "a
signed distance in local pixel units" regardless of source. `create_shape_pipeline` gains a second bind
group (group 1, the path atlas texture) alongside its existing group-0-only layout, mirroring how
`create_image_pipeline` already does `[time_bgl, image_bgl]`.

Scope this to `closed: true` (filled boundary) only for now - a plugin's vector brush stroke is always
a closed offset boundary by construction, so this fully covers the brush case. An open-path flat-stroke
render (no fill, just trace a line) is a separate, smaller Phase-2-general concern with no existing
crate to lean on (would need a from-scratch unsigned distance-to-polyline rasterizer) - explicitly
deferred, doesn't block brushes.

## Part 1 - `SpriteBatch`: the new general primitive

### 1a. Wire shape (kit10-scene)

```rust
pub struct SpriteInstance {
    pub position: [f32; 2],
    pub size: [f32; 2],
    pub rotation: f32,        // radians
    pub sprite_id: String,    // looked up against the loaded sprite atlas -> uv rect
    pub color: OklabColor,
    pub opacity: f32,
    pub tint: bool,           // false = sample the sprite's own RGB as-is; true = coverage-mask
                               // tinted by `color` (an ink/charcoal stamp vs. a full-color texture)
}

pub struct SpriteBatchData {
    pub parent_id: Option<usize>,
    pub width: Extent,        // sizing box - mirrors Box/Shape so it participates in layout/flex
    pub height: Extent,
    pub min_width: Extent, pub min_height: Extent,
    pub max_width: Extent, pub max_height: Extent,
    pub sprites: Vec<SpriteInstance>,
    pub opacity: f32,         // node-level multiplier, composes with each instance's own opacity
    pub extra: BoxExtra,      // flex-item participation only, always a leaf (same posture as Shape)
    pub selected: u8,
    pub hovered: bool,
}
```

`tint` is a genuinely general rendering choice (any sprite-batch consumer might want either an
ink-mask stamp or a native-color texture), not brush-specific - keep both modes from day one, one
shader branch + one instance field, cheaper to build once than to retrofit.

**Resolvability**: `sprites: Vec<SpriteInstance>` is not a new *kind* of resolvable field -
`kit10-scene` already has precedent for a Vec-of-struct value parsed out of one resolved property
string (`extra.grid_template_columns: Vec<TrackSize>`, `grid_template_areas: Vec<GridTemplateArea>`,
`padding`'s CSS shorthand). Charter reads one `"sprites"` property's resolved string value and parses
it into `Vec<SpriteInstance>` the same way it already parses grid track lists - Charter does NOT need
to know how the list was computed, only how to deserialize it. **Who writes that property is entirely
plugin/tool space** - a brush-pen tool computes the list (arc-length walk + pressure curve, using
shared `kit10-geom` math) and writes it via the ordinary `kit10_write_render_entry_to_layer` path,
same mechanism every other field commit already uses (`field-commit.ts`'s `commitFieldValue`). No new
write path, no `BrushProfile` concept needs to exist in the core at all.

### 1b. Charter's role - minimal, generic plumbing only

- `CREATABLE_PRIMITIVES` gets a `"sprite-batch"` entry (same one-table pattern Phase 1 already
  established - the add-child dispatch, context menus, and editor wiring come for free, zero new
  editor code, exactly as Phase 1 confirmed for Shape).
- A `build_sprite_batch_node` alongside `build_shape_node`: reads `width`/`height`/`min-*`/`max-*` via
  the same `compile_resize` path Shape already uses, parses the `sprites` property (JSON, matching the
  precedent of parsing structured shorthand strings elsewhere in this file) into `Vec<SpriteInstance>`,
  emits `UiNode::SpriteBatch`.
- `render_view_nodes` gets a leaf branch (same shape as the Img/Shape branches - no children).
- No `detect_primitive` heuristic needed - same as any explicitly-hinted primitive today, a tool
  creating a sprite-batch view sets `hints.charter.primitive: "sprite-batch"` explicitly (identical to
  how `add-child` already writes this hint for every non-box kind).

This is the entire Charter surface. Nothing about pressure, spacing, or brushes appears here.

### 1c. Vellum GPU side

**`SpriteAtlas`** (new module, `src/sprite/atlas.rs`, sized like `src/text/`): copy `GlyphAtlas`'s
shelf-packer + texture-ownership pattern (`text/atlas.rs:14-172`) near-verbatim - a single shared
atlas keeps the whole scene's sprite draw down to one batched draw call regardless of how many
*distinct* sprite images are referenced, exactly the reason `GlyphAtlas` exists for glyphs.
Differences from glyph: bigger typical cell size (plugin-supplied textures, not sub-64px glyphs - still
comfortably fits a 4096² atlas), a larger bleed gutter (sprite alpha edges are typically soft/organic,
not a crisp SDF), keyed by string id (`sprite_id`) rather than a glyph shape hash.

**`SpriteInstance` (GPU-side) + `sprite_shader.wgsl`**: true GPU instancing (`step_mode: Instance`),
matching `RectInstance`/`ImageInstance`/`ShapeInstance` - **not** glyph's flat-vertex batching. A
sprite quad is structurally identical to `ImageInstance` (uniform box, uv sub-rect, per-instance
rotation), so instancing is the right call here, unlike text's shaping-driven irregular geometry.
`create_sprite_pipeline` mirrors `create_image_pipeline`'s two-group layout (`[time_bgl,
sprite_atlas_bgl]`). Shader mirrors `glyph_shader.wgsl`'s existing coverage-vs-native sampling split
(reused for the `tint` field), converting Oklab -> output gamut exactly like every other shader here.

**`load_sprite`**: mirrors `load_image` almost exactly (`image::load_from_memory` -> `SpriteAtlas::
get_or_place`, string-keyed). **Sources bytes through the existing `assets` table / `assets.link`
infrastructure** - a sprite image IS just an asset, same table `registerBundledAsset` already
populates for images, no new resource-loading concept needed. The one new piece is the *destination*
(packed atlas vs. `ImageCache`'s per-image standalone texture) and a new wasm-exported entry point,
`vellum.load_sprite(id, bytes, tint_hint)`. Detecting an unresolved `sprite_id` referenced by a
resolved `SpriteBatchData` and fetching+loading it is the exact same shape as `Editor.svelte`'s
existing image-reload scan (CLAUDE.md's "Image Reload Scan" note) - reuse that scan's structure, add a
sprite-id variant.

**Layout (`layout/mod.rs`)**: `SpriteBatch` is sized and treated as a leaf exactly like `Shape` -
mirror `node_style`'s Shape arm (own sizing box via `compile_resize`) and `node_rect`'s Shape arm
(invisible hit-test/selection bbox, since real paint is the separate sprite pipeline). `LayoutResult`
gains `sprite_batches: Vec<SpriteBatchAreaData>` (index/position/size/opacity/the resolved
`Vec<SpriteInstance>`), same shape as `ShapeAreaData`.

**Per-frame projection**: a `to_sprite_instances` builder mirrors `to_shape_instances` - for each
`SpriteBatchAreaData`, look up its node-level `ResolvedAffine` (if animating) via `affine_rect` (the
*whole batch* moves/rotates/scales rigidly as one node, same as every other primitive - no per-sprite
independent animation, that's out of scope and would need a very different data model), then for each
`SpriteInstance` inside it, look up `sprite_id`'s uv-rect from `SpriteAtlas`, compose position/rotation
against the node's world transform, and emit a GPU `SpriteInstance`. Cull off-canvas/sub-pixel exactly
like `project_text_area`/`to_shape_instances` already do.

**Paint order**: insert the sprite pass in `draw_scene_content` right after the Shape pass -
`Grid -> Rects -> Shapes -> Sprites -> Images -> Text` - guarded `if count > 0` the same way
Images/Shapes already are. Same disclaimer every existing primitive already carries: no cross-type
depth sort, a sprite batch always paints before every Image regardless of tree position (pre-existing
limitation class, not new).

**`SceneUniforms`**: no changes. `sprite_shader.wgsl` declares its own local byte-compatible-prefix
`Globals` reading only what it needs, exactly like `shape.wgsl`/`glyph_shader.wgsl` already do - every
sprite-specific value (position/rotation/uv/color/opacity/tint) lives on the per-instance struct.

### 1d. Testing

- `sprite_shader_wgsl_parses_and_validates_via_naga` - new entry in the existing
  `shader_validation_tests` module (`render/mod.rs`), mechanical 4-line copy of the pattern already
  used for `shape_shader_wgsl_parses_and_validates_via_naga` (shipped with Phase 1).
- `to_sprite_instances`/projection unit tests mirroring `project_text_area_tests` and
  `to_shape_instances`'s own culling/affine-composition coverage.
- Layout structural test mirroring `demo_scene_variant_lays_out_without_panicking_across_phases`
  (shipped with Phase 1) once a demo scene exercises `SpriteBatch`.
- End-to-end (ask the user to drive, per this codebase's established convention): `load_sprite` a real
  PNG, author a `SpriteBatch` view with a hand-written `sprites` list (a few instances, some tinted,
  some native-color), confirm placement/rotation/color/opacity render correctly, confirm the whole
  batch animates rigidly under `set_node_dynamic`.

## Part 2 - explicitly NOT Vellum's job (where the actual "brush" lives)

- **Arc-length walking a fitted path, deciding spacing, mapping pressure -> per-instance size/opacity**:
  entirely plugin/tool space, using `kit10-geom`'s shared arc-length math (`Path::sample_at`, already
  correct and tested) - never touches Vellum or Charter.
- **Deciding what "a brush" even is** (a `BrushProfile` concept, per `pen-brush-architecture.md`) is a
  plugin-manifest-schema question, out of scope here entirely - by the time anything reaches Vellum,
  a brush stroke is indistinguishable from any other hand-authored `SpriteBatch`.
- **Vector-brush's offset-boundary computation** (turning a centerline + width curve into a closed
  filled polygon) is `kit10-geom` math a plugin runs before writing an ordinary `ShapeKind::Path`
  property - Vellum draws the result the same as any other filled Path.

## Sequencing / dependencies

1. `kit10-scene` tag bump: `ShapeKind::Path` (Part 0) and `SpriteBatchData`/`UiNode::SpriteBatch`
   (Part 1a) can land in the same bump (same "batch it, pay the dual-wasm-rebuild ritual once" logic
   Phase 1/M5 already used) - or separately if Part 0 is ready first. Either order works; Part 1 has
   no dependency on Part 0.
2. Vellum: Part 0 (PathAtlas + shape.wgsl branch) and Part 1c (SpriteAtlas + sprite pipeline) are
   independent workstreams, can build in either order or in parallel.
3. Charter: Part 1b is small and mechanical, blocked only on the wire bump landing.
4. Nothing here is blocked on kit10-geom's promotion/build-out - Vellum only ever consumes an
   already-resolved `Vec<SpriteInstance>` or `ShapeKind::Path`'s segments, never runs curve-fitting
   itself.

## Explicitly deferred

- Open-path (unfilled) stroke rendering for `ShapeKind::Path` - no brush use case needs it.
- Per-sprite independent animation within a batch (each `SpriteBatch` node animates as one rigid unit
  under `render_affines`, matching every other primitive).
- Any brush-specific concept anywhere in Vellum, Charter, or the wire dialect - by design.

## Key files

- `kit10-scene/src/lib.rs` - `ShapeKind::Path` variant, new `SpriteInstance`/`SpriteBatchData`
  structs + `UiNode::SpriteBatch` variant.
- `taf_can_do/src/render/shape.wgsl`, `types.rs` (`ShapeInstance` atlas-uv fields), `pipeline.rs`
  (`create_shape_pipeline`'s second bind group) - Part 0.
- `taf_can_do/src/sprite/{atlas.rs,mod.rs}` (new), `render/sprite_shader.wgsl` (new), `render/
  types.rs` (new `SpriteInstance` GPU struct), `pipeline.rs` (`create_sprite_pipeline`), `render/
  mod.rs` (`to_sprite_instances`, `draw_scene_content`'s new pass, `load_sprite`) - Part 1c.
- `taf_can_do/src/layout/mod.rs` - `SpriteBatch`'s sizing/leaf arms, `LayoutResult::sprite_batches`.
- `plugins/charter/src/lib.rs` - `CREATABLE_PRIMITIVES` entry, `build_sprite_batch_node`,
  `render_view_nodes` leaf branch.
- Everywhere a `match` on `UiNode` is exhaustive today (per Phase 1's own experience:
  `layout/mod.rs`'s `node_parent`/`node_selected`/`node_hovered`/`node_style`/`node_rect`, `render/
  mod.rs`'s duplicate `node_parent`, `plugins/webcodium/src/{tree.rs,css.rs,html.rs}`) will need a
  `SpriteBatch` arm added - same mechanical sweep Phase 1 already did for `Shape`, webcodium again gets
  a documented "no export yet" stub.
