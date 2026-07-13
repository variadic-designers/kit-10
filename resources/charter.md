# How Charter should behave — a deliberation against Figma / Penpot / Webflow / Framer

This is an opinion piece. It reads the four critiques in this folder as a spectrum
and argues where Charter (KIT•10's resolved-data → Vellum `UiNode` translation
layer) should sit, and why.

## The spectrum

Line the four up by how much CSS they make the user hold in their head:

```
   more abstraction ◄──────────────────────────────────► more literalism
        Framer            Figma            Penpot           Webflow
   (outcome names,   (icon-hidden,      (CSS names,      (CSS front-end,
    good defaults,    mode-overloaded    honest but       class cascade,
    but sprawl)       canvas)            offloads spec)   invisible ripples)
```

Charter's mandate (VISION 1st Principle: *opinionated translation, not raw CSS
pass-through*) puts it firmly on the **Framer end** — but it has to fix the two
things Framer gets wrong, and it inherits one problem *none* of them share.

## What to steal, what to reject

**From Framer — steal the philosophy.** Name fields for *intent/outcome*, not for
the CSS property that implements them. Default aggressively so the common case needs
no panel interaction. Infer structure rather than exposing knobs. This is exactly
what Charter already claims to be: it does not 1:1-expose every Vellum capability,
and it's free to have an opinion about what a designer should set by hand versus what
it infers. That instinct is correct — lean harder into it.

**From Framer — reject the sprawl.** Framer's layout affordances are the best of the
four, then drown in a panel that also does CMS, effects, interactions, and code.
Charter is spared this *by architecture*: Vellum is preview-only, export/CSS is a
different plugin's job, and the panel system is plugin-scoped. That boundary is a
feature — defend it. Charter should keep declaring a *small* field vocabulary and
resist absorbing adjacent concerns just because it can reach them.

**From Penpot and Webflow — reject the literalism, keep the honesty.** Surfacing
`justify-content` / `align-items` / `fr` verbatim is the failure the Penpot team
itself admitted ("too literal"). Every raw-CSS-named field Charter declares is a
**debt**: acceptable as a placeholder for a general-purpose primitive that has no
clearer opinion *yet* (which is honestly where a few of Charter's box fields are
today), but the north star is to earn an opinion and replace it with an
outcome-named or inferred control. Treat "we exposed the CSS name" as a TODO, not a
destination. What Penpot/Webflow get *right* — real labeled DOM controls, honest
disclosure, no burying — Charter should keep.

**From Figma — reject almost everything about the surface.** Three specific
anti-patterns to never reproduce:
- **No mode-overloaded widgets.** Figma's 3×3 grid means different things in
  packed vs space-between mode. One Charter field = one meaning, always.
- **No unlabeled disclosure.** Figma buries high-value settings behind a "…" with no
  signifier. If Charter defers a field to progressive disclosure, the entry point
  must say what's inside.
- **No icon-only, tooltip-gated controls.** Every field the editor renders from a
  Charter `FieldDef` should carry a human label and a semantic `inputType`, so the
  DOM panel can present a labeled, focusable, adequately-sized control — never a bare
  glyph. Charter owes the editor enough semantics to render accessibly.

## The accessibility fork Charter must not miss

Every one of these tools has the same accessibility failure: small, icon-only,
tooltip-gated controls, often on a non-semantic canvas. KIT•10 has a structural
advantage and must not squander it: **the viewport is a canvas (Vellum), but the
editing controls are real Svelte DOM.** That split is the single best accessibility
decision available in this category — Figma can't retrofit it. Charter's job is to
feed that DOM enough information (labels, types, value shapes) that the editor never
has to fall back to Figma-style icon guessing. Keep controls in the DOM; keep the
canvas for *rendering*, not for *input*.

## The problem none of the four share — and the one lesson that's really ours

Webflow's defining flaw is invisible *consequences*: edit one class and everything
sharing it changes; edit one breakpoint and others inherit silently. KIT•10 has the
**same shape of problem, deeper** — resolution across kits × axes × layers means one
render entry can ripple through many views, and a view override quietly beats a kit
layer. That cascade is our power and our Webflow-risk simultaneously.

The mitigation is already the right one and should be treated as core, not polish:
the Render/Axes **color + shape channels** (a property's hue = the layer key-set it
came from; the kit's icon = which kit) exist precisely to make *blast radius legible
before the user commits*. Webflow proves what happens without that signifier. So the
rule for Charter: whenever it introduces a field or op whose effect crosses view/kit/
layer boundaries, it must also surface *where the value comes from* — never let a
control mutate shared state with no cue to its scope. Charter declaring
`composition_field_keys` and letting the host color-code sources is exactly this
instinct; extend it, don't erode it.

## Bottom line

Charter should be **Framer's philosophy, on KIT•10's DOM-controls architecture, with
a Webflow-grade respect for cascade visibility that Framer never needed.** Concretely:

1. Name for intent, default hard, infer over expose. Raw-CSS field names are debt to
   pay down, not the goal.
2. Stay narrow. Preview translation only; let the plugin boundary hold the line
   against sprawl.
3. One field, one meaning. No mode-overloading, no unlabeled disclosure.
4. Feed the DOM real semantics (label + inputType) so controls are accessible by
   construction — the canvas is for rendering, not input.
5. Make cascade scope visible. Any control that touches shared kit/axis/layer state
   must signal where its value resolves from.

The other four each nail one axis and miss the rest. Charter's opportunity is that
KIT•10's architecture already positions it to hold all five at once — the work is
declining the shortcuts, not inventing new capability.

## See also

- [figma.md](./figma.md) · [penpot.md](./penpot.md) · [webflow.md](./webflow.md) · [framer.md](./framer.md)
