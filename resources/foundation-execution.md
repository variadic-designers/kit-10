# Executing the foundation - a multi-point milestone plan

Companion to [`foundation.md`](./foundation.md). That doc names the shared substrate
(Pillars A-F) under animation, text, SDF, and layout-tweening, plus the strategic build order
(B → A → D → C → E → F). This doc turns it into concrete, PR-sized milestones grounded in the
real integration points, so the substrate gets built low-risk-first.

> **Status (2026-08-07).** M1-M5 SHIPPED (Charter and the resolve pipeline are untouched by M1-M4;
> the animation layer is additive and inert until driven):
> - **M1 (kit10-motion crate):** interpolation + GSAP eases + CustomEase. DONE.
> - **M2 (dynamic layer, Pillar A):** per-node full affine (translate/scale/rotate/opacity) applied
>   at instance-build time via `render_affines`; rotation threaded through the box + image vertex
>   shaders; selection/hover overlays follow. DONE.
> - **M3 (tween runner, Pillar B):** GSAP-ease tweens on the ticker. DONE.
> - **M4 (Flip, Pillar D-a):** per-node interpolation between two resolved layouts
>   (`begin_flip`/`commit_flip`). DONE.
> - **M5 (Pillar C):** the arc-length `Path` primitive + `MotionPath`, the deferred per-glyph text
>   transform (`GlyphTransform`), text-*on*-path (per-glyph path placement, `shape_area`'s
>   `glyph_path_transform`), and the `Deform` wire contract (`kit10-scene` v0.2.6, only
>   `ArclengthPath` interpreted so far) are all DONE. Charter authors it via a `text-path` (+
>   `text-path-offset`) property, a raw JSON-array escape hatch - see AGENTS.md's own note. This
>   was the one milestone that touched Charter and did the `kit10-scene` bump (dual wasm rebuild,
>   both repos deployed).
> - **M6 (host-fns):** not started.
>
> In-app verification: web debug keybinds `Shift+T` (tween), `Shift+F` (Flip), `Shift+M`
> (MotionPath), `Shift+P` (text-on-path, toggles the selected Text view onto a demo sine-wave path)
> on the selected view; native `cargo run --features standalone` runs a self-contained
> "Animation Stage" panel cycling Flip / gentle in-place tweens / small MotionPath loops, kept
> clear of the `example_scene` feature showcase. These debug hooks are scaffolding, removed when the
> real animation authoring UI lands.

Three facts about the codebase reshape the sequencing:

1. **`kit10-scene` is a git-tagged shared crate** (`tag = "v0.2.2"`), consumed by BOTH Vellum
   (`taf_can_do/Cargo.toml`) and Charter (`kit10/plugins/charter/Cargo.toml`). Any change to it
   is a commit + tag + bump-both-Cargo.tomls + rebuild-BOTH-wasm ritual, not a local edit. So
   `kit10-scene` changes are expensive and must be deferred and batched. **Only Pillar C needs
   one.**
2. **Drag and selection are already Vellum-owned side state**, applied post-layout to
   `layout_result` (`translate_layout_result_subtree`, `rebuild_selection_instances`,
   `DragSession`), entirely OFF the `kit10-scene` wire. So **Pillar A (the dynamic layer) is
   pure Vellum-side: a per-node side array + JS exports + post-layout apply, no wire bump, no
   Charter.** This is the biggest de-risk in the plan.
3. **Interpolation runs Rust/Vellum-side first**: no TS mirror of `kit10-motion` until the
   editor genuinely needs client-side math (GSAP-export preview, later).

Scope: **substrate + proof-of-life** for Pillars A, B, D-a, C, F, each with a minimal
end-to-end demo. Explicitly OUT: the anima authoring product (timeline PGlite model, scrubber
UI, GSAP exporter), content-reflow layout tweening, and Pillar E (Scene3d / SDF).

---

## The milestones

### M1 - `kit10-motion` crate: interpolation + easing (Pillar B). Pure, zero integration.
- New git-tagged crate (sibling to `kit10-scene`, depends on it for `Extent` / `OklabColor`).
- `lerp` across: scalar, `Extent` (define the `Auto` / mixed-unit rules - the one non-obvious
  case), `OklabColor` (reuse `kit10-scene`'s, do not re-derive an sRGB lerp), a transform
  (translate/rotate/scale/opacity), and a path parameter.
- Ease library: `power0..4 / sine / circ / expo / back(n) / elastic(a,p) / bounce / steps(n)`
  + config-arg parse + the **CustomEase bezier evaluator** the premium-ease family reduces to.
- Tests: **numerical parity vs GSAP reference values** (the fidelity gate for anima export -
  capture a fixture of GSAP outputs, assert within epsilon), plus Extent/color lerp unit tests.
- Done when `cargo test` is green. Nothing consumes it yet. Tag `v0.1.0`. Ideal first PR.

### M2 - Vellum dynamic per-frame layer (Pillar A). Vellum-side only, off-wire.
- Add a per-node dynamic-transform side array to `Graphics` (indexed by node index, default
  identity), mirroring how drag/selection side state already works - NOT a `kit10-scene`
  `UiNode` field, so no contract bump.
- New `#[wasm_bindgen]` exports in `taf_can_do/src/lib.rs`: `set_node_dynamic(index, translate,
  rotate, scale, opacity)` + a clear/reset. Apply post-layout into `layout_result` each frame,
  extending the existing `translate_layout_result_subtree` path, and **re-derive
  selection/hover/hatch caches inside the same apply** (AGENTS.md's "any per-frame cache split
  from the dragged layout must be re-derived or it lags" rule).
- Drive via the reserved `continuousMode` flag in `Viewport.svelte` + a rAF loop, gated so it
  only paints while dynamic state is active; every mutation pairs with `requestRender()`.
- **Validate by retrofitting node-drag onto the channel** (a drag is an animator whose input is
  the cursor) - proves the channel end-to-end against an existing feature, no new UI.
- Rebuild + copy the Vellum wasm. No `kit10-scene` bump, no Charter rebuild.

### M3 - Proof-of-life: one 60fps tween (Pillar B x A).
- A minimal Vellum-side tween runner: given `(node index, from, to, duration, ease-string)`,
  evaluate on the ticker via `kit10-motion` (M1), write the dynamic channel (M2). Triggered by
  a dev export (`debug_tween_node(...)`) or a temporary editor button - NOT the authoring UI.
- This is anima Phase 0+1 combined: proves a node moves at 60fps with **no re-resolve**. The
  milestone that de-risks the whole substrate.
- Verify: user drives it in-app, confirms smooth motion; log-check that no `on_resolve` fires
  during the tween.

### M4 - Interpolatable layout: the Flip foundation (Pillar D-a). Vellum-side.
- Make `LayoutResult` cheaply snapshottable (clone rects by index) + a Rust-side
  `interpolate_layouts(a, b, t)` that lerps matched rects via `kit10-motion` and drives the
  dynamic channel (M2). Expose as a `begin_flip(snapshotA)` / `commit_flip(ease, duration)`
  style API (B captured from the current resolved layout). Runs Rust-side - no TS mirror.
- Proof-of-life: capture layout A, change an axis/arrange value (resolve produces B), tween the
  delta - one card moving between two layouts.
- Honest boundary: content-reflow tweening (mid-animation re-wrap) stays structural and out of
  scope; Flip handles endpoint-to-endpoint. No wire bump.

### M5 - Shared deformation contract + arc-length (Pillar C). The one `kit10-scene` bump.
- Define a `Deform` enum in `kit10-scene` (`matrix | arclength-path | envelope |
  surface-projection | domain-warp`), default variant identity so existing scenes stay
  byte-identical; carry the Lipschitz tier per variant (`sdf3d.md` discipline). Add the
  arc-length parameterization util to `kit10-motion` (or a `kit10-geom` sibling).
- The `kit10-scene` ritual: commit + tag (`v0.2.3`), bump the tag in Charter AND Vellum
  Cargo.tomls, **rebuild + copy both wasm artifacts**.
- First consumer / proof-of-life: **text-on-path** (`text.md` Phase 2) - Charter emits a
  `Deform::ArclengthPath` binding for a text node; Vellum's Stage-C glyph placement consumes it
  so glyphs follow a 2D path, reusing the same arc-length primitive MotionPath will later use.
- Highest-cost milestone (dual rebuild, both Charter and Vellum touched) - deliberately last of
  the near substrate.

### M6 - Plugin-facing host-fns (Pillar F). Additive.
- Expose `kit10-motion`'s lerp/ease + Pillar C's deform/arc-length as capability-gated host-fns
  (typed `ToBytes/FromBytes` + `#[serde(rename_all = "camelCase")]`, per AGENTS.md host-fn
  discipline). Gated behind M1/M5 landing; a re-export of proven internals, never a parallel
  impl.
- Proof-of-life: a test/plugin calls `kit10_ease` and gets GSAP-identical output.

---

## Explicitly deferred (out of this execution)
- anima authoring product: timeline/tween PGlite model, scrubber/playhead UI, GSAP exporter
  (anima Phases 2-3) - the substrate makes them a thin follow-on.
- TS mirror of `kit10-motion` (until the editor needs client-side math).
- Content-reflow layout tweening.
- Pillar E: Scene3d raymarch, extrusion, text-into-field, MorphSVG (gated on the `sdf3d.md`
  engine, which does not exist).

---

## Cross-cutting execution discipline
- **Two-repo commit** for any `taf_can_do` change: source → `taf_can_do` `origin/master`,
  compiled artifacts → `kit10`; never push `taf_can_do` `upstream`.
- **Vellum rebuild**: `wasm-pack build --target web --no-default-features --no-opt --out-dir
  ../kit10/src/lib/vellum` then verify the copy; **Charter**: `cargo build --target
  wasm32-unknown-unknown --release` + copy to `static/charter.wasm`. `cargo test` never touches
  either deployed artifact - rebuild + copy before any in-browser check.
- New fields land at struct end / default-identity so existing scenes deserialize unchanged
  (M2's side array is off-wire, so this is mostly an M5 concern for the `Deform` default).
- naga-validate any new WGSL and keep derivative ops in uniform control flow (M2/M4 are
  layout-side and likely touch no shaders; guard if they do).
- Confirm visual/motion results with the user, do not headless-screenshot.

---

## Representative files
- **New**: `kit10-motion/` (`Cargo.toml` + `src/`: interp, ease, custom_ease, arclength).
- `taf_can_do/src/render/mod.rs` (dynamic side array, `set_node_dynamic`, post-layout apply,
  `interpolate_layouts`, flip API), `taf_can_do/src/lib.rs` (`#[wasm_bindgen]` exports) →
  rebuild into `kit10/src/lib/vellum/`.
- `kit10-scene/src/lib.rs` (`Deform` enum, M5 only) → tag bump → Charter + Vellum Cargo.tomls.
- `kit10/plugins/charter/src/lib.rs` (emit `Deform` for text-on-path, M5).
- `kit10/src/lib/editor/Viewport.svelte` (`continuousMode` / rAF drive for M2/M3, flip trigger
  M4).
- `kit10/src/lib/plugins/manager.svelte.ts` (host-fns, M6).

---

## Verification
- **M1**: `cargo test` in `kit10-motion` green, incl. the GSAP parity fixture within epsilon.
- **M2/M3/M4**: user drives the retrofitted drag / dev-tween / flip in-app and confirms 60fps
  smoothness; a log assertion shows `on_resolve` does not fire during a tween (the dynamic-vs-
  structural guarantee).
- **M5**: rebuild + copy both wasm, user visually confirms glyphs follow a path in the editor.
- **M6**: a test calls a host-fn and asserts GSAP-identical ease output.
- Whole-plan gate: each milestone is independently shippable and reversible; the expensive
  `kit10-scene` bump happens exactly once (M5).

---

*See also: [`foundation.md`](./foundation.md) (the pillars this executes),
[`animations-transitions.md`](./animations-transitions.md) (anima phases M1/M3/M4 satisfy),
[`text.md`](./text.md) (Stage C / text-on-path, M5's first consumer),
[`sdf3d.md`](./sdf3d.md) (the Lipschitz discipline M5 carries, and Pillar E's engine).*
