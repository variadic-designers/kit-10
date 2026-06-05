# KIT•10 — FAQ

## What is KIT•10?

KIT•10 (pronounced **"kitten"**) is a framework and editor for building design systems from structured inputs instead of manually curated tokens and variants.

In traditional design system editors you create one outcome at a time. In KIT•10, you define how the system behaves across all states you can exhaustively account for.

The model is:

Views → Kit instances → Axes → Layers (specificity resolution) → Render Tokens

---

## Is KIT•10 a design system?

No. It's a way to **generate** design systems.

Think "design system factory," not "design system template" — though you can treat it as such without the refactoring limitations of the latter.

---

## What is a View?

A View is a UI's form at a given set of conditions. Think of it as the composed screen or surface the user sees.

A View consumes multiple Kits as instances, each with independently set Axis values.

---

## What is a Kit?

A Kit is an ordered bundle of Axes — a parameterized behavioral unit. It represents a cohesive design concern (spacing, color, typography, etc.).

A View instantiates Kits; Kits hold Axes.

---

## Do I need to understand Axes to use it?

At some point, yes — but not all at once.

Axes are degrees of freedom within a Kit. They can be categorical, numeric, or ranged (density, emphasis, contrast, etc.).  
The editor exists so you can explore what they do without memorizing theory first.

---

## What are Layers?

Layers are resolution intermediaries between Axes and Render output.

A `one-axis → render` mapping is less specific than a `two-axis → render` mapping, so the latter overrides the former when both apply. This specificity-based resolution means you can define broad defaults and targeted overrides without restructuring anything.

---

## How is this different from design tokens?

Tokens are one of the outputs — we call them Render Tokens.

KIT•10 elaborates what their values are based on user-defined context. It generates them by evaluating Axes through Layers with specificity resolution.

Render Tokens are backend-opinionated shapes, and they require no manual adjustment.

---

## Does this replace designers?

No. It replaces repetitive decision-making.

Designers still:

- define Views
- define Kits and their Axes
- define Layer mappings
- set constraints

— all alongside the design outcome.

KIT•10 just applies those decisions in traceable patterns so you avoid variant explosion and override purgatory.
