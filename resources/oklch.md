# OKLCH — color science, gamut limits, and what it means for KIT•10

> **Status: research + adopted direction (unbuilt).** OKLCH is the intended
> **default color representation** for KIT•10 — colors are authored, stored,
> and reasoned about in OKLCH; **Oklab** (its cartesian form) is the intended
> internal/wire type; and **hex / `rgb()` / `hsl()` are demoted to legacy
> _input_ formats** we still accept and convert on ingest but no longer
> author in. None of this is built yet. This doc is the color science behind
> the decision, the monitor/gamut limits it inherits, and the target
> architecture across Charter/Vellum/the editor — read the last section
> first if you're short on time.

---

## What OKLCH is

**Oklab** (Björn Ottosson, Dec 2020) is a perceptual color space: Euclidean
distance in it approximates _perceived_ color difference. **OKLCH is the
cylindrical (polar) form of Oklab** — the same colors, re-parameterized into
three axes a human can reason about:

| Axis              | Meaning                               | Range                               | Notes                                                        |
| ----------------- | ------------------------------------- | ----------------------------------- | ------------------------------------------------------------ |
| **L** — Lightness | perceived lightness, black→white      | `0`–`1` (or `0%`–`100%`)            | _perceptual_: L 0.5 looks equally "mid" for every hue        |
| **C** — Chroma    | colorfulness / saturation, gray→vivid | `0`–~`0.4`, theoretically unbounded | for any sRGB **or** P3 color it stays **below ~0.37**        |
| **H** — Hue       | angle on the color wheel              | `0`–`360°`                          | red ≈20°, yellow ≈90°, green ≈140°, blue ≈220°, purple ≈320° |

CSS syntax: `oklch(L C H)` or `oklch(L C H / alpha)`, e.g.
`oklch(70.9% 0.195 47.025)`. Oklab's cartesian form `oklab(L a b)` carries
identical information (`a` = green↔red, `b` = blue↔yellow); OKLCH is preferred
for authoring because C and H match how people actually think about color.

### Why it beats HSL and RGB (the concrete failure modes)

- **HSL lies about lightness.** HSL pretends every hue reaches the same
  saturation `0–100%` and the same lightness `0–100%`, but eyes and displays
  don't work that way. Adding "10% lightness" shifts blue and purple by
  visibly different amounts; a hue rotation at "fixed" L/S silently changes
  perceived brightness — so recoloring (e.g. deriving an error-red from a
  brand accent) can make text drop below contrast thresholds without any L
  value changing. OKLCH's L is genuinely constant-perceived-brightness across
  hue, which is why it's the right basis for **accessible palette
  generation** and **theme derivation**.
- **RGB/hex encode channel amounts, not intent.** `#3b82f6` tells you nothing
  perceptual; you can't nudge it "10% lighter, same hue" by hand. OKLCH makes
  every one of L/C/H an independent, meaningful knob.

The catch OKLCH exposes rather than causes: **maximum chroma depends on both
hue and lightness.** There is no single "max saturation." At L≈44% only blue
reaches high chroma on an sRGB screen; yellows top out much lower. This isn't
an OKLCH quirk — it's a limit of real displays and human vision. OKLCH just
stops hiding it (HSL hid it by lying).

---

## The gamut problem (this is the whole reason "fallback" matters)

A **gamut** is the set of colors a space/display can actually produce. OKLCH
can _encode_ any color — sRGB, Display P3, Rec2020, even colors no display
can show — because it's defined over human vision, not a device. That's a
feature for authoring and a hazard for rendering: **you can write an OKLCH
color your monitor cannot display.**

| Gamut          | Coverage                                                       | Real-world reach                                                                               |
| -------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **sRGB**       | ~35% of visible colors                                         | the safe floor — every display, most cheap external monitors are sRGB-only                     |
| **Display P3** | ~25% wider than sRGB (adds notably more saturated reds/greens) | Apple devices since ~2015 (iMac) / ~2016 (iPhone 7), most flagship phones, many recent laptops |
| **Rec2020**    | much wider still                                               | **no consumer display covers it fully**; aspirational                                          |

So a high-chroma OKLCH color (say C > ~0.13 depending on hue/L) lands _outside
sRGB_ — fine on a P3 laptop, impossible on a budget sRGB monitor. What
happens then is **gamut mapping** or **clipping**, and being deliberate about
which is the "aware of fallbacks" the whole feature hinges on.

---

## oklch.com — the picker, and why it's effectively the only one

**oklch.com** (built by **Evil Martians**, open source) is the canonical
OKLCH picker/converter. Clones and lesser tools exist (oklch.net,
oklchpicker.com), but oklch.com is the one designed as a _teaching
instrument_ — its explicit north star was **education**, because perceptual
spaces are old but under-adopted precisely because they're unintuitive until
visualized. Relevant affordances:

- **Three paired graphs — one per L/C/H slider — that are literal 2D cuts of
  the 3D OKLCH solid.** Each slider track is a horizontal slice of its graph;
  clicking a point on a graph sets two parameters at once. Together the three
  graphs are the "unfolded net" of OKLCH's lumpy 3D shape ("mountains and
  hollows").
- **The graph shapes _are_ the gamut boundary.** The irregular outlines —
  half-circle cuts, unfillable regions — show exactly where colors stop
  existing. Point the picker at an empty area and you get no color: the tool
  makes "this color is impossible" a visible, discoverable fact instead of a
  surprise.
- **P3 / Rec2020 toggles** overlay the wider gamuts, and the tool **identifies
  the fallback color** when the chosen color can't be shown on the target
  device — i.e. it _shows you the sRGB it would degrade to._ This is the exact
  mental model KIT•10 needs: authored color vs. displayable color, made
  explicit.
- Their demos lean on the perceptual win — e.g. dynamic accent colors that
  stay legible because only **H** varies while **L** is pinned for contrast.

Takeaway for us: oklch.com is both the reference **UX for gamut awareness**
(show the boundary, show the fallback) and a converter we can hand designers
today with zero integration. Any picker we build should copy its "here's the
gamut edge, here's the fallback" honesty rather than hide it.

---

## Monitor limitations & why you can't fully trust detection

The hard truth for a canvas-based editor: **you cannot reliably read the
user's true display gamut from inside the app.**

- The **only** standardized signal is the CSS media query
  `@media (color-gamut: srgb | p3 | rec2020)`, reachable from JS via
  `window.matchMedia('(color-gamut: p3)')`. It reports a _capability tier_,
  not the active ICC profile, and it can be coarse or optimistic (a display
  that "supports p3" may be mis-profiled, in an sRGB mode, or the OS may not
  be color-managing).
- There is **no** Canvas / WebGL / WebGPU API that returns the monitor's
  actual gamut or ICC profile. A GPU context knows what color space _it_ is
  writing (see below), never what the physical panel can emit.
- **WebGPU output is sRGB by default.** `GPUCanvasContext.configure()` takes
  `colorSpace: "srgb" | "display-p3"`, and **the default is `"srgb"`**. A
  canvas that never sets `display-p3` will have its wide-gamut colors clamped
  to sRGB _before they ever reach the display_, regardless of how good the
  monitor is. (See the Vellum note below — this is us, today.)

Net: treat `matchMedia('(color-gamut: p3)')` as the one hint we have, assume
sRGB when unsure, and never assume a stored high-chroma color is actually
being shown as authored.

---

## Gamut mapping & fallback strategies

When a color is out of the destination gamut, two things can happen:

1. **Per-channel clipping** — convert to the target RGB and clamp each channel
   to `[0,1]`. Fast, but shifts hue and can crush or over-saturate (it's what
   Chrome and Safari currently _actually_ do for `oklch()`, despite the spec
   asking for #2). "Not recommended," except it's genuinely better than
   chroma-reduction for some hues (yellows especially — see below).

2. **CSS Color 4 gamut mapping (chroma reduction, "Binary Search with Local
   MINDE")** — hold **L and H fixed**, binary-search **C** downward until the
   color is displayable, preferring the least desaturation that stays within a
   just-noticeable difference of the clipped version. The spec algorithm:

   ```
   if L >= 100%: return white
   if L <= 0%:   return black
   if inGamut(destination): return as-is
   JND = 0.02                 # just-noticeable difference, measured in deltaEOK
   ε   = 0.0001
   min = 0;  max = current chroma
   loop while (max - min > ε):
       C = (min + max) / 2
       set current chroma = C
       clipped = per-channel clip(current) into destination
       E = deltaEOK(clipped, current)      # deltaE in Oklab
       if inGamut(current):        min = C          # still displayable, allow more chroma
       else if E < JND:            return clipped    # close enough — ship the clipped form
       else:                       max = C          # too far, reduce chroma more
   return clipped
   ```

   The key constants: **JND = 0.02** and the difference metric is **deltaEOK**
   (Euclidean distance in Oklab). "Local MINDE" = it returns the _clipped_
   color once clipping is imperceptibly close, which is why for saturation-
   heavy hues like yellow the CSS method keeps far more chroma (~C 103 in
   Color.js's example) than naive chroma-reduction (~C 25).

**CSS-authoring fallback patterns** (what web devs ship — our reference, not
our mechanism, since Vellum isn't a browser):

- **Cascade** — declare an sRGB value, then the OKLCH one; older engines keep
  the last they understood: `color: #f60; color: oklch(70.9% 0.195 47);`
- **`@supports (oklch(0 0 0))`** — feature-gate.
- **`@media (color-gamut: p3)`** — serve a P3-only value to capable displays,
  sRGB elsewhere.

---

## How this lands in KIT•10 — the OKLCH-by-default target (the payload)

**Decision: OKLCH is KIT•10's default color representation; hex / `rgb()` /
`hsl()` are demoted to legacy _input_ formats.** Colors are authored and
reasoned about in OKLCH, carried internally as **Oklab** (its cartesian form —
the right shape for interpolation), and converted to device RGB only at the
very last step: inside Vellum, into whatever output color space the canvas is
configured for. You can still paste a `#3b82f6`; it converts to Oklab on
ingest and is not the form anything is stored, interpolated, or animated in.
Nothing here is built yet. Below: where we are, the corrected Vellum boundary,
and the target infra.

### Where we are today (and the silent fallbacks to kill)

- **Charter `parse_color` (`plugins/charter/src/lib.rs`)** handles **only**
  `#rrggbb`, `#rrggbbaa`, and `rgb(r,g,b[,a])`. **Everything else →
  `[0,0,0,1]` (opaque black), no warning.** That already includes
  `rgba(...)`, `hsl(...)`, named colors like `transparent`, and — the moment
  anyone types it — `oklch(...)`. This is documented in CLAUDE.md's Common
  Pitfalls, and it's the first fallback we're blind to.
- **Editor `token-utils.ts` (`isColorScalar`)** treats a scalar as a color iff
  it starts with `#`, `rgb`, or `hsl`. The panel swatch is then rendered by
  the **browser** via a CSS `--color-icon` variable — so the DOM shows the
  real color for anything CSS understands.
- **The divergence this creates (verify-worthy, likely a latent bug even
  pre-OKLCH):** an `hsl(...)` value shows a **correct swatch in the panel**
  (browser CSS) but renders **black in the Vellum preview** (`parse_color`
  falls through). Panel and canvas disagree with zero signal. An `oklch(...)`
  value would be _worse_: `isColorScalar` doesn't even list `oklch`, so it
  wouldn't get a swatch **and** would render black. **The panel-vs-preview
  disagreement is the concrete "using a fallback without being aware" failure
  this whole doc is about** — and it multiplies under OKLCH-by-default, where
  out-of-gamut colors stop being exotic.
- **Vellum's render target is sRGB** (`add_srgb_suffix` on the surface view,
  `taf_can_do/src/render/mod.rs`) and the shaders do **no** sRGB↔linear
  conversion, while Charter feeds hex as raw `byte/255` (sRGB-encoded) floats.
  Whether that's already a subtle gamma mismatch needs a visual check — but it
  means **any** real color-space work (OKLCH included) has to first pin down
  what space Vellum's `[f32;4]` actually are, or errors compound.
- **Vellum's WebGPU canvas never sets `colorSpace`, so it's sRGB.** Even if we
  computed a perfect P3 color, it would be clamped to sRGB before display.
  Wide-gamut output is a **prerequisite** (`context.configure({ colorSpace:
"display-p3" })`), not a free consequence of computing better colors.

### The boundary: mechanical color math is Vellum's, color _policy_ is the host's

An earlier draft of this doc said "never teach Vellum color spaces." That was
wrong. Vellum **already** interpolates color — `shader.wgsl`'s
`composite_border` does `mix(over_rgb, fill.rgb, blend)`, the composite pass
does `mix(content.rgb, …)` — and the animation plan
([animations-transitions.md](./animations-transitions.md)) interpolates color
between resolved states, today in muddy RGB. Two forces put color squarely
inside the renderer regardless of preference:

- **Perceptual interpolation can only live in the renderer.** For GPU color
  animation/gradients, both endpoints must arrive as Oklab so the shader
  blends perceptually; pre-converting to RGB host-side throws that away and
  forces per-frame pre-bake, defeating GPU animation. Interpolate in **Oklab
  (cartesian a/b), not polar OKLCH** — hue-angle interpolation has a
  shortest-arc wraparound problem and swings through gray as chroma→0. This is
  the correct fix to blending Vellum already does wrong.
- **Wide-gamut output requires Vellum.** P3 reaches the screen only if Vellum
  sets `colorSpace: "display-p3"` on its canvas. And if Vellum owns the
  Oklab→RGB conversion, it can emit **linear-light** values that the sRGB view
  then encodes correctly — which _also_ fixes the latent double-gamma muddle
  noted above. That's an argument _for_ Vellum owning conversion, not against.

So the split is **mechanical vs. policy**, not "Vellum knows no color":

| Concern                                                        | Owner            | Why                                                                              |
| -------------------------------------------------------------- | ---------------- | -------------------------------------------------------------------------------- |
| Oklab↔linear-RGB conversion (fixed 3×3 matrices + a cube root) | **Vellum**       | cheap, per-pixel, needed for interpolation + output                              |
| Perceptual interpolation of color (animation / gradients)      | **Vellum**       | endpoints must be Oklab at blend time                                            |
| Output color space (sRGB vs `display-p3` canvas config)        | **Vellum**       | it owns the surface                                                              |
| Parse `oklch()` + legacy hex/rgb/hsl → Oklab                   | **Charter/host** | design-intent → structured data, its existing job                                |
| _Which_ gamut to target; smart out-of-gamut mapping            | **host**         | a shader can only per-channel clip; the CSS JND chroma-search is a host pre-pass |
| Surfacing "you're seeing a fallback" in the panel              | **editor**       | inherently a designer-facing affordance                                          |

### Target infra & the fallback-awareness rules

1. **Oklab is the wire/internal color type; RGBA becomes a legacy variant.**
   Every color field today is `[f32;4]` RGBA (`BoxData.bg_color`/
   `border_color`, `TextData.text_color`, …). The target is a small tagged
   color type carrying Oklab (+ alpha), with hex/rgb/hsl accepted only at parse
   time and converted in. This is the real cost of the change — it touches
   every color field through serde/msgpack — and it is the "infra by default"
   worth paying once.
2. **Parse everything, blacken nothing.** `parse_color` (Charter) and
   `isColorScalar` (editor) recognize `oklch()`/`oklab()` first-class and
   accept hex/rgb/hsl as legacy input; a genuinely unparseable value warns
   (`console.warn` + a panel marker), never silently returns black. Killing
   black-on-unparseable is step one independent of everything else.
3. **Make the fallback visible, oklch.com-style.** OKLCH-by-default makes
   out-of-gamut colors _common_, so this is load-bearing, not a nicety. When a
   stored color exceeds the destination gamut the panel shows it's a fallback
   and the mapped color that will actually render — the panel swatch (CSS
   `oklch()`, wide-gamut-capable) and the Vellum preview must never diverge
   without a marker. Once both speak OKLCH they finally _can_ agree.
4. **Gamut-map deliberately, target explicitly.** The host gamut-maps to the
   chosen destination via the spec chroma-reduction (JND 0.02, deltaEOK, hold
   L+H) and hands Vellum in-gamut Oklab. Destination is sRGB until Vellum's
   canvas opts into `display-p3`, gated on `matchMedia('(color-gamut: p3)')`
   and _still_ defaulting to the sRGB-mapped value — the monitor signal is a
   hint, not a guarantee (see Monitor limitations).

### Why OKLCH-by-default is worth the refactor

It is the right substrate for what KIT•10 already reaches toward: **perceptual
theme/axis derivation** (a `theme: dark` layer shifting L while holding H,
legible by construction), **accessible palette generation**, **token color
scales** that step evenly in perceived lightness, and **perceptually correct
color animation** (the transitions plan blends color — smooth in OKLCH, muddy
in RGB). The token model already stores color scalars as opaque strings, so an
`oklch(...)` token is a storage no-op; the **seed and defaults** (today all
hex, e.g. `#ffffff` in `manager/src/seed.ts`) are the migration surface —
reauthor them in OKLCH so "default" is true from the first paint. None of this
survives HSL's brightness lies or RGB's opacity to intent — which is exactly
why hex/rgb/hsl are being demoted to ingest-only.

---

## See also

- [charter.md](./charter.md) — the "opinionated translation layer" boundary,
  redrawn here as **mechanical color (Vellum) vs. color policy (host)**:
  parsing and gamut-mapping _policy_ are Charter/host's; the conversion,
  interpolation, and output-space mechanics are legitimately Vellum's.
- [animations-transitions.md](./animations-transitions.md) — color is an
  interpolated property there; OKLCH/Oklab is what makes that interpolation
  perceptual instead of muddy, and why interpolation forces color into the
  renderer.
- CLAUDE.md — `parse_color` limitations (hex/rgb only, else black),
  Vellum's sRGB surface-view + no-shader-linearization notes, and the current
  `[f32;4]` color wire that the Oklab tagged-type target would replace.

## Sources

- [OKLCH in CSS: why we moved from RGB and HSL — Evil Martians](https://evilmartians.com/chronicles/oklch-in-css-why-quit-rgb-hsl)
- [OK, OKLCH: a color picker made to help think perceptively — Evil Martians](https://evilmartians.com/chronicles/oklch-a-color-picker-made-to-help-think-perceptively)
- [OKLCH Color Picker & Converter (oklch.com) — Evil Martians](https://evilmartians.com/opensource/oklch-color-picker)
- [Exploring the OKLCH ecosystem and its tools — Evil Martians](https://evilmartians.com/chronicles/exploring-the-oklch-ecosystem-and-its-tools)
- [Gamut mapping — Color.js](https://colorjs.io/docs/gamut-mapping)
- [CSS Color Module Level 4 — §14 Gamut Mapping (W3C)](https://www.w3.org/TR/css-color-4/#gamut-mapping)
- [Falling For Oklch: Color Spaces, Gamuts, And CSS — Smashing Magazine](https://www.smashingmagazine.com/2023/08/oklch-color-spaces-gamuts-css/)
- [CSS color gamut: sRGB, Display P3, Rec2020, and OKLCH compared — Orankit](https://orankit.com/en/blog/css-color-gamut/)
- [GPUCanvasContext.configure() (colorSpace) — MDN](https://developer.mozilla.org/en-US/docs/Web/API/GPUCanvasContext/configure)
- [oklch() — CSS-Tricks Almanac](https://css-tricks.com/almanac/functions/o/oklch/)
