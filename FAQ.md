# KIT•10 - FAQ

## Do I need to plan my axes before I can start drawing?

No. Draw first. All properties start on the null layer - a rule with no conditions that always applies. No axes, no setup required.

Add axes when you discover you need variation. Drag existing properties to their conditions as your design grows. The system captures your reasoning as you go, not before you start.

---

## What's the null layer?

A rule with no axis conditions. Because it has no conditions to fail, it always matches - making it the lowest-priority fallback.

It's where every design begins. Properties you haven't assigned to any condition yet live here. Once you assign a property to a conditioned rule, that rule takes over for any axis state it matches.

---

## What's the difference between a Kit and a View?

A **Kit** is a reusable behavioral specification for one design concern. It defines axes and the rules that respond to them.

A **View** is a composition. It assembles one or more Kits and sets the axis values for each. The same Kit in two different Views can produce completely different output if the axis args differ.

---

## What happens when two rules contest the same property?

The more specific rule wins. Specificity has three tiers, from highest to lowest:

1. Which Kit it belongs to (higher-priority Kit wins)
2. How many conditions it has (more conditions win)
3. Which axes are involved (axes later in the Kit's ordering win)

If two rules can never both be active at once - e.g. `{theme: dark}` and `{theme: light}` - they're mutually exclusive and there's no contest.

See [CONCEPTS.md → Specificity](./CONCEPTS.md) for the full model.

---

## What's the difference between a token and just writing the value directly in a rule?

Nothing changes in how the rule behaves. The difference is maintainability.

If `#3b82f6` appears in twenty rules and you change your brand color, you update twenty places. With a token named `colors.primary`, you update one.

Tokens are also scoped. A View token overrides a Kit token of the same name, which overrides a Project token. This lets the same name resolve to a different value per context without duplicating any rules.

---

## What's a render plugin?

The engine resolves your rules to a set of properties - `background: skyblue`, `padding: 8px`, etc. It doesn't know what those properties mean for a given output target. A render plugin takes that resolved output and interprets it.

A CSS plugin emits custom properties. An SCSS plugin emits variables and mixins. A 3D plugin sets material uniforms. The same rules produce different output depending on the plugin. The viewport in the editor is itself a plugin.

---

## Can I use the same Kit in multiple Views?

Yes. Attach the same Kit to two Views with different axis args and you get two different resolved outputs from the same rules. Change a rule in the Kit and it propagates to every View that uses it automatically.

---

## What happens if I delete an axis that layers already reference?

Any conditions on that axis are removed from the affected layers. The layers themselves remain, now with fewer conditions. If all conditions are removed from a layer, it becomes a null layer.

---

## Where does my data live?

In your browser, in a local database. Nothing leaves your machine unless you export it. No account required.

In Firefox private mode, local storage is unavailable. The editor falls back to in-memory storage for that session - everything works, but data is not persisted after the tab closes.

---

## How do I export my work?

Export depends on which render plugins are installed. A plugin declares what it can produce - CSS, SCSS, Style Dictionary JSON, or anything else the community has built. The core engine can also export the full project as JSON for backup or transfer between browsers.
