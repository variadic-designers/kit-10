# KIT•10 - Architecture & Component Boundaries

## Maintaining this doc

When a factual error is identified in any project MD, either called out by the user or spotted during a task, update the affected file in the same response. Do not defer doc corrections to a follow-up. This applies to CLAUDE.md, CONCEPTS.md, PLUGINS.md, FAQ.md, LIFECYCLE.md, and manager/MILESTONES.md.

This file documents architecture and durable invariants, not a changelog. When something ships, record the resulting rule/contract here (and why, if non-obvious) - not the story of the bug report, the date, or the fix's history. Narrative detail belongs in commit messages and `resources/*.md` design docs, which this file links to rather than duplicates.

---

## Writing style

No em dashes, anywhere: not in code comments, docs, commit messages, UI copy, or marketing/landing-page text. Use a comma, a period, or restructure the sentence instead.

---

## Overview

KIT•10 is a design-system editor that models components as **kits** (style systems), **axes** (dimensions like theme/density/state), and **views** (specific axis configurations). The editor stores everything in an in-browser PostgreSQL database (PGlite), resolves kit properties at runtime, and renders previews via a GPU renderer. A sandboxed WASM plugin (Charter) translates resolved data into a flat render tree.

---

## Stack

```
┌─────────────────────────────────────────┐
│  Svelte 5 UI  (src/lib/editor/)         │  Editor shell, panels, reactivity
├─────────────────────────────────────────┤
│  Manager  (manager/src/)                │  TypeScript library: DB, resolve, API
├─────────────────────────────────────────┤
│  PGlite  (Web Worker + IndexedDB)          │  In-browser PostgreSQL, live queries
├─────────────────────────────────────────┤
│  Charter  (plugins/charter/src/)        │  Extism/WASM plugin: resolve → UiNode[]
├─────────────────────────────────────────┤
│  Vellum  (src/lib/vellum/)             │  Rust/WASM GPU renderer: UiNode[] → pixels
└─────────────────────────────────────────┘
```

---

## Component Boundaries

### 1. PGlite (Database Layer)

**Owns:** All persistent state - workspaces, projects, views, kits, axes, axis values, axis args, compositions, layers, layer_axis_values, render snippets, render entries, tokens, token_axis_overrides.

**Must NOT:** do any resolution logic, hold derived/computed state, or be accessed directly from Charter or Vellum.

**Key contracts:**

- `render_entries.value` is a plain `text` column - JSON strings (e.g. for `children`) are stored as text and must be parsed by the caller.
- `tokens.value` is `jsonb` with type `TokenValue = { type: 'scalar', value: string } | { type: 'view', view_id: string }`. There is no list-valued token type - a property needing multiple view references (`children` being the common case) is composed of **N `view`-typed token rows sharing one `composition_alias`**, ordered by `tokens.priority_index` and aggregated into `ResolvedProperty.viewRefs` at resolve time (see Manager's `gatherScopedTokens`/`resolveViewsFromRows`). Unlike a `scalar` token, a `view`-typed row is exempt from the per-scope alias-uniqueness index, so more than one can share a `composition_alias`, and the same target `view_id` can legally appear twice (a view referenced by two simultaneously-active `view` tokens).
- `tokens.composition_alias` (nullable) drives resolution/composition membership for `type: 'view'` rows only - `tokens.alias` is a separate, effectively vestigial display name for those rows (the Tokens panel shows icon+viewName, never the alias). Every write path that creates a `view`-typed token for composition purposes (`addViewRef`, `upsertViewToken`, `createToken`) sets `composition_alias`, never relying on `alias` as a fallback - `alias` and `composition_alias` are independent columns by design so that detaching (`removeViewRef`, below) can clear membership without touching display identity or deleting the row. A render entry's own token reference resolves its substitution key the same way: `view`-typed → `composition_alias`, everything else → `alias` (see `resolve.ts`'s entries SQL, `CASE WHEN value->>'type' = 'view' THEN composition_alias ELSE alias END`).
- `token_axis_overrides` is a separate table (`token_id`, `axis_id`, `value: ArgValue`) recording axis overrides carried by a specific `view`-typed token *reference* (not by the referenced view's own `axis_args`, which is unaffected). These merge into the axis-arg record `matchLayers` uses when resolving that one occurrence - see `resolveViewsFromRows`'s `overriddenOccurrences` below.
- `axis_values.value` and `axis_args.value` are `jsonb` with types `AxisValueType` and `ArgValue` respectively.
- Live queries (`editor.core.live.query`) track table access from the query plan - include all resolution-relevant tables in the live query JOIN so writes to any of them fire the callback.

---

### 2. Manager (`manager/src/`)

**Owns:** Database access (Kysely + PgliteDialect), kit resolution logic, API surface, DB migrations and seed.

**Must NOT:** know about Svelte reactivity, the Charter plugin, or Vellum rendering format.

**Key exports:**

- `resolveManySlowPath(db, viewId)` - resolve all kits for one view (~3 round-trips). SLOW PATH: do NOT use in the editor's live-query loop.
- `resolveManyViews(db, projectId)` - hot path used by the editor's live-query loop: `fetchResolutionRows` + `resolveViewsFromRows`. Resolves ALL project views. Returns `ResolvedViewData[]` only (drops `overriddenOccurrences` below, keeping this convenience wrapper's long-standing contract) - a caller that wants per-occurrence override data calls `fetchResolutionRows` + `resolveViewsFromRows` directly.
- `fetchResolutionRows(db, projectId)` - async: fetches all 10 resolution rowsets in a single batched UNION ALL query (one IPC crossing into the PGlite worker).
- `resolveViewsFromRows(rows)` - pure sync: `ResolutionRows` → `{ views: ResolvedViewData[], overriddenOccurrences: OverriddenOccurrence[] }`. Split out so the editor can dedup on input rows before paying for resolve + serialize + plugin call. `overriddenOccurrences` is one entry per `view`-typed token reference that carries an axis override - additive, computed only when `token_axis_overrides` rows exist, so the zero-override common case costs nothing and `views` stays byte-identical to today's output. **Not yet consumed by Charter or the editor's selection/drag/navigation** - see the pitfall below.
- `rowsKey(rows)` - stable string over every column of `ResolutionRows`, for input-level dedup: same key → `resolveViewsFromRows` (pure) produces identical output, so the editor skips the resolve entirely. Immune to the field-omission class of bug an output fingerprint has.
- `RESOLUTION_RELEVANT_TABLES` - explicit list of tables the resolver reads. Tested against the editor's live-query JOIN (`resolve-live-query.test.ts`) so adding a resolution-relevant table without joining it is a caught failure, not silent staleness.
- `flattenKitResults(kits)` - merge all kit properties into a single Map. For each property, the kit whose winning layer has the HIGHEST `conditionCount` wins outright, regardless of kit composition order; kit order (later/higher-priority kit wins) only breaks a tie between two equally-specific candidates. Cross-kit specificity is `conditionCount` alone, not the full `[count, ...axisPriorities]` specificity `matchLayers` uses within one kit - two different kits tying on `conditionCount` fall back to kit order even if their axis priorities would tie-break differently within a single kit. Mirrored exactly in Charter's `merge_kits` (`plugins/charter/src/lib.rs`), which is what actually renders/exports - `flattenKitResults` only feeds the editor's Render-panel inspector. Keep the two in lockstep.
- `matchesArg(condition, arg)` - pure matching function, re-exported for the Axes panel UI.
- `queryBuilder(dialect)` - typed Kysely instance (the `Api` type), used throughout the UI.
- `addViewRef`/`removeViewRef`/`reorderViewRefs` - the write path for a multi-ref alias (`children`): append a new `view`-typed row (auto-incrementing `priority_index`), **detach** one specific row by id, or bulk-renumber to a given order. `removeViewRef` clears `composition_alias` to `null` rather than deleting the row - the token, its scope, and any `token_axis_overrides` all survive, exactly mirroring how unbinding a scalar/color token from a property never deletes the token itself. A still-attached view token can still be permanently destroyed via the Tokens panel's own `deleteToken` (a real hard delete, unaffected by this). `upsertViewToken` is still correct for a genuine 1:1 alias (a lone `view` token, or a `scalar`), but not for `children` - its find-then-write assumes exactly one row per (view, alias).
- `setTokenAxisOverride`/`clearTokenAxisOverride`/`getTokenAxisOverrides`/`getAxesConsumedByProjectId` - CRUD for a `view`-typed token's axis overrides, mirroring `setAxisArg`/`clearAxisArg`/`getAllAxisArgs`'s shape but keyed by `token_id`. `getAxesConsumedByProjectId(projectId)` lists candidate axes project-wide (every axis consumed by any kit any view in the project composes), each tagged with which view/kit consumes it, for the Tokens panel's right-click "Add Axis" submenu - keyed by `projectId` (not per-view) so the panel can drive it off a single live query and group by view/kit client-side.

**Resolution algorithm (`resolve.ts`):**

1. Fetch all layers for the kit.
2. For each layer, fetch its conditions (axis values it matches) and entries (property values it sets).
3. Match layers against the current axis args using specificity (condition count + axis priority indices).
4. Sort matched layers by specificity ascending - later entries overwrite earlier ones.
5. Substitute token aliases with their resolved scalar values.

**Specificity:** `[conditionCount, priority1, priority2, ...]` sorted descending. Higher specificity always wins.

`fetchResolutionRows` issues one UNION ALL query returning all 10 rowsets tagged (`views`, `compositions`, `axis_args`, `project_tokens`, `view_tokens`, `kit_tokens`, `token_axis_overrides`, `layers`, `conditions`, `entries` - kit names fold into the `compositions` branch, there is no standalone `kits` branch), using two leading CTEs (`project_view_ids`, `project_kit_ids`) so every branch shares the same filters instead of repeating the subquery. Compositions are sorted by `priority_index` client-side (UNION ALL doesn't preserve per-branch ORDER BY).

---

### 3. Editor UI (`src/lib/editor/`)

**Owns:** Svelte 5 reactivity, panel layout, user interaction, live-query subscriptions, orchestrating Manager calls.

**Must NOT:** contain resolution logic (use Manager), render geometry (use Vellum via viewportData), or know Charter's internal data format.

**Key reactive state in `Editor.svelte`:**

```
editorLoading: EditorState          - set once on mount
editorActivity: EditorActivity      - active workspace/project/view/kit IDs
selection: EditorSelection          - selected view IDs (primary + secondary)
resolvedViews: ResolvedView[]       - all project views with resolved kits, updated by live query
resolvedKits: derived               - resolvedViews entry for activeViewId
pluginManager: PluginManager        - Charter plugin wrapper
```

**Live-query loop (`$effect` in Editor.svelte):** a single JOIN query (`RESOLVE_LIVE_QUERY_SQL`) watches all resolution-relevant tables (tested against `RESOLUTION_RELEVANT_TABLES`). On any write, `scheduleReResolve` debounces and calls `fetchResolutionRows`. Row-level dedup via `rowsKey` skips the resolve + serialize + plugin call entirely when the fetched rows are unchanged - this is what enables content-based dedup, since Svelte 5's reference-based reactivity can't do it on its own. `resolveViewsFromRows` runs only when rows actually changed. A `cancelled` flag + `reResolveVersion` counter discards stale async results from a previous project or a superseded fetch (latest-wins).

**Three separate plugin effects** - keeping them separate lets selection and hover changes use the fast `on_selection_change` path instead of a full `on_resolve`:

```ts
$effect(() => pluginManager.setData(resolvedKits, viewHints, activeViewId, resolvedViews, fontFacts, overriddenOccurrences));
$effect(() => pluginManager.setSelection(primaryOccurrenceKey, secondaryOccurrenceKeys));
$effect(() => pluginManager.setHover(hoveredOccurrenceKey));
```

`setSelection`/`setHover` operate on occurrence keys, not view ids (see the occurrence model below).

**Axes panel layer-combo indicators (`Axes.svelte`, `Axis.svelte`, `layer-color.ts`):**

- Each categorical axis value shows one dot per distinct Layer **key-set** (its sorted axis-id set), deduped since axis values within one axis are mutually exclusive. A group is "active" if any Layer in it currently matches the selected axis args.
- The null layer (0 conditions) is excluded - it applies unconditionally to the whole kit, not to any axis value (that belongs to the Render/Tokens panels). Single-axis Layers (1 condition) **are** included.
- **Color = hash of the axis key-set** (`layerDotColor`/`axisSetHue`), shared identically with the Render panel's `StyleField` track color - changing the formula in one call site without the other reintroduces a visual mismatch.
- **Shape = the active kit's own icon** (`kitShape`, by composition order), never per-axis or per-Layer.
- **Column alignment:** `Axis.svelte`'s `keySetColumns` gives every key-set a fixed horizontal slot shared across all of an axis's values, instead of packing left.

**Layer authoring** (create mode, pipette, hover, deselect, GC) - full writeup in `resources/layer-authoring.md`. Right-click Axes → **New Layer** enters `createMode`. Clicking a dot picks it up (pipette) so Render-panel property clicks paint onto it; alt-click (rebindable as `layer.delete`/`property.remove`) deletes/GCs a conditioned Layer (never the null layer). Re-clicking an active axis value deselects it. **The pipette holds the axis *keyset*, not a frozen layer id** - recomputed live each change so re-picking a value moves what you paint onto. Do not regress this to a stored layer id.

**Keybinds are a unified host registry (`keybinds.ts`), not per-component literals.** A `Binding` captures a keyboard combo or mouse gesture; `KEYBIND_ACTIONS` declares each action as data; the `keybinds` store is localStorage-backed. Call sites read the store and match events via `matchKey`/`matchMouse` instead of checking literals (`e.altKey`, `e.key === 'Escape'`). Covers Viewport pan/pixel-snap/box-model toggle, Styles' `property.remove`, Axis's `layer.delete`, and various `edit.cancel` sites. Settings → Keybinds is a bespoke click-to-record widget.

**View navigation (`[` parent, `]` child, ↑/↓ siblings) lives in `Editor.svelte`, not the Views panel** (Editor is always mounted; the panel can be collapsed). Computes the composition DAG via `view-tree.ts`'s `buildViewTree` (shared with `Views.svelte`) and moves selection through the shared `selectView` funnel. Navigation is stateless first-parent (picks the first parent of a multi-parent DAG node; siblings clamp, no wrap), guarded by `isTextEntryTarget`.

**The Views panel scrolls to reveal the active view too, not just the Viewport.** `Views.svelte`'s `scrollIntoViewWhenSelected` action, gated on `editorActivity.activeViewId`, calls `node.scrollIntoView({ block: 'nearest' })` - works uniformly regardless of selection origin since it's driven purely by that one piece of state.

**The pan-to-selection effect (`Viewport.svelte`'s `ensure_index_visible`) only marks `lastPanSelection` once a real pan attempt happens (`index !== -1` in `nodeViewIds`)** - not the instant the effect runs. A freshly created view (clone/add-child) is selected before the next resolve catches up, so the naive guard used to permanently give up on it; now a not-yet-resolved selection keeps retrying until it resolves.

**The padding/gap (box-model) overlay is toggleable** via `viewportInput.showBoxModel` (default on), driving Vellum's `set_show_box_model`, surfaced as the Canvas toggle and `canvas.toggleBoxModel` keybind.

---

### 4. Plugin Manager (`src/lib/plugins/manager.svelte.ts`)

**Owns:** Charter plugin lifecycle, call serialization, host functions.

**Must NOT:** do resolution (use Manager), write DB state directly (only via `kit10_write_render_entry_to_layer`), or expose Svelte reactivity to Charter.

**Serial queue:** all plugin calls (`on_resolve`, `on_selection_change`, `on_field_update`) are chained on `pluginQueue` so they never run concurrently - the Extism worker is not re-entrant.

**Debounce + generation guard:**

- `setData` increments `selectionGen`, cancels any pending selection timer, and debounces `runResolve`. `setSelection`/`setHover` capture `selectionGen` at enqueue time; a mismatch at the pre-await check skips the call.
- The generation is **re-checked again after** the `await activePlugin.call('on_selection_change', ...)` too - the queue is FIFO, so a call already in flight when a newer `setData` lands isn't cancelled by that alone.
- **`beginPendingResolve()` sets a `resolvePending` flag that blocks `makeSelectionChangeRunner` (before and after its await), independent of `selectionGen`.** This is necessary because a *deterministic* ordering, not just a race, can beat the gen guard: a DB-round-trip-bound resolve (e.g. persisting a dragged view's position) can be dequeued after a same-tick hover-triggered `on_selection_change` that reaches the queue first and runs to completion before `selectionGen` was ever bumped. `Viewport.svelte` calls `beginPendingResolve()` synchronously before the write; `runResolve` clears it once its own `on_resolve` completes. Regression-tested in `manager.svelte.test.ts`.

**Plugin manifest schema (`manager/src/schema.ts`'s `PluginManifest`) is data-driven.** Beyond `wasm: [{url}]`, a manifest can declare `provides.exports`/`provides.imports`, `capabilities.hostFns`/`hosts` (host-fn/network surface it requests - filters `makeHostFunctions` when declared, full set when absent), and `supports` (informational compatibility declarations). Each is additive/optional. Full contract: `PLUGINS.md`.

**Export Profile** (`src/lib/plugins/export-profile.ts`) resolves which plugin handles which export `target` from a project's `hints.exportProfile`, showing a picker only when there's an actual choice (2+ providers, nothing saved). `ExportCapability.multiFile: boolean` lets an export return a `{files: [...]}` envelope instead of one blob. `ExportCapability.viewScoped: boolean` marks a provider as filtering output by `view_ids` (WebCodium) versus project-basis (Tenner, which ignores `view_ids` and always dumps the whole project) - the "Export to" submenu and the Export panel's flagged-views UI both filter to `viewScoped` providers, since toggling a per-view flag for a project-basis exporter would silently do nothing.

**Which views an export run includes is per-view, per-plugin: `hints.<providerId>.export: boolean`** (`export-flags.ts`), set from the Views panel's per-view "Export to" context menu. `Export.svelte` live-queries and shows only views flagged for the target's effective provider. `providerId` is always whichever provider the user clicked - never hardcoded.

**Cloning a view strips this flag from the clone** (`stripExportFlags` in `manager/src/api/index.ts`, applied before the clone's insert) - a clone must never inherit the source's own export opt-in. Removes just the `export` field from any hints namespace, leaving unrelated hint data (`hints.vellum.position`, `hints.charter.primitive`) untouched. Also applies to `instantiateKitDefaultsImpl`'s clone reuse.

**`plugins/webcodium/`** is a builtin Rust/Extism plugin (`manager/src/plugins-bootstrap.ts`, `kind: 'utility'`, `activation: 'lazy'`) that walks Charter's resolved `UiNode` tree (via `kit10_get_interpreter_output`) and emits a single HTML file with inlined CSS. Ships installed by default; its manifest is duplicated in `src/lib/plugin-catalogue.ts` for the store UI and must be kept in sync by hand (that file is app-side, `plugins-bootstrap.ts` is manager-package code and can't import it).

Its module layout: `tree.rs` (pure `UiNode`-graph utilities), `css.rs` (value formatting + `render_scss` + the baseline reset), `variants.rs` (Kit-basis static/dynamic variant synthesis), `html.rs` (markup), `lib.rs` (plugin entrypoints + wiring). Translation has gone through 3 phases (naive per-node classes → nested SCSS → Kit-basis export with one class per Kit and per-axis variant classification); full history in `resources/webcodium-export-plan.md`. Img and `@font-face` support resolve real asset/font URLs via host-fns (`kit10_get_asset_links`, `kit10_get_font_links`) - no plugin name or CDN is ever hardcoded, matching the "no hardcoded plugin" rule below. `assets.link` is resolved to an **absolute** URL at export time (`new URL(link, window.location.origin)`), not stored that way, since the exported HTML may be opened from anywhere.

**Known structural risk: Path A (`css.rs`, compiled `UiNode`) and Path B (`variants.rs`, raw kit properties) are two independent hand-written CSS emitters with no shared mapping enforcing parity with each other or with Vellum.** A parity audit already found and fixed 7 real discrepancies (missing Text paint props, line-height/font-weight/color formatting divergence, missing grid/flex properties in Path B's whitelist, pinned-view positions being unreachable in the export tree). Whenever Charter's `BoxExtra`/`BoxData` wire surface grows, `css.rs`'s `node_props` needs an explicit matching pass - nothing else catches the drift. Full list: `resources/webcodium-export-plan.md`.

**Every export is prefixed with `css::BASELINE_RESET`, a first-party 2-rule reset (`body`/`p` margin), never a third-party library.** `normalize.css` doesn't touch `p` margin; `the-new-css-reset` sets `box-sizing: border-box` globally, which conflicts with Vellum's deliberate `ContentBox` layout choice. **Never add a `box-sizing` rule here.**

**PROJECT-scope tokens export as real CSS custom properties, not baked-in literals - kit/view-scoped tokens don't (yet).** Every value elsewhere in this plugin is a literal by construction: `resolve.ts` substitutes a token's resolved scalar before Charter ever sees the data, so by the time Path A's `UiNode` or Path B's `KitExportShape` reaches WebCodium, a property backed by a token and a plain literal are indistinguishable - *except* `KitExportShape`'s raw entries, which still carry `tokenId` (export-shape.ts's `ExportLayerEntry`; previously silently dropped on the Rust side, since serde ignores unknown JSON fields - `variants::ExportLayerEntry` now declares it too). The new host fn `kit10_get_project_tokens` resolves the exporting project's own project-scope tokens (`kit_id`/`view_id` both null) to `{alias, value, format}`; `variants::render_root_variables` emits one `:root { --alias: value; }` per token (sorted by alias, collision-suffixed, `format` - `TokenValueScalar.format`, schema.ts - driving the same px/color-recognition formatting `format_value` would apply per-property, since a token isn't tied to one property), and `resolve_properties_with_tokens` swaps a token-backed property's declaration for `var(--alias)` **only when the token's id is present in that project-tokens map** - a kit/view-scoped token's id simply isn't there, so it falls through to today's literal-substitution behavior unchanged. `border`/`border-width` are permanently excluded from substitution (`NEVER_TOKEN_SUBSTITUTED`) since `synthesize_border` merges them into one atomic shorthand before this ever runs - a bare `var(--alias)` there would silently drop the width/style half. `background`/`color` re-check `is_recognized_color` on the *resolved* value before trusting a var(): a token whose own value is unparseable still gets Charter's magenta marker, never a variable reference to broken data. Path A (`css.rs::node_props`) is **not** part of this - it only ever sees Charter's fully-resolved `UiNode`, which has no token identity left to recover.

**A layer conditioned on multiple axes together produces one combined static variant rule - a compound selector chaining one axis-prefixed BEM fragment per condition** (`.button.button--plan-elite.button--theme-dark`), closing what was a deliberate v1 scope cut (single-axis-only). Chaining classes rather than fusing them into one class name is deliberate: CSS's own specificity counts one point per class token in a compound selector, so a 2-condition rule outranks a 1-condition rule automatically, mirroring `resolve.ts`'s own condition-count-first specificity order with zero extra bookkeeping. Fragment naming is axis-prefixed (`--{axis}-{value}`, not the old bare `--{value}`) so two different axes with same-named values can't collide on one modifier class. Scoped as "assume everything is static for now": a multi-condition layer always chains as static regardless of any contributing axis's own `variant_kind` - combining several axes' dynamic pseudo-classes into one compound selector isn't a coherent concept and stays out of scope; single-condition layers on a `variant_kind: "dynamic"` axis are unaffected, still `:hover`/`.is-{value}`.

**Static (and `.is-{value}`) variant rules only ever apply to an exported element because of a second, separate host fn: `kit10_get_view_axis_args`.** Before this existed, EVERY static variant rule WebCodium ever exported - single-axis included, going back to the original Phase 3 ship - was unreachable dead CSS: `html.rs` only ever wrote a node's base Kit class onto its `class=""` attribute, and nothing else ever put a modifier class there, so a compound selector like `.button--secondary` could never match anything in the exported HTML (only real dynamic pseudo-classes like `:hover`/`:focus` worked, since the browser applies those from actual interaction, no class needed). `kit10_get_view_axis_args` mirrors `kit10_get_kit_export_shape`'s pattern but is per-VIEW-INSTANCE, not per-Kit - it answers "which axis value did this specific view actually resolve to," which Charter's own resolved output can't answer (axis/layer identity doesn't survive Charter's property flattening). `lib.rs`'s `synthesize_all_variant_rules` hoists variant-rule synthesis out of `css.rs`'s per-node recursion (computed once per distinct Kit, same posture as `kit_names`/`asset_links`) so the same rules can be consulted by both CSS emission and `compute_instance_modifier_classes`, which appends a matching rule's exact `{class}{suffix}` token(s) to that one node instance's class list via `variants::rule_matches_args`. Dynamic rules are deliberately never given a class here - a real pseudo-class needs none, and a `.is-{value}` JS-toggle class is meant to be flipped by future runtime logic, not permanently baked in from a design-time axis pick.

**A view composing 2+ kits gets one class and one base rule per composed kit, not just Charter's single "winning" kit** (`node_kit_ids` collapses to `kits.last()`, which Path B independently works around via the new host fn `kit10_get_view_compositions` - the full `{view_id, kit_id, priority_index}` list). A property 2+ of those kits both declare is a genuine cross-kit contest, resolved the same way `flattenKitResults`/`merge_kits` resolve it (highest `conditionCount` wins regardless of kit order, kit order breaks a tie) and expressed in real CSS via an extra disambiguating rule (`variants::synthesize_contested_rules`) whose selector chains every composed kit's class plus a `tree::composition_signature_class` - an order-sensitive hash of the view's own ordered kit-id list. That signature class exists because a bare kit-class compound selector (`.density.priority`) can't tell apart two views composing the identical two kits in *opposite* priority order (class order in `class=""` doesn't affect CSS matching); the signature hash does, so their disambiguating rules never collide. Full mechanics: `resources/webcodium-export-plan.md`'s "Multi-Kit Composition Export" section.

**`width`/`height: fill`'s GROW half is now real in the Kit-basis export (`variants::synthesize_resize`), reversing part of Path B's original "resize needs the parent's own axis" scope cut.** `flex-grow`/`flex-shrink`/`flex-basis` are inherently main-axis-relative in real CSS regardless of `flex-direction`, so an unconditional `flex-grow: 1;` on a `fill`'d child correctly reproduces Fill's "equal share of the main axis" behavior whichever axis turns out to be main at render time - no Charter round-trip needed after all, unlike the Phase 3.1 plan originally assumed. An explicit raw `flex-grow` (the legacy item-level escape hatch) still wins, same "only fires when unset" rule as `synthesize_arrange`. **Still deliberately unhandled**: `flex-shrink`/`flex-basis`/`min-width`/`min-height` (Fill's "can shrink below content" half) and `align-self: stretch` on the cross axis - these genuinely are axis-specific and remain the real Phase 3.1 follow-up. Hug's own `flex-grow: 0` was never a gap (it already matches CSS's default, so omitting it was always correct).

**Utility plugins (`loadUtilityPlugin`/`callUtilityPlugin`)** are a second plugin category alongside Charter's viewport-interpreter lifecycle - stored in their own `Map<string, Plugin>`, never touching `activePlugin`, called on demand by name.

**Fontavious** (`plugins/fontavious/`) owns a font catalogue (`catalogue.json`, generated by `generate-catalogue.mjs`, **never hand-edited** - a hand edit is clobbered on the next rerun; after regenerating, rebuild and re-copy the wasm) and fetches WOFF2 from vendor CDNs. Four exports: `search_fonts`, `fetch_font` (checks an IndexedDB byte cache first, best-effort), `variant_url` (URL only, no fetch), `family_facts` (weight range + styles, no URLs). Full architecture: `resources/fontavious-catalogue-plan.md`, `resources/nature-of-fonts.md`.

**Weight is modeled as a range (`weightMin`/`weightMax`), not a single value** - most catalogued families are variable fonts where one URL covers a continuous range; a static font is the degenerate `min == max` case. Not every family has every weight (Lato/Poppins ship only 400/700).

**Proprietary/trademarked font names (Arial, Gotham, etc.) are ALIASES on an OFL root, never a catalogue entry's `family` - a trademark constraint, do not regress it.** `aliases` (exact/metric-compatible) and `looksLike` (visual/approximate) both resolve through `find_entry` to the root's real file; `search_catalogue` always labels the row with the root's own name. See `resources/fontavious-catalogue-plan.md` §2-§5.

**Charter never names Fontavious.** A `FieldDef.inputType: "font"` only claims what *kind* of field it is; `src/lib/plugins/suggestion-providers.ts`'s `resolveSuggestionSource(inputType, explicit)` is the one place mapping `inputType → plugin`. Swapping providers is a one-file edit, never a Charter rebuild.

**Charter snaps text weights to what the family actually has (`resolve_font_weight`).** `Editor.svelte` fetches `family_facts` per family and feeds them into `on_resolve`'s `fontFacts` input; a requested weight the family doesn't ship snaps to the nearest real one as a render-time decision (the stored kit value is never rewritten). `OnResolveResult.font_requests` is the concrete post-snapping set the editor's font-fetch scan iterates - one decision point, the scan is downstream of it. `fontFacts` is not a DB row, so `rowsKey` dedup never sees it; it's a separately-reassigned `$state` that re-fires `setData` on its own.

**`font-weight` is a pick-from-what-exists segmented control (`WeightField.svelte`), not free-typed** - filtered to what the resolved family's facts cover; an uncatalogued family falls back to the full set. No raw-numeric escape hatch exists for this field.

**`text-align`/`text-decoration` are real fields** (`parse_text_align`/`parse_text_decoration` map keywords to Vellum enum variants), rendered as fixed segmented rows, not runtime-fact-driven like weight.

**`line-height` is a real wire field**, plain free text (not a stepper, since CSS's dual reading - bare number = multiplier of font-size, `px` = absolute - would collide with a stepper that only ever writes bare numbers).

**`Editor.svelte`'s image-reload scan mirrors the font-fetch scan, for asset `src` properties.** Vellum's GPU texture cache is memory-only and resets on page load; the scan (a `$effect` over resolved `src` values, deduped via a `Set`) checks `assetBytes` first, falls back to `assets.link` (`fetch` + cache), then calls `vellum.load_image` + a repaint. Best-effort: a missing/orphaned asset is silently skipped. This is the first real consumer of the previously-dead `assets.link` column; `manager/src/seed.ts`'s `registerBundledAsset` is what populates it for bundled assets.

**Size fields are an `Extent` enum, not bare `f32`** (`Auto | Px(f32) | Percent(f32)`), mirroring taffy's `Dimension`. `fr` is deliberately not an `Extent` - it's a container concern (grid/flex), never self-declared size. `Text`/`Img` dimensions must always be `Auto` (Vellum measures them); `min_width`/`min_height` (Box only) give percent widths a usable floor against an auto parent.

**Host functions (Charter → Host calls):**

| Function                                        | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kit10_log`                                     | Structured log forwarded to browser console with level/color                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `kit10_kv_get` / `kit10_kv_set`                 | Per-plugin key-value store (in-memory)                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `kit10_font_cache_get` / `kit10_font_cache_put` | Persistent font-byte cache (IndexedDB). Best-effort, errors swallowed. See `resources/nature-of-fonts.md` §7.                                                                                                                                                                                                                                                                                                                                                                                |
| `kit10_get_resolution`                          | Returns current `resolvedKits` JSON to Charter                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `kit10_get_interpreter_output`                  | Public, capability-gated access to the active interpreter's last resolved output. `viewport_data` (JSON) is always kept current alongside the optional `viewport_data_binary` - see the manager.svelte.ts pitfall below.                                                                                                                                                                                                                                                                    |
| `kit10_write_render_entry_to_layer`             | Writes a field value back to DB via Manager API                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `kit10_set_viewport_data`                       | Direct viewport update bypass (legacy, avoid)                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `kit10_panel_publish`                           | Plugin publishes a `PanelManifest` keyed by `panel_id` into the editor's `$state` map. Always assigns a new `Map` instance to trigger Svelte 5 reactivity.                                                                                                                                                                                                                                                                                                                                    |

---

### 5. Charter Plugin (`plugins/charter/src/lib.rs`)

**Owns:** Translating resolved kit data into a flat `UiNode[]` render tree. Layout grid logic. Marking which nodes are selected. Field category definitions.

**Must NOT:** query the DB directly, hold cross-call mutable state beyond Extism `var` storage, or do text measurement (emit `width:0, height:0` for Text nodes; Vellum measures them).

**Charter does not have to 1:1-expose every CSS-like capability Vellum gains as a literal render-panel property.** It's an opinionated translation layer (VISION.md 1st Principle), not a raw CSS pass-through.

**Per-axis resizing (Fixed / Hug / Fill) is Charter's first sizing opinion (`compile_resize`).** `width`/`height` accept the keywords `fill`/`hug` alongside a length. Fill → `flex-grow:1`, `flex-shrink:1`, `flex-basis:0`, `min:0` on the main axis, `align-self: stretch` on the cross axis; Hug → `flex-grow:0`/`flex-shrink:0` on the main axis. A length is Fixed. Direction-aware via a threaded `parent_main_horizontal` flag. Only an explicit `fill`/`hug` keyword engages compilation, so existing plain-length layouts don't shift. The editor's Fixed/Hug/Fill segmented control writes exactly these keywords.

**Hug's cross-axis `align-self` is conditional on the parent's own resolved `align-items` (also threaded down, `parent_align_items`), not unconditional.** Hug forces `align-self: flex-start` only when the parent's cross-axis `align-items` would otherwise default to stretch (`None`, or an explicit raw `align-items: stretch`) - that's the correction an untouched Column Stack needs (see the pitfall below). When the parent has a *deliberate* non-stretch `align-items` (`Center`/`Split`'s `Center`, `Cluster`'s `FlexStart`), Hug leaves `align-self` unset so the child inherits that alignment - sizing (Hug) and cross-axis position are orthogonal, same as Figma. Forcing `flex-start` unconditionally made a Hug'd child in a `Center` container always sit flush at the start edge instead of centering, even once its *width* was correctly hugging. An explicit raw `align-self` prop always wins over either default. `render_view_nodes` threads a box's own resolved `align_items` (not the raw prop - must reflect `compile_arrange`'s defaults too) down to its children alongside `parent_main_horizontal`, exactly parallel to it.

**Size limits ride the resize control as contextual follow-ons (`resizeKeys`), not top-level rows.** `ResizeField.svelte` reveals the min/max pair inline exactly when a limit is meaningful (Fill, a fixed `%`, or an already-set limit).

**Arrangement (Stack / Cluster / Split / Center / Grid) is Charter's second layout opinion (`compile_arrange`)**, documented fully in `resources/layout-affordances.md`. The `layout` category is just `arrange`, `width`/`height` (resize), and `padding`; the raw knobs (`flex-direction`, `gap`, `align-items`, etc.) live only inside `arrange`'s `arrangeKeys` side-channel, so the editor never hardcodes a companion property name. Every `compile_arrange` output is a **default that only fires when the raw property was never explicitly set** - never an unconditional force, since forcing would make an Advanced-field edit silently invisible while a different tab is active.

**`TrackSize::AutoFit(f32)`** is exactly `repeat(auto-fit, minmax(<px>, 1fr))` - one opinionated shape, never arbitrary CSS `repeat()`. Mirrored exactly in Vellum; must match exactly, same rule as every other `TrackSize` variant.

**Grid's full vocabulary (arbitrary `minmax()`, `%`/`fit-content()`/`repeat(auto-fill,...)` tracks, named lines, `grid-template-areas`, `grid-auto-flow`, `justify-items`/`align-content`/`justify-self`) shipped 2026-07-31** - `kit10-scene@v0.2.0`, full history and what's still deferred (named-line *declaration*, a per-item span control, the canvas overlay's child-line-span highlight) in `resources/grid-mastery-plan.md`. `GridLine` lost its `Copy` derive when `NamedLine`/`NamedSpan` were added (an owned name can't be `Copy`) - every consumer takes `&GridLine`, not `GridLine`, now. The editor's `GridTracksField.svelte`/`GridAreaPainter.svelte` (`src/lib/editor/panels/grid-tracks.ts`/`grid-areas.ts`) are TS ports of Charter's own parsers, so the friendly UI and the raw "Custom tracks" text escape hatch never drift onto two different formats for the same property.

**`extract_paint_props`'s `padding` parses real CSS 1/2/3/4-value shorthand** (`[top, right, bottom, left]`). Backs the `spacing`/`spacingMode: "box"` inputType's progressive 1→2→3/4-value ladder in the Render panel, derived from the value itself (space-separated count), never separate component state. Any future field sharing this real T/R/B/L shorthand shape gets the widget for free via the same inputType/spacingMode.

**`parse_color` returns `OklabColor { l, a, b, alpha }`, not sRGB RGBA** (full architecture: `resources/oklch.md`). Parses `oklch()`/`oklab()` first-class; hex/`rgb()`/`hsl()`/`transparent` are legacy input converted to Oklab on ingest. Colors are authored and stored in Oklab, never sRGB. A genuinely unparseable value returns a visible magenta marker, never silent black. Every paint `FieldDef` declares `inputType: "color"`, with no companion `FieldDef` side-channel - `ColorField.svelte` derives slider positions by parsing the resolved string client-side.

**`Img` carries `fit: String`** (`"cover"|"contain"|"fill"`, unknown → `cover`) - the exact field name Vellum reads. `object-fit: cover` is clipped to the node box CPU-side (no scissor pass exists).

**Entry points:**

| Function              | Trigger               | Input                                | Output                                                                                                                                           |
| --------------------- | --------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `on_init`             | Plugin load           | `{name}`                             | `"ok"`                                                                                                                                           |
| `on_resolve`          | Data change           | `OnResolveInput`                     | `OnResolveResult`; also publishes `PanelManifest("views")` via `kit10_panel_publish`                                                             |
| `on_selection_change` | Selection or hover change only | `{primary, secondary, activeViewId, hovered_occurrence_id}` (occurrence keys) | `{viewport_data, node_view_ids, node_kit_ids, node_occurrence_ids, viewport_data_binary}`                                                        |
| `on_field_update`     | User edits a field    | `FieldUpdate`                        | `WriteRenderEntryResult`                                                                                                                          |

`on_resolve` stores its full input payload as `last_resolve_input` (Extism `var` storage). `on_selection_change` reads this, patches the three selection fields, and re-runs `build_viewport` - no full re-resolve round-trip for selection-only changes.

**`build_viewport` layout:** views with `hints.vellum.position` each become their own independent root at that literal world coordinate (never join the shared flex parent). Unpositioned views flow through a legacy auto-grid (max 4 per row, fixed padding/gap consts - Charter's own structural opinion, not a user preference). Charter can't pre-compute a packed layout for unpositioned views since it doesn't know their content size until Vellum measures text.

**Primitive detection (`detect_primitive`):** text-only properties → `"text"`; otherwise → `"box"`, recursing into `child_view_ids`. **`has_box_props` must only include genuinely structural properties** (`width`, `height`, `display`, `flex-direction`, `gap`, `grid-template-*`) - never fill/border/radius/padding, which real CSS text can have without stopping being text. That used to silently swap a node's whole sizing algorithm the moment a label got a background color.

**The Views-tree icon lives in `hints.view_icon`, not the manifest.** Charter never emits icon strings for the panel.

**Panel Manifests** ship via `kit10_panel_publish(panel_id, manifest)`, a channel decoupled from `OnResolveResult`. `build_views_panel_manifest` bundles per `PanelItem`: `id`, `write_alias`, and `ops`. Also carries `header_ops` and `composition_field_keys` (the resolved-property name(s) Charter treats as composition fields - its one nesting opinion). Does NOT carry `child_ids`/`is_root` (tree topology is a generic graph walk the host does over already-resolved data) or `icon` (read from `hints.view_icon`).

**The nesting split:** Charter's opinion on nesting is one string list, `composition_field_keys`. The host walks `resolvedViews` for those keys' `viewRefs`, builds `childrenByViewId`, partitions root vs. referenced, and cycle-guards via `isDescendant`. A child referenced by multiple parents renders once per parent (DAG, not tree).

**Per-item `ops`:** each `PanelOp` is self-describing (`name`, `label`/`icon`, `kind`). `common_item_ops` declares `rename`/`clone`/`lock`/`hide`/`deselect`/`delete` for every view; `container_item_ops` adds `add-child` (box/text/image) when the item's primitive is `box`. Creating a Box view also auto-attaches a blank kit so the new view has somewhere for a `children` write to land. `Views.svelte`'s context menu is built off `item.ops`; the manifest owns availability, the editor owns current state + execution (dispatch table: `rename`→`api.renameView`, `delete`→`api.deleteView`, `clone`→`api.cloneViewSubtree`, `lock`/`hide`→toggle APIs, `add-child`→`api.createViewInProject` + attach). The box/text/image trio is one canonical table (`CREATABLE_PRIMITIVES`) inside Charter, not hand-duplicated across the two ops functions.

**`Text` nodes carry their own paint properties** (`build_text_node` via the shared `extract_paint_props` helper) - `background`/`border`/`border-radius`/`padding` apply directly onto `TextData`, since Vellum's `node_rect()` draws these for Text exactly like Box.

**A Box never renders inline text - it is a pure container.** Text goes inside as a nested `Text` primitive; there is no `content` fallback, and `box_categories()` deliberately declares no `content` field.

**Selection marking:** Charter sets `BoxData.selected` (0/1/2 = none/secondary/primary) and otherwise leaves `border_color`/`border_width` untouched. Vellum owns the actual selection visuals as a separate overlay.

**`CharterHints` (`hints.charter`)** - Charter-interpreted: `primitive: "box" | "text"` overrides auto-detection.

**A view is never declared "top-level" or "child" - that's derived, not stored.** `build_viewport` unions `collect_child_view_ids` across every view's `resolved_kits`; a view renders top-level for exactly as long as nothing's `children` property lists it.

**`VellumHints` (`hints.vellum`)** - passed straight through to Vellum with no Charter interpretation: `position: [f32; 2]` places the view's top-level cell via `NodePosition::Absolute`, escaping the auto-flow grid.

---

### 6. Vellum (`src/lib/vellum/`)

**Owns:** GPU rendering, camera (pan/zoom), layout engine (flex-direction, auto-sizing).

**Rebuilding the wasm binary** (source in `taf_can_do/`):

```
wasm-pack build --target web --no-default-features --no-opt --out-dir ../kit10/src/lib/vellum
```

`--no-default-features` is **required** - the `standalone` feature gates out all `#[wasm_bindgen]` exports; without it you get a ~17KB stub with no exports. `--no-opt` bypasses wasm-opt, which fails on bulk-memory ops in the bundled version.

**`taf_can_do/` is a separate repo** with its own remote (`origin` → `git@github.com:Variadic-Designs/vellum.git`, branch `master`). Only the compiled `vellum_renderer_bg.wasm` + generated JS/`.d.ts` glue get committed into `kit10`. **Never push to its `upstream` remote** (the public template it was forked from). A Vellum change is always a two-repo commit: source → `taf_can_do` `origin/master`, artifacts → `kit10`.

**Vellum's `UiNode`/`BoxData`/`TextData`/`ImgData`/`OklabColor` types come from the shared `kit10-scene` crate**, not local definitions - the same crate Charter depends on. Both renderers compile against identical struct definitions, which is what let the old hand-copied wire golden fixture be retired. Bumping the shared contract: commit + tag `kit10-scene`, bump the `tag = "..."` in whichever of Charter's/Vellum's `Cargo.toml` needs it, then rebuild-and-copy.

**Canvas backing store is DPR-aware; world-space stays logical (CSS px) everywhere else.** `create_graphics_for_canvas` sizes the actual surface to `devicePixelRatio`× the logical size the editor passes in - this is what keeps borders/radii/grid crisp on HiDPI without upscale blur. Only `grid_shader.wgsl` (reads `frag_coord`, always physical texels) and `TextRenderer::shape_area` (rasterizes glyphs at `font_size * dpr` for a sharper atlas entry, then scales metrics back down) actually consult the ratio. Native/standalone hardcodes `dpr: 1.0`.

**MSAA is off on the shipped web build** - anti-aliasing comes entirely from per-fragment SDF math (`fwidth`-based in `shader.wgsl`, `smoothstep`-based in the grid shaders). `msaa_dims` collapses the requested MSAA target size to `(1,1)` on web so it isn't allocated for nothing. Native/standalone (`SAMPLE_COUNT == 4`) is unaffected.

**Corners render as either a circular arc (`sd_rounded_rect`) or a superellipse/"squircle" (`sd_squircle_rect`), selected per-instance by `BoxData`/`TextData.squircle` (`kit10-scene`, not `ImgData` - it has no `corner_radius` at all).** `sd_squircle_corner` computes a gradient-projection (Newton's-method-for-an-implicit-curve) iteration toward `|x/r|^n + |y/r|^n = 1` (`n = 4`, fixed, not user-tunable) and, UNLIKE `sd_rounded_rect`'s raw `length(max(q, vec2(0.0)))` corner term, already returns a fully r-relative signed distance (equivalent to `length(q) - r` for the circular case) - `sd_squircle_rect` must NOT subtract `r` again on top of it. **This was shipped broken once**: an extra `- r` in `sd_squircle_rect` double-subtracted the radius, making the entire corner region (all the way out past the literal sharp corner tip) read as "inside," i.e. squircle mode rendered as a plain unrounded rectangle regardless of `corner_radius` - caught by hand-deriving the SDF value at `q=(r,r)` (the unrounded corner tip, which must read positive/outside; the bug made it strongly negative/inside). The isolated-corner-term ground-truth tests didn't catch this, since the bug was in the COMPOSITION of the corner and flat-edge terms, not the corner math alone - `layout::squircle_sdf_tests` in `taf_can_do` now also tests the full `sd_squircle_rect` composition (`sharp_corner_tip_is_outside_the_shape_not_inside`, `squircle_and_rounded_rect_agree_off_the_corner`), not just `sd_squircle_corner` in isolation. A true superellipse has no closed-form SDF; the iteration's raw (unclamped) form badly overshoots through most of the shape's interior since the implicit function is very flat there (grows as `u^n`) - `SQUIRCLE_MAX_STEP_FRAC` clamps each step to `0.15 * r`, trading interior accuracy (irrelevant - those fragments are always outside the AA band) for correctness near the boundary, where it's verified to ~0.5px across `r` in `[5, 300]`. A second, smaller bug in the same shipment: the Newton iteration is a genuine fixed point (not just floating-point noise) exactly at the corner-circle's center `qc=(0,0)` (WGSL's `sign(0.0) == 0.0` zeroes the gradient there), incorrectly returning `0` instead of the correct `-r`; short-circuited via a small near-origin radius check rather than solving the general symmetric-convergence problem. **Box-shadow blur (`rounded_box_shadow`/`shadow_x`) always stays circular-arc regardless of `squircle`** - an exact squircle blur has no closed form (would need a 2D numeric quadrature over the implicit boundary), so this is a deliberate, permanent v1 scope cut, not a bug: a squircle box's own shadow will visibly round its corners even though the box itself doesn't. On the Charter side, `border-radius-squircle` rides `border-radius`'s own Render-panel row as a companion boolean property (`RadiusKeys`, mirroring `ResizeKeys`' min/max side-channel shape) - never a second top-level field.

**Vellum's color pipeline is Oklab end-to-end; conversion to linear sRGB happens only in WGSL, at the last moment before fragment output** (full architecture: `resources/oklch.md`). `color.rs` holds `OklabColor` and the Oklab↔linear-sRGB conversion; every color field keeps its `[f32;4]` byte shape but is reinterpreted as `(l, a, b, alpha)`. Each render shader carries its own copy of `oklab_to_linear_srgb` (WGSL has no shared includes) and converts exactly once, right before output. Perceptual (Oklab-space) blending replaces the 3 places Vellum used to `mix()` in raw RGB (border/fill compositing, the grid overlay blend) - the pixel-grid invert-contrast blend deliberately stays plain linear RGB, since it's synthetic debug chrome with no perceptual analog.

**Display-P3 wide-gamut output is implemented on web, gated.** `create_graphics_for_canvas` opts into `DisplayP3` only when both the display and the surface support it; otherwise byte-identical to sRGB. Delivered as a WGSL `const` injected per-pipeline (not a `SceneUniforms` field - see the SceneUniforms pitfall below). Host-side gamut mapping and the panel fallback-visibility UI are not built yet; that's a deliberate boundary - see the Gamut Mapping note below.

**Gamut mapping does not live in Vellum.** The CSS Color 4 chroma-reduction search that maps an out-of-gamut color down to displayable is host-owned (future editor/manager concern, per `resources/oklch.md`); Vellum converts mechanically with no clamping of its own.

**Discrete, snapped zoom levels, 10% to 3000%** (`ZOOM_LEVELS`), coarser near the extremes, finer around 100%.

**Macro grid**: sparse 16-world-unit crosshairs drawn first in the content pass, opacity fading with zoom alone.

**Rendering is two passes only above 1600% zoom, one pass otherwise** (`draw()` branches on `view_zoom >= 16.0`). Below: a single pass straight to the swapchain. At/above: content renders into an offscreen texture, then a composite pass reads it back to apply the pixel-grid overlay (which needs to know what's underneath to invert-contrast over content vs. draw a faint line over empty canvas) before drawing hover/selection on top. `content_texture` is sized lazily - grown to full physical resolution only when zoom first crosses the threshold, shrunk back to a `(1,1)` stub below it, to avoid holding a full HiDPI render target in VRAM all session for a rarely-active feature.

**Glyph atlas needs a padding gutter between packed glyphs** (`GLYPH_PADDING`) - bilinear sampling near a glyph's border otherwise blends in a neighboring packed glyph's texel. `ClampToEdge` only guards the atlas's outer border, not inter-glyph seams.

**`text_align`/`text_decoration` ride cosmic-text's own machinery.** Alignment is `Buffer::set_text`'s `alignment` param; decoration draws via real font-metric-derived offset/thickness (`decoration_metrics`), pushed into the same glyph vertex buffer as a `mode = 2.0` (solid fill, no atlas sample) so the shader's existing derivative-op calls stay in uniform control flow. `hash_area` hashes both fields since they change vertex generation itself.

**`line_height` replaces the hardcoded `font_size * 1.2` at both `shape_area` (render) and `measure_text_node` (taffy measure pass) - the two must stay in agreement**, or box sizing disagrees with what's actually drawn. `≤ 0.0` is the "not provided" sentinel (old-Charter-build compatibility). Both the cache hash and the taffy measure-key include it.

**Vellum owns text measurement.** Text arrives as `width: Auto, height: Auto`. `measure_text_node` answers taffy's three width probes distinctly: `Definite(w>0)` wraps the shaped buffer at `w`; `MaxContent` (and the defensive `Definite(≤0)` probe) reports the natural unwrapped line; **`MinContent` reports the longest word** (shape at width 0). Collapsing min-content into the full line breaks flex shrink/wrap for text children (their automatic minimum becomes their whole width). **The `Definite(w)` branch's *returned* width must be the shaped buffer's real measured bounds, never `w` echoed back literally** - `w` there is often just a shrink-to-fit probe's upper bound (taffy's `determine_hypothetical_cross_size`, used for any non-stretched auto-width flex item, e.g. a Hug'd cross-axis child under `align-items: flex-start`/`center`), not a real target size; echoing it back makes every such node report itself as exactly `w` wide regardless of its actual content, i.e. Hug becomes indistinguishable from Fill/Stretch. (A stretched/already-sized node is unaffected either way, since `known_dimensions.width` wins outright over this return value.) Regression-tested in `flex_text_shrink_tests::text_child_hugs_its_own_width_on_the_cross_axis_instead_of_filling_it`.

**`measure_img_node` checks `known_dimensions` FIRST, before the image cache.** An `Img` with both axes already `Extent::Px` must return that immediately - falling through to a cache-miss-during-async-load used to measure it as `Size::ZERO` for every layout pass before the image finished loading, visibly "spawning cropped" until a later layout corrected it.

**`UiNode[]` contract:**

- Nodes are a flat array; `parent_id: number | null` is an index into it.
- Size fields are `Extent` (`Auto | Px(f32) | Percent(f32)`), not bare `f32`. `Box{width: Auto}` auto-sizes to children+padding; `max_*: Auto` means no constraint; `min_*` is a lower clamp (Box only).
- `flex_direction`: `"Row" | "Column" | "RowReverse" | "ColumnReverse"`.
- `BoxExtra` carries `align_items`/`justify_content`/`flex_wrap` (container), `flex_grow`/`flex_shrink`/`align_self`/`flex_basis` (item), and `margin`, mapped 1:1 in `apply_box_extra`. `None` on `Option`-typed fields means "leave taffy's own default," not "set to zero." Charter no longer surfaces the item-flex trio or `margin` in the panel - the `resize`/`arrange` controls drive them.
- `BoxExtra.position: NodePosition` (`Relative` default, or `Absolute { x, y }`) is **not** a kit render-panel property - Charter only sets it from `hints.vellum.position`. **Never mapped onto taffy's own `Position`/`inset`** - see the Position-vs-Sizing pitfall below. Instead, a positioned root gets its own fully independent taffy tree (ordinary auto-sizing) and `(x, y)` is applied as a pure post-layout translation.
- Every `Box`/`Text`/`Img` variant has a `selected: u8` (0/1/2). Charter sets it; Vellum owns how it's drawn.

**Selection is a separate overlay, not a border override.** `rebuild_selection_instances`, run every frame from `write_frame` (not just on scene change), turns captured layout rects into an outline `RectInstance` + 4 corner handles, expressed in world units as `desired_screen_px / view_zoom` so they stay a constant screen size regardless of zoom. Runs every frame because pan/zoom mutators update the camera without touching the instance buffer.

**Live node-drag** (`start_node_drag`/`update_node_drag`/`end_node_drag`) translates just the dragged subtree's entries directly in `self.layout_result` - no full taffy re-layout mid-drag, same class of post-layout translation `NodePosition::Absolute` already uses. **Every other per-frame cache reading `layout_result.rects` must be explicitly re-derived inside `update_node_drag` or it visibly lags** - `selection_decorations`/`hover_decorations` and the padding/gap hatch overlay are re-derived via free functions (`selection_decorations_from_rects`, `hover_decorations_from_rects`, `build_hatch_instances`) callable without a live GPU device, and `scene_version` is bumped purely to defeat the glyph-buffer's cache gate (without forcing any actual reshaping).

**Drag eligibility walks up to the ACTIVE root, not just a direct hit** (`resolveDragTargetViewId`). A root fully tiled by covering children has no point that hit-tests to itself, so when the active view is a root and the hit falls anywhere in its composition subtree, that root is the drag target. A non-active root only drags on a direct hit - deliberate, to leave room for a future drag-to-reorder-children feature.

**A dropped view's position snaps to a world-space grid, applied once on drop via a short eased settle animation, not live during drag** - `update_node_drag` tracks the raw cursor unsnapped; `end_node_drag` computes the snapped target and starts a `SettleState` (0.15s cubic ease-out) if it differs. Grid size comes from the Settings "Drag snap grid" preference via `vellum.set_position_snap_px`. `Viewport.svelte`'s `driveSettleAnimation()` polls `vellum.is_settling()` in a self-terminating rAF loop.

**Paint order is NOT depth-sorted by tree/z-position - one global pass per primitive type** (all boxes, then all images, then all text). Any text anywhere always paints above any box anywhere, regardless of nesting. Rarely noticeable until views overlap (e.g. via drag). Not yet fixed; would need interleaved per-node draws (loses batching) or a depth buffer.

**The box-model hatch overlay (`build_hatch_instances`/`push_gap_strips` in `render/mod.rs`) computes gap strips per flex LINE, never as one flat sequence across a hovered box's children.** A wrapped row/column (Cluster's default, or any arrangement flipped to `Wrap` via Advanced flex) re-derives line membership geometrically (`group_into_lines`, cross-axis extent OVERLAP in source order, not exact-position matching - `align-items` other than `FlexStart` never shares an exact start position across a line) and bounds each within-line gap strip to that line's own cross-axis extent (`line_cross_extent`), plus one between-line strip per wrap boundary. **Grid gets real 2D gutter geometry from taffy's `detailed_layout_info` cargo feature instead of the flex path** - `push_grid_gap_strips` reads resolved track sizes/gutters off a new `LayoutResult.grid_info: HashMap<usize, DetailedGridInfo>` (populated in `layout/mod.rs`'s `walk_tree` while the `TaffyTree` is still in scope, keyed by node index), never derived from child positions, which breaks the moment a child spans more than one track. A third hatch color, desaturated-blue "unused space" (`push_unused_space_strips`), shows main-axis leading/trailing leftover per line and cross-axis leftover per child when `align-items` isn't `Stretch` - both purely geometric (derived from where children actually landed vs. their line's own extent), so no special-casing is needed for `justify-content`'s `Space*` distributions.

**`HatchInstance` carries a `mode` field (`0.0` = diagonal hatch stripes, `>= 0.5` = solid fill), letting the grid-line overlay's track-boundary lines (`build_grid_line_instances`) ride the exact same pipeline/buffer as the padding/gap hatch** - `push_solid_rect` is `push_hatch`'s solid sibling, and `hatch_shader.wgsl`'s `fs_main` computes the diagonal-stripe coverage unconditionally (never behind an `if` on `mode`) then `select()`s between it and full coverage, since a derivative op (`fwidth`) in non-uniform control flow is a Dawn/WebGPU runtime rejection naga doesn't catch. The overlay draws every resolved grid line (not just internal gutters, unlike `push_grid_gap_strips`) plus 1-indexed line-number labels (`grid_line_labels`, riding the same `desired_screen_px / view_zoom` constant-screen-size trick `rebuild_selection_instances` uses for its corner handles) for any hovered OR selected Grid box - needs zero editor-side wiring, since hover/selection state already travels with scene data. Full history: `resources/grid-mastery-plan.md`.

**API surface used:**

```ts
vellum.initialize(canvasId, w, h)  // once on mount
vellum.set_data(json)              // update UiNode[]
vellum.render()                    // draw one frame, on demand
vellum.resize(w, h)
vellum.set_pan(dx, dy)
vellum.zoom_in_at(cx, cy) / vellum.zoom_out_at(cx, cy)
vellum.set_colors(...)             // grid + background colors
vellum.set_show_box_model(on)      // padding/gap hatch overlay toggle
vellum.ensure_index_visible(index) // frame a node iff <85% visible; zooms out (never in) if needed
vellum.set_position_snap_px(px)
vellum.start_node_drag(index, sx, sy) / vellum.update_node_drag(sx, sy) / vellum.end_node_drag()
vellum.is_settling()
```

**Rendering is on-demand, not a perpetual rAF loop.** `Viewport.svelte`'s `requestRender()` schedules at most one rAF-deferred call, coalescing bursts. Every state mutation affecting the screen must call it explicitly (data/theme effects, wheel/pointer handlers, ResizeObserver). `vellum.load_font()` calls happen outside `Viewport.svelte` (font scan, font picker), so they go through `requestVellumRender()` (`vellum-instance.ts`), a module-level indirection to Viewport's registered `requestRender`. **Adding a new Vellum-mutating call site must pair it with one of these**, or the change sits unpainted until an unrelated interaction triggers the next frame. `continuousMode` (currently always `false`) is the reserved hook for future perpetual-animation work.

**`requestRender()` is also gated on `hasData`** (the first real `set_data()` call) so an early render (ResizeObserver's initial callback, init-time color apply) can't paint a background+grid frame visible around the loading logo before real project data lands. Correspondingly, `create_graphics_for_canvas`'s initial `scene` must stay `Vec::new()`, never `example_scene()` (a native/standalone-only dev fixture) - reusing it on web would flash placeholder content for one frame before real data arrives.

---

## Data Flow

### Resolve flow (axis change or view selection)

```
DB write (axis_args or render_entries)
  → PGlite live query fires
  → scheduleReResolve (debounce 0ms)
  → fetchResolutionRows(db, projectId)        [single batched UNION ALL query, 1 IPC crossing]
  → rowsKey(rows) == lastRowsKey? → skip entirely (input-level dedup)
  → resolveViewsFromRows(rows)                [pure sync, no db]
  → resolvedViews = result                    [new array ref → fires downstream $effect]
  → $effect: setData(resolvedKits, hints, viewId, resolvedViews)
  → debounce 0ms → enqueue(runResolve)
  → plugin.call('on_resolve', payload)        [Charter WASM, worker thread]
  → on_resolve stores last_resolve_input
  → returns OnResolveResult
  → viewportData = JSON                       [Svelte reactive state]
  → Viewport.$effect: vellum.set_data(d)     [next tick]
  → vellum.render()                          [rAF]
```

### Selection-only fast path

```
User clicks view in Views panel
  → setData(...) + setSelection(id, [])
  → setData cancels selection timer, increments selectionGen
  → only runResolve fires (setSelection sees dataTimer !== null)

User changes secondary selection only (no activeViewId change)
  → setSelection(primary, secondary)
  → selectionGen captured
  → enqueue(makeSelectionChangeRunner(gen))
  → gen check passes → plugin.call('on_selection_change', payload)
  → on_selection_change patches last_resolve_input selection fields
  → re-runs build_viewport → returns viewport_data
  → viewportData updated
```

### Field update flow (Styles panel → DB)

```
User edits a field value in StyleField, confirms (Enter)
  → confirmUpdateStyle() calls onFieldUpdate({layerId, property, value})
  → pluginManager.fieldUpdate(update)
  → enqueue(on_field_update)
  → on_field_update calls kit10_write_render_entry_to_layer
  → host writes render_entry to DB via Manager API
  → DB write triggers resolve flow above
```

**Future (not yet built): hover/preview intermediary value** - a live preview before a Styles suggestion is committed. If implementing, the fit is a sibling entry point (`on_field_preview`) that patches a copy of `last_resolve_input` and reruns `build_viewport`, the same way `on_selection_change` does - never writing the DB, never mutating the stored `last_resolve_input`.

---

## Key Invariants

1. **Do not call `resolveManySlowPath` per-view in the live-query loop.** Use `fetchResolutionRows` + `resolveViewsFromRows` (or `resolveManyViews`) - `resolveManySlowPath` is O(views).

2. **Cancelled + version on async resolve.** The resolution `$effect` sets `cancelled = true` on cleanup and checks `version === reResolveVersion` before writing `resolvedViews`, so fast project switching can't let stale data overwrite fresh data.

3. **Charter is stateless except `last_resolve_input`.** Everything else is rebuilt each call from the payload. The KV store is for plugin-scoped persistence, not cross-call state.

---

## Common Pitfalls

- **Vellum's editor-chrome color constants** (`SELECTION_PRIMARY_COLOR`, `PADDING_COLOR`, `GAP_COLOR`, `SECONDARY_COLOR`, `HANDLE_FILL`) are raw `const [f32;4]` Rust literals, not `UiNode` struct fields - easy to miss in an Oklab-migration sweep that only greps struct field names. They must be **hand-precomputed Oklab literals** with a `// from_srgb([...])` comment, since a `const` can't call a non-`const fn` conversion. Grep for `const.*\[f32; 4\]` too when changing what a color field means anywhere in this codebase.

- **Charter and Vellum are two separate WASM builds - editing one's Rust source doesn't rebuild or deploy either.** Charter compiles via `cargo build --target wasm32-unknown-unknown --release` and must be manually copied to `static/charter.wasm`; Vellum compiles via the `wasm-pack` command above, copied into `src/lib/vellum/`. `cargo test` only builds a native host-target binary for unit tests - it never touches either deployed artifact. After any Rust change meant to reach the running app, rebuild **and copy** the specific artifact (both, if the change touches the contract between them) before testing in a browser.

- **`manager.svelte.ts`'s `viewportData` (JSON) and `viewportDataBinary` (MessagePack) are two independent caches of the same resolve result - don't gate setting one on the other's absence.** Charter's `viewport_data` is a required field, always sent alongside the optional `viewport_data_binary`. Setting `viewportData` only in an "else, no binary present" branch starves every JSON consumer (`kit10_get_interpreter_output`) the moment a project has real content. Set both independently, unconditionally, on every resolve.

- **A `#[serde(rename_all = "camelCase")]` added to a Charter struct that crosses into `manager.svelte.ts`'s snake_case reads silently breaks that field with zero errors anywhere** - Rust unit tests that assert on struct fields (not serialized JSON) won't catch it; the JS side just sees `undefined` and falls back to an empty default. Only `on_field_update`'s JS-authored input structs need camelCase; JSON *this plugin authors* for the editor (`OnResolveResult`, `OnSelectionChangeResult`) must stay snake_case. Write tests against the serialized JSON string's key names, not just Rust struct fields. (The `UiNode` wire itself is no longer guarded by a hand-copied golden fixture - both Charter and Vellum compile against the shared `kit10-scene` crate now, so a field rename is a compile error on both sides instead of a silent JSON mismatch.)

- **`parse_px` only handles pixel values; `parse_extent` is the sizing parser.** `parse_px` (padding/gap/border-width/font-size) silently returns `0.0` for `auto`/`%`/`em`. Box sizing properties (`width`/`height`/`min-*`/`max-*`) go through `parse_extent` instead (`N%` → `Percent`, `Npx`/bare-`N` → `Px`, `auto`/empty → `Auto`). `em` isn't supported anywhere.

- **`parse_color` returns `OklabColor`, not `[f32;4]` RGBA** - its wire shape (`{l,a,b,alpha}`) is deliberately incompatible with the pre-2026-07-17 array shape, so a stale build fails to deserialize loudly instead of silently reinterpreting sRGB floats as Oklab. See `resources/oklch.md`.

- **A view referenced by nobody's `children` always renders top-level - there's no separate "hide this view" flag.** `build_viewport` derives this from the composition graph itself. If a view should only ever appear as a child, put it in some box's `children`.

- **The resolver is name-neutral about composition - it does NOT know `children`.** Any alias with one or more `view`-typed token rows is carried as `ResolvedProperty.viewRefs` (`{viewId, tokenId}[]`), gated on value type, never property name. The opinion "`children` means nest into a box" lives entirely in Charter's `composition_field_keys` + the editor's DAG walk off it - never in `resolve.ts`.

- **The editor nests the Views tree off Charter's VIEW-INDEPENDENT `composition_field_keys`, not the active view's categories** (`fieldCategories`). Deriving it from the active view's own categories empties the keys and flattens the whole tree whenever a text/no-kit view happens to be selected.

- **A view referenced by more than one simultaneously-active `view`-typed token renders and selects independently - this is now real, end to end.** An **occurrence key** (`ViewOccurrence` in `view-tree.ts`) identifies one specific rendered instance: the referencing token's own id for a nested child, or the view's own id for a root (a root is unreferenced by definition, so it has exactly one occurrence). Charter's `build_viewport` builds an `occurrence_map` (keyed by occurrence key, from `OnResolveInput.overridden_occurrences`) alongside the existing `view_map`, and `render_view_nodes` consults it FIRST when recursing into a child reference - so an overridden occurrence renders its own `resolved_kits`, never the shared per-`view_id` one. `node_occurrence_ids: Vec<String>` (parallel to `node_view_ids`/`viewport_data`, `""` for structural scaffolding) is the wire mechanism the editor uses to map a click/hover back to the exact instance, not just the first node sharing that view id. **"Active" stays view-level** (`SelectionCtx.active_view_id`, still the Render/Axes/Tokens panel's edit target, shared by every occurrence of a view), **but click-selection and hover are occurrence-level** (`SelectionCtx.selected_occurrence_primary`/`selected_occurrence_secondary`/`hovered_occurrence_id`, `EditorSelection.selectedOccurrencePrimary`/`selectedOccurrenceSecondary`, `hoveredOccurrenceKey`). `view-tree.ts`'s `ViewTree`/`buildViewTree`/`parentOf`/`navigate`/`resolveDragTargetViewId` all operate on `ViewOccurrence` now (not bare view ids) - `childrenByViewId` holds a view's own plain children (view-level, shared across its non-overridden occurrences), `overriddenChildrenByOccurrenceKey` holds an override's own (possibly different) children, and `childrenOf()` is the fallback lookup mirroring Charter's `occurrence_map`-then-`view_map` order exactly. `manager.svelte.ts`'s `serializeResolvedKits` sends `ResolvedProperty.viewRefs` as the full `{viewId, tokenId}[]` shape now (no longer flattened) since Charter's `ResolvedProperty.view_refs: Option<Vec<ViewRef>>` accepts it directly. Keyboard `[`/`]`/arrow-nav and viewport drag-to-reparent are occurrence-aware for parent/child/sibling WALKING (so they correctly disambiguate which specific instance's ancestor chain to follow), but drag-to-reparent's actual TARGET is still a plain view id (an occurrence has no independent position/hint storage - `hints.vellum.position` is per-view). The Views panel's tree ops (`build_views_panel_manifest`/`PanelItem`) remain view-id-keyed on purpose - rename/delete/clone are inherently view-level, affecting every occurrence identically; only the tree's row *highlighting* (selected/hovered) and *recursion* (`kitter`'s `occurrenceKey` param, keyed by each ref's own `tokenId`) are occurrence-aware.

- **A per-frame cache split from the real scene data can go stale silently.** `Graphics::build_screen_texts`'s `text_cache` used to only set `content`/`font_family`/`font_weight`/`font_style` once on a freshly-grown slot - editing those properties on an existing node's index silently never reached the renderer (layout updated, glyphs didn't). Always resync every field from fresh layout data every frame; a cache like this exists only to reuse the `Vec` allocation, never to freeze content.

- **"The live query fired and a resolve ran" is not the same guarantee as "this compiled field reflects only the current state."** Live queries and the resolve pipeline solve reactivity at the DB-row level (did anything relevant change) - they say nothing about whether a COMPILE function inside that resolve is itself a pure function of all currently-relevant inputs. `compile_arrange`'s Grid-container fields (`grid_template_columns`/`rows`/`areas`, `grid_auto_rows`/`columns`, `grid_auto_flow`, `justify_items`, `align_content`) used to fall back to the box's raw stored property whenever the compiled value was `None` - correct while `arrange` was actually Grid, but the same unconditional fallback kept firing after switching to Stack/Split too, since nothing ever rewrites that raw property on a mere tab switch. Every live-query cycle ran end to end correctly; the bug was invisible to that whole chain because the resolve itself kept computing a value that depended on a field no longer relevant to the box's current mode, and Vellum (correctly, per its own logic) rendered whatever `BoxData` it was faithfully handed. Audit any `unwrap_or_else(|| raw_prop)`-shaped fallback in a compile function for whether the fallback should be gated on the same condition that produced the `None` in the first place - not just "does a write to this row eventually trigger a re-resolve."

- **PGlite is single-threaded.** `Promise.all` for multiple queries does not parallelize them; they queue behind each other in the worker. This is why `fetchResolutionRows` uses one batched UNION ALL query instead.

- **A multi-step write not wrapped in `db.transaction()` pays a separate commit cost per statement**, which dominates for a deeply recursive operation. `cloneViewSubtreeImpl`/`instantiateKitDefaultsImpl` wrap their exposed entry points in a single transaction, and were further rewritten from a one-row-at-a-time recursive walk to a two-phase batched clone (BFS discovery with pre-generated ids, then one bulk insert per table) - O(tree depth) round-trips instead of O(nodes). The batched version preserves the original recursive DFS's diamond-vs-cycle semantics via `CloneSite { oldId, newId, ancestors }`, one site per traversal *position* (not per distinct old id): a diamond (same old id reachable via two non-overlapping parent paths) clones twice independently; a genuine cycle terminates by checking the *site's own ancestor chain*, not a global visited set. `cloneViewSubtree` (not `instantiateKitDefaults`) also re-attaches a non-root clone as a sibling immediately after its source, inside the same transaction.

- **Every self-transacting `Api` method (`api/index.ts`) opens its transaction via `withTransaction(db, fn)`, never a bare `db.transaction().execute(fn)`.** Kysely's `Transaction` throws if you call `.transaction()` on a handle that's already one (no nested-transaction support) - `withTransaction` checks `db.isTransaction` and, if already inside one, just runs `fn` against the existing transaction instead of nesting. This is what lets a caller wrap a whole BATCH of API calls in one outer transaction without individually auditing which of those calls self-transact internally. `initEditorDB` (`index.ts`) is the first such caller: the entire seed (`registerBuiltinPlugins` + all 4 demo projects, thousands of individual inserts previously each paying its own commit) now runs inside one transaction, cutting real first-load time. Any NEW self-transacting `Api` method must use `withTransaction`, not `db.transaction()` directly, or it silently breaks the moment it's called from inside a larger transaction.

- **Never map a "where is this node" concept onto taffy's `Position::Absolute` for an auto-sized box.** It bundles "don't participate in flow" with "compute your own size via CSS shrink-to-fit," which probes width via `Definite(0.0)` rather than `MinContent`/`MaxContent` - collapsing text to a real zero-width wrap. `NodePosition` placement is instead a fully independent taffy tree (ordinary auto-sizing) plus a pure post-layout translation. If you need "don't affect siblings" without "resize via shrink-to-fit," decouple placement from sizing entirely; don't reach for `Position::Absolute`.

- **`compile_resize`'s cross-axis default belongs on the container (`compile_arrange`'s `align_items`) for the UNSET-property case, never unconditionally on the child's own `align_self`.** An item's `align-self` always beats its container's `align-items` in CSS/taffy, so a per-child default (even one that only fires when the property was never explicitly set) silently defeats every arrangement kind's own `align_items` opinion at once - Cluster's `FlexStart`, Split's/Center's `Center`, Stack-Row's `Center` - the moment that child's cross-axis length happens to be unset, which is the common case. This was shipped once as a `compile_resize` change (an unset cross-axis property reading as "Hug" in `StyleField.svelte`, defaulted to `align_self: FlexStart` to stop implicit stretch) and broke Split/Center centering across every seeded demo project; the correct fix for the *unset* case lives in `compile_arrange`'s `Stack` branch instead (Column variant now also defaults `align_items: FlexStart`, mirroring Row's `Center`), since that's scoped to Stack alone and never touches a child's `align_self`. Separately, an *explicit* `hug` keyword legitimately does need its own per-child `align_self: FlexStart` override (that's the whole point of Hug) - but only when the parent's own resolved `align_items` would otherwise default to stretch, never unconditionally; see `compile_resize`'s `parent_align_items` parameter above, which was the second half of this same bug (Hug's own override, not just the unset-property default, was also unconditionally stomping a deliberate `Center` parent).

- **A box's `flex_direction` for computing its CHILDREN's main/cross axis must come from the box's own already-resolved `flex_direction` field (post `compile_arrange`), never by re-reading the raw `flex-direction` property directly.** Cluster and Split both default their direction to Row without the raw property ever being set (`resolve_flex_direction`) - Cluster's own doc comment even says its identity "comes entirely from these defaults." `render_view_nodes`' `child_main_horizontal` used to `matches!(get_prop(&merged, "flex-direction"), Some("row") | Some("row-reverse"))`, which is `false` (Column) for an untouched Cluster/Split, silently swapping which axis children's Fill/Hug main-axis behavior (`flex-grow`/`shrink`) applies to. Fixed by reading `box_data.flex_direction` (the `BoxData` already built via `compile_arrange`) instead.

- **`#[host_fn]` declarations must use typed structs, never raw `u64`.** extism-pdk's macro always routes non-`()` params/returns through `ToMemory`/`FromBytes`; a `u64` param gets re-serialized as a raw value instead of passed through as the memory offset, silently corrupting the call. Use typed structs deriving `ToBytes, FromBytes` + `#[encoding(Json)]`, and remember every boundary-crossing struct needs `#[serde(rename_all = "camelCase")]` (a mismatch fails deserialization silently via `unwrap_or_default()`).

- **Vellum's box shader assumes an opaque fill wherever a border is drawn.** `composite_border` blends using the fill's own alpha as the base - a transparent fill with an opaque border renders completely invisible, border included. Any hollow/outline-only box needs the fixed alpha-compositing formula (blend "border over fill" alpha, not just RGB).

- **`cargo build` does not validate embedded WGSL** - shader source is loaded as a string and only compiled by wgpu at runtime in-browser. Validate with `naga` (`naga::front::wgsl::parse_str` + `Validator::validate`) before shipping an untestable shader change. **One class naga does NOT catch: derivative ops (`fwidth`/`dpdx`/`dpdy`, implicit-LOD `textureSample`) in non-uniform control flow** - naga passes it, Dawn/WebGPU rejects the whole pipeline at runtime (black screen). Keep derivative calls in uniform control flow; compute them unconditionally and `select()` between branch results rather than branching around them.

- **Vellum's `SceneUniforms` is one shared uniform buffer read by several WGSL shaders, each declaring only the fields it needs** (a byte-compatible prefix, not the whole struct). New fields must always be **appended at the end, never inserted in the middle** - naga only validates one shader file in isolation and has no idea the buffer is shared, so a mid-insert silently corrupts every other shader's offsets with zero compile-time error. Keep the Rust struct's total size a multiple of 16 bytes.
  - **`vec3<T>` has 16-byte alignment in WGSL's uniform space; Rust's `[f32; 3]` does not.** Using `vec3<f32>` as an explicit WGSL padding field to mirror a Rust `[f32; 3]` pad shifts every subsequent field's offset. Either match Rust's padding with individual scalar fields, or (simpler) don't declare padding in WGSL at all and let implicit std140-like alignment insert the same padding automatically.

- **Don't gate an inputType-specific widget on `!isToken`.** A kit-default property (e.g. `src`, `content`) is typically token-backed (`isToken: true`) - gating a custom widget on `!isToken` hides it for the most common case. `isToken` only signals the write target (token vs. literal render entry), never how the value should be edited. Check `inputType` alone.

- **Every Render-panel widget commits through `src/lib/editor/panels/field-commit.ts`, never a bare `onFieldUpdate({ value })`.** `commitFieldValue` writes to the shared token via `api.updateTokenValue` when the property is token-backed (`isToken && tokenId`), and a literal render entry otherwise. A bare `onFieldUpdate` with no `tokenId` silently clears the token link on every edit. Detaching a token to a literal must be an explicit action (`detachToken`), never an edit side effect. New field components must route through this and render `TokenBadge` when token-backed.

---

## Open Question: MCP Access to the Editor

An MCP interface for programmatic interaction with the running editor (state/console introspection, triggering actions) has come up as something that would materially help AI-assisted work in this codebase, but it is **under consideration only, not decided and not started**. AI-agent access to design tools is a genuinely contested question beyond just engineering effort. Do not build toward this without explicit direction.
