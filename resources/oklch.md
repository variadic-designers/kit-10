# OKLCH — color science and where KIT•10 stands

OKLCH is KIT•10's default color representation: colors are authored and
reasoned about in OKLCH, carried internally/on the wire as **Oklab** (its
cartesian form — the right shape for interpolation), and converted to device
RGB only at the final render step. Hex/`rgb()`/`hsl()` are accepted as legacy
*input* formats (parsed and converted on ingest) but are no longer the
authoring or storage form anywhere in the stack.

## Current state (shipped 2026-07-17)

- **Charter/Vellum wire type.** `OklabColor { l, a, b, alpha }` replaced the
  old `[f32;4]` sRGB RGBA everywhere (`BoxData`/`TextData`/`BoxShadow`,
  `RectInstance`/`GlyphVertex`/`HatchInstance`/`SceneUniforms`) — a JSON
  **object**, deliberately not the old array shape, so a stale build on either
  side of the Charter↔Vellum boundary fails to deserialize loudly instead of
  silently reinterpreting floats (there's no version marker in that wire
  format otherwise).
- **`parse_color`** (Charter) parses `oklch()`/`oklab()` first-class, accepts
  hex/`rgb()`/`rgba()`/`hsl()`/`hsla()`/`transparent` as legacy input, and
  returns a visible magenta marker (+ a host-log warning) for anything
  genuinely unparseable — never silent black.
- **Vellum's GPU pipeline** carries Oklab through unconverted and converts to
  linear sRGB only in WGSL, at the last moment before fragment output. This
  also fixed a real, pre-existing bug: Charter used to feed already
  gamma-encoded sRGB straight through into a render target that *itself*
  auto-encodes linear→sRGB on write — a double gamma application (see
  Nuances). The 3 places Vellum blends color (`composite_border`'s
  border/fill interface, the pixel-grid-overlay's grid blend) now interpolate
  in Oklab space instead of raw RGB.
- **The Render panel has a real OKLCH field** (`inputType: "color"` on every
  `background`/`border`/`color` `FieldDef`; `ColorField.svelte` — L/C/H/alpha
  sliders, a live swatch, a collapsible raw-text fallback for pasting legacy
  values). `src/lib/color/oklch.ts` is a third, small, manually-synced copy of
  the Oklab matrices (TypeScript, since there's no browser API to pull OKLCH
  components out of an arbitrary CSS color string).
- **`manager/src/seed.ts`** and **the app's own SCSS/CSS/SVG** (the raw color
  palette, the theme maps, scattered `var(..., #fallback)` literals, two
  script files, and the brand SVGs) are all migrated to native `oklch(...)`.

**Not built:** host-side gamut mapping, the panel's fallback-visibility
affordance (oklch.com-style "here's what will actually render"), interactive
2D graph pickers, and Display-P3 output.

## Upstream: what's blocking P3

Display-P3 output needs a **wgpu 29→30+ upgrade** — `taf_can_do/Cargo.toml`
still pins `wgpu = { version = "29.0" }` (`29.0.3` resolved in
`Cargo.lock`), and that version's `SurfaceConfiguration` has no `color_space`
field at all — there's no way to ask for anything but sRGB output on the
version currently pinned.

**wgpu 30.0.0 is already published** (confirmed against docs.rs, not
guessed) and does add what's needed: `SurfaceConfiguration::color_space:
SurfaceColorSpace`, an enum with `Srgb`, **`DisplayP3`** (wide-gamut SDR, P3
primaries + sRGB transfer function — exactly what this feature wants),
`Auto`, plus several HDR variants (`ExtendedSrgbLinear`/`ExtendedSrgb`/
`ExtendedDisplayP3`/`Bt2100Pq`/`Bt2100Hlg`) unrelated to this use case. So the
upgrade is available now, not hypothetically blocked on an upstream feature
that doesn't exist yet — the remaining work is just doing the bump: `Cargo.toml`
version pin, resolving whatever breaking API changes 29→30 brings elsewhere
in `taf_can_do` (not yet audited), then actually setting `color_space:
SurfaceColorSpace::DisplayP3` on the surface config plus the
`matchMedia('(color-gamut: p3)')`-gated decision of when to request it. Still
deliberately not bundled with the color work above — it's its own dependency
bump with its own risk surface. Vellum's pipeline already isolates "convert
to output format" to one final WGSL step, so wiring P3 in later is additive,
not another refactor.

## Nuances

**Why the double-gamma bug specifically desaturated colors, not just
darkened them.** The sRGB transfer function is applied per-channel and is
concave — it pushes mid-range values up toward white, with 0 and 1 as fixed
points. Applying it twice compounds that push for every value in between. A
saturated color is defined by its channels being *spread apart* (high R, low
G/B for a red); shoving all three toward white with the same curve
compresses that spread — which is literally what "less saturated" means.
Pure primaries at the exact extremes barely moved (0 and 1 don't shift), but
most real UI colors sit in between, so they were quietly desaturated and
lightened for as long as the bug existed. Undoing it doesn't add saturation
from nowhere — it un-compresses the channel spread back to the color that
was actually specified.

**This bug was device-independent — P3 is not the same phenomenon.** The
double-gamma bug baked wrong RGB values into the framebuffer in software,
before any display saw them; it would reproduce identically on any device
running the same code, mobile or desktop, regardless of screen gamut. The
well-known "Figma looks more vibrant on mobile" effect is a *different*,
device-*dependent* phenomenon layered on top of whatever's actually in the
framebuffer: phone OLED panels are often genuinely wider-gamut (P3) with
punchier contrast than a typical desktop sRGB LCD, many phones ship a
"vivid" display mode that deliberately oversaturates past color accuracy,
and real-world color management for canvas/GPU content isn't always
perfectly implemented across browser/OS combinations. WebGPU canvases
default to `colorSpace: "srgb"` (Vellum doesn't opt into anything else, and
per the section above, currently can't) — a spec-compliant, well
color-managed pipeline should render identical *content* the same on both,
mapping the sRGB numbers correctly onto whichever panel is showing them. So
fixing the software bug closes the one gap this codebase controls; any
residual mobile-vs-desktop difference is real device/OS behavior outside of
it, and is exactly what the deferred P3-awareness work (gated on the wgpu
upgrade above) would need to handle deliberately rather than by accident.

**Interpolate in Oklab (cartesian a/b), not polar OKLCH.** Hue-angle
interpolation has a shortest-arc wraparound problem and swings through gray
as chroma→0. Relevant whenever color animation/interpolation gets built
(`animations-transitions.md`).

**Gamut mapping, when it gets built, is host-owned — not Vellum's.** A GPU
shader can only per-channel clip (fast, but shifts hue / crushes or
over-saturates — what Chrome/Safari actually do for `oklch()` today, despite
the CSS spec wanting better). The correct algorithm (CSS Color 4 "Binary
Search with Local MINDE") holds **L and H fixed**, binary-searches **chroma**
downward until the color is displayable, and accepts the per-channel-clipped
result once it's within a just-noticeable difference (`JND = 0.02`,
measured as `deltaEOK` — Euclidean distance in Oklab):

```
if L >= 100%: return white
if L <= 0%:   return black
if inGamut(destination): return as-is
JND = 0.02; ε = 0.0001
min = 0;  max = current chroma
loop while (max - min > ε):
    C = (min + max) / 2
    clipped = per-channel clip(color at chroma C) into destination
    E = deltaEOK(clipped, color at chroma C)
    if inGamut(color at chroma C):  min = C
    else if E < JND:                return clipped
    else:                           max = C
return clipped
```

This is why for saturation-heavy hues like yellow, the CSS method keeps far
more chroma than naive chroma-reduction — it's "local MINDE" (minimum
detectable error), not a blind clamp. Reference implementation to check
against: [Color.js's gamut mapping](https://colorjs.io/docs/gamut-mapping).

**You cannot reliably read the display's actual gamut from inside the app.**
The only standardized signal is `matchMedia('(color-gamut: p3)')`, which
reports a capability tier, not the active ICC profile or whether the OS is
actually color-managing — treat it as a hint, default to sRGB when unsure.

## Ownership (mechanical vs. policy)

| Concern | Owner | Why |
| --- | --- | --- |
| Oklab↔linear-RGB conversion | **Vellum** | cheap, per-pixel, needed for interpolation + output |
| Perceptual interpolation (animation/gradients) | **Vellum** | endpoints must be Oklab at blend time |
| Output color space (sRGB vs `display-p3`) | **Vellum** | it owns the surface |
| Parse `oklch()` + legacy hex/rgb/hsl → Oklab | **Charter/host** | design-intent → structured data |
| Which gamut to target; smart out-of-gamut mapping | **host** | a shader can only per-channel clip |
| Surfacing "you're seeing a fallback" in the panel | **editor** | designer-facing affordance |

## Reference

**Axes** — `oklch(L C H)` or `oklch(L C H / alpha)`, e.g.
`oklch(70.9% 0.195 47.025)`. `oklab(L a b)` is the cartesian form (`a` =
green↔red, `b` = blue↔yellow), identical information, OKLCH preferred for
authoring since C/H map to how people think about color.

| Axis | Meaning | Range |
| --- | --- | --- |
| **L** Lightness | perceived lightness, black→white | `0`–`1` / `0%`–`100%` |
| **C** Chroma | colorfulness, gray→vivid | `0`–~`0.4` (sRGB/P3 both stay below ~0.37) |
| **H** Hue | angle on the color wheel | `0`–`360°` |

Unlike HSL, L is genuinely constant-perceived-brightness across hue (HSL's
"100% lightness" means different things per hue, which is why recoloring in
HSL can silently break contrast). The tradeoff OKLCH exposes rather than
causes: max chroma depends on both hue and lightness — there's no single
"max saturation," that's a limit of real displays and vision, not an OKLCH
quirk.

| Gamut | Coverage | Reach |
| --- | --- | --- |
| sRGB | ~35% of visible colors | universal — the safe floor |
| Display P3 | ~25% wider (more saturated reds/greens) | Apple since ~2015-16, most flagship phones/recent laptops |
| Rec2020 | much wider | no consumer display covers it fully |

**oklch.com** (Evil Martians) is the reference picker — its three paired
graphs are literal 2D slices of the OKLCH solid, the graph *shape* is the
gamut boundary made visible, and it shows the fallback color a chosen value
degrades to on a narrower target. Copy its "here's the edge, here's the
fallback" honesty rather than hiding it, whenever the panel fallback UI (not
built) gets designed.

## See also

- [charter.md](./charter.md) — the "opinionated translation layer" boundary.
- [animations-transitions.md](./animations-transitions.md) — color as an
  interpolated property; why interpolation forces color into the renderer.
- [OKLCH in CSS — Evil Martians](https://evilmartians.com/chronicles/oklch-in-css-why-quit-rgb-hsl)
- [OK, OKLCH: a color picker made to help think perceptively — Evil Martians](https://evilmartians.com/chronicles/oklch-a-color-picker-made-to-help-think-perceptively)
- [Gamut mapping — Color.js](https://colorjs.io/docs/gamut-mapping)
- [CSS Color Module Level 4 — §14 Gamut Mapping (W3C)](https://www.w3.org/TR/css-color-4/#gamut-mapping)
- [GPUCanvasContext.configure() (colorSpace) — MDN](https://developer.mozilla.org/en-US/docs/Web/API/GPUCanvasContext/configure)
