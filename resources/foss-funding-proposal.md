# KIT•10: a design system that writes its own variants

**A funding proposal for the KIT•10 ecosystem**

---

## The one-line pitch

You describe *when*, *why*, and *where* a design property changes, once. KIT•10 derives every variant, every breakpoint, every theme combination that implies, instead of you drawing all of them by hand and a developer reverse-engineering your intent back into `if` statements.

## The problem

Every design tool today ships you a canvas and lets you draw. What none of them give you is a real model for *why* a value is what it is. You end up with 27 components for 3 axes (light, dark, compact, disabled, and every combination), duplicated by hand, drifting the moment one of them gets a fix the others don't.

Design tokens don't solve this. `color-primary: blue` tells you *what* a value is, never *why* it changes, and it can't express that a value only makes sense in a specific context. So the real logic, the conditions, ends up living nowhere written down: in a designer's head, in a developer's `className` string, in the gap between them. That gap is where handoff actually breaks. A designer says "button, hover state, dark theme." A developer writes `if (hovered && theme === 'dark')`. They're describing the exact same rule in two unconnected languages, and every redesign re-pays that translation tax from scratch.

KIT•10's answer is a specificity system: axes define the *conditions* something can vary by (theme, viewport, emphasis, state), tokens define what a value *is* under a set of those conditions, and resolution is priority-ordered exactly the way CSS specificity already works, but applied to design intent instead of just style. Add a fourth axis and you write one more rule, not twelve more variants. The same conditional model a designer authors against is the state machine a developer would have written anyway; export just changes the syntax it comes out in.

## The architecture is the pitch

KIT•10 is deliberately not a monolith. Every layer is built to be replaced:

- The **core** is a resolution engine (axes and values in, resolved properties out) and nothing else. It has no opinion about rendering, export, or output format.
- **Charter**, the resolver-to-render-tree interpreter, and **Vellum**, the GPU renderer that turns Charter's output into pixels, are first-party plugins today for bootstrapping reasons, not because they're privileged. Either is meant to be swappable the same way any third-party plugin is: Vellum could be replaced by a DOM renderer, a print layout engine, or a Gaussian-splat renderer without touching the core.
- Every editor panel and field is declared by the active plugin, not hardcoded. A plugin says a field is `inputType: 'font'` ("this holds a font family name"); it never names a specific provider. Which plugin actually serves that kind is a separate, swappable mapping, so nobody has to fork the editor to add a new font source, icon source, or color picker.
- The wire contract between every renderer and every interpreter is a single shared schema crate, checked by an automated drift guard: a field added to one side that the other doesn't know about fails a test immediately, instead of silently corrupting data at runtime.

This is the part that makes KIT•10 a platform, not a feature: the plugin surface already exists and is exercised in production by first-party plugins, so a third-party renderer or exporter isn't a hypothetical extension point, it's the same path Vellum and Charter already take.

## What's already built and running

This isn't a pitch deck for an idea. Here's what's shipped, working, and tested today:

**The resolution engine.** Full axis-conditioned specificity resolution, live, in the browser: tokens, layers, priority-ordered condition stacks, view-level overrides that unconditionally win over kit-layer resolution when a single instance needs to diverge, linked axis values, and composition of kits into views. This is the hard part of the whole system and it works end to end, today, on real projects.

**Vellum, the GPU renderer.** Not a toy canvas. Vellum runs real flexbox *and* grid layout through `taffy`, the same layout engine class used in production Rust UI frameworks, not an approximation of CSS behavior. Every corner, border, and shadow is an analytic signed-distance field: rounded rectangles and squircle (superellipse) corners share one SDF, anti-aliased sub-pixel at any zoom level, with no texture atlases or stencil tricks. Text is shaped with `cosmic-text` and rasterized into a shared MSDF glyph atlas, so it stays crisp whether you're at 10% zoom or 3000%. Color is Oklab end to end, with Display P3 wide-gamut output on displays that support it, converted to device gamut only at the very last step before a pixel hits the screen. A dynamic transform layer already drives tweens, motion paths, and text-on-path under the hood, the direct foundation for full animation authoring. Vellum recently shipped complete descendant clipping (an ancestor's `overflow: hidden` now correctly clips its whole subtree, and images clip to their own border radius even under `object-fit: contain`), closing one of the last remaining gaps against real browser rendering behavior. It's backed by 220+ automated tests and scales to scenes with 10,000+ views.

**A real plugin ecosystem, not a roadmap slide.** Charter (interpreter), Vellum (renderer), Fontavious (a font catalogue and fetch/cache layer with a trademark-safe aliasing model, so searching "Arial" transparently resolves to the OFL-licensed Arimo with zero proprietary bytes ever shipped), WebCodium (an HTML/CSS exporter that understands variants as either discrete rules or a dynamic runtime concern), and a PDF exporter with real font embedding and layout that matches the canvas pixel for pixel. Icon fonts (Font Awesome) were added to the catalogue with zero new plugin code, purely because the font infrastructure was already generic enough to carry it. That's the extensibility principle actually paying off, not just stated.

**Editor craft that most tools never get to.** A fully rebindable keybind system exposed in Settings, not hardcoded shortcuts. Canvas-driven resize, drag, and grid-gutter editing that write through the *exact same* token-aware commit path a manual field edit does, so there's never a second, divergent code path to keep in sync. Full CSS Grid authoring (named lines, areas, `minmax()`, `repeat()`) with a live visual track painter. Round-trip project import/export that preserves composition order and remaps every cross-reference correctly.

## Where funding goes

**Animation authoring (project name: Anima).** The dynamic-layer transform system already exists and already drives tweens, motion paths, and text-on-path internally. What's missing is the authoring surface: timelines, easing curves, keyframes, a real UI on top of infrastructure that's already proven itself under real usage. This is the single highest-leverage next milestone; the hard engineering underneath it is done.

**The plugin marketplace, for real.** WebCodium already exists. Four more plugins are scoped and intended as free, FOSS-community tools from day one: **ViteStreamer** (streaming editor output straight into a Vite dev server's HMR, closing the loop between design and a running site), **Inkspensive** (static-artifact export: PDF, PNG, WebP, straight to disk or into a project's own assets), **Godard** (the motion counterpart: GIF, MOV, and similar), and **Pragma** (CI/CD orchestration into GitHub and GitLab for automated export and deploy). Funding accelerates these from "scoped" to "shipped."

**A real, time-bound open source commitment.** The philosophy has always been commons-first: a Kit's rules, axes, and conditions are knowledge, not proprietary logic, and any public Kit is fully legible to anyone who wants to learn from or build on it. The stack is licensed under the **Fair Source License (FSL)**, the same model used by Sentry and Gitbutler: source is visible and self-hostable from day one, with a narrow non-compete restriction (no standing up a competing hosted service on top of it), and each release automatically converts to a fully permissive license two years after it ships. This isn't a promise to open source it eventually; it's a license that does it on a fixed clock, version by version, whether or not anyone remembers to flip a switch.

**3D, eventually, on the foundation that's already there.** Vellum's whole rendering model is already signed-distance fields. A raymarched 3D pillar and deeper SDF-driven effects (domain warp) sit on the exact same math the 2D renderer runs today; this isn't a rewrite, it's an extension of a technique that's already load-bearing.

## Why this is fundable

The comparison points (Figma, Framer, and the rest) are closed, proprietary, and treat their own internal model as a trade secret. KIT•10's founding premise is the opposite: the rules that produce a design should be as legible and forkable as the code that implements it. That's not a marketing position, it's the 4th Principle the project was built against from day one, and it's why the plugin architecture isn't cosmetic, it's the actual load-bearing structure of the editor.

What exists today is a working resolution engine, a genuinely capable GPU renderer with real layout and real color science, and a plugin contract that's already proven itself against five real, shipped plugins. What's missing is authoring surface (animation) and breadth (the export marketplace), both of which build directly on infrastructure that already exists and already works. This is a project past the point of architectural risk, looking for the resources to build the last mile of a very large, very deliberate vision.

---

*This document describes the KIT•10 ecosystem: the core resolution engine (kit10), the GPU renderer (Vellum), the shared wire-schema contract (kit10-scene), and first-party plugins (Charter, Fontavious, WebCodium, PDF export). Technical detail and architecture docs are available in the respective repositories on request.*
