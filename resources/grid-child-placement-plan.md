# Grid child placement - let a child declare which named area it sits in

Status: **SHIPPED 2026-08-08, in three passes.** Pass 1 shipped the raw `grid-area: <name>` string
field. Pass 2 (same day) shipped the parent-aware "Position in parent" dropdown this doc originally
researched - the doc's own "Why" complaint (a Stack/Cluster child inside a Grid parent had no
visible path to place itself) is now fixed. Pass 3 (same day, direct user feedback) then removed
the raw line/span placement mechanism ENTIRELY and renamed the field to `place` - see all three
reconciliation notes below for exactly what landed vs. what this doc's 2026-08-03 draft originally
proposed.

## Pass 1 (2026-08-08): the raw string field, no dropdown yet

The user first asked for the plain-string version ("just the string"), not the full parent-aware
dropdown below. Delivered as a genuinely new Charter-side property instead of this doc's original
finding #1 approach (writing `<name>-start / <name>-end` text directly into the existing
`grid-column`/`grid-row` fields via editor-side pattern-matching helpers):

- **`grid-area: <name>`** is a real property, parsed by `resolve_grid_axis`
  (`plugins/charter/src/lib.rs`) into the identical `NamedLine("<name>-start", 1)`/
  `NamedLine("<name>-end", 1)` pair on both `grid_column` and `grid_row` - same underlying
  named-line pipeline this doc's research already confirmed was wired end-to-end, just entered
  through one dedicated field instead of two raw line-pair fields holding lookalike text.
- Surfaced as a plain `FieldDef::new("grid-area", Some("Area"))` alongside `grid-column`/
  `grid-row` in every `extra`-carrying primitive's field list - at this point still nested inside
  the same "Custom tracks" disclosure gated on the CHILD's own arrange tab, i.e. the doc's core
  complaint was not yet fixed (fixed in Pass 2, same day).
- No editor/TS changes in this pass - no dropdown, no parent-lookup plumbing.

## Pass 2 (2026-08-08): parent awareness + child awareness of named areas

The user then explicitly asked for both halves this doc originally scoped: "we need parent
awareness at this point. we also need child awareness on available grid areas." Delivered close to
this doc's original "Planned approach", with two real deviations surfaced by fresh Explore-agent
verification before implementation:

- **Writes through `grid-area` directly**, not the two raw `grid-column`/`grid-row` strings step 1
  originally proposed - Pass 1 made that simpler, since the name is now stored as itself rather
  than needing to be pattern-matched back out of `<name>-start / <name>-end` text. This also means
  `areaNameFromPlacement`/`placementForArea` (this doc's originally-proposed helpers) were never
  needed - `grid-areas.ts` instead gained one new pure helper, `areaNamesFromParentMap(parentMap)`,
  which just decides "is this parent a Grid, and if so what are its area names."
- **A real correctness fix was required first**: `resolve_grid_axis` checked `grid-area` by
  presence, not emptiness, so a naive "clear to auto-placed" write of `""` would have produced a
  broken `NamedLine("-start")` that silently defeated the `grid-column`/`grid-row` fallback.
  Hardened (empty/whitespace now treated as absent, mirroring `parse_grid_line`'s own
  `s.is_empty()` philosophy) with a regression test before the dropdown's clear path was wired up.
  The dropdown's "(auto-placed)" option goes through a genuine field removal
  (`field-commit.ts`'s new `clearFieldValue`, wrapping `api.removePropertyFromLayer`) rather than
  writing an empty string either way, since presence-vs-emptiness bugs of this shape are easy to
  reintroduce elsewhere.
- **`Editor.svelte`'s `buildViewTree` call was hoisted into one shared `$derived`** (`viewTree`) -
  previously computed fresh inline inside the keyboard-nav handler only; the new
  `parentGridAreaNames` derived needed the same tree, so both now share one build per reactive tick
  instead of computing it twice.
- Everything else matches the original plan: `parentGridAreaNames: string[] | null` threaded
  `Editor.svelte` -> `Styles.svelte` -> `ArrangeField.svelte`; a new "Position in parent" section
  in `ArrangeField.svelte` rendered as a sibling BEFORE the `activeKind` tab branching (so it shows
  regardless of the child's own arrangement); `grid-column`/`grid-row`/`grid-area`/`justify-self`
  relocated out of the Custom-tracks disclosure into this new section's own raw-entry sub-disclosure
  (filtered out of `gridAdvanced` there to avoid double-rendering for a grid-in-grid child). **This
  raw-entry sub-disclosure was removed again in Pass 3, two messages later** - see below.

## Pass 3 (2026-08-08): drop the raw line/span escape hatch entirely, rename to `place`

User feedback, verbatim: "i don't like children being able to define columns and row extents on
where they can sit, i only want them to get a name on where they can sit. none of these
thing-start / thing-end they should just be place:thing." A deliberate scope NARROWING, not an
addition - the dropdown from Pass 2 already covered the actual use case; the raw fallback
underneath it (added "for power users" without being asked) is exactly what got pushed back on.

- **The property itself is renamed `grid-area` -> `place`.** Not just a label change: `place` is
  now the ONLY way to place a child, so `resolve_grid_axis` (which used to check `place`... no,
  `grid-area`, THEN fall back to parsing raw `grid-column`/`grid-row` text) collapses into
  `resolve_place`, which checks `place` alone and returns `(Auto, Auto)` when unset - no fallback
  branch, because there is nothing left to fall back to.
- **`parse_grid_line`/`parse_grid_line_pair` (the general CSS line/span/named-line parser) are
  deleted from Charter entirely**, along with their own unit tests - nothing calls them anymore.
  The `GridLine` enum itself (kit10-scene, shared with Vellum/taffy) is untouched - `place` still
  produces `GridLine::NamedLine`, same wire shape as always; only the AUTHORING path that could
  produce `GridLine::Line`/`Span`/`NamedSpan` from a Charter-parsed raw property is gone.
- **`place` is not declared as a `FieldDef` anywhere.** `grid-column`/`grid-row`/`grid-area`'s
  three-line `FieldDef` triple is deleted outright (not replaced) from all 5 primitives'
  `grid_advanced` lists - `place` is a bespoke property the Render panel's dropdown reads/writes
  by literal string key (`track('place')`/`resolvedMap.get('place')`), same pattern the dropdown
  already used for `grid-area` in Pass 2, needing no FieldDef backing since nothing renders it via
  the generic `fieldRow` snippet anymore.
- **`ArrangeField.svelte`'s "Position in parent" section loses its raw-entry sub-disclosure
  entirely** - the dropdown IS the whole UI now. `PLACEMENT_KEYS`/`placementFields`/
  `gridAdvancedWithoutPlacement` (Pass 2's filtering machinery) are all deleted; "Custom tracks"
  reverts to rendering `arrangeKeys.gridAdvanced` unfiltered, which naturally un-relocates
  `justify-self` back to its original home (it was never part of the user's complaint - alignment
  within a cell is orthogonal to which cell a child is in - so it stays put rather than getting a
  new home of its own).
- **`seed.ts`'s three grid demos (Forge's Class Grid, Meridian's Grid Slot axis + `lookbookCellKit`)
  were migrated from the old `grid-column`/`grid-row: "<name>-start / <name>-end"` two-line pattern
  to `place: "<name>"`** - these predated `place` (authored 2026-08-07, before any of this
  session's grid-child-placement work) using literal text that happened to match the naming
  convention `resolve_grid_axis` would later formalize. `seed.test.ts`'s one literal-value
  assertion updated to match (`property = 'place'`, `value = 'mobility'` instead of
  `property = 'grid-column'`, `value = 'mobility-start / mobility-end'`).
- **A real gap was caught and explicitly NOT silently patched, then fixed as its own step**:
  WebCodium's Path B (`plugins/webcodium/src/variants.rs`) exports a grid child's placement from
  raw, uncompiled kit properties via a hardcoded `DIFFABLE_PROPERTIES` whitelist - it already
  listed `grid-column`/`grid-row` (valid real CSS, safe to pass through literally) but had no
  entry for `place` (not a real CSS property at all - real CSS's own shorthand is `grid-area`).
  Flagged to the user before making the seed.ts change (per "stop if we missed something");
  fixed once the user confirmed. Naively whitelisting `place` would have emitted invalid CSS
  (`place: header;` isn't real CSS - `place-*` properties in real CSS are unrelated
  align+justify shorthands). **SHIPPED**: `place` added to `DIFFABLE_PROPERTIES`, `grid-column`/
  `grid-row` removed from it (Charter no longer authors either, so keeping them diffable would
  have let Path B silently export a declaration Path A no longer honors), and a new
  `css_property_name(property)` translation applied at the exact point
  `declarations_for_with_tokens` builds the final declaration string - `place: <name>` now emits
  real `grid-area: <name>;`, the property lookup itself (`DIFFABLE_PROPERTIES`/`format_value`/
  `token_vars`) still keyed by Charter's own `place` name throughout. Covered by 3 new tests: base
  declarations, variant-rule declarations (an axis-conditioned layer, mirroring seed.ts's actual
  usage), and a regression proving `grid-column`/`grid-row` now correctly fall through to the
  "unsupported" comment instead of silently passing through. `webcodium.wasm` rebuilt and
  deployed.

Known accepted limitations from the original plan still apply unchanged (see below) - neither pass
touched them.

## Why

The user tried to use Grid areas the way real CSS works - paint/name areas on the parent, then
have a child just declare which area it sits in - and found it unusable. The root cause is worse
than "no friendly dropdown exists":

**The only UI for grid placement (`Col Span`/`Row Span`, i.e. `grid-column`/`grid-row`) is nested
inside a "Custom tracks" disclosure that only renders when the CHILD'S OWN arrangement is set to
Grid** (`src/lib/editor/panels/ArrangeField.svelte:393-435` -
`{#if activeKind !== 'grid'} ...Advanced flex... {:else} ...Custom tracks (incl. Col Span/Row
Span)... {/if}`, where `activeKind` comes from `resolvedMap.get(field.key)?.value`, i.e. the
CHILD's own `arrange` property).

This conflates two orthogonal CSS concepts: "how do I arrange my own children" (the 5 tabs -
Stack/Cluster/Split/Center/Grid) vs. "where does my PARENT place me" (`grid-column`/`grid-row`/
`justify-self`, meaningful only when the parent is a Grid, entirely independent of the child's own
arrangement). A child that's naturally a Stack or Cluster (the common case - icon+label rows,
buttons, etc.) sitting inside a Grid parent has **zero path** to place itself into a specific
area, because its own arrange tab isn't Grid. That's the actual "I can't even use it."

## Research findings (both confirmed via Explore agents, 2026-08-03)

**1. This is achievable as a pure editor-UI change - no Charter/Vellum/wire changes needed.**

Real CSS's `grid-area: <name>` is pure named-line text substitution - exactly equivalent to
`grid-column: <name>-start / <name>-end; grid-row: <name>-start / <name>-end`, using the implicit
line names `grid-template-areas` already generates. This exact named-line placement pipeline
(`GridLine::NamedLine`) is **already wired end-to-end**:
- Charter parses it: `parse_grid_line`, `plugins/charter/src/lib.rs:1026-1057` (bare name -> `GridLine::NamedLine(name, 1)` at line 1054).
- Vellum/taffy resolves it: `taf_can_do/src/layout/mod.rs:107-114,292-300` (`gridline_to_placement` maps `NamedLine`/`NamedSpan` onto taffy's own `GridPlacement` variants), proven by an existing sidebar-placement test at `mod.rs:1149-1151`.
- WebCodium exports it back to real CSS: `css.rs:174-177,400-411`.

No `grid-area` shorthand exists anywhere in the stack today (`kit10-scene`'s `BoxExtra` only has
`grid_column`/`grid_row` as line-pairs, no single-name field; taffy itself has no `grid_area`
either - the caller resolves a name to lines). Confirmed no wire/parsing/taffy work is needed;
writing the two existing `grid-column`/`grid-row` string properties with `<name>-start /
<name>-end` text is sufficient and already round-trips correctly end to end.

**2. The parent-lookup plumbing needed already exists, just isn't threaded to a field.**

`parentOf` over the composition tree is already imported and used in `Editor.svelte`
(`buildViewTree(resolvedViews, compositionKeys, overriddenOccurrences)` at `Editor.svelte:453`,
`compositionKeys` derived at `:425` from `viewsPanelManifest?.composition_field_keys`). All
resolved data needed (the parent's `resolvedKits`) is already sitting in `resolvedViews` in
memory - `flattenKitResults` (same pattern `Styles.svelte:150-152` already uses) turns that into a
lookup map. This is new prop-threading, not a new resolve and not a resolver/Charter change.

**Exact prop path today** (what needs extending): `Editor.svelte`'s `resolvedViews` (`:129`) ->
derived `resolvedKits` (active view only, `:139-140`) -> `<StylesPanel {resolvedKits}
{selection} ...>` (`:938-950`) -> `Styles.svelte`'s `resolvedMap = flattenKitResults(resolvedKits)`
(`:150-152`) -> `<ArrangeField ... {resolvedMap}>` (`:359-367`).

The `arrange` property's literal key is `"arrange"` (`plugins/charter/src/lib.rs:1829`,
`FieldDef::new("arrange", Some("Arrangement"))`) - what a parent-context check reads to determine
"is my parent actually a Grid."

## Planned approach

**1. `src/lib/editor/panels/grid-areas.ts`** - add two pure helpers alongside the existing
`parseAreas`/`serializeAreas`/`paintArea`:
- `areaNameFromPlacement(gridColumn: string, gridRow: string): string | null` - recognizes the
  `<name>-start / <name>-end` pattern in both props and returns `name` if they agree, else `null`.
- `placementForArea(name: string): { gridColumn: string; gridRow: string }` - the inverse, for
  writing.

**2. `src/lib/editor/Editor.svelte`** - add a `$derived` (near the existing `resolvedKits`/
`compositionKeys` derivations) that computes the *parent* grid context for the currently selected
occurrence:
- Build the occurrence key the same way the keyboard-nav handler already does
  (`{viewId: activeViewId, occurrenceKey: selection.selectedOccurrencePrimary ??
  activeViewId}`), call `parentOf` against `buildViewTree(resolvedViews, compositionKeys,
  overriddenOccurrences)`.
- If a parent occurrence exists: look up its `resolvedKits` from `resolvedViews`, flatten via
  `flattenKitResults`, check `.get('arrange')?.value === 'grid'`. If so, parse
  `.get('grid-template-areas')?.value` via `parseAreas` and map to `.name`.
- Expose as one new prop, e.g. `parentGridAreaNames: string[] | null` (`null` = no Grid parent),
  passed into `<StylesPanel>` (~`Editor.svelte:938`).

**3. `src/lib/editor/panels/Styles.svelte`** - add `parentGridAreaNames` to the `StylesPanel` prop
type (~line 23) and thread it straight into `<ArrangeField>` (~line 359-367).

**4. `src/lib/editor/panels/ArrangeField.svelte`** - the main UI change:
- Add `parentGridAreaNames` to `ArrangeFieldProps`.
- New **"Position in parent"** section, rendered whenever `parentGridAreaNames !== null` - placed
  visually separate from, and NOT nested inside, the `activeKind` tab branching, so it's visible
  regardless of what the child's own arrangement tab is set to. Contents:
  - Derive `currentArea` via `areaNameFromPlacement` on the child's own resolved `grid-column`/
    `grid-row`.
  - A `<select>`: `(auto-placed)` plus each name in `parentGridAreaNames`. Picking a name calls
    `commitFieldValue` for both `grid-column` and `grid-row` via `placementForArea(name)`; picking
    `(auto-placed)` clears both.
  - A small disclosure underneath for raw line/span entry (power-user / non-named-area grids),
    reusing the *existing* `grid-column`/`grid-row`/`justify-self` `FieldDef`s already declared in
    `arrangeKeys.gridAdvanced` - same "friendly control + raw escape hatch stays underneath"
    pattern the rest of this field already uses.
- In the pre-existing "Custom tracks" disclosure (only shown when the child's *own*
  `activeKind === 'grid'`, e.g. a grid-in-grid), filter `arrangeKeys.gridAdvanced` to exclude
  `grid-column`/`grid-row`/`justify-self` when rendering that list - a plain client-side
  `.filter()`, avoiding those three fields appearing twice for a nested-grid child. No Charter
  change; the FieldDefs themselves are untouched, just not double-rendered.

## Known, accepted limitations (not planned for this pass)

- Renaming a parent's painted area does **not** cascade-update any child already pointing at the
  old name (stored as literal `<name>-start/-end` text) - it silently falls back to
  auto-placement, matching the caveat already flagged in `resources/grid-mastery-plan.md`. A
  follow-up, not in scope here.
- A view referenced by multiple different Grid parents (DAG): the dropdown's option list reflects
  the *currently selected occurrence's* parent (best-effort), but the write is still view-scoped -
  identical to how every other Render-panel field already behaves per CLAUDE.md's "Active stays
  view-level" rule. Not a new limitation introduced by this change.

## Verification (once implemented)

No Rust/wasm involved, so no rebuild-and-copy step.
1. `npm run check` (svelte-check) across the touched files - 0 errors.
2. `npm run test:unit -- --run` - confirm nothing in existing Grid/Arrange/Styles test coverage
   regresses; add unit tests for `areaNameFromPlacement`/`placementForArea` round-tripping
   alongside the existing `parseAreas`/`serializeAreas` tests.
3. Per `feedback_no_self_browser_verification` - do not self-verify visually. Ask the user to:
   build a Grid parent, paint 2+ named areas (existing painter, unchanged), add a Stack- or
   Cluster-arranged child inside it, select the child, confirm the new "Position in parent"
   section now appears (it previously would not, regardless of tab) with a dropdown listing the
   parent's area names, and confirm picking one visually moves the child into that area in the
   viewport.
