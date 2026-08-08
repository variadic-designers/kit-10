# Anima - animation & transitions, with GSAP as the export target

Research on GSAP (the de-facto standard for web motion) and a plan for **anima**,
KIT•10's animation system. The hard requirement: **anima must export to GSAP code
losslessly.** That single constraint decides the architecture - because the cheapest
way to export perfectly to a system is to *author in that system's own model*. So the
thesis of this doc is:

> **Adopt GSAP's data model (tween / timeline / ease / position / stagger) as anima's
> native representation, and make GSAP export a serialization rather than a translation.**
> Then solve the *performance* separately, against Vellum's GPU renderer.

Companion to [`sdf3d.md`](./sdf3d.md) and [`text.md`](./text.md) - the path/deformation
infrastructure those propose is the *same* machinery anima needs for motion-along-a-path.

---

## 1. What GSAP actually is (distilled)

GSAP is a **property interpolation engine** driven by one global ticker. It is not a
CSS-transition wrapper - it computes values in JS every frame and sets them directly.
Three layers:

### 1.1 The Tween - the atom

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

### 1.2 The Timeline - the composition

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

### 1.3 The position parameter - the sequencing grammar (quote-exact)

The second arg to `.to()/.from()/.fromTo()` on a timeline. Every form:

| Form | Meaning |
|------|---------|
| `3` | absolute - 3s from timeline start |
| `"someLabel"` | at a label (created at end if missing) |
| `"+=1"` / `"-=1"` | 1s gap after / 1s overlap before timeline end |
| `"<"` / `">"` | start / end of the **previous** animation |
| `"<1"` = `"<+=1"` | 1s after previous start; `">-0.5"` = 0.5s before previous end |
| `"myLabel+=2"` | relative to a label |
| `"+=50%"` / `"-=25%"` | gap/overlap as % of the **inserting** tween's duration (3.7+) |
| `"<25%"` | 25% into the previous animation |

### 1.4 Stagger - one tween, many targets, offset in time

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

### 1.5 Keyframes - multi-stage within one tween

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
.timeScale(x) .kill() .invalidate()`. This is the runtime surface anima's preview
scrubber and playhead need to mirror.

---

## 2. Easing - the fidelity-critical part

Eases are the *shape* of interpolation `progress = ease(t)`, `t∈[0,1]`. **anima's eases
must be numerically identical to GSAP's**, or a preview won't match the exported code.
GSAP's eases are Penner-derived closed forms - cheap to reimplement exactly.

**Built-in** (each with `.in` / `.out` / `.inOut` unless noted):

- `none` (= `linear`) - constant velocity.
- `power0..power4` - polynomial of degree 1..5 (`power1` = quad, `power2` = cubic, …).
  **GSAP default ease is `power1.out`.** (Note: `power0` = linear.)
- `sine`, `circ`, `expo` - trig / circular / exponential curves.
- `back` - overshoots then settles. Configurable: `back.out(1.7)` (overshoot amount).
- `elastic` - spring oscillation. `elastic.out(amplitude, period)` e.g. `elastic.out(1, 0.3)`.
- `bounce` - decaying bounces.
- `steps(n)` - discrete quantized steps.

**Plugin eases** (EasePack): `slow(SlowMo)`, `rough(RoughEase)`, `expoScale(ExpoScaleEase)`.
**Premium**: `CustomEase` (arbitrary bezier curve - an SVG-path-like `d` string),
`CustomBounce`, `CustomWiggle`.

Ease strings are passed verbatim (`ease: "elastic.out(1, 0.3)"`), so anima's ease
model should store the **same string grammar** - name + optional config args - and both
(a) evaluate it and (b) emit it verbatim on export.

> `CustomEase` matters: it's a bezier curve editor. anima's ease-curve editor should
> produce a `CustomEase` `d` string so a hand-drawn curve round-trips to GSAP exactly.

---

## 3. Why GSAP is performant (and which of it transfers)

| GSAP technique | What it does | Transfers to Vellum? |
|---|---|---|
| **Single rAF ticker** (`gsap.ticker`) | one loop updates *all* animations; no per-tween timers | **Yes** - one ticker drives Vellum, not N |
| **Lag smoothing** (`gsap.ticker.lagSmoothing(500, 33)`) | on a frame spike, clamps dt so motion doesn't "jump" | **Yes** - same dt-clamp on the ticker |
| **Direct value setting** | sets props in JS each frame; never CSS transitions | **Yes** - anima writes node transforms per frame |
| **`force3D` / GPU layer** | promotes transforms to `translate3d` for GPU compositing | **Different** - Vellum *is* the GPU; transforms are uniforms |
| **Lazy rendering** | batches first-frame reads to avoid layout thrash | Partial - Vellum has no DOM layout to thrash |
| **Overwrite management** | resolves two tweens hitting the same prop (`overwrite: "auto"`) | **Yes** - needed in anima's evaluator |

The load-bearing lessons: **one ticker**, **clamp dt**, **set values directly**, and
**resolve overwrites**. GSAP's DOM-specific optimizations (force3D, lazy layout reads)
are moot because Vellum owns the GPU - which is actually an *advantage* (§4).

---

## 4. How KIT•10/Vellum changes the problem

Two facts about this stack reshape the performance design:

1. **Vellum renders on-demand, not in a perpetual rAF loop.** `Viewport.svelte` only
   paints in response to a change (`requestRender()` coalesces into one rAF). There is
   already a `continuousMode` flag (currently always `false`) whose entire purpose is
   "reschedule every frame" for animation. **anima playing = flip `continuousMode` on;
   idle = off.** The ticker and the render scheduler are the same mechanism.
2. **The property source is the resolve pipeline, not the DOM.** Values flow
   DB → resolve → Charter → Vellum `UiNode[]`. A naive "animate = re-resolve every frame"
   would be catastrophic (resolve + serialize + WASM plugin call per frame). So animation
   must **bypass the resolve for the hot properties** and write them straight into Vellum
   as cheap per-node state - exactly the pattern Vellum already uses for the **selection
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
today) - so animating it never touches taffy.

---

## 5. The KIT•10-native insight: animation is interpolation between *resolved states*

KIT•10 already models **discrete states**: a *view* is a specific axis configuration,
and the resolver produces a full property set for it. So the most natural animation
primitive in this system isn't "tween a raw number" - it's:

> **Interpolate between the resolved property sets of two views (or two axis-arg
> configurations).**

"Animate from Light/Default to Dark/Compact/Hover" = tween every differing resolved
property from state A to state B. This is precisely what **GSAP's Flip plugin** does
(record state → change → animate the delta), which makes it the natural export target
for state transitions. Two animation authorings, both exportable:

- **Timeline animations** - explicit tweens on a timeline → `gsap.timeline()` + `.to()`.
- **State transitions** - interpolate resolved state A → B → GSAP **Flip** (or a
  generated set of `.to()` tweens over the diffed properties).

This is anima's differentiator: it doesn't bolt a generic motion tool onto a design
system - it animates the *transitions between the states the design system already
defines*. The `.to()`/timeline model handles freeform motion; the state-diff model
handles the design-system-native case.

---

## 6. Proposed anima architecture

**Data model (PGlite, non-destructive - same as everything else in KIT•10).**
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
   (§4) - never through resolve.
5. `requestRender()` - one repaint.
6. On idle (all tweens done / paused), disable `continuousMode`.

**Easing library:** the exact GSAP closed forms (power/sine/expo/circ/back/elastic/
bounce/steps + config parse for `back(n)`/`elastic(a,p)`/`steps(n)`), plus a
`CustomEase` bezier evaluator. Unit-tested for numerical parity against GSAP output -
this is the fidelity gate for export.

**Motion-along-a-path:** reuse the **path/deformation infrastructure** from `text.md`
Stage C and `sdf3d.md` - a MotionPath tween animates a node's transform along a path by
arc-length, with `autoRotate` = the path tangent frame. Text-on-path, a shape moving on
a path, and MotionPath animation are **one path primitive**, three consumers. Exports to
`MotionPathPlugin`.

---

## 7. GSAP export mapping (the payoff)

Because the model is GSAP-isomorphic, export is a code-gen walk:

| anima | GSAP output |
|---|---|
| `Timeline{defaults, labels, children}` | `gsap.timeline({ defaults })` + `.addLabel()` + chained children |
| `Tween{targets, vars, duration, ease, position}` | `tl.to(targets, { ...vars, duration, ease }, position)` |
| `from` present | `.from(...)` / `.fromTo(...)` |
| `ease: "elastic.out(1,0.3)"` | verbatim - same string |
| `position: "<25%"` | verbatim - same string |
| `stagger` object | verbatim - same keys |
| `keyframes` | `{ keyframes: {...} }` |
| MotionPath tween | `{ motionPath: { path, align, alignOrigin, autoRotate } }` + register `MotionPathPlugin` |
| State transition (view A→B) | `Flip.from(state, {...})` **or** generated per-prop `.to()` tweens over the diff |
| SplitText target | `SplitText.create(el, { type })` + a staggered `.to()` over the returned chars/words/lines |
| Content tween (text / scramble) | `{ text: "..." }` / `{ scrambleText: {...} }` verbatim |
| DrawSVG / MorphSVG | `{ drawSVG: "0% 100%" }` / `{ morphSVG: {...} }` (path-gated, §8.4) |
| Scroll-bound timeline | `scrollTrigger: { trigger, start, end, scrub, pin, toggleActions }` verbatim |
| CustomWiggle / CustomBounce ease | `CustomWiggle.create(...)` / `CustomBounce.create(...)` + register (else the raw CustomEase `d`) |

```js
// generated
gsap.registerPlugin(MotionPathPlugin);
const tl = gsap.timeline({ defaults: { duration: 1, ease: "power2.out" } });
tl.from(".card", { y: 40, opacity: 0 })
  .to(".dot", { motionPath: { path: "#curve", align: "#curve", autoRotate: true }, duration: 2 }, "<0.25")
  .to(".title", { scale: 1.1, ease: "back.out(1.7)" }, ">-0.3");
```

The exporter's only real work is mapping anima `NodeSelector`s to whatever selector
the exported target uses (CSS class / id / data-attr on the DOM or SVG the design
compiles to) - the *motion* is 1:1.

---

## 8. The plugin ecosystem - what a GPU design editor can actually use

GSAP's reach comes from its plugins, but anima lives on the far side of a split GSAP never has to cross: the **preview** is a GPU scene (Vellum), the **export** is DOM/SVG/GSAP. So the useful question isn't "which plugins do we support" - it's "which side of that split does each one live on," because that decides whether it's a cheap native fit, expensive new infrastructure, or export-only with no real preview. Every plugin below sorts into one of six buckets.

### 8.1 The buckets

| Bucket | Meaning | Plugins |
|---|---|---|
| **A. Native fit** | previews natively in Vellum AND exports cleanly | SplitText, Flip, CustomEase family, EasePack |
| **B. Content tween** | animates a node's *content* (its text string) - a new evaluator category that bypasses resolve like §4's transform layer | TextPlugin (Text Replacement), ScrambleText |
| **C. Path-gated** | needs the vector-path infrastructure from `sdf3d.md`/`text.md`; then three plugins share one arc-length/morph primitive | MotionPath, DrawSVG, MorphSVG |
| **D. Export-only** | no meaningful canvas preview; authored as a binding/attribute, previewed through a proxy control | ScrollTrigger, ScrollTo, ScrollSmoother |
| **E. Interaction layer** | end-user interactivity / physics, orthogonal to the tween/timeline core - a separate feature, not anima motion | Draggable, Inertia, Observer, Physics2D, PhysicsProps |
| **F. Our own UI, never exported** | a GSAP authoring/debug *tool* whose analog is an anima editor affordance | GSDevTools, MotionPathHelper |
| **(out)** | third-party-runtime integrations with no KIT•10 export target | EaselPlugin, PixiPlugin |

The rest of this section is the per-bucket detail: what each plugin does and the exact reason it lands where it does.

### 8.2 A - native fit (build these first)

- **SplitText** (popular). Splits a text element into per-char / per-word / per-line pieces so each can animate and stagger. This is anima's **best-fit plugin**: Vellum already shapes text into positioned glyphs (cosmic-text), so a split is "promote each glyph/word/line to its own animatable-transform sub-target" (§4) - the geometry already exists, no re-layout. Preview is fully native; export is `SplitText.create(el, { type: "chars,words,lines" })` + a staggered tween over the returned array, which the stagger grammar (§1.4) already addresses. Model a Text node's split as `{ type, mask?, ... }` producing N sub-targets. (Modern SplitText is now free in GSAP and handles masking, smart-wrap, and aria restore - track those as export options, not preview concerns.)
- **Flip** (popular). Already core to anima as the **state-transition** export target (§5, §7, Phase 4): record resolved state A, change to B, animate the diff. No new infra.
- **CustomEase family + EasePack** (§2). CustomEase (popular), CustomWiggle (needs CustomEase), CustomBounce (needs CustomEase), and EasePack's `rough` / `slow` / `expoScale`. The load-bearing insight: **every one of these reduces to a CustomEase `d` string.** CustomWiggle and CustomBounce literally *generate* a CustomEase (CustomBounce can emit two - a bounce ease plus a matching squash/stretch ease). So a single CustomEase bezier evaluator previews the entire family, and export picks the *readable* form: emit the generator call (`CustomWiggle.create(...)`, `CustomBounce.create(...)`) and register the plugin, falling back to the raw `d` string only for a hand-drawn curve. The whole premium-ease set is therefore nearly free once the Phase-1 CustomEase evaluator exists.

### 8.3 B - content tweens (a new evaluator category)

`TextPlugin` (**Text Replacement**, `text: "..."`) and **ScrambleText** (`scrambleText: {...}`, the "decoding/hacker" reveal) both animate the **string a Text node displays**, not its transform. That's a category §4 doesn't cover: it mutates content, which normally rides the slow resolve path. But it changes only the string, never layout topology, and Vellum owns text shaping - so anima special-cases a **per-frame text-content override** written straight into the Text node (the same "bypass resolve, write cheap per-node state, repaint" move §4 makes for transforms, applied to the glyph buffer instead). One small runtime addition - a "current display string" override, re-shaped per frame, cleared when the tween ends - covers both plugins. Export → `text:` / `scrambleText:` verbatim. Self-contained, no path infra.

### 8.4 C - path-gated (one primitive, three plugins)

All three depend on KIT•10 gaining a **stroked vector-path primitive**, which it does not have today (Vellum is SDF rects/squircles/text/img). That primitive, plus an **arc-length parameterization** and a **shape-morph interpolator**, is exactly the path/deformation work `sdf3d.md` and `text.md` already propose - so these aren't net-new, they're consumers of that infrastructure:

- **MotionPath** - already planned (§6, §7, Phase 5): move a node's transform along a path by arc-length, `autoRotate` = tangent frame. Arc-length is the shared piece.
- **DrawSVG** (popular) - animate the *visible fraction* of a stroked path ("draw it on"). Same arc-length parameterization as MotionPath, just driving stroke start/end instead of a transform. Export → `drawSVG: "0% 100%"`.
- **MorphSVG** - interpolate one path's `d` into another's (point-count-matched). Adds a morph interpolator on top of the path primitive. Highest value for logo/icon motion, deepest infra. Export → `morphSVG: {...}`.
- **MotionPathHelper** is **not** here - it's an on-canvas path *editor*, i.e. bucket F: its analog is anima's own path-editing UI (sibling to the CustomEase curve editor), with nothing to export.

### 8.5 D - export-only (scroll: dominant on the web, absent on the canvas)

Vellum is a pan/zoom canvas, not a scrolling document, so none of these have a literal preview - yet scroll-driven motion is the **single most common web-animation pattern**, so ScrollTrigger still ranks high. The move is to **author scroll as a binding on a timeline and preview it through a proxy scrubber**:

- **ScrollTrigger** (popular). Links a timeline's progress (`scrub`) or its play/reverse (`toggleActions`) to a scroll range. Author it as a per-timeline `scrollTrigger: { trigger, start, end, scrub, pin, toggleActions, snap }` block; preview by mapping a **virtual scroll slider** to timeline progress (reusing the Phase-2 playhead/scrubber, just fed by a fake scroll position instead of a play clock). Export → `scrollTrigger:` verbatim. The highest-value non-core plugin for a web-motion export tool.
- **ScrollTo** (`scrollTo: y | element`). A tween whose target is the *scroller*. Meaningless on the canvas (nothing scrolls); model as a special "page scroll" target that only manifests on export. Requires ScrollToPlugin. Low priority.
- **ScrollSmoother** (needs ScrollTrigger). Smooth-scroll + parallax via per-element `data-speed` / `data-lag`. The design-meaningful part is **parallax speed per node**, which anima can model as a per-node export attribute (and fake in preview by offsetting layers against the virtual scroll). The smooth-scroll wrapper itself is a pure DOM-runtime behavior with nothing to preview. Lower priority.

### 8.6 E - the interaction layer (a separate feature from motion)

- **Draggable** + **Inertia** (formerly ThrowProps) - make an exported element user-draggable, with momentum/flick physics and snap on release. **Observer** - a normalized wheel/touch/pointer/scroll event abstraction with velocity/delta (no animation of its own; it's input plumbing). **Physics2D** / **PhysicsProps** - ballistic motion from velocity/acceleration/gravity/friction instead of duration+ease.

  These are real GSAP and exportable (`Draggable.create`, `inertia:`, `physics2D:`), but they're **end-user interactivity and physics, not timeline motion** - a different authoring axis from anima's tween/timeline core. Two honest notes: (1) KIT•10 already has editor-side drag and a normalized wheel/pointer pipeline in `Viewport.svelte`, but that's *authoring* infrastructure, unrelated to *exporting* an interaction onto the final design. (2) Physics2D/PhysicsProps are self-contained - the ticker can integrate them per frame with no path infra - so they're the cheapest of this bucket to preview if an interactions feature is ever scoped. Recommendation: defer the whole bucket to a post-anima **"interactions"** feature; don't let it dilute the tween/timeline core.

### 8.7 F - GSAP tools that are actually *our* UI

- **GSDevTools** - GSAP's overlay scrubber / play-controls / timeline-visualizer for *debugging* animations. anima's own playhead + scrubber (§1.6, Phase 2) **is** this. Nothing to export; building anima's scrubber well is building our GSDevTools.
- **MotionPathHelper** - the on-canvas path-point editor (see §8.4). Analog = anima's path-editing UI. Not exported.

### 8.8 Out of scope

- **EaselPlugin** - integration for the legacy EaselJS/CreateJS canvas library. No KIT•10 export target; skip.
- **PixiPlugin** - integration for PixiJS (animate Pixi display objects' transform/tint/filters). Only relevant if anima ever gains a **PixiJS export target** instead of DOM/SVG. One note worth keeping: Pixi is itself a GPU scene graph, so PixiPlugin is the closest existing analog to *what anima's own runtime does internally* (drive a GPU scene from GSAP-shaped tweens) - but as a design **export** it's niche. Out of scope unless a Pixi target is deliberately added.

### 8.9 Priority read

Collapsed to a build order: **SplitText** and the **CustomEase family** first (bucket A - native, cheap, high-visibility), then **content tweens** (bucket B - one small runtime addition), then **ScrollTrigger** (bucket D - the dominant web pattern, previewed via the scrub proxy), then the **path plugins** (bucket C) whenever the `sdf3d.md`/`text.md` vector-path work lands. The **interaction layer** (E) is a separate future feature; **GSDevTools / MotionPathHelper** (F) are just names for anima UI we're already building; **Easel / Pixi** are out.

---

## 9. Caveats & honesty

- **GSAP animates the DOM/CSS/SVG; anima animates a GPU scene.** The preview runs on
  Vellum; the export runs on the user's DOM. So (a) not every GSAP property is meaningful
  in Vellum's scene (DOM-layout-specific ones), and (b) export fidelity depends on the
  design compiling to a DOM/SVG whose selectors and transforms match what we animated.
  Keep anima's animatable props to the ones that map cleanly both ways: transform
  (x/y/rotation/scale/skew), opacity, color, and path-driven motion.
- **Ease parity is a test surface, not an assumption.** Ship numerical parity tests
  against GSAP's reference values; a subtly-off `elastic` is a silent export bug.
- **Overwrite & relative values (`"+=100"`) carry semantics** - replicate them, don't
  approximate. They change *what the exported code does*, not just how it previews.
- **Timeline is the source of truth, not baked frames.** Never resolve animation to a
  keyframe dump - keep the tween/timeline structure (non-destructive), the same reason
  KIT•10 never bakes resolution. Baked frames can't export to readable GSAP.
- **Don't animate through resolve.** The single biggest performance trap (see §4). If a
  property can only be changed via a Charter re-resolve, it is *not* animatable at 60fps -
  either promote it to the animatable-transform layer or accept it's a slow, discrete change.

---

## 10. Phasing

- **Phase 0 - Animatable transform layer in Vellum.** Add per-node
  `translate/rotate/scale/opacity` applied post-layout (like `NodePosition` today), plus
  wire it into `continuousMode`. No authoring yet - just prove a node can move at 60fps
  without re-resolving.
- **Phase 1 - Ease library + single tween.** Exact GSAP eases (parity-tested) + a
  `gsap.to`-equivalent tween evaluated on the ticker into the Phase-0 layer.
- **Phase 2 - Timeline + position grammar + stagger + keyframes.** The full composition
  model, stored in PGlite. Playhead/scrubber UI mirroring GSAP's control API.
- **Phase 3 - GSAP exporter.** Code-gen walk of the model → GSAP source. Ships the moment
  the model is GSAP-isomorphic (which it is by construction).
- **Phase 4 - State transitions (Flip).** Interpolate resolved view A→B; export to
  `Flip`. The design-system-native payoff (§5).
- **Phase 5 - MotionPath**, reusing the `text.md`/`sdf3d.md` path infrastructure. Export
  to `MotionPathPlugin`.
- **Phase 6 - SplitText.** Per-glyph/word/line animatable sub-targets off Vellum's
  existing shaped glyphs, staggered via the Phase-2 grammar. Bucket A (§8.2).
- **Phase 7 - Content tweens.** Per-frame text-content override (text replacement /
  scramble) bypassing resolve. Bucket B (§8.3).
- **Phase 8 - ScrollTrigger.** Scroll-binding authoring + virtual-scroll scrub preview +
  export; the dominant web pattern. Bucket D (§8.5).
- **Phase 9 - Path plugins (DrawSVG, MorphSVG).** Once the `sdf3d.md`/`text.md`
  vector-path infra lands; shares arc-length with MotionPath (Phase 5). Bucket C (§8.4).

The dependency spine: Phase 0's animatable-transform layer gates everything (nothing
animates at 60fps without it); the exporter (Phase 3) is nearly free because the model is
GSAP-shaped from day one; MotionPath (Phase 5) is shared with the path work already
planned elsewhere, so it's not net-new infrastructure. The plugin phases (6-9) are mostly
independent and slot in by value: SplitText and the CustomEase family (folded into Phase
1) are cheap native wins; the path plugins (Phase 9) wait on the same vector-path work as
MotionPath; the interaction layer (Draggable/Inertia/Observer/Physics, §8.6) is a
deliberately separate later feature, not part of anima's motion core.

---

## 11. The one decision that matters

**Author anima in GSAP's own vocabulary** - tween, timeline, verbatim ease/position
strings, stagger, keyframes - so export is serialization, not translation; and **solve
performance by splitting animatable transforms (cheap, per-frame, straight to Vellum)
from structural resolve (slow, data-change only)**, driving Vellum's existing
`continuousMode` from one lag-smoothed ticker. Do that and GSAP export is free, the
preview matches the export, and animation never fights the resolve pipeline.

---

*Sources: GSAP v3 docs - core/tweens/timelines, Eases, position parameter, and the
plugin catalogue (ScrollTrigger/ScrollTo/ScrollSmoother, SplitText/ScrambleText/TextPlugin,
DrawSVG/MorphSVG/MotionPath/MotionPathHelper, Flip/Draggable/Inertia/Observer,
Physics2D/PhysicsProps/GSDevTools/EaselPlugin/PixiPlugin, CustomEase/EasePack/CustomWiggle/
CustomBounce). Current Vellum hooks referenced: `continuousMode` &
`requestRender()` in `Viewport.svelte`, the per-frame selection-overlay rebuild and
post-layout `NodePosition` translation in `taf_can_do/src/render/`.*
