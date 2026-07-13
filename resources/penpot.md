# Penpot Flex/Grid Layout — accessibility & affordance critique

Grounding: Penpot exposes two layout modes (Flex, Grid) from the Design panel's
Layout section. Flex shows **direction** (row / row-reverse / column /
column-reverse), **align-items** and **justify-content** as icon rows, **gap**
(row/column), **padding** (uniform or 4-side), **margin**, and **sizing**
(fix/fit/grow). Grid adds a track editor (columns/rows in `fr`/`auto`/fixed/
`minmax`), plus its own align/justify/place controls and on-canvas track badges.
Spacing supports click-drag with Shift (opposite sides) / Alt (all sides).
Crucially, the whole editor is **web-native (DOM/SVG)**, not a canvas app, and the
Inspect tab emits real production CSS.

## Tech stack

- **Frontend:** **ClojureScript + React**, compiled via shadow-cljs; state through
  Potok (Redux-like) + Okulary (reactive derived state); **SCSS** styling.
- **Rendering:** historically **SVG in the DOM** ("what you design is what ships" —
  SVG/CSS/HTML), now augmented by a **Rust `render-wasm`** module for near-native
  canvas rendering performance.
- **Backend:** **Clojure/JVM**, **PostgreSQL** for persistence. Fully open source.

The all-DOM/React frontend is why its accessibility ceiling is high even though the
current polish is low — and the open source + Rust-wasm direction mirrors KIT•10's
own PGlite + Rust/WASM shape more than any other tool here.

## Accessibility

- **Better baseline than Figma, by architecture — but under-exploited.** Because
  the panel is real HTML, its inputs *can* be genuine focusable, labelable form
  controls, and it's open source so a11y is fixable in the open. That's a real
  structural advantage. But the implementation hasn't cashed it in: the board
  itself is SVG with no screen-reader-navigable object model, and the panel is
  mostly small icon-toggles without visible labels.
- **Density is the a11y tax.** Flex and Grid surface nearly every CSS property at
  once (direction, align, justify, align-content, row/column gap, 4-side padding,
  margin, sizing — and for Grid, track definitions on top). It's a wall of tiny
  targets; punishing for low-vision and motor-impaired users, and no respect for
  OS dynamic-type/zoom.
- **Icon-only segmented controls.** align-items / justify-content / direction are
  glyph rows whose meaning is tooltip-gated — the same keyboard/touch-invisible,
  learn-by-hover problem Figma has.
- **Contrast.** The dark chrome uses low-contrast gray icons/dividers that, by
  inspection, likely miss the 3:1 non-text-component bar in places.
- **Pointer-heavy grid editing.** Defining/resizing tracks and dragging spacing
  are drag interactions with no obvious keyboard equivalent.

## Affordance

- **CSS literalism is the headline flaw — and the team admits it.** Penpot said it
  did "a very straightforward translation by listing the available properties while
  keeping the CSS naming… we may have been too literal." Controls name the *CSS
  property* (`justify-content`, `align-items`, `fr`, `minmax`) rather than the
  *visual outcome*. For a designer without a web mental model, the control tells you
  the syntax, not what it does. The team itself frames this as a gap between "web
  native language" and "designer's mental models."
- **Two near-identical control sets.** Flex's align/justify and Grid's
  align/justify/place look almost the same but mean different things; the user must
  already know flex-vs-grid semantics to read identical-looking icon rows correctly.
- **Grid's genuine power carries a genuine cliff.** The track editor (fr/auto/fixed
  tracks, on-canvas badges) is expressive but has a steep, acknowledged learning
  curve, with little scaffolding for someone who doesn't already think in CSS Grid.
- **The upside worth naming:** the literal-CSS mapping is *good* affordance for the
  dev-adjacent audience — predictable, and it round-trips to real CSS in Inspect.
  Penpot also discloses more than Figma: properties are listed with names and values
  rather than buried behind an unlabeled "…" popover. So its failure is narrower —
  it optimizes hard for CSS-fluent users and leaves pure designers behind, rather
  than being opaque to everyone.

## Bottom line

Opposite failure mode to Figma. Figma hides meaning behind icons and mode-dependent
widgets on an inaccessible canvas; Penpot over-*exposes* meaning as raw CSS on an
accessible-by-architecture-but-unpolished DOM. Penpot is more honest and more
fixable, but it offloads the CSS spec onto the user as the price of admission.

Relevant to KIT•10: Penpot is the cautionary tale for our VISION 1st Principle —
Charter is deliberately *not* a raw CSS pass-through and doesn't 1:1-expose every
Vellum capability as a literal render-panel property. Penpot shows exactly what
"too literal a translation" costs in learnability. Steal the good part (real
labeled DOM controls, honest disclosure, code round-trip) and reject the bad part
(surfacing `justify-content`/`fr` verbatim instead of an outcome-named, opinionated
control).

## Sources

- [Penpot Help — Flexible Layouts](https://help.penpot.app/user-guide/flexible-layouts/)
- [Penpot Blog — How to create CSS Flex & Grid layout components](https://penpot.app/blog/how-to-create-css-flex-and-grid-layout-components-in-penpot/)
- [Penpot Blog — Responsive CSS Grid layouts](https://penpot.app/blog/tutorial-how-to-create-responsive-css-grid-layouts-in-penpot/)
- [Penpot Community — Simplify the Grid & Flex layout UI](https://community.penpot.app/t/simplify-the-grid-flex-layout-ui/4895)
- [Penpot — Responsive Design: CSS Grid & Flex Layout](https://penpot.app/design/layout)
