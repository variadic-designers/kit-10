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

Axes are arbitrary — the system imposes no semantic constraints on what an axis represents. Any design dimension expressible in one of the following shapes is valid:

- **Categorical** — a discrete set of named values (e.g., tone: neutral / destructive / confirmative); no ordering is implied between values
- **Numeric / Ranged** — a continuous or bounded numeric spectrum (e.g., viewport width: 0–∞, animation budget: 0–1); ranges may overlap or nest
- **Discrete** — an unconstrained value with no predefined set

The only constraint on axes is representational, not semantic: they must be expressible in one of the shapes above.

Each axis should represent exactly one idea.  
An Axis by itself should not overlap in meaning with another Axis.

---

## Layers

A Layer is a rule: a set of axis conditions, each pairing an axis with a specific value, mapped to a render result.

A Layer may carry zero or more axis conditions. There is no upper limit.

A **null Layer** — one with no axis conditions — always applies, since it has no conditions to satisfy. Its specificity is zero at every tier. This makes it the lowest-priority fallback: its properties are only used when no other Layer provides them.

Null Layers are not recommended for production use, but they serve a practical purpose during prototyping: they let users define rough default outcomes before discovering which axes matter, then refactor intent into proper axis-conditioned Layers.

```
Layer: { dark: true }                        → { background: #333; color: #dedede }
Layer: { dark: true, high_contrast: true }    → { background: #000; color: #FFF }
```

When the current axis state satisfies all conditions of a Layer, that Layer applies. A Layer with more conditions in its set applies with higher specificity — so in the example above, when both `dark` and `high_contrast` are true, the two-condition Layer overrides the one-condition Layer.

Override is per-property, not per-Layer. A more-specific Layer only replaces the properties it declares; properties from less-specific Layers that are not contested remain in effect. Nothing is deleted — only contested properties are replaced.

A Layer has exactly one render result. The render result is a set of individual property declarations (e.g., `background: #333` and `color: #dedede` are separate entries), not a monolithic blob. This per-property granularity is what makes per-property override possible.

Multi-axis mappings always override less specific ones when both apply. This is the axis-count tier of specificity (see Specificity).

---

## Specificity

Specificity is a three-tier, non-overlapping hierarchy. Higher tiers always win, regardless of values in lower tiers.

| Tier | Basis | Description |
|------|-------|-------------|
| 1 (lowest) | **Axis ordering within a Kit** | Within a Kit, Axes are ordered by priority. When two Layers have the same axis count and their highest-priority axes differ, the Layer whose axis appears later in the Kit ordering wins. |
| 2 | **Axis count in the Layer condition** | The number of axis conditions a Layer carries. A two-axis Layer always overrides any one-axis Layer, regardless of which axes are involved or their ordering. Likewise, a three-axis Layer overrides any two-axis Layer, and so on. |
| 3 (highest) | **Kit precedence** | A View consumes multiple Kits in priority order. When two Kits produce a render result for the same property, the higher-priority Kit wins — regardless of axis count or axis ordering within either Kit. |

When two Layers have the **same axis count**, their relative specificity is determined by the compounded ordering of their axes within the Kit. The highest-priority axis (latest position in Kit ordering) present in either Layer decides: the Layer whose matching axis appears later wins. The same rule compounds as axis count increases — a three-axis Layer borrows its specificity from the ordering of all three axes, but it already outranks any two-axis or one-axis Layer by tier 2 alone.

These tiers are non-overlapping: no amount of lower-tier specificity can beat a higher tier. The system behaves as a composite value where each tier is its own digit, analogous to `(kit_priority, axis_count, compounded_axis_order)`.

When two Layers share the same specificity, they are either **mutually exclusive** or **orthogonal**:

- **Mutually exclusive** — both Layers condition on the same axis but different values (e.g., `{theme: dark}` vs `{theme: light}`). Only one can match the current axis state at a time, so they never contest the same property in a single resolution.
- **Orthogonal** — the Layers condition on different axes (e.g., `{theme: dark}` vs `{density: compact}`). Both can match simultaneously. If they declare different properties, they merge cleanly. If they contest the same property, tier 1 (axis ordering) resolves it.

Identical specificity never produces ambiguity.

---

## Render Tokens

A Render Token is the final output artifact — a backend-opinionated shape produced by resolving Layers.

Render Tokens encode the structure that a specific rendering target expects (framework, platform, or output format).

They are derived artifacts and are not authoritative.  
Render Tokens do not require manual adjustment.

---

## Tokens

Tokens are project-level named values (e.g., `colors.brand: #3b82f6`). They exist outside the cascade — they are not resolved through Layer specificity and are not scoped to Kits or Views.

Tokens participate in the cascade in two passes:

1. **Pass 1 — Specificity resolution.** Layers are resolved in specificity order. Each property declaration in a Layer's render result wins or loses per the specificity rules. At the end of Pass 1, every property has a winning value, which may be a literal (e.g., `#333`) or a token reference (e.g., `colors.brand`). Tokens are **not** dereferenced during this pass — they compete as opaque references, so a token reference on a higher-specificity Layer beats a literal on a lower one.

2. **Pass 2 — Token substitution.** After the winning per-property values are determined, any token references are replaced with their underlying values. This substitution happens after all specificity is settled, so tokens never affect which Layer wins — they only affect what the final output value is.

A render result entry is always **one of**: a literal value or a token reference. It is never both, and it is never neither. The data model enforces this with a check constraint.

Unbounded tokens (those without axis conditions) naturally reside on the null Layer, where they serve as baseline values that more-specific Layers can override per-property.

---

## Range conditions

A Layer condition on a ranged axis does not match by equality — it matches by evaluation. For example, a condition `{viewport_width: ≥1024}` is satisfied when the current axis arg for viewport width is any value ≥ 1024, not just exactly 1024.

The resolution engine evaluates each Layer condition against the current axis args:
- **Categorical conditions** match by value identity.
- **Range conditions** match by evaluating the operator against the axis arg's current value.
- **Discrete conditions** match by value identity with no predefined set.

This evaluation happens at resolution time, not at storage time.

---

## Cascade

Intent flows through the system in a defined order:

Views → Kit instances → Axes → Layers (Pass 1: specificity resolution) → Token substitution (Pass 2) → Render Tokens

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
