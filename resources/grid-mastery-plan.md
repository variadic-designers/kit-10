# Grid mastery - expanding CSS Grid into a full-featured layout system

Status: **Phase 1 SHIPPED 2026-07-31.** Wire format, Charter parsing, Vellum render + overlay,
WebCodium export parity, and a first editor UI pass are all live. See "What's next" for the
deliberately deferred pieces.

## Why

The Render panel's Grid arrangement used to be one narrow preset ("Cell Min + Gap", a responsive
`repeat(auto-fit, minmax(Npx, 1fr))`) plus a raw-text "Custom tracks" escape hatch. Real CSS Grid
capability (arbitrary `minmax()`, percent/fit-content tracks, `repeat(auto-fill, ...)`, named
lines, `grid-template-areas`, `grid-auto-flow`, `justify-items`/`align-content`/`justify-self`)
was entirely unreachable except by hand-typing raw CSS into that one text field.

Research confirmed the bottleneck was never the renderer: taffy 0.10.1 (Vellum's layout engine)
already supports all of the above natively. The real ceiling was the shared `kit10-scene` wire
vocabulary and Charter's parsing/field surface.

## What shipped

### 1. Wire format - `kit10-scene@v0.2.0`

- `TrackSize` gained `Percent(f32)`, `FitContent(f32)`, `AutoFill(f32)` (repeat(auto-fill, ...),
  `AutoFit`'s sibling), and `MinMax(TrackMin, TrackMax)` for arbitrary `minmax(a, b)` - two new
  non-recursive bound enums (`TrackMin`/`TrackMax`) instead of a self-referential `TrackSize`,
  which keeps `TrackSize` `Copy`.
- `GridLine` gained `NamedLine(String, i16)` / `NamedSpan(String, u16)` (mirrors taffy's own
  `GridPlacement` variants) - this made `GridLine` lose its `Copy` derive (an owned name can't be
  `Copy`), a real breaking change every consumer had to absorb.
- New `GridTemplateArea` (name + 4 line coordinates) and `GridAutoFlow`
  (`Row`/`Column`/`RowDense`/`ColumnDense`) wire types.
- `BoxExtra` gained `grid_template_areas`, `grid_auto_flow`, `justify_items`, `align_content`
  (container-level), `justify_self` (item-level).
- Closed a real version-drift bug in passing: `webcodium` and `charter` were both still pinned to
  `kit10-scene v0.1.0` while `taf_can_do` was on `v0.1.2` (identical shape at the time, but a
  latent landmine). All three now pin `v0.2.0`.

### 2. Charter (`plugins/charter/src/lib.rs`)

- `parse_track`/`parse_track_list` extended for `%`, `fit-content()`, `minmax()`,
  `repeat(auto-fill, ...)`. Found and fixed a real tokenizer bug in the process: naive
  `split_whitespace()` shredded `repeat(auto-fit, minmax(160px, 1fr))`'s own internal spaces into
  unparseable fragments - replaced with `split_respecting_parens`, a depth-tracking tokenizer.
- `parse_grid_line`/`parse_grid_line_pair` extended for named lines (`sidebar-start`, `sidebar 2`)
  and named spans (`span content`, `span 2 content`).
- New `parse_grid_template_areas` parses real CSS's quoted-row syntax
  (`"a a" "b b"`) into resolved line coordinates - the parser the editor's area painter output
  round-trips through, so a painted layout always stores as genuine, spec-correct CSS text.
- `ArrangeKeys` gained 6 new fields (`gridColumns`, `gridRows`, `gridAreas`, `gridAutoFlow`,
  `gridJustifyItems`, `gridAlignContent`) - full `FieldDef`s, same pattern `gap`/`cellMin` already
  use, so the editor never hardcodes a property key.
- `has_box_props` (used by `detect_primitive`) closed a pre-existing gap: only
  `grid-template-columns/rows`/`grid-cell-min` counted as box-forcing, so a node with only
  `grid-auto-columns`/`grid-column`/etc set was misdetected as text.

### 3. Vellum (`taf_can_do`)

- `apply_box_extra` wires all 5 new `BoxExtra` fields onto real taffy `Style` fields - mechanical,
  taffy 0.10.1 already supports every one of them.
- **Deliberate partial ship**: `NamedLine`/`NamedSpan` item PLACEMENT resolves end-to-end, but line
  name DECLARATION (a separate taffy `Style` field, `grid_template_column_names`/`_row_names`)
  isn't wired. An unresolved name gracefully falls back to `auto` (confirmed via taffy's own
  `into_origin_zero`, never a panic), so this is safe to ship incomplete. Named *areas* (which the
  editor's painter targets) don't depend on this at all.
- New grid-line canvas overlay: for a hovered/selected Grid box, draws every resolved track
  boundary (not just internal gutters) plus 1-indexed line-number labels, reusing
  `LayoutResult::grid_info` already captured for the box-model hatch work.
  - `HatchInstance` gained a `mode` field (0.0 = diagonal hatch, 1.0 = solid fill) so the new lines
    ride the exact same pipeline/buffer/shader as the padding/gap hatch - no new GPU resources.
  - Line-number labels use the same `desired_screen_px / view_zoom` trick
    `rebuild_selection_instances` already uses for its corner handles, so they stay legible at any
    zoom.
  - **Needs zero editor-side wiring** - hover/selection state already travels with scene data via
    the existing `set_data` path, so the overlay appears automatically. No new `#[wasm_bindgen]`
    export, no `Viewport.svelte` changes.
  - **Deliberately deferred**: highlighting a selected child's own resolved line span via the
    currently-unread `DetailedGridInfo::items` field. Mapping it back to a specific child requires
    replicating taffy's exact in-flow/non-absolute child filter+order - flagged as a real
    follow-up rather than risking a subtly-wrong implementation under time pressure.

### 4. WebCodium (`plugins/webcodium`)

- Path A (`css.rs`): `track_size_css`/`track_size_non_repeated_css`/`grid_line_css` extended for
  every new variant; new `grid_auto_flow_css` and `grid_template_areas_css` (the exact inverse of
  Charter's `parse_grid_template_areas`); `node_props` emits all 5 new fields.
- Path B (`variants.rs`): the 5 new properties added to `DIFFABLE_PROPERTIES` - same "raw stored
  value is already valid CSS" passthrough treatment the existing `grid-*` entries use. Closes the
  same class of gap the 2026-07-27 audit found for `grid-auto-rows/columns`/`grid-column/row`.

### 5. Editor UI (`src/lib/editor/panels/`)

- **`GridTracksField.svelte`** - ordered track-list builder for columns/rows. Add/remove/reorder
  (up/down buttons, not drag-and-drop yet), each track picks a kind (Fixed / Fraction / Auto /
  Min / Max / Percent / Fit-content / Responsive-fit / Responsive-fill) via a select. Backed by
  `grid-tracks.ts` (`parseTrackList`/`serializeTrackList`), a direct TS port of Charter's
  `parse_track`/`track_size_css` including the paren-respecting tokenizer fix.
- **`GridAreaPainter.svelte`** - a live mini-grid matching the box's own current column/row track
  count; click-drag paints a rectangular region into an auto-named, inline-renamable area. Backed
  by `grid-areas.ts` (`parseAreas`/`serializeAreas`/`paintArea`), mirroring Charter's parser and
  WebCodium's serializer so a painted layout always round-trips as real CSS text.
- `ArrangeField.svelte`'s Grid tab gained both track builders, a Row/Column + Dense segmented
  control for `grid-auto-flow`, and select-based pickers for `justify-items`/`align-content`. The
  raw "Custom tracks" disclosure stays underneath, unchanged - the friendly controls and the raw
  text field are two views onto the same properties, per `layout-affordances.md`'s "advanced, not
  first contact" stance.
- 4 new `InputType` members (`grid-tracks`, `grid-area-painter`, `grid-auto-flow`, `align-picker`).

## What's next (not started)

- **True drag-to-reorder** for the track list (currently up/down buttons - functional, not as
  fluid).
- **A dedicated per-item span control** (a friendly stepper for `grid-column`/`grid-row` on a Grid
  child) - needs new "is my parent a grid" context `ArrangeField` doesn't have yet; the raw
  `grid-column`/`grid-row` fields in "Custom tracks" are the only way to set spans today.
  Once a child is placed via `grid-area`, a named-area dropdown (populated from the painted area
  names) should replace raw span entry for that child - not built yet.
- **Named-line declaration** - the wire vocabulary and item placement exist, but nothing lets a
  user actually DECLARE a name against a track position yet (would need a new `BoxExtra` field
  mirroring taffy's `grid_template_column_names`/`row_names`, plus Charter parsing of the real
  `[name] <track> [name] ...` bracket syntax, plus editor UI - likely a "name tag" affordance on
  each `GridTracksField` row). Lower priority than areas; named areas cover the common case.
  A `GridLine::NamedLine`/`NamedSpan` reference with no matching declared name today just falls
  back to `auto` - silent, not broken, but also not useful yet.
- **Grid child span-selected-child line-span highlight** in the canvas overlay (see Vellum section
  above).
- **A shared icon-based alignment picker** - `justify-items`/`align-content` currently use plain
  `<select>` dropdowns, not the nicer icon-row widget originally scoped. Functional, not polished.
- **Subgrid, masonry** - not in taffy 0.10.1 at all. Blocked on a taffy upgrade landing the
  feature, not a KIT•10-side gap.

## Files touched

- `kit10-scene/src/lib.rs`, `Cargo.toml`, `fixtures/wire-golden.json`, `generated/wire-schema.json`
- `plugins/charter/src/lib.rs`, `Cargo.toml`
- `taf_can_do/src/layout/mod.rs`, `src/render/mod.rs`, `src/render/types.rs`,
  `src/render/hatch_shader.wgsl`, `src/api.rs`, `src/lib.rs`, `Cargo.toml`
- `plugins/webcodium/src/css.rs`, `src/variants.rs`, `Cargo.toml`
- `src/lib/editor/panels/GridTracksField.svelte`, `GridAreaPainter.svelte`, `grid-tracks.ts`,
  `grid-areas.ts`, `ArrangeField.svelte`
- `src/lib/plugins/types.ts`
- `static/charter.wasm`, `static/webcodium.wasm`, `src/lib/vellum/vellum_renderer_bg.wasm`
