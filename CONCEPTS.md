# KIT•10 — Concepts

This document defines the core concepts used by KIT•10.

It exists to keep terminology consistent and to constrain implementation decisions.

---

## Design space

KIT•10 models design as a space defined by multiple independent dimensions.

A design outcome is the result of evaluating a position within that space.

Changing input values moves the position and produces a different result.

---

## Axes

An axis represents a single dimension of design intent.

Examples:

- Density
- Emphasis
- Contrast
- Motion
- Tone
- Formality

Axes may be:

- Continuous or discrete
- Numeric or symbolic

Each axis should represent exactly one idea.  
An Axis by itself should not overlap in meaning with other axis.

---

## Axis evaluation

Design values are not selected directly.

Outputs are produced by evaluating multiple axes together.  
No single axis should be sufficient to define a final value.

---

## Determinism

Axis evaluation is deterministic.

Given the same inputs, the system must always produce the same outputs.

This applies across:

- Value derivation
- Cascades
- Exports

---

## Cascades

Intent flows through the system in a defined order:

axes → mappings → derived values → outputs

There are no implicit overrides.  
Changes must be the result of upstream input changes.

---

## Traceability

Every derived value should be traceable to the axis inputs that produced it.

---

## Components

UI Components are not primary entities.

A component is rendered by evaluating the current axis state(s).
Component variants are expressions of different axis positions.

---

## Tokens

Tokens may be emitted as outputs.

They are derived artifacts and are not authoritative.  
Tokens do not require manual adjustment.

---

## Variadic structure

The system does not assume:

- A fixed number of axes
- A fixed schema
- A fixed output structure

Axes may be added or removed without restructuring the framework.

---

## Intent encoding

Inputs describe intent, not necessarily appearance.

Visual characteristics are derived from axis choice evaluation rather than specified directly.

---

## Scope

This document describes conceptual constraints.

Implementation details belong in code and editor documentation.
