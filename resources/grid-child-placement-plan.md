# Grid child placement - let a child declare which named area it sits in

Status: **DRAFT, not started.** Researched and planned 2026-08-03; execution deferred.

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
