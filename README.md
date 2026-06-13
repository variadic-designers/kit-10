<p align="center">
  <img src="static/favicon.svg" alt="KIT•10 Logo" width="200" />
</p>

# KIT•10

Write the rule once. Every variant follows.

KIT•10 (pronounced **"kitten"**) is a design system editor where you define how your UI behaves across themes, sizes, viewports, and states - and the system produces every combination for you.

---

## Why does this exist?

You've been there: your button needs a light version, a dark version, a compact version, a dark-compact version, a disabled version, a dark-disabled version… and now you're maintaining 27 components for 3 axes.

You could use design tokens - but tokens only say *what* a value is, not *why* it changes. `color-primary: blue` doesn't tell you it should turn grey when disabled, or that it should get bigger on desktop.

KIT•10 lets you say **when** and **why**:

```
No conditions      → background: #fff, color: #333, padding: 16px
{theme: dark}      → background: #1a1a2e, color: #e0e0e0
{theme: dark, density: compact} → padding: 8px, font-size: token(colors.primary)
{viewport ≥ 1024} → width: 320px
```

More conditions = higher priority. So `dark + compact` overrides `dark`, which overrides default. Add a fourth axis? One more row. Not twelve more variants.

---

## How it works

1. **Axes** - dimensions of intent (Theme: light/dark, Density: compact/comfortable, Viewport: ≥768/≥1024)
2. **Layers** - rules that say "when these conditions are true, apply these properties"
3. **Kits** - bundles of axes + layers (Button, Layout, Card…)
4. **Views** - compositions of kits with axis values set ("Dark Compact", "Light Comfortable")
5. **Resolution** - the engine picks the most specific matching layer for each property, then substitutes tokens

Every output value is traceable to the rule and conditions that produced it. No surprises.

---

## What you get

- **No variant explosion.** Add an axis, not a component tree.
- **Composable kits.** Swap a Kit into any View with different axis values - instant reskin.
- **Token substitution.** Reference `colors.primary` in one place, the engine resolves it per-view.
- **Traceable.** Every rendered property points back to its source layer and axis conditions.
- **Offline-first.** Runs entirely in-browser via PGlite. No server, no login.

---

## What it's not

Not a drawing tool. Not AI. Not a component library. It's a meta-editor - you define the logic, it generates the outcomes.

---

## Current state

Actively under development. Start with **[CONCEPTS.md](./CONCEPTS.md)** for the technical model and **[FAQ.md](./FAQ.md)** for the design rationale.

---

**KIT•10** → _"kitten"_. Yes, intentionally cute.

---

## License

_TBD_. Rights reserved until chosen.