<p align="center">
  <img src="static/favicon.svg" alt="KIT•10 Logo" width="200" />
</p>

# KIT•10

KIT•10 (pronounced **"kitten"**) is a design system generator — not a library of tokens, not a template kit, not a Figma plugin. It's a **meta-editor** where you define how a UI behaves across conditions, and the system produces every outcome exhaustively, deterministically, without you having to build each one by hand.

---

## The problem KIT•10 solves

Most design tools model output directly. You craft a button, then a variant, then another variant, then a variable to sync their padding, then an override that breaks the variable chain. At three axes and four values each, you're maintaining 64 component states — and the gap between the editor and usable code grows with every change.

This is **variant explosion**. It's not a bug. It's what happens when your tool's information architecture is a document tree with abstraction layers bolted on after the fact.

---

## How KIT•10 is different

Instead of modeling output, KIT•10 models **design space**.

You define independent dimensions of intent — **Axes** like Density, Emphasis, Contrast, Tone. You define how those axes map to visual results — **Layers** with specificity rules. You compose them into **Kits**, instantiate them in **Views**, and the system resolves everything through a deterministic cascade.

The information architecture is a **relational pipeline**, not a node tree:

```
Views → Kit instances → Axes → Layers (specificity resolution) → Render Tokens
```

A View consumes multiple Kits. Each Kit holds ordered Axes. Each Layer links axis conditions to render output. Specificity is non-overlapping three-tier — kit priority > axis count > axis order — so adding a new condition never requires restructuring existing rules.

The result: adding a fourth axis doesn't multiply your workload by its values. It adds one row to a table.

---

## What this enables

- **Composable design logic.** Kits, Layers, and Axes are operands with explicit precedence rules. You can reorder Kits in a View, add a 2-axis Layer, or insert a new Axis without touching anything else.
- **Deterministic output.** Same inputs always produce the same results. Every value is traceable to the axis conditions that produced it. No hidden overrides, no broken variable chains.
- **Backend-agnostic render.** Output shapes (CSS, Tailwind, JSON tokens) are schema rows — Render Snippets. Switching export formats is data, not a pipeline rewrite.
- **Extensible by nature.** Adding a new axis kind, a new specificity rule, or a new output target is a schema change. The extension surface IS the data model.
- **Local-first, offline.** PostgreSQL-in-browser via PGlite. No server, no sync conflicts, no login.

---

## A different category

Figma and Framer are **crafting tools** — you build one outcome at a time. KIT•10 is a **generator** — you define behavior across all states and let the system elaborate the rest.

This isn't AI. It's just a better information architecture for the problem. Design intent flows through a defined cascade with explicit precedence, not through a document tree with invisible exception chains.

---

## Current state

This project is **actively under development**. The manager schema and API are stable; the frontend is mid-migration from prototype to production. Expect moving parts.

Start with **[CONCEPTS.md](./CONCEPTS.md)** for the architecture and **[FAQ.md](./FAQ.md)** for the philosophy.

---

## Name

**KIT•10** → _"kitten"_. Yes, that's intentional.

---

## Trademarks & assets

The KIT•10 name, logo, and related marks are official project assets. Presence here does not imply permission for external use.

---

## License

_TBD_. Rights reserved until chosen.
