<p align="center">
  <img src="static/favicon.svg" alt="KIT•10 Logo" width="200" />
</p>

# KIT•10

Write the rule once. Every variant follows.

KIT•10 (pronounced **"kitten"**) is a design system editor built around one idea: instead of drawing every variant by hand, you describe your intention once and let the system derive the rest.

---

## Start by drawing

Open the editor. Draw your button. Style it however you want - that's your default, and it already exists with no setup required.

When you need a secondary variant, you don't duplicate anything. You drag that background color to an axis - **Emphasis → primary** - then add a second entry for **Emphasis → secondary**. The system now understands that background changes with emphasis, and it produces every combination automatically.

Add an axis for viewport width and every rule you've written now applies across every breakpoint. You wrote a handful of rules. The system handles everything they imply.

---

## Why does this exist?

You've been there: your button needs a light version, a dark version, a compact version, a dark-compact version, a disabled version, a dark-disabled version - and now you're maintaining 27 components for 3 axes.

You could use design tokens - but tokens only say *what* a value is, not *why* it changes. `color-primary: blue` doesn't tell you it should turn grey when disabled, or that it should get bigger on desktop. And global tokens can't express that some values only make sense in certain contexts.

KIT•10 lets you say **when**, **why**, and **where**. More conditions means higher priority. `dark + compact` overrides `dark`, which overrides the default. Add a fourth axis? One more rule. Not twelve more variants.

---

## It goes anywhere

The system resolves your rules to properties. What those properties mean - CSS variables, SCSS, 3D material settings, a sitemap structure - is up to a render plugin. The engine has no opinion about the output format. The community builds the interpreters.

---

## Where to start

- **[CONCEPTS.md](./CONCEPTS.md)** - the mental model: Views, Kits, Axes, Layers, Tokens
- **[FAQ.md](./FAQ.md)** - common questions about working with the editor

---

**KIT•10** → *"kitten"*. Yes, intentionally cute.

---

## License

*TBD*. Rights reserved until chosen.
