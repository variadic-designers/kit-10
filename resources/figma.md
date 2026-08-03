# Figma Auto Layout - accessibility & affordance critique

Grounding: the panel is a set of icon-only segmented buttons (flow direction), a
**3×3 alignment grid** (9 dots in a tiny square), horizontal/vertical **gap** and
**padding** numeric inputs (expandable to 4-side), **Hug/Fill/Fixed** dropdowns for
W/H, on-canvas pink drag handles for spacing/padding, and an **advanced popover
behind a "…" icon** (spacing mode, strokes-in-layout, canvas stacking, text
baseline, negative spacing).

## Tech stack

- **Canvas:** a C++ 2D renderer compiled to **WebAssembly** (Emscripten), painting to
  a `<canvas>` via **WebGL**, upgraded to **WebGPU** in 2023 (compute shaders, WGSL,
  MSAA). This is the "game engine, not a web app" core.
- **UI chrome / panels:** **TypeScript + React**, real DOM - the properties inspector
  is *not* canvas-drawn. A bindings layer bridges the C++/WASM engine and the JS UI.
- **Backend:** Rust multiplayer servers over WebSockets; plugins run in a Realms
  sandbox on the main thread.

This split matters for the critique below: the panel *is* accessible-capable DOM;
the *design* is the part with no accessible object model.

## Accessibility

- **Root cause: the design has no accessible object model.** Because the artboard is
  a WASM/WebGPU canvas, objects, layers, and selection aren't exposed to assistive
  tech at all - you can't tab the layer tree or hear what's selected. The properties
  panel, by contrast, *is* React DOM and is fixable in principle; its failures below
  are a11y *hygiene*, not architecture. The dominant, architectural failure is the
  un-navigable canvas model.
- **Target size.** The 3×3 alignment grid crams 9 hit targets into roughly one
  control's footprint; individual cells are well under WCAG 2.2's 24×24 CSS-px
  minimum (let alone the 44px recommendation). Hostile to motor-impaired and
  touch/pen users.
- **Icon-only, no persistent labels.** Flow, padding-axis, and hug/fill/fixed rely
  on glyphs whose meaning is only recoverable via hover-tooltip - unavailable to
  keyboard and touch, and slow for everyone. Low-vision users can't parse the
  glyphs at all.
- **Color as the sole channel.** On-canvas spacing/padding overlays are signaled
  purely by a pink tint; no secondary encoding for color-blind users, and contrast
  against arbitrary canvas content is unmanaged.
- **Contrast.** The gray-on-gray panel icons/dividers look, by inspection, likely
  to miss the 3:1 non-text-component contrast bar in several spots.
- **Pointer-only interactions.** Dragging the canvas handles and (in practice)
  operating the alignment grid have no obvious keyboard equivalent. No respect for
  OS dynamic-type/zoom - the chrome stays tiny.

## Affordance

- **Over-aggressive progressive disclosure.** High-value behaviors (space-between
  vs packed, strokes-in-layout, negative spacing, wrap nuances) hide behind an
  unlabeled "…" with no signifier that anything important lives there.
  Discoverability is accidental.
- **Mode-dependent widgets.** The alignment grid *means different things* depending
  on spacing mode (packed vs space-between); the gap field silently doubles as an
  "Auto" toggle. One control, several meanings, no visible indication of which is
  active.
- **Hidden dependencies.** A child's **Fill** only exists if the parent has auto
  layout; options appear/disappear by context in the same physical location, so
  users can't tell *why* a control is missing. Figma itself conceded the
  resizing-vs-constraints overlap was an "invisible dependency" that confused
  people.
- **Destructive, unpreviewed reflow.** Applying auto layout or flipping direction
  can collapse spacing and re-stack content instantly, with no inline preview or
  "why did it jump" explanation - the recurring "Auto Layout broke my brain"
  complaint.
- **Handles that only exist on hover.** The canvas manipulators aren't persistent
  signifiers and share the selection color, so you learn they exist by stumbling
  onto them.
- **Vocabulary churn.** Renaming Direction→Flow and the 2024–25 panel reshuffle
  invalidated learned muscle memory; forum reaction ranged to "horrible / looks
  like they removed it."

## Bottom line

It optimizes for a dense expert panel at the cost of learnability and inclusion:
meaning is deferred to hover, controls are overloaded by mode, and the design model
sits on a non-semantic WASM/WebGPU canvas that AT can't traverse - while the React
panel around it never got the a11y hygiene its DOM foundation would have allowed.

Relevant to KIT•10: our Axes/Render panels already lean on color-coded dots + shape
as a *dual* channel (hue + kit icon) and visible labels - that's the right instinct.
The Figma lessons worth stealing as anti-patterns: don't overload one widget across
modes, don't bury high-value settings behind an unlabeled popover, and keep a text
label next to every icon-only control.

## Sources

- [Figma Learn - Guide to auto layout](https://help.figma.com/hc/en-us/articles/360040451373-Guide-to-auto-layout)
- [LogRocket - Using Figma's auto layout](https://blog.logrocket.com/ux-design/using-figma-auto-layout/)
- [Figma Blog - Behind the feature: the new Auto Layout](https://www.figma.com/blog/behind-the-feature-the-making-of-the-new-auto-layout/)
- [Figma Forum - Is the new UI a bit confusing?](https://forum.figma.com/share-your-feedback-26/is-the-new-ui-a-bit-confusing-42359)
- [Medium - Figma's Auto Layout broke my brain, until…](https://medium.com/@ryan.almeida86/figmas-auto-layout-broke-my-brain-until-4c6c085a6f16)
