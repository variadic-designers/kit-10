# KIT•10 — FAQ

## What is KIT•10?

KIT•10 (pronounced **"kitten"**) is a framework and editor for building design systems from structured inputs instead of manually curated tokens and variants.

The model:

Views → Kit instances → Axes → Layers (specificity resolution) → Render Tokens

See [CONCEPTS.md](CONCEPTS.md) for full definitions.

---

## How is this different from design tokens?

Tokens are one of the outputs. KIT•10 calls them Render Tokens.

Design token systems (Style Dictionary, Figma Variables, Tokens Studio) treat each token as a standalone value or a set of modes. You define `color-primary` once per theme. Want it to change when density changes too? You duplicate the token set or nest modes — and now you're manually tracking combinations.

KIT•10 doesn't store token values per combination. It stores intent, and the resolution engine derives the values. The output is the same (CSS custom properties, JSON, etc.), but the input model is N-dimensional instead of flat.

---

## How is this different from Figma Variables / Style Variables?

Figma Variables let you define modes (e.g., Light / Dark) and switch between them. A variable belongs to one collection with one set of modes. If you need a button to respond to theme *and* emphasis *and* interaction state, you're stuck:

- Each mode is a linear switch. You pick one mode per collection.
- There is no specificity model. If two collections both set `color`, the last one wins — no structured resolution.
- There is no concept of a "layer" that combines conditions. You can't say "when dark + high contrast, override the dark variant."

KIT•10's Layers handle this natively. A `{dark: true, high_contrast: true}` Layer is more specific than a `{dark: true}` Layer, and the system resolves this without you duplicating values or creating intermediate modes.

---

## How is this different from Tailwind / utility CSS?

Tailwind composes styles linearly: you list classes, and specificity is source order plus CSS weight. It works for one-off compositions but breaks down at system scale:

- No structured override model. Two utilities setting `color` fight by CSS rules, not by design intent.
- No way to say "in dark mode, override this" without `@apply` or duplicating classes per state.
- Utility classes are flat. They don't compose into reusable behavioral bundles with independent parameters.

KIT•10's Kits are ordered behavioral bundles. Their internal Axes compose through a three-tier specificity model (Kit priority > axis count > axis ordering) that CSS cannot express. The output can target Tailwind, but the input model is not a flat utility list.

---

## How is this different from CSS-in-JS / styled-systems?

Styled-systems (Style System, Stitches, Vanilla Extract) introduce responsive and variant-based styling. They're closer to KIT•10's model than tokens or Tailwind, but they have key limitations:

- Variants are flat switch statements. `color: { dark: '#333' }` is a one-dimensional lookup. Composing `dark + compact + hover` requires enumerating every combination or relying on CSS cascade behavior.
- No cross-variant specificity. If `size: sm` and `emphasis: primary` both set `padding`, the resolution is whichever comes last in the object — no different from CSS source order.
- No Kit-level composition. Each component's variants are defined in isolation. There's no ordered bundle that carries its own axis state, and no cross-bundle precedence.

KIT•10's Layers let you define `{dark: true}` and `{dark: true, compact: true}` separately. The two-condition Layer wins when both axes are active, without enumerating any other combination. Cross-Kit conflicts resolve by Kit priority, not by CSS cascade or object order.

---

## How is this different from a design system theme switcher?

Theme switchers toggle between two or more complete token sets (light.css / dark.css). This is a one-axis model with at most a few values.

KIT•10 is N-axial. Adding a new dimension (density, emphasis, viewport width, motion preference) doesn't multiply your token sets — it adds one axis to the resolution engine. The number of possible outputs grows combinatorially, but the number of Layers you *write* grows linearly with the conditions you care about.

---

## Does this replace designers?

No. It replaces repetitive decision-making.

Designers still:

- define Views
- define Kits and their Axes
- define Layer mappings and render results
- set constraints and intentions

KIT•10 applies those decisions in traceable patterns so you avoid variant explosion and override purgatory. The designer defines the rules once; the engine generates every combination.

---

## What's a null Layer?

A Layer with no axis conditions. It always applies with zero specificity — the lowest priority. Useful during prototyping when you haven't discovered which axes matter yet. See CONCEPTS.md → Layers.

---

## What happens when two Layers conflict?

It depends on whether they have the same specificity:

- **Different axis count** — the Layer with more conditions wins (tier 2).
- **Same axis count, different axes** — Kit ordering decides (tier 1).
- **Same axis, different values** — they're mutually exclusive; only one can match at a time.
- **Different Kits** — Kit precedence decides (tier 3), regardless of any internal resolution.

No ambiguity. See CONCEPTS.md → Specificity for the full model.