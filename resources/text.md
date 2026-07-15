# Text as first-class geometry — a long-term plan

Companion to [`sdf3d.md`](./sdf3d.md). That doc argued SDFs could be Vellum's
geometry primitive. This one argues **text has to ride the same rails** — because
the features we actually want (type on a path, envelope distort, projection onto a
surface, and extrusion with roundedness) are impossible under the current
"axis-aligned quad + coverage bitmap" model, and become *natural* under a single
outline-driven, deformation-shared design.

The hard expectation that shapes everything here: **text must apply seamlessly onto
the 3D SDFs.** Not as a bolted-on decal mode — as the same class of thing the SDF
geometry is, flowing through the same deformation stage. If a designer welds a
shape into a surface with `smin`, they should be able to weld a word into it the
same way.

---

## 0. Where we are today (the thing we're evolving)

Vellum's text path (`taf_can_do/src/text/`):

- **Shape/layout — cosmic-text.** `Buffer` + `shape_until_scroll` + `layout_runs`:
  font resolution, advanced shaping, wrapping, at logical `font_size`. Correct, keep it.
- **Rasterize — swash** via `SwashCache.get_image` → an **8-bit coverage bitmap**
  (`img.data`), requested at `font_size × dpr`.
- **Atlas — one `R8Unorm` texture** (`atlas.rs`, 4096²), glyphs packed with a
  padding gutter, bilinear sampled.
- **Draw — `glyph_shader.wgsl`.** One axis-aligned quad per glyph; fragment shader is
  `color.a * textureSample(...).r` — a straight alpha-masked quad.

The per-glyph vertex is literally (`taf_can_do/src/render/types.rs`):

```rust
pub struct GlyphVertex {
    pub position: [f32; 2],   // <- 2D, axis-aligned, baked
    pub uv:       [f32; 2],   // <- into a fixed-size coverage atlas
    pub color:    [f32; 4],
}
```

Two properties of this are load-bearing problems:

1. **Placement is baked into an axis-aligned 2D quad.** It can only rigid-translate.
   No per-glyph rotation (path), no interior bend (warp/envelope), no depth (extrude),
   no surface-conforming (projection).
2. **The glyph is stored as pixels, not shape.** A bitmap is only correct near its
   rasterized size — hence the existing `×dpr` rasterization and the extreme-zoom
   `cull`/re-raster machinery, which is *already* paying the "bitmap doesn't scale"
   tax in pure 2D. You cannot extrude, offset, bevel, or field-combine an image.

Every feature we want is blocked at one of these two. So the plan is two moves, not
four features.

---

## 1. The central realization: the outline is the master

Today swash rasterizes the glyph **outline** straight to coverage and discards the
outline. That outline — the glyph's bezier contours — is the one representation
*every* other representation derives from:

```
                          ┌─ rasterize ───────→ coverage bitmap    (today; flat UI labels)
                          ├─ field-gen ───────→ MSDF               (crisp under scale/rotate/warp/persp)
   glyph OUTLINE ────────►├─ triangulate ─────→ fill mesh          (crisp vector fill; extrusion cap)
   (bezier contours,      ├─ sweep+cap+bevel ─→ 3D solid mesh      (EXTRUSION with roundedness)
    the source of truth)  └─ outline → 2D SDF ─→ opExtrusion/opRound/smin  (text ON / INTO the SDFs)
```

The bottom two rows are the extrusion + text-on-SDF answer, and **roundedness lands
in two flavours that match the two render backends** (§4):

- **Mesh route:** roundedness = a **bevel profile** swept on the extruded rim
  (chamfer / round / step presets — Illustrator 3D bevel, Blender curve bevel).
- **SDF route:** roundedness = literally **`opRound`** from `sdf3d.md` — perfectly
  smooth, and `smin`-weldable into a surface.

Same requirement, two implementations, both falling out of "keep the outline."

**Acquiring the outline is cheap:** the font data is already resident (cosmic-text /
fontdb / ttf-parser expose glyph outlines directly). This is the single pivot the
whole plan turns on — nothing in Phases 2–4 is possible without it, and it's a
drop-in next to the existing swash raster call.

---

## 2. The layered architecture to commit to

Four stages, strictly separated. The separation *is* the design — entangling any two
is how you get a renderer that can't grow.

**Stage A — Shaping (cosmic-text). Flat, isolated, never warped.**
String → glyphs on a straight baseline. Shape flat, *then* deform — always. This
boundary already exists; guard it religiously.

**Stage B — Glyph representation (derived from the outline, swappable).**
`coverage bitmap | MSDF | fill mesh | extruded solid | glyph-SDF`. Behind one
interface. Which one is chosen per text-style, not baked into "text." Body copy →
MSDF-flat; a hero title → extruded solid; a logo welded into a panel → glyph-SDF.

**Stage C — Deformation (`p_flat → p_world`). SHARED with geometry.**
This is the stage that doesn't exist today. A glyph becomes a **tessellatable mesh**
whose vertices flow through a warp:
- **matrix** → flat card / 3D card,
- **arc-length along a path** → type on a path,
- **2D→2D envelope** → envelope distort,
- **projection onto a surface / SDF** → text on a surface,
- **domain warp** (twist/bend/displace) → same ops as SDF geometry.

Critically, this is **the same `p→p'` machinery as the SDF domain deformations in
`sdf3d.md`.** Do not build a text-only warp system. "Project this word onto that
surface" must be the *same* operator as "bend this geometry," so text and geometry
share one answer to "how does a thing get bent in space." That shared stage is what
makes text apply *seamlessly* to the SDFs — it's not a text feature, it's the
geometry deformation stage that text happens to also use.

**Stage D — Backend (raster or raymarch).**
Two renderers; text must be expressible in both and degrade gracefully (§4).

---

## 3. Seamless text-on-SDF (the headline expectation)

Two genuinely different things hide under "text on a surface"; the plan supports
both, and they map to the two backends:

**(a) Text ON a surface — a decal / conforming skin.**
The glyph coverage (MSDF, so it stays crisp at any angle/scale) is *placed onto* the
surface by Stage C's projection warp: sample the surface, map glyph UV → surface
parameterisation (or project along a direction), tessellate enough to follow
curvature. The glyph is still a thin skin; the surface underneath is whatever it is
(SDF, mesh). This is the common case — a label on a curved panel, text on a bottle.

**(b) Text INTO/AS the SDF field — emboss, deboss, weld, smooth roundedness.**
Here the glyph becomes a **2D SDF** (from its outline, or read from the MSDF field),
lifted via `opExtrusion`, rounded via `opRound`, and **combined into the surface's
own distance field** with `opSmoothUnion` / `opSmoothSubtraction`:
- emboss = `smin(surface, extruded_glyph, k)`
- deboss/engrave = `opSmoothSubtraction(extruded_glyph, surface, k)`
- freestanding rounded 3D text = `opRound(opExtrusion(glyphSDF, h), r)`

This is the case that *requires* the SDF engine and is the reason text and geometry
must share the field representation. It's also where "roundedness and whatever"
becomes trivial — it's the `opRound`/`smin` algebra already catalogued in
`sdf3d.md`, applied to a glyph field instead of a primitive field.

The unification to hold onto: **a glyph is coverage-carrying geometry.** In backend
(a) it's a textured skin; in backend (b) it's a contributor to the scene's distance
field. Same source outline, same deformation stage, two evaluation strategies.

---

## 4. The two backends, and the perf reality

| | Raster route (2D + camera-3D) | Raymarch route (SDF engine) |
|---|---|---|
| Representation | coverage / MSDF / fill mesh / extruded mesh | glyph-SDF folded into `map()` |
| Extrusion roundedness | swept **bevel profile** on the rim | **`opRound`** (exact, smooth) |
| Text-on-SDF | projection decal (skin) | `smin`/`opSub` into the field (weld) |
| Crispness under transform | MSDF: yes; bitmap: no | exact at any scale |
| Cost | cheap → moderate (mesh extrude) | expensive per glyph |
| Use for | body copy, labels, most titles | hero text, emboss, organic 3D |

**Perf discipline is non-negotiable.** A paragraph of body text must *never* go down
the mesh-extrude or (especially) the glyph-SDF path — each glyph in `map()` is a real
per-fragment cost, and `map()` runs 100+ times per pixel. Default is **MSDF-flat**;
the heavy modes are explicit per-text-style opt-ins for display/hero text. Cache
every derived form keyed on `(glyph, params)` — glyphs repeat constantly, same
discipline the current atlas already applies. The SDF route is a **luxury layered on
top**, never a load-bearing dependency: a text style must always be able to fall back
to the MSDF-flat representation when the raymarch engine isn't present.

---

## 5. The glyph-instance data model (concrete, against today's `GlyphVertex`)

The evolution is legible directly from the current struct. Today:

```rust
struct GlyphVertex { position: [f32;2], uv: [f32;2], color: [f32;4] }
```

Target — a glyph *instance* references a representation + a deformation, and its
geometry is a mesh (≥ a quad, tessellatable), in 3D:

```rust
// Per-glyph placement result: no longer a baked axis-aligned quad.
struct GlyphInstance {
    glyph_ref:  GlyphKey,        // font + glyph id + subpixel bin (as today's CacheKey)
    repr:       GlyphRepr,       // which Stage-B form to draw (swappable)
    deform:     DeformRef,       // Stage-C warp binding: matrix | path | envelope | surface | none
    baseline:   [f32; 3],        // pen origin in *flat* layout space, pre-deform (note: 3D)
    color:      [f32; 4],
}

enum GlyphRepr {
    Coverage,                    // R8 atlas (today's path)
    Msdf,                        // multi-channel SDF atlas
    FillMesh,                    // triangulated outline (crisp vector fill)
    Solid { depth: f32, bevel: BevelProfile }, // extruded mesh w/ roundedness
    FieldSdf { depth: f32, round: f32 },       // contributes to raymarch map()
}

// The tessellated render mesh; vertices carry enough to be warped and lit.
struct GlyphMeshVertex {
    position: [f32; 3],          // was [f32;2] — now 3D, pre/post-deform per stage
    uv:       [f32; 2],          // into coverage/MSDF atlas (unused for pure solid)
    normal:   [f32; 3],          // for extruded solids under the camera-3D lighting
    color:    [f32; 4],
}
```

The two edits that unlock the future without shipping any feature yet:
`position: [f32;2] → [f32;3]`, and a glyph becomes a **mesh + deform binding**
instead of a hardcoded quad. Everything else is additive derivation.

---

## 6. Phasing (each phase independently shippable)

- **Phase 0 — Don't foreclose (now, ~free).** Reshape the glyph path so a glyph is
  `{ glyph_ref, geometry: mesh, repr, deform }` rather than a baked axis-aligned quad;
  make `GlyphRepr` swappable; keep Stage A ⟂ Stage C. No new user-facing features —
  pure hygiene so the rest is additive. Widen `GlyphVertex.position` to 3D behind the
  scenes (z = 0).
- **Phase 1 — Placement stage + camera-3D.** Per-glyph transform (unlocks **2D type
  on a path** immediately — rigid per-glyph rotation). Land the VP-matrix ortho /
  perspective camera + depth buffer (see the camera-3D note; today's 2D pan/zoom *is*
  an ortho matrix, so this unifies rather than replaces). Text still coverage; accept
  blur — this establishes the 3D *space* text will inhabit.
- **Phase 2 — Outline + MSDF + fill mesh + warp.** Acquire glyph outlines (the pivot).
  Derive MSDF (retires the zoom hacks; crisp under scale/rotate/perspective). Derive
  fill mesh. Tessellated glyph mesh through Stage C → **envelope distort** and
  **text-on-surface projection (decal / route a)**.
- **Phase 3 — Extrusion (mesh route).** From the outline: cap + swept side walls +
  **beveled/rounded rim profiles**, rasterized with Phase-1's camera + depth + normals
  for lighting. Genuine extruded 3D text with roundedness; depth/bevel/round are
  resolved (non-destructive) properties.
- **Phase 4 — Text as SDF field (raymarch route).** Once the `sdf3d.md` engine exists:
  glyph → 2D SDF → `opExtrusion` / `opRound` / `smin` → **emboss / deboss / weld text
  into surfaces** and smooth organic 3D text. Hero text only. This is the payoff of
  having shared the outline and the deformation stage all along.

The dependency spine: Phase 0–1 need nothing new; **Phase 2's outline acquisition is
the gate** for all crispness-under-transform and all extrusion; Phase 4 additionally
needs the SDF renderer. So the ordering is forced and clean.

---

## 7. Designer implications (why this is worth the architecture)

Each capability is a staple the designer already expects from vector/3D tools, and
under this plan they're *derivations of one system*, not four bespoke features:

- **Type on a path** — bind text to a curve (Stage C path warp). Illustrator "Type on
  a Path."
- **Envelope distort** — bind text to a deformed bounding shape (Stage C envelope).
  Illustrator "Make with Warp / Mesh."
- **Text on a surface** — project onto an SDF/mesh (Stage C projection, route a).
- **Extrude with roundedness** — bevel-swept solid (route b, mesh) or `opRound`
  (route b, SDF). Illustrator/Blender 3D text.
- **Emboss / engrave / weld into geometry** — `smin`/`opSub` into the field (route b,
  SDF). The design-tool superpower nothing cheap gives you.

And because KIT•10 is non-destructive by thesis, every one of these is a **resolvable
property** — path binding, bevel profile, extrusion depth, weld radius — editable
forever, never flattened. Text is not a special case in the resolution model; it's
geometry that also happens to carry coverage.

---

## 8. Immediate next steps (recommended sequence)

The concrete near-term path, smallest-risk first — this is the execution plan behind
the phasing in §6:

1. **Ship this doc.** Agree the north star and the two commitments (§9) before writing
   code, so Phase 0 is done with intent.
2. **Phase 0 hygiene in `taf_can_do`.** Reshape the glyph path so a glyph is
   `{ glyph_ref, mesh, repr, deform }` (§5), and widen `GlyphVertex.position` to
   `[f32;3]` (z = 0). No user-facing change; pure decoupling. Ships behind the
   existing behaviour.
3. **Spec the shared deformation-stage interface** — the `p→p'` contract that *both*
   text and SDF geometry consume (§2 Stage C). This is the load-bearing unification;
   write it down before either side grows a private warp system.
4. **MSDF spike.** Prove outline acquisition (Phase 2's gate) + one glyph rendered
   from an MSDF atlas, crisp under an arbitrary transform. De-risks everything downstream.

Only after those four is there a decision to make about *which* feature (path, warp,
extrude) to build first — and by then it's a derivation, not a rewrite.

## 9. The two decisions that matter

Everything above reduces to two commitments. Make them now (they're nearly free now
and ruinously expensive to retrofit later):

1. **Stop discarding the glyph outline.** It is the master representation; coverage,
   MSDF, fill mesh, extruded solid, and glyph-SDF are all derived and cached from it.
2. **Make deformation shared geometry infrastructure**, not a text feature. Text on a
   path, warped, projected, or welded into an SDF must run the *same* `p→p'` stage as
   geometry — that shared stage is precisely what makes text apply seamlessly to the
   3D SDFs.

Do those two, and extrusion-with-roundedness, text-on-surface, and text-welded-into-a-field
are derivations of a coherent system — not a renderer rewrite each.

---

*Companion: [`sdf3d.md`](./sdf3d.md) (SDF primitives, deformations, CSG algebra the
text-on-SDF routes reuse). Current implementation: `taf_can_do/src/text/`
(cosmic-text shaping + swash coverage atlas), `taf_can_do/src/render/glyph_shader.wgsl`,
`GlyphVertex` in `taf_can_do/src/render/types.rs`.*
