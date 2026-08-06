# Pen & Brush Architecture — a generalized drawing pipeline for KIT•10

## Status

DRAFT. Not started, not locked. This is Phase 2's authoring half (`resources/shapes-drawing-plan.md`
§2d, "pen tool + point editor") pulled out into its own doc because the real requirement is bigger
than one pen tool: **a plugin should be able to define its own brush** — its own smoothing feel, its
own curve-fitting math, its own stroke rendering (flat vector fill or a stamped raster texture) —
without forking the pen interaction itself. This doc is the pipeline architecture and the
plugin-extension seam; `shapes-drawing-plan.md` §2 stays the wire-contract/primitive plan (`Shape::Path`,
the `PathField.svelte` editor). The two are co-dependent: this doc's output is what feeds that Path.

## The core problem

A software pen that feels natural — where the user draws smooth, confident curves without
micromanaging vector nodes — is manufactured, not captured. Raw pointer input (mouse or stylus) is
noisy: hand tremor, sensor jitter, and irregular sampling rate all show up directly in the coordinate
stream. Every drawing tool that feels good (Procreate, Illustrator's pencil, Photoshop's smoothing
slider) is running a real signal-processing and curve-fitting pipeline between the hardware event and
the pixel. Skip this pipeline and you get a shaky, over-noded, unusable line.

## Pipeline

Five stages, in order, from raw hardware event to renderable geometry. **Stage 0 is the one gap in
the original research pass** — pressure/tilt/velocity have to survive the whole pipeline or a brush
has nothing to vary width/opacity/texture by, so it's called out explicitly here rather than folded
silently into "the coordinate."

### Stage 0 — Raw capture

Every pointer event, kept as `{ position: [f32;2], pressure: f32, tilt: Option<[f32;2]>, t: f32 }`.
`pressure` defaults to a constant (mouse has none) — a brush must degrade gracefully to uniform width
on a pressure-less device, never require a stylus. This raw stream is the thing Stage 1 filters; it
is also kept around unfiltered (or lightly filtered) as the **pressure/velocity source** for brush
width later, since heavy smoothing on *position* must not also flatten a real pressure ramp.

### Stage 1 — Signal smoothing (the "feel")

Before any vector math, tame the input stream itself.

- **Mass-spring-damper ("pulled string") model** — the mechanism behind Procreate's StreamLine and
  Sketchbook's Steady Stroke. The cursor doesn't draw the ink directly; it's the anchor of a spring
  pulling a virtual weight, and the weight's position is what gets drawn. High-frequency hand tremor
  is a small, fast oscillation the spring's own inertia can't follow, so it's absorbed for free. This
  is the "premium" feel — it's a real physical simulation (needs a stiffness/damping/mass tuple, not
  just an average), and it introduces genuine per-point lag proportional to speed, which is the
  correct trade for smoothness.
- **Weighted moving average / low-pass filter** — cheaper, blend each point with its 3–5 predecessors.
  Fine feel at low cost, but the lag-vs-smoothness trade is coarser and less controllable than a real
  spring model (you're tuning a window size, not a physically meaningful stiffness).

Both live entirely in **input-event space**, before any point is committed to the stroke's own point
array — this stage never sees the fact that a curve fit will happen downstream.

### Stage 2 — Point simplification (the "clean up")

A one-second stroke can generate 100+ pointer events. Fitting a curve to all of them is wasteful and
produces a needlessly dense, hard-to-edit path.

- **Ramer–Douglas–Peucker (RDP)** — draw a line from the stroke's start to its end, find the point
  furthest from that line; if the distance exceeds a threshold, split there and recurse on both
  halves. Reduces hundreds of raw points to the handful of genuine corners/inflections, without
  changing the stroke's visible shape (within the threshold). This is decimation, not smoothing — it
  runs on the *already-smoothed* Stage 1 output.

### Stage 3 vs. Stage 4 — these are ALTERNATIVES, not sequential steps

The original research framed curve fitting as one linear pipeline. It isn't — **live preview** (while
the pointer is still down, must be cheap and incremental) and **finalization** (once the pointer
lifts, worth spending more compute for a clean, minimal-node result) are two different jobs with two
different correct algorithms:

**Stage 3 — Catmull-Rom interpolation (live preview).** A Catmull-Rom spline is guaranteed to pass
exactly through every point it's given, and each new segment only needs the 4 nearest points — cheap,
local, incremental, ideal for "redraw the tail of the stroke every frame while the user is still
drawing." Rendering backends (SVG, Canvas2D, WGSL fills) don't natively draw Catmull-Rom, so the
standard trick is converting each span's Catmull-Rom tangents into an equivalent cubic Bézier's
control handles on the fly — same curve, expressed in a form the renderer already knows how to draw.
**Caveat inherited from the "must pass through every point" guarantee:** widely-spaced points can
overshoot/wiggle, since the spline has no freedom to deviate from a point to stay smooth. Acceptable
for a live, still-being-drawn stroke; not the shape you want to commit to the document.

**Stage 4 — Schneider's algorithm (finalization, on pointer-up).** Philip J. Schneider's curve-fitting
algorithm (Graphics Gems) fits the *minimum number* of cubic Béziers to a point sequence within an
error tolerance — it does NOT require passing through every input point, trading exact interpolation
for far fewer, cleaner curves. It tries one Bézier for the whole stroke; if the max deviation from the
real points exceeds the tolerance, it splits at the worst point and recurses. This is what an editable
vector tool actually wants as the *committed* path — few nodes, each one meaningful, editable by hand
afterward. Run this once, when the stroke ends; never per-frame.

**Chaikin's corner-cutting** is a third, cruder option: repeatedly cut every corner of the raw
point-polygon a quarter of the way down each edge. Very cheap, visually smooth almost instantly, but
it measurably shrinks the shape (each cut moves inward) and produces a growing point count rather than
Schneider's minimal one — better suited to a rasterized-brush centerline (where a few percent of
shrink is invisible under stroke width) than a precision vector outline.

### Stage 5 — Curvature continuity (the "why does this still look lumpy" fix)

Even a clean Bézier fit (Stage 4) can look subtly uneven, because two adjacent Bézier segments can
share a tangent direction (G¹ continuity — the curve doesn't *kink*) while their curvature still jumps
abruptly at the joint (no G² continuity — the curve's *bend rate* kinks). Human eyes are very sensitive
to this even when they can't articulate why a curve looks "off."

**Euler spirals (clothoids) / the Spiro algorithm** (Raph Levien, used in Inkscape and in type design)
guarantee G² continuity: curvature changes *linearly* along the spline, mimicking a physical spring
steel strip bent around pegs. The authoring model is different from raw Bézier handles too — the user
places points, and Spiro solves for the spline connecting them, rather than the user dragging tangent
handles directly. This is real added complexity (an implicit equation solve, not a closed form) and is
explicitly the highest-effort, lowest-priority stage here — a "type-design-grade" polish pass, not a
baseline requirement for a usable pen. Deferred; noted so the pipeline has a slot for it later without
a structural rewrite.

## Generalization: where plugins hook in

The five stages above split cleanly into two tiers, and that split IS the plugin seam:

**Host-owned, not pluggable (pure geometry, no opinion to have):**
Stage 0 (capture) and Stage 1 (smoothing) run in the editor's pointer-event handler
(`Viewport.svelte`, new pen-mode alongside the existing drag/create modes per
`shapes-drawing-plan.md` §2d) — they're UI-interaction concerns, same reasoning that already keeps
drag-to-reparent and box-model overlay host-side rather than plugin-side. Stage 2 (RDP) and the two
Stage-3/4 fitting algorithms (Catmull-Rom→Bézier, Schneider) are pure math with a single correct
implementation each — they belong in **`kit10-geom`** (the reserved sibling crate,
`shapes-drawing-plan.md` §2a / `foundation.md:134`), shared by the editor (live preview) and any
plugin that wants to re-fit or re-simplify a path server-side or at export time. There is exactly one
RDP and one Schneider fit in this codebase, not one per plugin — reimplementing curve math per plugin
is the kind of duplication `kit10-scene`/`kit10-motion` already exist to prevent.

**Plugin-owned (this is the actual "brush," the opinionated part):**
Once Stage 4 hands back a clean, minimal-node vector path (a `kit10-geom::Path`, arc-length walkable
exactly like `kit10-motion::Path` already is), what happens next is where a brush's identity lives,
and it forks into two genuinely different rendering strategies:

- **Vector brush.** The fitted centerline is offset by a half-width function of pressure/velocity
  (sampled from the Stage-0 stream, resampled onto the fitted path's own arc-length parameterization)
  to produce two boundary curves, which close into a single filled `Shape::Path`
  (`shapes-drawing-plan.md`'s `ShapeKind::Path { segments, fill_rule, closed }`) — an ordinary,
  fully-resolvable Shape after that point. Width-as-a-function-of-pressure is exactly the kind of
  small, swappable opinion a plugin declares (a curve/easing, same shape as `kit10-motion`'s
  `EaseSpec`) rather than the host hardcoding one taper behavior.
- **Rasterized brush.** The fitted centerline is walked at fixed arc-length spacing
  (`Path::sample_at(s)`, already exists) and a texture "stamp" is placed at each sample, rotated to
  the tangent and scaled/faded by pressure. **Vellum has no brush-specific concept for this at all**
  (see `resources/vellum-sprite-batch-plan.md`, which supersedes this section's earlier framing) — a
  plugin walks the path itself (using `kit10-geom`'s shared arc-length math) and writes the result as
  an ordinary `SpriteBatch` node: ONE resolved property (`sprites: Vec<SpriteInstance>`, flat position/
  rotation/size/color/opacity/sprite-id data with zero path or pressure semantics attached). Vellum
  just draws whatever `SpriteInstance` list it's handed, sampling a shared atlas (`SpriteAtlas`,
  structurally copied from the glyph atlas's packer, `taf_can_do/src/text/atlas.rs`) in one batched,
  GPU-instanced draw call. Same primitive also serves particle effects, repeating patterns, or anything
  else "many small stamped things" — the "brush" is entirely the plugin's arc-length-walk + pressure
  curve, computed before anything crosses the wire.

A **`BrushProfile`** is the data shape a plugin declares (mirrors how a `FieldDef.inputType` names a
*kind* without naming a provider, VISION.md's 1st Principle): smoothing params (Stage 1's
stiffness/damping, or "off" for a raw-input brush a plugin wants full control over), the fit
tolerance (Stage 4's error threshold — tight for precision line art, loose for a sketchy/expressive
feel), and which OUTPUT primitive it writes (an ordinary `ShapeKind::Path` for a vector brush, an
ordinary `SpriteBatch` for a rasterized one — see `resources/vellum-sprite-batch-plan.md`; there is no
Vellum-level `render: Vector | Raster` mode to declare, since both outputs are just data the plugin
already fully computed). The editor's pen tool is generic over `BrushProfile` the same way
`StyleField.svelte`/`SuggestField.svelte` are generic over `inputType` — it never hardcodes a specific
plugin's brush.

## Open questions (not decided)

- Does `BrushProfile` selection live per-Shape (a property, tokenizable like everything else in this
  dialect) or is it purely an authoring-time tool choice with no resolved-property trace once the
  path is committed? **Resolved by `vellum-sprite-batch-plan.md`: the latter.** A brush shapes the
  INITIAL fit and instance-list computation; the committed `ShapeKind::Path` or `SpriteBatch.sprites`
  is what's actually resolvable, and by the time either reaches Vellum there is no `BrushProfile`
  concept left at all — a brush stroke is indistinguishable from any other hand-authored Path/
  SpriteBatch.
- Where does a rasterized brush's stamp texture live — **resolved: the `assets` table**, same one
  `registerBundledAsset` already populates for images (`vellum-sprite-batch-plan.md`'s `load_sprite`
  reuses `assets.link` resolution exactly like the existing image-reload scan does), not a
  plugin-private resource.
- Live preview during Stage 3 needs to re-run every frame the pointer moves — needs a perf budget
  check against `kit10-motion::Path`'s existing flatten cost before assuming "cheap."
- Spiro (Stage 5) is explicitly out of scope for a first pass; revisit only if Bézier-fit output is
  visibly inadequate for a real use case, not preemptively.

## Key files (once this is built)

- `kit10-geom` (new sibling crate, promoted from `kit10-motion/src/path.rs` per
  `shapes-drawing-plan.md` §2a): RDP, Catmull-Rom→Bézier conversion, Schneider fit, Chaikin
  corner-cutting.
- Editor: `Viewport.svelte` (new pen-mode pointer handling, Stage 0/1), `PathField.svelte`
  (`shapes-drawing-plan.md` §2d).
- Vellum: **`resources/vellum-sprite-batch-plan.md`** is the full, planned answer for both rendering
  strategies (vector fills via Phase 2's `ShapeKind::Path` + a new `PathAtlas`; rasterized stamping via
  a new, brush-agnostic `SpriteBatch` primitive + `SpriteAtlas`) — read that doc for Vellum's actual
  scope, this doc only covers the smoothing/fitting pipeline that feeds it.
- Plugin-facing: a new `BrushProfile` capability, shaped like `provides.exports`/`suggestionsFrom` in
  `PLUGINS.md`'s manifest schema — not started, needs its own manifest-schema section once the shape
  above is locked.
