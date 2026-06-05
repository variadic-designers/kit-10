# KIT•10 — Concepts

This document defines the core concepts used by KIT•10.

It exists to keep terminology consistent and to constrain implementation decisions.

---

## Design space

KIT•10 models design as a space defined by multiple independent dimensions.

A design outcome is the result of evaluating a position within that space.

Changing input values moves the position and produces a different result.

---

## Views

A View represents a UI's form at a given set of conditions.

A View can consume multiple Kits at once, instantiating each Kit with independent Axis values.

Views are the top-level compositional unit. They define *what* is rendered by assembling and parameterizing Kits.

---

## Kits

A Kit is an ordered bundle of Axes representing a cohesive design concern.

A Kit is not a component — it is a parameterized behavioral unit that a View instantiates.

Each Kit instance within a View carries its own independent Axis state.

---

## Axes

An axis represents a single dimension of design intent within a Kit.

Examples:

- Density
- Emphasis
- Contrast
- Motion
- Tone
- Formality

Axes may be:

- Continuous or discrete
- Numeric, categorical, or ranged

Each axis should represent exactly one idea.  
An Axis by itself should not overlap in meaning with another Axis.

---

## Layers

A Layer is a resolution intermediary that sits between Axes and Render output.

A Layer maps Axis conditions to rendered results:

- A `one-axis → render` mapping applies broadly.
- A `two-axis → render` mapping applies with higher specificity.

Layers are not limited to single-axis mappings.  
Multi-axis mappings override less specific ones when both apply.

---

## Specificity

Specificity is a three-tier, non-overlapping hierarchy. Higher tiers always win, regardless of values in lower tiers.

| Tier | Basis | Description |
|------|-------|-------------|
| 1 (lowest) | **Axis ordering within a Kit** | Within a Kit, Axes are ordered by priority. An Axis at position 2 overrides one at position 1 for conflicting render results. This is the finest unit of specificity. |
| 2 | **Axis count in the Layer condition** | The number of Axes in a Layer's mapping. A `two-axis → render` Layer always overrides any `one-axis → render` Layer. A `three-axis → render` overrides `two-axis`, and so on. |
| 3 (highest) | **Kit precedence** | A View consumes multiple Kits in priority order. When two Kits produce a render result for the same property, the higher-priority Kit wins — regardless of axis count or axis ordering within either Kit. |

These tiers are non-overlapping: no amount of lower-tier specificity can beat a higher tier. The system behaves as a composite value where each tier is its own digit, analogous to `(kit_priority, axis_count, axis_order)`.

---

## Render Tokens

A Render Token is the final output artifact — a backend-opinionated shape produced by resolving Layers.

Render Tokens encode the structure that a specific rendering target expects (framework, platform, or output format).

They are derived artifacts and are not authoritative.  
Render Tokens do not require manual adjustment.

---

## Cascade

Intent flows through the system in a defined order:

Views → Kit instances → Axes → Layers (specificity resolution) → Render Tokens

There are no implicit overrides.  
Changes must be the result of upstream input changes.

---

## Determinism

Axis evaluation is deterministic.

Given the same inputs, the system must always produce the same outputs.

This applies across:

- Value derivation
- Layer resolution
- Render exports

---

## Traceability

Every derived value and Render Token should be traceable to the Axis inputs and Layer mappings that produced it.

---

## Variadic structure

The system does not assume:

- A fixed number of Views
- A fixed number of Kits per View
- A fixed number of Axes per Kit
- A fixed schema
- A fixed output structure

Views, Kits, and Axes may be added or removed without restructuring the framework.

---

## Intent encoding

Inputs describe intent, not necessarily appearance.

Visual characteristics are derived from Axis evaluation and Layer resolution rather than specified directly.

---

## Scope

This document describes conceptual constraints.

Implementation details belong in code and editor documentation.
