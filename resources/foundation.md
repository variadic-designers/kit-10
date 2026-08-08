# Foundation first - the shared substrate under animation, text, SDF, and layout

This doc sits **above** the four vertical design docs
([`animations-transitions.md`](./animations-transitions.md),
[`text.md`](./text.md), [`sdf3d.md`](./sdf3d.md),
[`layout-affordances.md`](./layout-affordances.md)). Each of those is a self-contained
feature with its own phasing. Read together, they keep reaching for the **same small set of
substrates that none of them owns** - a per-frame dynamic layer, a value-interpolation +
easing library, a shared deformation stage, and interpolatable layout. Built once per
vertical, that substrate would be four subtly-incompatible copies. Built once as **foundations
the verticals consume**, every feature above becomes thin.

The thesis:

> **The verticals are consumers; the substrate is the product.** Build the shared foundations
> first, as reusable utilities (internal shared modules AND a plugin-facing host-fn surface),
> and animation, text-geometry, SDF, and layout-tweening each collapse to a thin layer on top.

Two disciplines the existing docs already share, restated here because every foundation below
obeys them:

1. **One representation, derived consumers.** `text.md` keeps the glyph outline as the master
   and derives coverage/MSDF/mesh/field from it; `sdf3d.md` makes one `f(p)->float` the whole
   scene; `animations-transitions.md` stores verbatim GSAP ease/position grammar and both
   evaluates and exports it. Never two hand-maintained copies of one truth.
2. **Dynamic vs structural** (the load-bearing performance law, `animations-transitions.md`
   §4). Split cheap **dynamic** state (per-frame, straight to Vellum, never re-resolves) from
   expensive **structural** state (the resolve pipeline, data-change only). Animating through
   resolve is the single biggest trap. Every foundation here serves that split.

Where each pillar lands:

| Pillar | Foundation | Primary consumers |
|---|---|---|
| **A** | Dynamic per-frame layer (Vellum) | anima tweens, Flip transitions, content-tweens, node-drag (retrofit), live-preview |
| **B** | Interpolation + easing (`kit10-motion`) | anima eases/tweens, layout-tween, state-diff, any crossfade |
| **C** | Shared deformation stage `p→p'` | text Stage C, SDF domain warp, MotionPath, DrawSVG, MorphSVG |
| **D** | Interpolatable layout | Flip state-transitions, "layouts that tween" |
| **E** | 3D / SDF (raymarch) | text Phases 3-4, MorphSVG, emboss / deboss / weld |
| **F** | Plugin-facing host-fns | any plugin beyond Charter / WebCodium |

Confirmed greenfield as of this writing: there is **no** interpolation/easing/tween utility
(TS or Rust), **no** deformation or arc-length module, and **no** motion crate. The only
per-frame-override code that exists is one-off, in `taf_can_do/src/render/mod.rs`
(`rebuild_selection_instances`, `start_node_drag`, `build_hatch_instances`) plus the dormant
`continuousMode` flag. That ad-hoc code is not a problem to route around - it is the
**precedent to generalize**. Pillar A is mostly "notice we already did this three times, name
it."

---

## Pillar A - The dynamic per-frame layer (Vellum)

Vellum already updates cheap per-node state every frame and repaints **without re-running
layout** in three places: the selection overlay (`rebuild_selection_instances`, run every
frame from `write_frame`), the hover overlay, and live node-drag (`update_node_drag` mutates
`layout_result.rects` directly). Each re-derives its own caches by hand. They are three
instances of one idea.

Generalize them into **one post-layout dynamic channel**: a per-node
`translate / rotate / scale / opacity / color-override / content-override` applied *after*
taffy as a transform, exactly the mechanism `NodePosition::Absolute` already uses (a pure
post-layout translation, never mapped onto taffy's own `Position` - see CLAUDE.md's
Position-vs-Sizing pitfall). Animating this channel never touches taffy, never re-resolves,
never round-trips through Charter.

Design commitments:

- **Straight to Vellum for hot props.** The canonical per-frame path writes dynamic state
  directly into Vellum (a `set_data`-adjacent API), *not* through Charter's `on_resolve`. This
  extends the existing `on_selection_change` fast-path precedent (which patches
  `last_resolve_input` and re-runs only `build_viewport`), and matches what drag and
  `set_pan` already do. `animations-transitions.md` §4 argues this explicitly for animation.
- **`continuousMode` is this pillar's on/off.** The flag exists and is always `false` today;
  its entire purpose is "reschedule every frame." Playing = flip it on; idle = off. The ticker
  and the render scheduler (`requestRender()`) are the same mechanism. TECHNICAL.md §18 already
  anticipates gating a continuous loop on "an animating/interactive thing is on screen."
- **Content-override is the one structural-looking exception that stays dynamic.** A text-
  string change would normally be structural (re-shape), but it changes no layout topology and
  Vellum owns shaping, so it rides this channel as a per-frame glyph-buffer re-shape (the
  `text` / `scrambleText` content-tween category, `animations-transitions.md` §8.3).
- **Retrofit drag onto it.** A drag is just an animator whose input is the cursor instead of a
  clock. Once the channel exists, `update_node_drag`'s bespoke rect-mutation + cache re-
  derivation becomes "write the channel, repaint."

Consumers: anima tweens, Flip state-transitions (Pillar D), content-tweens, node-drag
(retrofit), and any future live-preview / `on_field_preview` intermediary.

---

## Pillar B - Interpolation + easing (`kit10-motion`)

A new pure, unit-tested crate, sibling to `kit10-scene`, holding the math every other pillar
and every animation feature needs. No rendering, no I/O.

- **Generic `lerp` across the KIT•10 value types.** Scalars, `Extent` (`Auto | Px | Percent` -
  define the rules for interpolating `Auto` and mixed units, the one genuinely non-obvious
  case), `OklabColor` (color interpolation is already perceptual and already lives in
  `kit10-scene` - `taf_can_do/src/color.rs` is just `pub use kit10_scene::OklabColor`, so reuse
  it, do not re-derive an sRGB lerp), transforms, and path parameters.
- **The exact GSAP ease library.** The Penner-derived closed forms
  (`power0..4 / sine / circ / expo / back(n) / elastic(a,p) / bounce / steps(n)`), plus the
  config-arg parse, plus the **CustomEase bezier evaluator** that the entire premium-ease
  family reduces to (CustomWiggle and CustomBounce literally generate a CustomEase - see
  `animations-transitions.md` §2, §8.2). One evaluator previews the whole family.
- **Numerical parity is the fidelity gate.** Ease values must be numerically identical to
  GSAP's or a preview will not match the exported code
  (`animations-transitions.md` §2, §8). Ship parity tests against GSAP reference values; a
  subtly-off `elastic` is a silent export bug.

Delivery (the "internal + plugin-facing" answer): the Rust crate is consumed by Vellum for
preview; a **TS mirror** is consumed by the editor's resolve-level state-diff (Pillar D-a runs
in the editor, not Vellum); and the same primitives are exposed as host-fns (Pillar F). The
`kit10-motion` crate depends on `kit10-scene` for the value types, so `Extent`/`OklabColor`
interpolation has exactly one definition.

---

## Pillar C - The shared deformation stage `p→p'`

`text.md` §8 step 3 states the requirement directly: **spec the shared deformation-stage
interface before either text or SDF grows a private warp system.** This pillar is that spec.
One `Deform` vocabulary, consumed by *all* of: text Stage C glyph placement
(`text.md` §2, §7), SDF domain warp (`sdf3d.md` §4), MotionPath, DrawSVG, and MorphSVG
(`animations-transitions.md` §8.4).

- **Variants:** `matrix | arclength-path | envelope (2D→2D) | surface-projection |
  domain-warp (twist / bend / displace)`. This is the same `p→p'` machinery `sdf3d.md` §5
  describes as "transform the point, not the shape" - an SDF scene graph is a tree of
  coordinate wrappers, and text's Stage C is the same operator applied to glyph mesh vertices.
- **Arc-length path parameterization is the shared sub-utility.** MotionPath (move a transform
  along a path), DrawSVG (animate the visible fraction of a stroked path), and text-on-path are
  three consumers of one arc-length parameterization. It belongs in `kit10-motion` (or a
  `kit10-geom` sibling if geometry utilities grow beyond paths).
- **Carry the Lipschitz discipline as an explicit correctness note** (`sdf3d.md` §1, §4).
  Surface warps (`opRound`, `opOnion`, `opElongate`) preserve the distance metric and march
  normally; space warps (`opTwist`, `opCheapBend`, `opDisplace`) break the bound and must
  shrink the raymarch step size. A deformation's tier is part of its contract, not an
  afterthought.

This is the pillar that makes text apply *seamlessly* onto the SDFs: text-on-a-surface is not
a text feature, it is the geometry deformation stage that text also uses.

---

## Pillar D - Interpolatable layout ("layouts supporting being tweened")

The explicit ask. taffy cannot run at 60fps, and even if it could, frame-by-frame raw-taffy
output is not the same as tweening. So layout tweening is two moves, both foundation-level:

- **(a) Snapshot + interpolate resolved `LayoutResult`s (the Flip foundation).** Capture the
  resolved rects for state A and state B, interpolate between them via Pillar B, and drive the
  result through Pillar A. This is `animations-transitions.md` §5's "interpolate between two
  resolved states" made concrete for layout, and it is exactly what GSAP's Flip plugin does
  (record → change → animate the delta), which is why Flip is the natural export target
  (§7, §8.2). No per-frame taffy. The one requirement it puts on Vellum: `LayoutResult` must be
  cheaply snapshottable and diffable.
- **(b) Post-layout transform independence** (Pillar A applied to layout). Animating a node's
  position / scale / opacity must never trigger relayout - already the `NodePosition::Absolute`
  post-layout-translation pattern, generalized.

Honest boundary: **true content-reflow tweening** (text re-wrapping mid-animation, a grid
re-flowing track counts) stays structural and is deliberately out of the cheap path. The
Flip-diff handles the overwhelmingly common case - a card moving between two resolved layouts,
a panel expanding - by interpolating the two endpoint layouts, not by re-solving the layout
every frame. If a design genuinely needs per-frame reflow, that is a slow discrete change, the
same honesty `animations-transitions.md` §8 applies to "don't animate through resolve."

---

## Pillar E - The 3D / SDF far-future (first-class, a consumer of B + C)

`sdf3d.md`'s raymarch engine and `text.md`'s Phases 3-4 are not a separate stack - they **fall
out of Pillars B and C**, which is why they belong in this foundation narrative rather than off
to the side.

- **`Scene3d` camera-node containment** (TECHNICAL.md §18, a settled decision). The 2D pipeline
  stays 2D; genuine 3D is a scissored raymarch pass over an SDF scene, hosted inside a single
  node's rect. Nothing here 3D-ifies `UiNode` or taffy.
- **Extrusion + the `opRound` / `smin` algebra IS Pillar C applied to a glyph or primitive
  field** (`sdf3d.md` §4, §6; `text.md` §3, §4). Roundedness lands as `opRound`; welds as
  `smin`; emboss/deboss as `opSmoothUnion` / `opSmoothSubtraction`. The correctness ladder
  (Pillar C's Lipschitz note) is this pillar's own gate.
- **Text-into-field (emboss / deboss / weld)** is the payoff of the shared master outline
  (`text.md` §1) plus the shared deformation stage (Pillar C) - the same operator that bends
  geometry welds a word into a surface.
- **Explicitly a luxury layered on top.** Every text style and shape must always degrade to the
  MTSDF-flat / 2D path when the raymarch engine is absent (`text.md` §4). Pillar E is never a
  load-bearing dependency of the near pillars; the near pillars ship fully without it.

---

## Pillar F - The plugin-facing surface (host-fns)

Per the "internal modules AND plugin-facing" direction: once Pillars B and C exist as internal
modules, expose them to third-party plugins via a deliberate host-fn surface
(`kit10_lerp` / `kit10_ease` / `kit10_deform` / `kit10_path_arclength`, or one small grouped
host fn) so plugins beyond Charter and WebCodium can consume the same interpolation, easing,
deformation, and arc-length primitives instead of re-implementing them.

Follow the existing host-fn discipline (CLAUDE.md): typed structs deriving
`ToBytes / FromBytes` with `#[encoding(Json)]`, `#[serde(rename_all = "camelCase")]` on every
boundary-crossing struct (a mismatch fails deserialization silently), and capability-gating via
the manifest's `capabilities.hostFns`. This surface is **additive** and gated behind the
internal modules landing first - it is a re-export of an already-proven internal utility, never
a parallel implementation.

---

## Foundation-first build order (the dependency spine)

Ordered so nothing waits on something below it, and each foundation is cited against the
consumer-doc phase it unblocks:

1. **Pillar B - interpolation + easing.** Pure, zero dependencies. Unblocks
   `animations-transitions.md` Phase 1 (ease library + single tween) and Pillar D. Build first
   because it is testable in isolation and everything motion-shaped needs it.
2. **Pillar A - dynamic per-frame layer.** Unblocks all 60fps motion, the node-drag retrofit,
   and gates `animations-transitions.md` Phase 0. Mostly generalizing existing ad-hoc code.
3. **Pillar D-a - `LayoutResult` snapshot + interpolate.** Unblocks Flip state-transitions
   (`animations-transitions.md` Phase 4) and the "layouts that tween" ask. Needs A + B.
4. **Pillar C - deformation contract + arc-length.** Unblocks `text.md` Phase 2 (type-on-path,
   envelope), MotionPath (`animations-transitions.md` Phase 5), and DrawSVG
   (`animations-transitions.md` Phase 9).
5. **Pillar E - `Scene3d` / SDF.** Unblocks `text.md` Phases 3-4, MorphSVG, and emboss/weld.
   Needs C, and the raymarch engine from `sdf3d.md`.
6. **Pillar F - host-fns.** Layered on B and C once they are stable.

The spine mirrors every consumer doc's own conclusion: B and A are cheap and gate the rest; C
is the shared warp both text and SDF wait on; E is the luxury on top; F is a re-export.

---

## Where it all lives (crate / module map)

| Foundation | Home | Reuses |
|---|---|---|
| Interpolation + easing (B) | **new `kit10-motion` crate**, sibling to `kit10-scene` | `kit10-scene`'s `Extent` / `OklabColor` |
| Arc-length path (C sub-utility) | `kit10-motion` (or a `kit10-geom` sibling if geom grows) | - |
| Dynamic-layer fields on the node (A) | **`kit10-scene`** (`UiNode` per-node dynamic channel) | `NodePosition::Absolute` post-layout precedent |
| `Deform` enum / contract (C) | **`kit10-scene`** (shared by text + SDF wire) | `sdf3d.md` §5 point-transform model |
| Dynamic-layer apply + ticker (A) | `taf_can_do/src/render/` | `rebuild_selection_instances`, `update_node_drag`, `continuousMode` |
| Layout snapshot/interp (D-a) | editor TS (state-diff) + Vellum snapshot API | TS mirror of `kit10-motion` |
| Host-fns (F) | plugin manager (`src/lib/plugins/`) | existing host-fn plumbing |
| TS mirror of B | `src/lib/` motion module | - |

Both renderers already compile against `kit10-scene`, so adding the dynamic-layer fields and
the `Deform` enum there means text, animation, and SDF share one definition - the same win the
shared-crate migration already bought for `UiNode` / `OklabColor`. The new `kit10-motion` crate
depends on `kit10-scene`, never the reverse.

---

## Cross-refs

- [`animations-transitions.md`](./animations-transitions.md) - §4 (dynamic vs structural, the
  law Pillar A/D serve), §5 (interpolate resolved states = Pillar D), §8.2-§8.4 (the ease
  family = Pillar B, the path plugins = Pillar C), Phase list (what each pillar unblocks).
- [`text.md`](./text.md) - §2 (Stage C = Pillar C), §8 step 3 (spec the shared deform contract
  first), §1/§4 (outline master + MTSDF-flat degrade path for Pillar E).
- [`sdf3d.md`](./sdf3d.md) - §4 (deformations = Pillar C), §5 (transform the point), §1 (the
  Lipschitz correctness ladder Pillar C carries), §6/§9 (CSG algebra for Pillar E).
- [`layout-affordances.md`](./layout-affordances.md) - the authoring surface (shipped) whose
  resolved output Pillar D snapshots and interpolates.
- `taf_can_do/TECHNICAL.md` §18 - `Scene3d` containment and the continuous-loop gating Pillar
  A/E rely on.
