# KIT•10 - FAQ

## Do I need to plan my axes before I can start drawing?

No. Start drawing. Every property you add goes on the baseline rule - no conditions, no setup required.

Add axes when you realize you need variation. Drew a button and now you want a dark version? That's when you add a "Theme" axis and say "when theme is dark, change this color." You add complexity when you discover you need it, not before you start.

---

## What's the baseline rule?

A rule with no conditions. Because there's nothing to check, it always applies - it's your fallback for everything.

Every Kit starts with one automatically. All your initial properties live here. When you add a conditioned rule ("when density is compact, reduce padding"), that rule only overrides the specific properties it declares. Everything else still comes from the baseline.

---

## What's the difference between a Kit and a View?

A **Kit** is a recipe. It says: "given these settings, here's what you get."

A **View** is a serving of that recipe with specific values plugged in. Two Views using the same Kit look different if they set the axes differently - same rules, different inputs, different output.

A View can also combine multiple Kits. Your button recipe and your color-system recipe can coexist in the same View and talk to each other via tokens.

---

## What if two rules both try to set the same property?

The more specific one wins. "More specific" has a clear ranking:

1. **How many conditions** - "when dark AND compact" always beats "when dark." More conditions win regardless of which axes are involved. This is the primary signal, and it holds even across Kits: if two Kits both declare a property, the one whose winning rule has more conditions wins, regardless of Kit order.
2. **Which Kit** - only used to break a tie. When two Kits declare a property with the *same* number of conditions, the higher-priority Kit wins. A lower-priority Kit with a more-conditioned rule still beats it.
3. **Which axes** - within a single Kit, when two rules have the same number of conditions, the one whose axes appear later in the Kit's ordering wins.

Two rules that can never both be true at once - like "theme is dark" and "theme is light" - don't compete. They can't both fire.

---

## What's the difference between a token and just writing the value directly?

Your design looks the same either way. The difference is maintenance.

If you type `#3b82f6` in fifty rules and your brand color changes, you update fifty places. With a token named `colors.primary`, you update one.

Tokens also have scope. A View token overrides a Kit token of the same name, which overrides a Project token. This means you can have `colors.primary` mean slate-blue in one View and forest-green in another, without touching any rules - just define the token differently per context.

---

## What's a render plugin?

The engine resolves your rules to a flat list of properties: `background: #3b82f6`, `padding: 8px`, and so on. It doesn't decide what to do with that list. That's the plugin's job.

A CSS plugin turns the list into CSS custom properties. An SCSS plugin makes variables and mixins. A 3D plugin sets material uniforms on a mesh. The rules are the same - the plugin just speaks a different output language.

The editor's own visual preview is itself a plugin.

---

## Can I use the same Kit in multiple Views?

Yes. Attach the same Kit to two Views, set different axis values in each, and you get two different results from the same rules. Change a rule in the Kit and it updates everywhere the Kit is used.

---

## What happens if I delete an axis that rules already reference?

The conditions on that axis are removed from any rules that referenced it. The rules stay - they just have fewer conditions now. If a rule had only that one condition, it becomes a baseline rule and applies everywhere.

---

## Where does my data live?

In your browser, in a local database. Nothing leaves your machine unless you export it. No account required.

In Firefox private mode, local storage is unavailable. The editor uses in-memory storage for that session - everything works, but nothing is saved after the tab closes.

---

## How do I export my work?

Export depends on which render plugins are installed. A plugin declares what it can produce - CSS, SCSS, Style Dictionary JSON, or anything the community has built. The core engine can also export the full project as JSON for backup or transfer to another browser.
