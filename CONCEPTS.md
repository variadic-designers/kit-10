# KIT•10 - Concepts

This document defines the core concepts used by KIT•10. It exists to keep terminology consistent and to constrain how the system is understood and discussed.

---

## Design space

KIT•10 models design as a space defined by independent dimensions.

A design outcome is the result of evaluating a position within that space. Changing the inputs moves the position and produces a different result.

---

## Views

A View represents a UI at a given set of conditions.

A View assembles multiple Kits and sets the axis values for each. Views are the top-level compositional unit - they define what is on screen by parameterizing the Kits they contain.

A View can also **compose other Views as children** - nesting them to build a tree. This is expressed as a value that references views (a view-list), not a separate structural concept: whichever property a rendering plugin decides means "compose these" holds the child references. Views are unique and reference-based, so a child is the same view wherever it appears; when a Kit ships default children, each consuming View gets its own deep-cloned copy so instances stay independent (the component/instance model).

---

## Kits

A Kit is a reusable bundle of axes and rules for a single design concern - a button, a layout, a color system.

A Kit is not a component. It is a behavioral specification. A View can use the same Kit with different axis values and get different results from the same rules.

---

## Axes

An axis is a single dimension of design intent within a Kit.

Examples: Emphasis, Density, Theme, Motion, Viewport Width.

Axes can take three forms:

- **Categorical** - a named set of values with no implied ordering (e.g. `tone: neutral / destructive / confirmative`)
- **Range** - a numeric spectrum where conditions are evaluated as comparisons (e.g. `viewport_width ≥ 1024`)
- **Discrete** - a freeform value with no predefined set

Each axis should represent exactly one idea and should not overlap in meaning with any other axis in the same Kit.

---

## Layers

A Layer is a rule: a set of axis conditions mapped to a set of property declarations.

```
{ emphasis: primary }                    → background: skyblue; color: white
{ emphasis: primary, density: compact }  → background: skyblue; padding: 8px
```

A Layer with no conditions - the **null layer** - always applies. It has no conditions to fail, so it matches every axis state. It is the lowest-priority fallback and the natural starting point for any design: properties live here until you give them conditions.

Layers override per-property, not wholesale. A more specific Layer only replaces the properties it declares. Everything else from less specific Layers carries forward.

---

## Specificity

When multiple Layers match and contest the same property, the more specific one wins.

Specificity is determined by three tiers, from highest to lowest:

1. **Kit priority** - when two Kits in a View declare the same property, the higher-priority Kit wins
2. **Axis count** - a Layer with two conditions always beats one with one condition, regardless of which axes are involved
3. **Axis ordering within the Kit** - when two Layers have the same number of conditions, the one whose axes appear later in the Kit's ordering wins

These tiers are non-overlapping. No amount of lower-tier specificity can beat a higher tier. Given any two Layers and any axis state, there is always exactly one winner per property.

When two Layers can never both be active at the same time - e.g. `{theme: dark}` and `{theme: light}` - they are mutually exclusive and never contest each other.

---

## Tokens

Tokens are named values that Layers can reference instead of hardcoding a literal.

Rather than writing `#3b82f6` in every Layer, you write `token(colors.primary)` and define the value once. Change the token, and every Layer that references it updates.

Tokens are **scoped**:

- **Project tokens** are available to every Kit and View in the project. Use them for shared foundations: brand colors, spacing scales, type scales.
- **Kit tokens** are visible only within the Kit that defines them. Use them for values that only make sense inside that Kit's context.
- **View tokens** are visible only within the View that defines them. Use them when the same token name needs a different value depending on which View is consuming it.

More specific scope wins: a View token overrides a Kit token of the same name, which overrides a Project token.

A token's value is usually a scalar, but it can also be a **view-list** - a reference to a set of Views. This is how composition is stored: a View's children are a view-list token, and a Kit's default children are a Kit-scope view-list token. The same scope-precedence rule applies, which is what lets one instance diverge its children (a View-scope override) from the Kit's default.

Token references compete on specificity like any other value - a token reference on a higher-specificity Layer beats a literal on a lower one. After the winning value per property is determined, token references are substituted with their underlying values using the scoping rules above.

---

## Range conditions

A Layer condition on a range axis does not match by equality. It matches by evaluation.

A condition `{ viewport_width: ≥ 1024 }` is satisfied by any arg value that is ≥ 1024, not just exactly 1024. Two range conditions on the same axis can overlap - specificity determines which wins when both match.

---

## Cascade

Intent flows through the system in a defined order:

Views → Kit instances → Axes → Layers → Token substitution → Render output

There are no implicit overrides. Every output is traceable to a specific Layer, the axis conditions that activated it, and the token scope that resolved its values.
