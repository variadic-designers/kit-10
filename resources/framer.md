# Framer Layout (Stack / Grid) - accessibility & affordance critique

Grounding: Framer arranges content with two primitives - a **Stack** (`⇧A`, a flex
row/column) and a **Grid** (`⇧G`) - and you convert one to the other from the
right-hand properties panel. The panel exposes **direction**, **distribution**
(gap / space-between), **alignment**, **gap**, **padding**, and **sizing**
(Fixed / Fill / Fit). Framer deliberately uses **designer-facing names** ("Stack",
"Distribute", "Gap") rather than raw CSS (`flex-direction`, `justify-content`), and
ships opinionated defaults (transparent stacks, sensible spacing) - the January
2025 update explicitly improved Stack defaults, wrap behavior, and layer-panel
icons. It sits at the **opposite pole from Webflow**: maximal abstraction over CSS,
not maximal exposure of it.

## Tech stack

- **Editor:** a **React**/TypeScript web app; the properties panel and layer tree are
  React DOM like the rest.
- **Canvas → code:** every element on the canvas **generates React behind the
  scenes** (props, state, handlers). Layout is Framer's own engine expressed through
  the Stack/Grid abstraction rather than raw CSS classes.
- **Animation/runtime:** **framer-motion / Motion**. Code components are real React
  components dropped onto the canvas.
- **Output:** optimized **React components**, not hand-written HTML - which is why
  the surface controls can afford to hide CSS entirely (there's a compiler between
  the panel and the markup).

The React-all-the-way-down pipeline is what *lets* Framer be the most abstracted of
the four: the outcome-named controls compile down, so they never have to expose the
CSS underneath.

## Accessibility

- **React DOM chrome, poor hygiene.** Unlike Figma, Framer's editor (and its canvas
  content) is React, so its panel isn't architecturally locked out of accessibility -
  but the controls are small icon toggles and tooltip-gated glyphs, with the same
  keyboard/touch-invisible, learn-by-hover problem as the others, and no meaningful
  respect for OS dynamic-type/zoom.
- **Icon-only alignment/distribution.** Direction, distribution, and alignment read
  as compact glyph rows; targets are small and below the WCAG 2.2 24×24 minimum.
- **Contrast.** The neutral/dark chrome uses low-contrast gray icons that, by
  inspection, likely miss the 3:1 non-text-component bar in places.
- **Feature density by accretion.** Framer folds design, layout, CMS, effects,
  interactions, and code components into one panel; the layout controls compete for
  attention with everything else, raising cognitive and visual load.
- **Output vs. tool.** As with Webflow, any accessibility story is mostly about the
  *published site*, not the editor, which remains a hard assistive-tech target.

## Affordance

- **Best-in-set affordance for non-CSS designers - and that's the point.** By naming
  concepts for outcomes ("Stack", "Distribute", "Fill/Fit/Fixed") instead of CSS
  properties, Framer lets a designer reason about *what happens visually* rather than
  *which property fires*. Good defaults and direct on-canvas manipulation mean the
  common case rarely requires touching the panel at all. This is the opposite of the
  Penpot/Webflow literalism trap.
- **The abstraction's cost is opacity.** Because the friendly names don't map
  transparently to CSS, it's harder to predict the exact generated output or to
  reason about edge cases the abstraction doesn't cover - you trade predictability
  of the underlying model for approachability of the surface.
- **Fixed/Fill/Fit is the familiar hidden dependency.** As in Figma, a child's
  "Fill" only means something inside a Stack/Grid parent; the same control changes
  behavior by context, and the panel gives little cue as to *why* an option is
  available or not.
- **Stack↔Grid conversion is a nice affordance** - "start simple, upgrade when you
  need 2D" is exactly the progressive path Grid-first tools miss - but the moment of
  conversion silently reinterprets your alignment/distribution settings under the new
  model, an unpreviewed reflow reminiscent of Figma's.
- **Scope creep dilutes focus.** The layout controls are strong, but they live in a
  panel that keeps growing; the affordance for "just lay this out" is increasingly
  buried among unrelated capabilities.

## Bottom line

Framer is the anti-Webflow: it hides CSS behind outcome-named, well-defaulted
controls, which makes it the friendliest of the four for pure designers - at the
price of predictability and a panel that's sprawling into everything-at-once. Its
layout affordances are the strongest here; its accessibility is no better than the
rest (small icon controls on a canvas app).

Relevant to KIT•10: Framer is the closest existing tool to our VISION 1st Principle
- an *opinionated translation layer* over the raw engine, exactly what Charter is to
Vellum (don't 1:1-expose every capability; name controls for intent, default
sensibly). The cautionary half is the flip side: as Framer shows, an abstraction
must still be *predictable* and mustn't let the surface sprawl until "lay this out"
is hard to find. Steal the outcome-naming and defaults; keep the panel focused and
the model legible.

## Sources

- [Framer Updates - January 2025: Layout](https://www.framer.com/updates/january-update-2025)
- [Framer Academy - Stacks vs grids](https://www.framer.com/academy/lessons/framer-fundamentals-stacks-vs-grids)
- [Framer Help - Adding a layout grid](https://www.framer.com/help/articles/layout-grids/)
- [Design+Code - Adaptive Layout with Stacks and Constraints in Framer](https://designcode.io/framer-web-design-adaptive-layout/)
- [Framer Developers - Property Controls](https://www.framer.com/developers/property-controls)
