# Charter Text primitive — a long-term affordance plan

> **Status: Phases 1–4 shipped (Phase 2 partially), all 2026-07-16,
> UX-scoped; Phase 5 remains forward-looking plan.** The font-facts
> channel is live: Fontavious's `family_facts`, the host-assembled
> `fontFacts` map on `on_resolve`, Charter's `resolve_font_weight` +
> `snap_text_weights`, and the `font_requests` output driving the editor's
> font fetching — see CLAUDE.md's weight-snapping note for the
> implementation. `font-weight` is now `inputType: "weight"` —
> `WeightField.svelte` renders a segmented row of named-weight buttons
> (same grammar as `arrange`'s tabs), filtered to the resolved family's
> real weights via `fontFacts`. `text-align`/`text-decoration` are real:
> Vellum's `TextData`/`TextAreaData` gained `text_align`/`text_decoration`
> wire fields (`taf_can_do` commit 2efd8a5), rendered via cosmic-text's own
> alignment parameter and per-span decoration system (real font-metric
> offset/thickness, not a guessed baseline), and Charter's
> `parse_text_align`/`parse_text_decoration` + `inputType: "align"`/
> `"decoration"` give them real four- and three-icon segmented panel
> controls — see CLAUDE.md's Phase 3 note for the implementation. Three
> deliberate deviations from the plan below, all "UX first, not
> data-integrity yet": **facts are catalogue-only** — the Vellum
> `font_facts`-from-loaded-bytes oracle (Phase 1's uploaded-font leg) is
> deferred until font uploads exist; **Phase 2 shipped without a
> raw-numeric escape hatch** — unlike Arrangement's Advanced disclosure (a
> genuinely separate raw field), font-weight has no companion raw property
> to expose since it IS the raw property, so the picker is the only panel
> surface now (parsing itself is untouched — an oddball DB/import/seed
> value still resolves and still gets Phase 1's snap, just isn't
> free-typable from this panel); and **decoration stayed single-choice**
> (None/Underline/Line-through as one segmented control, matching the
> wire's `TextDecorationKind` enum) rather than Phase 3's original
> "toggles" language, since the wire never modeled underline and
> line-through as independently combinable in the first place. **Phases
> 4–5 were refined 2026-07-16** into a single combined design, and
> **Phase 4 shipped the same day**: `line-height` is a real concrete
> `f32` wire field (`taf_can_do` commit 3a50b8b — `TextData`/
> `TextAreaData.line_height`, threaded through `shape_area`,
> `measure_text_node`, `hash_area`, the `TextMeasureKey` cache, and
> `project_text_area`'s zoom scaling — see CLAUDE.md's Phase 4 note) and
> Charter's `compile_line_height` (same only-when-unset rule as
> `compile_arrange`; a bare number is a CSS-style multiplier of
> `font-size`, a `px` value is absolute, unset derives the ratio ramp).
> **Deviation from the refined plan, same day, by explicit user request:**
> a standalone panel row shipped anyway
> (`FieldDef::new("line-height", Some("Leading"))`, no `inputType` —
> plain free text, same as
> `font-size`, deliberately not a numeric stepper, since a stepper always
> writes a bare number and would silently collide with
> `compile_line_height`'s CSS-style dual reading). "Just for line-height,
> defer Phase 5" was the ask — so Leading is live in the panel now, ahead
> of and independent from Phase 5's grouping. Phase 5 below, if it ships
> later, is expected to fold this `FieldDef` into `typographyKeys` rather
> than leave it a permanent 6th top-level row. Phase 5 itself anchors one
> `FieldDef` on `font-family` (`inputType: "typography"` +
> `typographyKeys`, the `arrangeKeys`/`resizeKeys` pattern) so Family,
> Size, Weight, Line height, Align, and Decor collapse into **one header +
> follow-ons** — one panel "place," matching Arrangement's own shape —
> while each follow-on keeps resolving and coloring independently (the
> Webflow cascade-visibility principle is not negotiable, even for layout
> consolidation). Phase 5 itself remains unbuilt, assessed **low-risk** (a direct
> reuse of the already-proven `ArrangeField`/`ResizeField` pattern), so
> this holds by default. **Phase 6 (added 2026-07-16, contingency only,
> not planned to build)** documents what a true single-resolved-property
> collapse would require and cost, as a fallback if Phase 5's per-row
> coloring proves confusing in real use — deliberately not a next step.
> Sibling to
> [layout-affordances.md](./layout-affordances.md), whose phases 1–5 all
> shipped; this doc applies the same method — earn opinions, retire raw
> debt, one `compile_*` + widget per keyword contract — to the `Text`
> primitive.

An opinion piece. The Text primitive is the highest-frequency thing a designer
touches after layout, and it is currently the lowest-tech corner of Charter:
half its panel fields are raw CSS strings, two of them are literally dead ends,
and the one genuinely hard problem (font weights that don't exist) is being
"solved" by a silent substitution three layers down that the panel never hears
about. The plan below is mostly _subtractive_ — derived defaults and
only-pickable-what-exists controls in place of free-text fields — because the
complexity here is accidental, not essential.

---

## Where the Text primitive is today

**Panel surface (`text_categories()`):**

```
content                     → token-backed plain string        ✅ fine as-is
color           "Fill"      → raw hex                          ✅ fine (color is color)
font-family     "Family"    → inputType "font" + Fontavious    ✅ the one modern control
font-size       "Size"      → raw length                       ⚠️ raw, no scale opinion
font-weight     "Weight"    → raw number                       ⚠️ free text; can name weights
                                                                  that don't exist ("600" on Lato)
text-align      "Align"     → raw string                       ❌ DEAD END — never parsed,
text-decoration "Decor"     → raw string                       ❌ never reaches the wire
highlight category          → background/border/radius/padding ✅ real (Text carries paint)
```

**Wire (`TextData`):** `content`, `font_size`, `font_family`, `font_weight: u16`,
`font_style: String`, `text_color`, plus the shared paint fields. No alignment,
no decoration, no line-height, no letter-spacing.

**Runtime facts the plan builds on:**

- **Weight substitution already happens, silently.** cosmic-text's font
  matching picks the closest _loaded_ weight of the family at shaping time.
  Ask for 600 on Lato (which only ships 400/700) and you get one of those —
  pixels never break, but the panel says 600, the wire says 600, and nothing
  anywhere admits the lie. `fetch_font` returns a "no variant" error that is
  `console.warn`'d and dropped.
- **Line-height is a hardcoded constant** — `font_size * 1.2` in Vellum
  (`taf_can_do/src/render/mod.rs`, `shape_area`'s metrics). No knob exists at
  any layer.
- **Vellum's font surface is deliberately dumb:** `load_font(bytes) →
Vec<String>` (family names) and family-only `is_font_loaded(name)`. The old
  `is_font_variant_loaded` (swash `wght`-axis introspection) was removed when
  the resolve-time scan moved to asking Fontavious `variant_url` instead —
  Vellum stopped answering catalogue-shaped questions (see CLAUDE.md's
  Fontavious section). Phase 1 re-adds introspection but with a different
  contract: _describe the bytes you loaded_, never _what exists in the world_.
- **Fontavious's catalogue already models weight as a range**
  (`weightMin`/`weightMax` per variant) — it knows Lato has exactly 400/700
  before anything is fetched.

---

## The design premise: honesty, then subtraction

Two ideas drive every phase:

1. **Panel = wire = pixels.** A control must state what will actually render.
   Today the weight field can hold a number no font file backs, and the align
   field edits a property nothing reads. Every phase either makes a field
   honest or removes it from the default surface.
2. **The user should pick from what exists, not free-type into the void.**
   The family picker already works this way (Fontavious suggestions). Weight
   should too. Where a value is genuinely continuous (size), the default
   should be _derived_ (leading from size) rather than another empty box.

---

## The core move: the font-facts channel

The recurring question — "what weights/styles does this family actually
have?" — has **two different oracles**, and using the wrong one is the trap:

- **Fontavious's catalogue** knows what is _fetchable_: the full variant set
  of a catalogued family, before any file has loaded. This is the right
  oracle for substitution decisions — deciding off loaded-bytes alone makes
  the choice flip as files stream in (600→400 while only the 400 file has
  landed, then 600→700 a second later when 700 arrives: a visible
  double-jump on every family switch).
- **Vellum's loaded bytes** are the _only possible_ oracle for fonts that
  exist purely as bytes — user-uploaded WOFF2s (a future asset type) have no
  catalogue entry. A `font_facts(family)` export (the swash `wght`-axis walk
  `is_font_variant_loaded` used to do, returning ranges + styles instead of a
  boolean) covers these.

**The host assembles the map — catalogue first, loaded-bytes for anything
uncatalogued — and hands it to Charter inside `on_resolve`'s payload**, the
same way `viewHints` already ride along. Charter never calls Vellum or
Fontavious (it has no channel to either; the host mediates everything), and
neither renderer nor catalogue ever decides _policy_ — Charter does:

```
font_facts: {
  "Inter":  { variants: [{ weightMin: 100, weightMax: 900, style: "normal" }], source: "catalogue" },
  "Lato":   { variants: [{ weightMin: 400, weightMax: 400 }, { weightMin: 700, weightMax: 700 }], source: "catalogue" },
  "MyUpload": { variants: [{ weightMin: 400, weightMax: 400 }], source: "loaded" }
}
```

Implementation cautions, learned the hard way elsewhere in this repo:

- **Facts are not DB rows**, so the live-query `rowsKey` dedup never sees
  them. A facts change (a font finished loading, the catalogue answered) must
  force its own `setData` — otherwise Charter keeps deciding off stale facts
  until an unrelated DB write happens to fire a resolve.
- **Exactly one implementation of "nearest weight" may exist.** If Charter
  snaps 600→700 but the resolve-time font scan still asks `variant_url` for
  600, the scan warns and fetches nothing while Charter confidently emits a
  weight whose file never loads. The fix is structural: after Phase 1 the
  scan should fetch the **concrete weights Charter emitted** (read off the
  viewport output), not the requested weights in resolved props — then
  Charter's `resolve_font_weight` is the single decision point and the scan
  is just its supply chain.
- Vellum's `font_facts` needs swash's `variations()` API — re-adding `swash`
  as a direct dependency of `taf_can_do` (it's already transitive via
  cosmic-text) is the documented precedent, not a smell.

---

## Phased roadmap

Each phase is independently shippable. Phases 1, 3 and 4 touch the Vellum
wire, so each is a two-repo commit (source → `taf_can_do`, rebuilt artifacts
→ `kit10`) per CLAUDE.md's WASM-deploy pitfall.

### Phase 1 — Weight honesty (the font-facts channel)

- **Vellum:** `font_facts(family)` export — weight ranges + styles of loaded
  faces, via swash introspection. Describes bytes, answers nothing about the
  catalogue.
- **Fontavious:** `family_facts(family)` export — the variant ranges the
  catalogue already holds (data `variant_url` consults today), JSON in/out,
  no HTTP.
- **Host:** assemble the facts map (catalogue ∪ loaded), attach to
  `on_resolve` input, refresh + force a re-resolve when it changes.
- **Charter:** `resolve_font_weight(requested, facts)` — the CSS
  font-weight-matching algorithm (exact → below-then-above for <400,
  above-then-below for >500, the 400↔500 special case), ~20 lines, unit
  tested. `build_text_node` emits the _resolved_ weight on `TextData`. The
  stored kit value is never rewritten — substitution is a render decision,
  not a DB write.
- **Editor:** the resolve-time scan fetches Charter's emitted weights (see
  the caution above).
- _Payoff:_ panel, wire and pixels agree; the "Lato has no 600" case becomes
  a deterministic 600→700, decided in one named function instead of deep in
  cosmic-text's matcher. cosmic-text's own fallback remains as the last-line
  safety net for the not-yet-loaded window.

### Phase 2 — Weight stops being a free number — **shipped, partially**

- **Shipped:** `font-weight` is `inputType: "weight"` (Charter just names
  the kind; it carries no companion keys, unlike `arrangeKeys`/
  `resizeKeys`, since the choices are runtime facts Charter doesn't hold).
  `WeightField.svelte` renders the nine standard named weights (Thin 100 …
  Black 900) as a wrapping button row, filtered client-side to what the
  resolved family's `fontFacts` entry actually covers — Lato: `[400, 700]`;
  Inter's 400–700 variable range: `[400, 500, 600, 700]`. An uncatalogued
  family (no facts entry) falls back to the full unfiltered set — Charter's
  own "no facts, no opinion" rule, applied client-side too.
- **Not shipped:** a raw-numeric escape hatch. Arrangement's Advanced row
  works because Advanced exposes a genuinely _separate_ raw property
  (`flex-direction` etc.) alongside the friendly control. `font-weight` has
  no such pair — the picker writes the exact same property a raw field
  would — so there is no raw sibling to reveal, and the picker is simply
  the only panel surface for this property now. A value written outside
  the panel (DB edit, import, seed) is untouched — parsing doesn't care
  where a value came from — and still gets Phase 1's render-time snap; it
  just can't be typed from here anymore, which is the intended tightening.
- Phase 1's substitution demotes from primary UX to safety net — it still
  covers stale values, axis-resolved weights, and family switches (the
  moment between picking a new family and its facts landing).
- _Payoff, realized:_ the failure Phase 1 handles gracefully mostly stopped
  being enterable at all, from the panel.

### Phase 3 — Make Align and Decor real — **shipped**

- **Shipped:** `TextData`/`TextAreaData` gained `text_align`
  (`taf_can_do` maps it straight onto cosmic-text's own `Buffer::set_text`
  alignment parameter) and `text_decoration` — decoration draws via
  cosmic-text's native per-span decoration system (`Attrs::underline`/
  `.strikethrough()`, real font-metric offset/thickness read back off
  `run.decorations`), not a hand-rolled geometry heuristic as originally
  scoped here. The quads reuse the glyph shader/buffer as a new solid-fill
  `mode`, rather than a separate box-shader draw call.
- **Shipped, with one shape change:** `text-align` is the planned four-icon
  segmented control (left / center / right / justify). `text-decoration`
  shipped as a **three-way segmented control** (none / underline /
  line-through), not independent toggles — the wire's `TextDecorationKind`
  is a single enum (Charter's `text_categories()` has always declared
  "Decor" as one field, never two), so toggles would have implied a
  combinability the data model never had.
- _Payoff, realized:_ two lies removed; two raw strings retired from the
  surface.

### Phase 4 — Derived leading, a real `line-height` wire field — **shipped**

- **Shipped: concrete wire field, not an `Option`.** `TextData`/
  `TextAreaData` gained `line_height: f32` — always a resolved absolute
  px value, same convention `font_size` already uses. `≤ 0.0` is the
  "not provided" sentinel (the `font_weight` `if > 0 { .. } else { 400 }`
  idiom, already established elsewhere in `taf_can_do`) rather than an
  `Option` — a stale, not-yet-redeployed Charter build degrades to the
  old hardcoded `font_size * 1.2` ratio instead of a hard deserialize
  failure. Both consumption sites — `shape_area` (actual rendering) and
  `measure_text_node` (taffy's layout measure pass) — read it with the
  identical fallback, since they must agree exactly or the box taffy
  sizes at layout time disagrees with what render draws. `hash_area` and
  the taffy `TextMeasureKey` cache both include it now (changes glyph
  vertical position / `content_height`, not just post-cache state), and
  `project_text_area` scales it by `view_zoom` identically to
  `font_size` (the `0.0` sentinel scales to `0.0`, so the fallback
  survives projection at any zoom level).
- **Shipped: `compile_line_height(font_size, raw) -> f32`** — the
  only-when-unset rule verbatim from `compile_arrange`/`compile_resize`:
  an explicit raw `line-height` kit property always wins (parsed
  CSS-style — a bare number is a multiplier of `font-size`, e.g. `"1.5"`
  → `font_size * 1.5`, deliberately not routed through `parse_px`, which
  reads a bare number as literal px; a `px` value is absolute, e.g.
  `"24px"`); absent or unparseable, Charter derives it via a ratio ramp
  (1.5× flat at ≤20px body sizes, tightening linearly to 1.1× flat at
  ≥48px display sizes).
- **Deviation, shipped same day by explicit user request: a standalone
  panel row after all.** The original plan here was "no `FieldDef` of
  its own — reduce complexity, zero new controls by default." The user
  asked to surface it in the panel now anyway, deferring only Phase 5's
  grouping. `FieldDef::new("line-height", Some("Leading"))` carries no
  `inputType` — plain free text, same as `font-size`, deliberately not a
  numeric stepper: the existing `spacing` scalar stepper (`gap`/
  `cell-min`) always writes a bare number, which would silently collide
  with `compile_line_height`'s CSS-style dual reading (bare = multiplier,
  `px` = absolute) — free text is what lets a designer type either form
  directly, matching real CSS line-height authoring. Verified live:
  typing `"1.4"` and separately `"48px"` both round-trip through the DB
  write correctly. Expected to fold into Phase 5's `typographyKeys` as a
  follow-on rather than staying a permanent 6th top-level row, whenever
  Phase 5 ships.
- `letter-spacing` stays out of this phase — cosmic-text has no native
  tracking, so it would mean Vellum manually offsetting glyph quads
  post-shaping, a materially bigger change than `line-height`'s "pass a
  different number to `Metrics::new`". Revisit only if a real design needs
  it.
- _Payoff, realized:_ typography looks professionally set with zero new
  default controls — the opinion is a default, not a field. (Not yet
  independently visually confirmed on the actual GPU canvas — this
  session's headless container has no WebGPU; verified instead via 6 new
  Charter unit tests asserting exact `compile_line_height` output across
  the ramp's anchors/midpoint/both raw-value forms, 3 new Vellum tests for
  hash invalidation and zoom-scaling correctness, and a live app smoke
  test across several text views at different font sizes with zero
  console errors post-deploy.)

### Phase 5 — Typography as one grouped control, one layer-bound "place" (refined plan)

The concrete ask this refines: today Family / Size / Weight / Align / Decor
are five separately-headered rows, each its own header-row-and-track-dot —
five "places" a designer has to scan. Collapse that to **one panel slot**,
the same way Arrangement collapsed the flex quartet into one slot — without
pretending the five properties are actually one property underneath.

- **Charter declares one `FieldDef`, anchored on `font-family`** — the
  property every Text node always has, same anchoring logic `resize` uses
  for width/height. It carries `inputType: "typography"` and a
  `typographyKeys` side-channel (same "typed side-channel keyed by
  inputType" shape as `arrangeKeys`/`resizeKeys`): `size` (font-size),
  `weight` (font-weight — keeps its own `inputType: "weight"` untouched,
  so `WeightField`'s per-family fact-filtering keeps working exactly as it
  does today), `lineHeight` (Phase 4's new field), `align`, `decoration`.
- **`TypographyField.svelte`** (new, mirrors `ArrangeField`'s shape): one
  header — track dot + label — clicking it opens the family `SuggestField`
  picker in place (the header doubles as the always-visible primary
  control, same as Arrangement's tab row being both the selector and the
  visible state). Every follow-on renders directly below as an ordinary
  `StyleField` row — no `<details>`/Advanced disclosure needed here,
  unlike Arrangement or Resize, because there is no raw-vs-friendly split
  left to hide: weight/align/decoration are already the friendly controls
  (Phases 2–3 already retired their raw equivalents from the surface), and
  size/line-height/family have no rawer form to begin with.
- **What actually collapses is panel real estate, not resolution.** Each
  follow-on stays its own independently resolved property with its own
  track dot/color — exactly how `resize`'s Min/Max and `arrange`'s
  Gap/Direction already behave today. If a density axis layer overrides
  only `font-size`, that row's dot shows the density layer's hue while
  Family's dot still shows the base layer's. Collapsing every follow-on
  into one synthetic color would erase real cascade information —
  precisely the charter.md Webflow lesson (principle 8 in
  layout-affordances' own list) this plan has followed at every prior
  phase. "One place" is a layout decision, not a resolution-model change.
- Type-scale awareness (size snapping to a project scale) stays deferred —
  no scale token type exists yet. The hook is documented, not built.
- **Risk assessment: low.** This phase is a straight application of an
  already-proven pattern — `ArrangeField.svelte`/`ResizeField.svelte`
  already wrap a header + independently-tracked follow-on rows today, so
  `TypographyField.svelte` has no new architecture to invent, only a new
  `FieldDef`/`*Keys` shape and a new Svelte component copying the existing
  one. Nothing here is expected to need the Phase 6 fallback below.
- _Payoff:_ the text category shrinks from 5 typography rows + Highlight's
  4 rows (9 total) down to 1 typography control + Fill + Content +
  Highlight — matching the layout category's post-arrangement density
  (CLAUDE.md: `box_categories()`'s layout category went from ~19 fields to
  4).

### Phase 6 — True single-layer collapse (contingency, not a default target)

Not planned to build proactively. Phase 5's per-follow-on independent
resolution/coloring is a **deliberate correctness choice**, not a stopgap —
but it's captured here as an explicit fallback in case a real usage pattern
proves it wrong in practice (e.g. designers consistently editing all five
Typography properties together, on one layer, and finding five different
track dots more confusing than reassuring for a control that reads as "one
thing" at a glance).

- **What it would actually mean:** collapsing Typography's sub-properties
  onto **one genuinely shared resolved value** — not five independently
  resolvable properties any more, but a single property (e.g. `typography`,
  holding a bundled value, or every follow-on's write forced onto
  `font-family`'s own `sourceLayerId` regardless of which layer would
  naturally own that specific property) — so the whole group shows exactly
  one track dot, because it structurally _is_ one thing to the resolver,
  not five things wearing one label.
- **The real cost, stated plainly:** this sacrifices the cascade-visibility
  principle every other phase in this plan (and `layout-affordances.md`
  before it) has held as non-negotiable — a density-axis layer overriding
  only `font-size` would become invisible as a distinct fact; the panel
  would show "Typography: Base layer" even while one sub-value diverges
  per-axis underneath. That's real information loss, not just a visual
  simplification, so this is not a phase to build "for tidiness" — only
  in response to a demonstrated problem with Phase 5's actual UX in use.
- **If it is ever built:** it likely needs its own resolver-level concept
  (a composite/bundled property type), not just a panel trick — the
  resolver would need to understand "these five kit properties are written
  and read as one unit" as a first-class idea, which is a bigger change
  than anything else in this document. Scope it properly against
  `resolve.ts`'s actual capabilities before starting, rather than assuming
  it's a small follow-on to Phase 5.

---

## What stays out of scope (deliberately)

- **Rich text / inline spans.** A `Text` node is one run of one style.
  Mixed-style text is composition (multiple Text views in a Cluster), not a
  span tree — revisit only if real designs prove that insufficient.
- **`em`/relative units** — still unsupported by the parsers, unchanged here.
- **Font uploads as assets** — a separate feature; this plan only ensures the
  facts channel won't need redesigning when it lands (`source: "loaded"` is
  already the uncatalogued path).
- **OpenType feature flags (ligatures, small caps…)** — real "features" a
  future `font_facts` could report, but no phase here surfaces them; don't
  confuse them with the weight/style facts Phase 1 needs.

---

## Principles this plan commits to

1. **Panel = wire = pixels.** No control states a value the renderer isn't
   actually using; no dead-end fields.
2. **Pick from what exists.** Enumerable choices (weights, styles) come from
   facts, not free text.
3. **Facts flow host-mediated.** Charter never calls Vellum or Fontavious;
   the host assembles the facts map into `on_resolve`'s payload. Vellum
   describes its loaded bytes; Fontavious describes its catalogue; Charter
   alone decides.
4. **One decision point per policy.** Nearest-weight matching lives in
   exactly one function (Charter's); everything else consumes its output.
5. **Derived defaults, only-when-unset.** Leading (and later tracking) are
   computed opinions with parse-only escape hatches — never unconditional
   forces, same rule as `compile_arrange`.
6. **Escape hatches parse forever.** Raw `font-weight` numbers,
   `line-height`, `text-align` strings keep working when typed/stored; they
   just stop being the default surface.
7. **Every wire change is a two-repo commit** — Vellum source and rebuilt
   artifacts land together or the browser runs a stale contract.

---

## See also

- [layout-affordances.md](./layout-affordances.md) — the shipped sibling plan
  this one's method comes from
- [charter.md](./charter.md) — raw-CSS-as-debt, the earn-an-opinion north star
- [text.md](./text.md) — Vellum's glyph rendering internals (MTSDF/bitmap),
  the layer _below_ everything here
- CLAUDE.md — Fontavious section (catalogue/variant model, why Vellum stopped
  answering catalogue questions), WASM deploy pitfall, `compile_resize`/
  `compile_arrange` precedents
