# KIT•10 — Vision

This document captures the designer's philosophy and the intended endgame, for reference across sessions and contributors.

---

## 0th Principle — Birth of KIT•10

KIT•10 was born out of love for design and a passionate hate of editor workflows that force you to redraw every UI variant by hand on every change.

Tokens are definitions, not conditions — that's what axes are for. A Kit is a unit that stores an opinionated set of rules across axes. A Composition is a set of opinionated Kits consumed by a View thus a View is one form of a UI under a specific set of conditions.

The deeper problem KIT•10 solves is handoff hell — the translation tax between designer and developer.

When a designer draws "button, hover state, dark theme" and a developer implements `if (hovered && theme === 'dark')`, they are describing the same thing in two different languages with no shared model.

KIT•10's specificity system is that shared model. The same axis conditions that resolve a design also describe a state machine a developer would write. The designer and developer are working in the same language; the export just changes the syntax.

This is firstly intended for the web but is not expected to stop there. Icons, fonts, and animation are within the horizon.

---

## 1st Principle — Parametrization to the conventional extreme

Avoid designing against extensibility; design for it. Every layer of the stack is intended to be replaceable or augmented:

- Panels can be spawned or configured by plugins — the Render Panel's fields are populated by whatever the active plugin declares, not by the core editor.
- Charter and Vellum are first-party plugins because they are opinions. Charter can be replaced by anything more efficient at translating resolved data into a render tree. Vellum can be replaced by any renderer — Gaussian splatting, a DOM renderer, a print layout engine.
- No lock-in to a specific tool for a specific job — and be honest about which layer actually owns that decision. A plugin defining a field only claims *what kind* it is (e.g. `inputType: 'font'` — "this holds a font family name"); it never names a specific provider plugin itself, or it would need recompiling just to swap one. *Which* plugin currently serves that kind is a separate, editor/project-level mapping (kind → provider), so a plugin author never has to know Fontavious exists to define a font field, and swapping the provider — or running a competing one — never means touching the plugin that defined the field.
- The core (axes + values → resolved properties) is intentionally minimal. It is a resolution engine, not an editor. Plugins make it an editor.
- A Kit Composition (View), when instanced, could expose its own axes as configurable parameters — making it a reusable, self-describing component that other Views can embed and configure.
- A View-level token override always wins outright over whatever its composed Kits would otherwise resolve for that property — unconditionally, regardless of which axis args are active. This is the same relationship an inline style has to a class, or an instance override has to a component default: Kit-layer specificity is the right tool for "this property should legitimately vary by axis" (a button's label content differing by emphasis, say); a View-level override is for "this one instance needs to diverge entirely," without forcing a fork of the whole Kit just to pin a single exception. Once a View has diverged a property this way, the editor should offer a way to hide the now-moot per-axis controls for that property on that View's Render panel — they no longer have any effect there, and leaving them visible just invites confusion.

---

## 2nd Principle — Refactoring smoothly

The designer declares intent — "when theme is dark and state is hovered, background is this color" — and the framework resolves what applies and when.

No imperative logic, no manually wiring conditions together. The specificity system is the implementation; the designer never writes it.

This offloads the "how does this work at runtime" question entirely to the export plugin, which translates declarations into whatever target language the developer needs.

UX expectations should reinforce this: encourage users to organize their rules deliberately, without blocking early prototyping. The baseline layer (no conditions) means you can start drawing immediately and add axes only when you discover you need variation.

The longer-term vision: rules can be dragged and dropped between layers and across kits. The Compositions panel becomes a humble organizer that makes explicit which rules belong to which axes and how kits compound on top of each other.

---

## 3rd Principle — Plugins, built and envisioned

The plugin architecture reaches further than export alone — it's the same extensibility the 1st Principle describes, applied concretely. What's already running, first-party but replaceable:

- **Charter** — the default resolver-to-render-tree translator, turning resolved kit data into a flat render tree.
- **Vellum** — the default GPU renderer, turning Charter's render tree into pixels.
- **Fontavious** — a utility plugin providing a font catalogue plus fetch/cache layer.

Charter and Vellum are tightly ingrained today — wired in as the editor's assumed interpreter and renderer rather than swapped in through the same loose, declared mechanism other plugins use. That's a bootstrapping expedient, not the end state: as the plugin architecture matures, they're meant to be let go as loose as any other plugin, replaceable the same way a Web plugin or a print-layout renderer would be.

Plugins can also declare export capabilities. Users define an Export Profile in the Export Panel specifying which plugin handles which target. The following are envisioned as free, FOSS-community plugins in the store from day one:

1. **WebCodium** — a markup exporter driven by user-defined Export Profiles. First targets are HTML, CSS, Svelte, and SCSS, meant to slot directly into existing development workflows. WebCodium understands variants as discrete or a dynamic thing.
2. **ViteStreamer** — an opinionated Vite integration that streams editor output straight to a dev server's HMR, closing the loop between the design editor and the running site.
3. **Inkspensive** — a static-artifact exporter built on a renderer's own output, with DPI/resolution configuration, targeting PDF, PNG, WebP, and similar formats — for direct download or straight into a project's assets.
4. **Godard** — the motion counterpart to Inkspensive: renders GIFs, MOVs, and similar motion artifacts, same download-or-asset destination.
5. **Pragma** — a CI/CD orchestrator wiring KIT•10 projects into GitHub, GitLab, and similar, for automated export/deploy workflows.


## 4th Principle — Community and Commons

Layout patterns, rule structures, and specificity systems are knowledge — not intellectual property.

A button's hover logic, a spacing scale, a color ramp: these circulate freely in code today (Stack Overflow, GitHub, shadcn) and should circulate freely in design too.

The early build defaults to public work. What you make is visible — not just the output, but the system behind it.

Because a Kit is a set of explicit rules, a new designer can open any public Kit and see exactly how a design was achieved: which axes were defined, what conditions were set, how the dark mode or the hover state was constructed.

The process is as public as the result. Others can learn from it, adapt it, build on top of it.

The distinction is between the system and the output. The Kit — the rules, the axes, the conditions — belongs to the commons. The export is entirely yours.

The website, the SVG, the font, the sitemap, the finished artifact: you own it and license it however you want. Sharing how you built something does not mean sharing what you built with it.
