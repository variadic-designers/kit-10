# Charter Text primitive — a long-term affordance plan

> **Status: unbuilt, forward-looking plan (authored 2026-07-16).** Nothing
> below is implemented. Phase 1 (weight honesty via the font-facts channel)
> is the next planned Charter work. Sibling to
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

### Phase 2 — Weight stops being a free number

- `font-weight` gets `inputType: "weight"`: a picker whose options are the
  _actually available_ weights of the currently resolved family, from the
  same facts channel — named (Light / Regular / Medium / SemiBold / Bold /
  numeric for oddballs), only-pickable-if-exists.
- The editor learns nothing about fonts: the options are data, derived from
  facts the host already holds; the widget writes plain numbers Charter
  already parses. Free-typed numbers keep parsing (escape hatch), per the
  retired-fields precedent.
- Phase 1's substitution demotes from primary UX to safety net — it still
  covers stale values, axis-resolved weights, and family switches.
- _Payoff:_ the failure Phase 1 handles gracefully mostly stops being
  enterable at all.

### Phase 3 — Make Align and Decor real

- The two dead-end fields either work or leave. They should work: `TextData`
  gains `text_align` (cosmic-text `Align` maps directly) and decoration needs
  Vellum-side line drawing (underline/strikethrough quads next to the glyph
  quads — same shader, rects only).
- Panel: `text-align` becomes a four-icon segmented control (left / center /
  right / justify), `text-decoration` becomes toggles — both currently free
  text a designer must spell correctly into a field that does nothing.
- _Payoff:_ two lies removed; two raw strings retired from the surface.

### Phase 4 — Derived leading (the "reduce complexity" payoff)

- No new raw field by default: Charter computes `line_height` from
  `font-size` — the classic ratio ramp (≈1.5 at body sizes, tightening
  toward ≈1.1 at display sizes) — and emits it on a new `TextData` wire
  field, which replaces Vellum's hardcoded `* 1.2`.
- `compile_arrange`'s only-when-unset rule applies verbatim: an explicit
  `line-height` kit property (parse-only, no default surface) always wins;
  the derivation never fights an author.
- `letter-spacing` is the same shape _but not free_: cosmic-text has no
  native tracking, so Vellum would offset glyph quads itself post-shaping.
  Ship leading first; tracking only if wanted later.
- _Payoff:_ typography looks professionally set with zero new controls — the
  opinion is a default, not a field.

### Phase 5 — Typography as one grouped control

- Family / weight / size / leading collapse into a single `inputType:
"typography"` control using the same disclosure grammar as `arrange`
  (header → follow-ons → one labeled Advanced), replacing four top-level
  rows. Same `FieldDef` side-channel pattern as `arrangeKeys`/`resizeKeys`.
- Type-scale awareness (size snapping to a project scale) is deferred exactly
  like spacing's token-scale was: KIT•10 has no scale token type yet. The
  hook is documented, not built.
- _Payoff:_ the text category's first impression becomes one control + Fill +
  content, matching the layout category's post-arrangement density.

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
