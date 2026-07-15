# Animato — animation & transitions, with GSAP as the export target

Research on GSAP (the de-facto standard for web motion) and a plan for **animato**,
KIT•10's animation system. The hard requirement: **animato must export to GSAP code
losslessly.** That single constraint decides the architecture — because the cheapest
way to export perfectly to a system is to *author in that system's own model*. So the
thesis of this doc is:

> **Adopt GSAP's data model (tween / timeline / ease / position / stagger) as animato's
> native representation, and make GSAP export a serialization rather than a translation.**
> Then solve the *performance* separately, against Vellum's GPU renderer.

Companion to [`sdf3d.md`](./sdf3d.md) and [`text.md`](./text.md) — the path/deformation
infrastructure those propose is the *same* machinery animato needs for motion-along-a-path.

---

## 1. What GSAP actually is (distilled)

GSAP is a **property interpolation engine** driven by one global ticker. It is not a
CSS-transition wrapper — it computes values in JS every frame and sets them directly.
Three layers:

### 1.1 The Tween — the atom

A tween is "a high-performance property setter": given targets, a duration, and target
property values, it interpolates each frame. Four constructors:

```js
gsap.to(target, vars)              // current → vars
gsap.from(target, vars)            // vars → current
gsap.fromTo(target, fromVars, toVars)  // explicit both ends
gsap.set(target, vars)             // instant (duration 0)
```

`vars` carries both the animated properties *and* the config: `duration`, `ease`,
`delay`, `repeat`, `yoyo`, `stagger`, `onComplete`, `overwrite`, `keyframes`, etc.

```js
gsap.to(".box", { x: 100, rotation: 27, duration: 1, ease: "power2.out" });
```

Relative values (`x: "+=100"`), unit conversion, and color interpolation (in RGB) are
built in.

### 1.2 The Timeline — the composition

A timeline is a **container of tweens** (and nested timelines) with a playhead. Chaining
sequences them; the **position parameter** (§1.3) overrides placement. Moving a parent
playhead cascades to children.

```js
const tl = gsap.timeline({ defaults: { duration: 1, ease: "power2.out" } });
tl.to(".a", { x: 100 })
  .to(".b", { y: 200 }, "<")        // start with previous
  .addLabel("mid")
  .to(".c", { rotation: 360 }, "mid+=0.5");
```

`defaults` apply to every child tween. Labels are named playhead positions.

### 1.3 The position parameter — the sequencing grammar (quote-exact)

The second arg to `.to()/.from()/.fromTo()` on a timeline. Every form:

| Form | Meaning |
|------|---------|
| `3` | absolute — 3s from timeline start |
| `"someLabel"` | at a label (created at end if missing) |
| `"+=1"` / `"-=1"` | 1s gap after / 1s overlap before timeline end |
| `"<"` / `">"` | start / end of the **previous** animation |
| `"<1"` = `"<+=1"` | 1s after previous start; `">-0.5"` = 0.5s before previous end |
| `"myLabel+=2"` | relative to a label |
| `"+=50%"` / `"-=25%"` | gap/overlap as % of the **inserting** tween's duration (3.7+) |
| `"<25%"` | 25% into the previous animation |

### 1.4 Stagger — one tween, many targets, offset in time

Number form (`stagger: 0.1` = 0.1s between each), or object form:

```js
stagger: {
  each: 0.1,            // time between each (or use `amount` for total spread)
  amount: 1.5,          // total time spread across all (alternative to each)
  from: "center",       // "start" | "center" | "end" | "edges" | "random" | index
  grid: [rows, cols],   // 2D staggering
  axis: "x",            // restrict grid distance to one axis
  ease: "power1.in"     // distribute offsets along an ease
}
```

### 1.5 Keyframes — multi-stage within one tween

```js
gsap.to(".box", { keyframes: {
  x: [0, 100, 50],
  y: [0, 50, 200],
  ease: "power1.inOut"
}, duration: 3 });
// or array-of-objects form, each with its own duration/ease
```

### 1.6 Control API (Tween & Timeline share `Animation`)

`.play() .pause() .reverse() .restart() .seek(t) .progress(0..1) .time() .duration()
.timeScale(x) .kill() .invalidate()`. This is the runtime surface animato's preview
scrubber and playhead need to mirror.

---

## 2. Easing — the fidelity-critical part

Eases are the *shape* of interpolation `progress = ease(t)`, `t∈[0,1]`. **animato's eases
must be numerically identical to GSAP's**, or a preview won't match the exported code.
GSAP's eases are Penner-derived closed forms — cheap to reimplement exactly.

**Built-in** (each with `.in` / `.out` / `.inOut` unless noted):

- `none` (= `linear`) — constant velocity.
- `power0..power4` — polynomial of degree 1..5 (`power1` = quad, `power2` = cubic, …).
  **GSAP default ease is `power1.out`.** (Note: `power0` = linear.)
- `sine`, `circ`, `expo` — trig / circular / exponential curves.
- `back` — overshoots then settles. Configurable: `back.out(1.7)` (overshoot amount).
- `elastic` — spring oscillation. `elastic.out(amplitude, period)` e.g. `elastic.out(1, 0.3)`.
- `bounce` — decaying bounces.
- `steps(n)` — discrete quantized steps.

**Plugin eases** (EasePack): `slow(SlowMo)`, `rough(RoughEase)`, `expoScale(ExpoScaleEase)`.
**Premium**: `CustomEase` (arbitrary bezier curve — an SVG-path-like `d` string),
`CustomBounce`, `CustomWiggle`.

Ease strings are passed verbatim (`ease: "elastic.out(1, 0.3)"`), so animato's ease
model should store the **same string grammar** — name + optional config args — and both
(a) evaluate it and (b) emit it verbatim on export.

> `CustomEase` matters: it's a bezier curve editor. animato's ease-curve editor should
> produce a `CustomEase` `d` string so a hand-drawn curve round-trips to GSAP exactly.

---

## 3. Why GSAP is performant (and which of it transfers)

| GSAP technique | What it does | Transfers to Vellum? |
|---|---|---|
| **Single rAF ticker** (`gsap.ticker`) | one loop updates *all* animations; no per-tween timers | **Yes** — one ticker drives Vellum, not N |
| **Lag smoothing** (`gsap.ticker.lagSmoothing(500, 33)`) | on a frame spike, clamps dt so motion doesn't "jump" | **Yes** — same dt-clamp on the ticker |
| **Direct value setting** | sets props in JS each frame; never CSS transitions | **Yes** — animato writes node transforms per frame |
| **`force3D` / GPU layer** | promotes transforms to `translate3d` for GPU compositing | **Different** — Vellum *is* the GPU; transforms are uniforms |
| **Lazy rendering** | batches first-frame reads to avoid layout thrash | Partial — Vellum has no DOM layout to thrash |
| **Overwrite management** | resolves two tweens hitting the same prop (`overwrite: "auto"`) | **Yes** — needed in animato's evaluator |

The load-bearing lessons: **one ticker**, **clamp dt**, **set values directly**, and
**resolve overwrites**. GSAP's DOM-specific optimizations (force3D, lazy layout reads)
are moot because Vellum owns the GPU — which is actually an *advantage* (§4).

---

## 4. How KIT•10/Vellum changes the problem

Two facts about this stack reshape the performance design:

1. **Vellum renders on-demand, not in a perpetual rAF loop.** `Viewport.svelte` only
   paints in response to a change (`requestRender()` coalesces into one rAF). There is
   already a `continuousMode` flag (currently always `false`) whose entire purpose is
   "reschedule every frame" for animation. **animato playing = flip `continuousMode` on;
   idle = off.** The ticker and the render scheduler are the same mechanism.
2. **The property source is the resolve pipeline, not the DOM.** Values flow
   DB → resolve → Charter → Vellum `UiNode[]`. A naive "animate = re-resolve every frame"
   would be catastrophic (resolve + serialize + WASM plugin call per frame). So animation
   must **bypass the resolve for the hot properties** and write them straight into Vellum
   as cheap per-node state — exactly the pattern Vellum already uses for the **selection
   overlay**, which it rebuilds *every frame* from a light per-node struct without
   re-running layout.

This gives the core performance rule:

> **Split "animatable transform" (cheap, per-frame, GPU) from "structural resolve"
> (expensive, only on data change).** Translate / rotate / scale / opacity / color of a
> node must be a per-node value Vellum can update and repaint without a layout pass or a
> Charter round-trip. Structural changes (adding nodes, changing text, relayout) stay on
> the slow resolve path and must not happen per animation frame.

Concretely that means adding an **animatable transform layer** to the `UiNode` wire
format (a per-node `translate`/`rotate`/`scale`/`opacity`, applied post-layout as a
matrix, the same way `NodePosition::Absolute` is applied as a post-layout translation
today) — so animating it never touches taffy.

---

## 5. The KIT•10-native insight: animation is interpolation between *resolved states*

KIT•10 already models **discrete states**: a *view* is a specific axis configuration,
and the resolver produces a full property set for it. So the most natural animation
primitive in this system isn't "tween a raw number" — it's:

> **Interpolate between the resolved property sets of two views (or two axis-arg
> configurations).**

"Animate from Light/Default to Dark/Compact/Hover" = tween every differing resolved
property from state A to state B. This is precisely what **GSAP's Flip plugin** does
(record state → change → animate the delta), which makes it the natural export target
for state transitions. Two animation authorings, both exportable:

- **Timeline animations** — explicit tweens on a timeline → `gsap.timeline()` + `.to()`.
- **State transitions** — interpolate resolved state A → B → GSAP **Flip** (or a
  generated set of `.to()` tweens over the diffed properties).

This is animato's differentiator: it doesn't bolt a generic motion tool onto a design
system — it animates the *transitions between the states the design system already
defines*. The `.to()`/timeline model handles freeform motion; the state-diff model
handles the design-system-native case.

---

## 6. Proposed animato architecture

**Data model (PGlite, non-destructive — same as everything else in KIT•10).**
GSAP-isomorphic so export is serialization:

```ts
Timeline {
  id, name,
  defaults: TweenVars,          // GSAP timeline defaults
  labels: { [name]: number },
  children: (Tween | Timeline)[]  // nesting, like GSAP
}
Tween {
  targets: NodeSelector[],       // resolves to view/node ids
  vars: { [prop]: value | [keyframes] },  // animated props
  from?: TweenVars,              // present ⇒ fromTo/from semantics
  duration, ease: string,        // ease string = GSAP grammar, stored verbatim
  position: string | number,     // GSAP position parameter, stored verbatim
  stagger?: number | StaggerObj,
  repeat, yoyo, delay, overwrite
}
```

Storing `ease` and `position` as the **verbatim GSAP grammar** is deliberate: it's the
one representation that both our evaluator and the exporter consume, with zero lossy
round-trip (same discipline `sdf3d.md`/`text.md` apply to "one representation, derived
consumers").

**Evaluation engine (the runtime):**

1. One **ticker** (reuse Vellum's rAF scheduler); on play, enable `continuousMode`.
2. Each frame: advance the playhead by a **dt clamped by lag-smoothing**; for every
   active tween compute `eased = ease(localProgress)`, interpolate each prop A→B.
3. **Resolve overwrites** (`overwrite:"auto"` kills conflicting inflight tweens on the
   same target+prop).
4. Write results into the **animatable-transform layer** of the affected `UiNode`s
   (§4) — never through resolve.
5. `requestRender()` — one repaint.
6. On idle (all tweens done / paused), disable `continuousMode`.

**Easing library:** the exact GSAP closed forms (power/sine/expo/circ/back/elastic/
bounce/steps + config parse for `back(n)`/`elastic(a,p)`/`steps(n)`), plus a
`CustomEase` bezier evaluator. Unit-tested for numerical parity against GSAP output —
this is the fidelity gate for export.

**Motion-along-a-path:** reuse the **path/deformation infrastructure** from `text.md`
Stage C and `sdf3d.md` — a MotionPath tween animates a node's transform along a path by
arc-length, with `autoRotate` = the path tangent frame. Text-on-path, a shape moving on
a path, and MotionPath animation are **one path primitive**, three consumers. Exports to
`MotionPathPlugin`.

---

## 7. GSAP export mapping (the payoff)

Because the model is GSAP-isomorphic, export is a code-gen walk:

| animato | GSAP output |
|---|---|
| `Timeline{defaults, labels, children}` | `gsap.timeline({ defaults })` + `.addLabel()` + chained children |
| `Tween{targets, vars, duration, ease, position}` | `tl.to(targets, { ...vars, duration, ease }, position)` |
| `from` present | `.from(...)` / `.fromTo(...)` |
| `ease: "elastic.out(1,0.3)"` | verbatim — same string |
| `position: "<25%"` | verbatim — same string |
| `stagger` object | verbatim — same keys |
| `keyframes` | `{ keyframes: {...} }` |
| MotionPath tween | `{ motionPath: { path, align, alignOrigin, autoRotate } }` + register `MotionPathPlugin` |
| State transition (view A→B) | `Flip.from(state, {...})` **or** generated per-prop `.to()` tweens over the diff |

```js
// generated
gsap.registerPlugin(MotionPathPlugin);
const tl = gsap.timeline({ defaults: { duration: 1, ease: "power2.out" } });
tl.from(".card", { y: 40, opacity: 0 })
  .to(".dot", { motionPath: { path: "#curve", align: "#curve", autoRotate: true }, duration: 2 }, "<0.25")
  .to(".title", { scale: 1.1, ease: "back.out(1.7)" }, ">-0.3");
```

The exporter's only real work is mapping animato `NodeSelector`s to whatever selector
the exported target uses (CSS class / id / data-attr on the DOM or SVG the design
compiles to) — the *motion* is 1:1.

---

## 8. Caveats & honesty

- **GSAP animates the DOM/CSS/SVG; animato animates a GPU scene.** The preview runs on
  Vellum; the export runs on the user's DOM. So (a) not every GSAP property is meaningful
  in Vellum's scene (DOM-layout-specific ones), and (b) export fidelity depends on the
  design compiling to a DOM/SVG whose selectors and transforms match what we animated.
  Keep animato's animatable props to the ones that map cleanly both ways: transform
  (x/y/rotation/scale/skew), opacity, color, and path-driven motion.
- **Ease parity is a test surface, not an assumption.** Ship numerical parity tests
  against GSAP's reference values; a subtly-off `elastic` is a silent export bug.
- **Overwrite & relative values (`"+=100"`) carry semantics** — replicate them, don't
  approximate. They change *what the exported code does*, not just how it previews.
- **Timeline is the source of truth, not baked frames.** Never resolve animation to a
  keyframe dump — keep the tween/timeline structure (non-destructive), the same reason
  KIT•10 never bakes resolution. Baked frames can't export to readable GSAP.
- **Don't animate through resolve.** The single biggest performance trap (see §4). If a
  property can only be changed via a Charter re-resolve, it is *not* animatable at 60fps —
  either promote it to the animatable-transform layer or accept it's a slow, discrete change.

---

## 9. Phasing

- **Phase 0 — Animatable transform layer in Vellum.** Add per-node
  `translate/rotate/scale/opacity` applied post-layout (like `NodePosition` today), plus
  wire it into `continuousMode`. No authoring yet — just prove a node can move at 60fps
  without re-resolving.
- **Phase 1 — Ease library + single tween.** Exact GSAP eases (parity-tested) + a
  `gsap.to`-equivalent tween evaluated on the ticker into the Phase-0 layer.
- **Phase 2 — Timeline + position grammar + stagger + keyframes.** The full composition
  model, stored in PGlite. Playhead/scrubber UI mirroring GSAP's control API.
- **Phase 3 — GSAP exporter.** Code-gen walk of the model → GSAP source. Ships the moment
  the model is GSAP-isomorphic (which it is by construction).
- **Phase 4 — State transitions (Flip).** Interpolate resolved view A→B; export to
  `Flip`. The design-system-native payoff (§5).
- **Phase 5 — MotionPath**, reusing the `text.md`/`sdf3d.md` path infrastructure. Export
  to `MotionPathPlugin`.

The dependency spine: Phase 0's animatable-transform layer gates everything (nothing
animates at 60fps without it); the exporter (Phase 3) is nearly free because the model is
GSAP-shaped from day one; MotionPath (Phase 5) is shared with the path work already
planned elsewhere, so it's not net-new infrastructure.

---

## 10. The one decision that matters

**Author animato in GSAP's own vocabulary** — tween, timeline, verbatim ease/position
strings, stagger, keyframes — so export is serialization, not translation; and **solve
performance by splitting animatable transforms (cheap, per-frame, straight to Vellum)
from structural resolve (slow, data-change only)**, driving Vellum's existing
`continuousMode` from one lag-smoothed ticker. Do that and GSAP export is free, the
preview matches the export, and animation never fights the resolve pipeline.

---

*Sources: GSAP v3 docs — core/tweens/timelines, Eases, position parameter,
MotionPathPlugin, Flip. Current Vellum hooks referenced: `continuousMode` &
`requestRender()` in `Viewport.svelte`, the per-frame selection-overlay rebuild and
post-layout `NodePosition` translation in `taf_can_do/src/render/`.*
