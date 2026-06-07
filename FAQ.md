# KIT•10 — FAQ

## What is KIT•10?

KIT•10 (pronounced **"kitten"**) is a design system editor that lets you define how your UI behaves across every state, theme, and viewport — and generates the outputs automatically.

Instead of creating a variant for every combination by hand, you define the rules once. The engine works out every combination.

---

## Why would I use this instead of Figma or Framer?

Figma and Framer are great for drawing and prototyping. But when your design system grows, you hit problems they weren't built to solve:

- **Variant explosion.** A button with 3 themes × 3 sizes × 3 states = 27 components. Add one more dimension and you're maintaining 54. In KIT•10, you write 7 rules and the engine generates every combination.
- **No reuse across projects.** Reskinning a Figma component library means duplicating and editing files. In KIT•10, a Kit is a reusable behavioral bundle — plug it into a different View with different axis values and you get a new skin without redefining anything.
- **Manual synchronization.** Change a theme token in Figma and you update every affected component by hand. In KIT•10, changing one Layer propagates to every View that uses that Kit.
- **Dead-end output.** Figma exports flat CSS. Framer ships React components. KIT•10 can export to CSS custom properties, Tailwind, SCSS, Flutter, Style Dictionary JSON, or any format the community builds a backend for — from the same design rules.

KIT•10 is not a drawing tool. It's a system logic tool. You define the rules; the engine produces render-ready output for any platform.

---

## How is this different from design tokens?

Tokens describe what a value is. KIT•10 describes *why* that value is what it is.

A token system stores `color-primary: #3b82f6` per theme. Want it to change when density changes too? You duplicate the token set or nest modes — and now you're manually tracking combinations.

KIT•10 stores intent. You say "when dark mode is on, background is #333." When "dark mode + high contrast" should be #000, you add one more rule. The engine derives every combination. The output format is the same — CSS variables, JSON, whatever your pipeline expects — but you defined the logic, not the flat values.

---

## How is this different from Figma Variables?

Figma Variables let you define modes (Light / Dark) and switch between them. One axis, one value at a time.

If you need a button to respond to theme *and* size *and* interaction state, you're stuck:

- You pick one mode per collection. No way to combine them.
- If two collections both set `color`, whoever is last wins. No structured resolution — just blind override.
- You can't say "when dark + high contrast, override the dark variant." You'd need a separate mode for every combination.

KIT•10 handles this natively. You define `{dark: true}` and `{dark: true, high_contrast: true}` as separate rules. The latter wins when both conditions are active. No duplication, no intermediate modes.

---

## How is this different from a theme switcher?

A theme switcher swaps between two token sets — light.css and dark.css. That's one axis with two values.

KIT•10 is multi-axial. Adding a new dimension (density, viewport width, motion preference) doesn't multiply your output files. It adds one axis to the rules. The possible outputs grow combinatorially, but the rules you *write* grow linearly with the conditions you care about.

---

## What's a Layer?

A rule that says "when these conditions are true, apply these properties."

```
{dark: true}                      → background: #333; color: #dedede
{dark: true, high_contrast: true}  → background: #000; color: #FFF
```

The second rule has more conditions, so it wins when both apply. Only the properties it declares override the first — everything else carries forward.

A Layer with no conditions (null Layer) always applies. It's the lowest-priority fallback. Useful for prototyping defaults before you know which axes matter.

---

## What happens when two rules conflict?

It depends on which rule is more specific:

- **More conditions win.** A rule with two conditions (dark + compact) beats one condition (dark).
- **Same number of conditions, but different axes?** The axis listed later in the Kit wins.
- **Same axis, different values?** They can't both be active at once (dark and light can't be true simultaneously). No conflict.
- **Different Kits, same property?** The higher-priority Kit wins.

No ambiguity, no guessing. See [CONCEPTS.md](CONCEPTS.md) → Specificity for the full technical model.

---

## Does this replace designers?

No. It replaces repetitive decision-making.

Designers still define the Views, Kits, Axes, and Layers. KIT•10 applies those decisions in traceable patterns so you avoid variant explosion and override purgatory. You define the rules once; the engine generates every combination.