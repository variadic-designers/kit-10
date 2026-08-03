# Layer authoring - create mode, pipette, hover, value CRUD

How a designer builds and fills **Layers** (conditional style rules) from the Axes + Render panels,
end to end. Shipped 2026-07-19. All editor + manager; no Charter/Vellum rebuild. This is the fuller
writeup behind the concise notes in `CLAUDE.md` (§3 Editor UI, §2 Manager).

## Mental model

A Layer = *"when the design is in this state (a combination of axis values), these properties differ."*
Its condition is a set of `axis_values` (one per axis, across one or more axes); its content is the
`render_entries` on its `render_snippet`. Specificity = condition count (more conditions win).

The whole feature rides one visual: the **combo dot**. A dot on an axis value means "a Layer conditions
on this value," colored by the hash of its axis key-set (`layer-color.ts::layerDotColor`). The same dot
color appears on the Render panel's `StyleField` track, so a property's color and a Layer's dot match
across panels. Creating, picking up, and deleting Layers all key off these dots.

## The five pieces

1. **Hover highlight** - hovering a combo dot lights up every axis in that Layer's key-set, in the dot's
   color. `Axis.svelte` reports the hovered dot's `keys` up via `onLayerHover`; `Axes.svelte` holds
   `hoveredLayerKeys` and pushes `highlightColor` back down to every axis whose id is in the set. Makes a
   multi-axis Layer's span legible at a glance.

2. **Create-layer mode** - right-click Axes panel → *New Layer*. `Axes.svelte` sets `createMode`; while
   on, clicking a value toggles it into `pendingConditions` (one value per axis) instead of selecting the
   arg. The picked values glow in the prospective Layer color. **Enter** → `api.createLayerWithConditions`;
   **Esc** cancels. The new dot appears via the live query.

3. **Pipette (the core authoring loop)** - after create (or by clicking any dot) you "hold" a Layer and
   paint properties onto it. **Key design decision, learned the hard way (see below): what you hold is the
   *keyset* (which axes), NOT a frozen layer id.** The specific Layer is derived from the current Axes
   selection. Held state lives in `src/lib/editor/pipette.svelte.ts` (module-level `$state`, same
   cross-panel-sharing pattern as `dnd.svelte.ts`), because the Axes panel establishes it but the Render
   panel consumes it.

   - `paintKeys()` - the pinned axis-id set you're working across (source of truth: painting iff non-null).
   - `paintTarget()` - `{ keys, color, label, axisValueIds, ready }`, recomputed by an `$effect` in
     `Axes.svelte` from `paintKeys` × the live `axisArgs` selection. `ready` = every keyset axis has a
     current selected value. **This is why re-picking `Fruit:Apple` after starting on `Fruit:Pineapple`
     moves what you paint onto** - the target follows the selection, the banner follows the target.
   - Painting: `Styles.svelte`'s capture-phase `fieldClick` delegate. Clicking a property's **track dot**
     (`.option124__track` / `.weight-field__track` / `.color-field__track`) calls
     `api.createLayerWithConditions(kitId, target.axisValueIds)` (find-or-create, duplicate-guarded) then
     the normal `onFieldUpdate({layerId, property, value})` write path - copying the property's current
     resolved value/token so the override starts identical to what's on screen.

4. **Deselect + delete + GC**
   - **Deselect an axis value:** re-click the active one. A radio doesn't fire `change` on the already-
     checked option, so `Axis.svelte`'s label `onclick` handles it, calling `onArgChange(null)` →
     `handleArgChange` → `api.clearAxisArg` (drops the `axis_args` row; the earlier code path ignored null).
   - **Remove a property from a layer:** alt-click any Render-panel row → `api.removePropertyFromLayer(
     sourceLayerId, key)`. Deletes the entry, then **garbage-collects**: a *conditioned* Layer left with
     zero render entries is deleted (cascade drops its snippet + conditions; its dot vanishes). The
     null/base layer (0 conditions) is never GC'd.
   - **Delete a whole layer:** alt-click its dot in the Axes panel → `api.deleteLayer` (FKs cascade the
     snippet, entries, and conditions - confirmed `ON DELETE cascade` on `render_snippets.layer_id` and
     `layer_axis_values.layer_id`).

5. **Axis + value management (prerequisite plumbing)** - `axisKinds.ts` is the per-kind registry
   (categorical implemented; range/number disabled stubs). Creating an axis seeds a first value and opens
   it in rename mode; values support inline rename, add (context menu), delete (context menu, warns via
   `getAxisValueUsage` if layers reference it), and drag reorder (`axis_values.priority_index`). See the
   Manager exports below.

## Manager API added

`createAxisWithValues`, `updateAxisValue` (propagates a literal rename into `axis_args` / `default_value`
so a view's selection follows the rename), `getAxisValueUsage`, `deleteAxisValueSafe`, `setAxisValuesOrder`,
`createLayerWithConditions`, `removePropertyFromLayer`, `clearAxisArg`. Schema: `axis_values.priority_index`
(in-place migration edit + `CURRENT_SCHEMA_VERSION` bump to `2026-07-19`).

## Why "held = keyset, not a frozen layer" (don't regress this)

The first cut held a concrete `{ layerId, label }`. It felt wrong immediately: create a `Fruit:Pineapple`
layer, then re-pick `Fruit:Apple` in Axes to "change your mind" - the banner stubbornly still said
Pineapple, because the layer id was frozen at pickup. The Axes selection *is* the steering wheel; the paint
target must be derived from it, live. Hence the split: the pipette module holds only the pinned **keyset**;
`Axes.svelte` recomputes the concrete target (values, label, `axisValueIds`, `ready`) from the selection on
every change and pushes it to the module; `Styles.svelte` resolve-or-creates the actual layer at paint time.
If you ever "simplify" this back to storing a layer id, you reintroduce that exact bug.

## Tips for future expansion

- **Discoverability.** Alt-click (remove/delete) and re-click-to-deselect are hidden gestures. A hint in the
  pipette banner ("alt-click a property to remove it"), a tooltip on rows, or a visible trash affordance on
  the pipette banner for "delete this layer" are all natural adds. Keep gestures consistent: alt-click =
  destructive-remove in *both* panels (row → one property, dot → whole layer).

- **Preview before commit.** `CLAUDE.md`'s "hover/preview intermediary value" note (a Charter `on_field_preview`
  sibling to `on_selection_change`) pairs naturally with painting: hovering a property's track dot while
  holding a Layer could live-preview the paint in Vellum before the click commits. Reuse that patch-and-
  rebuild path, never mutate `last_resolve_input`.

- **Range/Number axes.** The create/pipette flow is kind-agnostic *except* that a paint target needs a
  discrete `axis_value` per axis. `axisKinds.ts` is the seam: implement its four functions for `range`/
  `number` and flip `enabled: true`. But think through what "the layer for a range selection" means - a
  range arg matches an interval, not a single value, so `paintTarget.axisValueIds` (which assumes one value
  per axis) needs a range-aware notion of "which condition am I authoring."

- **Multi-real-layer dots.** A dot is a keyset *group*; `resolveDotLayer` (in `Axes.svelte`) picks the Layer
  matching the current selection, else the first. If you add UI to distinguish `dark+compact` vs `dark+dense`
  within one dot, that's the function to extend (and the place a "which of these N layers?" affordance goes).

- **Composite fields.** `fieldClick`'s track delegation maps a clicked track to its outer `.field-slot`'s
  `data-prop-key`. For composite fields (Arrange/Resize with sub-tracks) that resolves to the *group* key,
  which can mis-target a sub-property paint. If painting composite sub-fields matters, give each sub-track
  its own `data-prop-key` rather than inheriting the slot's.

- **Tokens panel parity.** Alt-click-to-remove currently lives only in the Render panel. The Tokens panel
  (`Variables.svelte`) is the obvious next surface for the same "remove this reference → GC empty layer"
  gesture, since token-backed render entries are what a Layer references just like literals.

- **Explicit "delete layer" from the Render side.** Today whole-layer delete is only alt-click-the-dot in
  Axes. A trash in the pipette banner (delete the current paint target's layer, if it exists - needs a
  find-only `deleteLayerByConditions(kitId, axisValueIds)`, since `createLayerWithConditions` would create)
  would let you delete without leaving the Render panel.
