use extism_pdk::*;
use serde::{Deserialize, Serialize};

// The render wire types now live in the standalone kit10-scene crate (the contract Charter and
// Vellum both conform to), not in Charter. Charter builds and serializes these; it no longer owns
// their definition.
use kit10_scene::{
    AlignValue, BoxData, BoxExtra, Deform, Extent, FillRule, FlexDir, FlexWrapValue, FontStyle,
    GridAutoFlow, GridLine, GridTemplateArea, ImageSource, ImgData, JustifyValue, NodePosition,
    OklabColor, PathSegment, ShapeData, ShapeKind, SpriteBatchData, SpriteInstance, TextAlign,
    TextData, TextDecorationKind, TrackMax, TrackMin, TrackSize, UiNode,
};

/// Map Charter's internal flex-direction string (as `resolve_flex_direction` produces it, always
/// one of the four `FlexDir` variant names) to the wire enum. Unknown → `Column`.
fn flex_dir_from_str(s: &str) -> FlexDir {
    match s {
        "Row" => FlexDir::Row,
        "RowReverse" => FlexDir::RowReverse,
        "ColumnReverse" => FlexDir::ColumnReverse,
        _ => FlexDir::Column,
    }
}

// One view reference: the target view plus the id of the specific `view`-typed token row that
// names it. `token_id` is this reference's OCCURRENCE KEY when Charter renders it as a nested
// child -- distinct references to the same `view_id` (two different tokens) are two independent
// occurrences, each potentially resolving differently if `token_id` carries an axis override (see
// `OverriddenOccurrence`). A root view (referenced by nobody) uses its own `view_id` as its
// occurrence key instead -- see `render_view_nodes`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ViewRef {
    view_id: String,
    token_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResolvedProperty {
    property: String,
    value: String,
    source_layer_id: String,
    kit_id: String,
    is_token: bool,
    token_alias: Option<String>,
    condition_count: u32,
    // Views this property's value references (set by the resolver for any alias with one or more
    // `view`-typed token rows, name-neutrally). Charter treats its OWN `children` field's
    // view_refs as nested children -- that opinion lives here, in the plugin, not in the resolver.
    #[serde(default)]
    view_refs: Option<Vec<ViewRef>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResolvedKit {
    kit_id: String,
    kit_name: String,
    properties: std::collections::HashMap<String, ResolvedProperty>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct FieldDef {
    key: String,
    #[serde(rename = "displayText")]
    display_text: Option<String>,
    // "color" | "text" | "number" | "select" | "slider" | "font" | "arrange" | "spacing" |
    // "weight" | "align" | "decoration" | "grid-tracks" | "grid-area-painter" | "grid-auto-flow" |
    // "align-picker" -- how the editor should render this field's input. None means the editor's
    // default (plain text).
    #[serde(rename = "inputType", default)]
    input_type: Option<String>,
    // Names which utility plugin + functions serve suggestions for this field -- the editor
    // never hardcodes a specific plugin (e.g. Fontavious) or property key. See VISION.md's
    // 1st Principle: "no lock-in to a specific tool for a specific job."
    #[serde(rename = "suggestionsFrom", default)]
    suggestions_from: Option<SuggestionSource>,
    // Only set on the "arrange" field. Declares the companion property keys/FieldDefs its tab
    // widget reads and writes, so the editor never hardcodes property names like "flex-direction"
    // or "gap" -- same "typed side-channel keyed by inputType" shape as suggestions_from.
    #[serde(rename = "arrangeKeys", default)]
    arrange_keys: Option<Box<ArrangeKeys>>,
    // Only set on "resize" fields (width/height). Declares the dimension's min/max limit fields
    // as the resize control's own contextual follow-ons instead of four permanent top-level rows
    // (layout-affordances Phase 4) -- same side-channel shape as arrange_keys.
    #[serde(rename = "resizeKeys", default)]
    resize_keys: Option<Box<ResizeKeys>>,
    // Only set on inputType "spacing" fields. "scalar" (gap, cell-min -- one number) vs "box"
    // (padding -- CSS 1/2/3/4-value shorthand, with a 1<->4 expand/collapse affordance).
    #[serde(rename = "spacingMode", default)]
    spacing_mode: Option<String>,
    // Only set on inputType "radius" fields (border-radius). Declares the companion boolean
    // squircle-mode property, ridden as the same control's inline toggle button rather than a
    // second visible top-level row -- same side-channel shape as resize_keys' min/max.
    #[serde(rename = "radiusKeys", default)]
    radius_keys: Option<Box<RadiusKeys>>,
}

impl FieldDef {
    fn new(key: &str, display_text: Option<&str>) -> Self {
        FieldDef {
            key: key.to_string(),
            display_text: display_text.map(str::to_string),
            input_type: None,
            suggestions_from: None,
            arrange_keys: None,
            resize_keys: None,
            spacing_mode: None,
            radius_keys: None,
        }
    }

    // Charter only ever claims *what kind* of field this is (e.g. "font" -- this holds a font
    // family name). It deliberately never names a specific suggestion-provider plugin --
    // *which* plugin currently serves that inputType is an editor/project-level choice (see
    // src/lib/plugins/suggestion-providers.ts), swappable without recompiling Charter.
    fn with_input_type(mut self, input_type: &str) -> Self {
        self.input_type = Some(input_type.to_string());
        self
    }

    fn with_arrange_keys(mut self, keys: ArrangeKeys) -> Self {
        self.arrange_keys = Some(Box::new(keys));
        self
    }

    fn with_resize_keys(mut self, keys: ResizeKeys) -> Self {
        self.resize_keys = Some(Box::new(keys));
        self
    }

    fn with_spacing_mode(mut self, mode: &str) -> Self {
        self.spacing_mode = Some(mode.to_string());
        self
    }

    fn with_radius_keys(mut self, keys: RadiusKeys) -> Self {
        self.radius_keys = Some(Box::new(keys));
        self
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SuggestionSource {
    plugin: String,
    search_fn: String,
    #[serde(default)]
    fetch_fn: Option<String>,
}

// Declared only on the "arrange" FieldDef (see box_categories). Charter's one earned arrangement
// opinion (Stack/Cluster/Split/Center/Grid tabs) needs its editor widget to read/write several
// OTHER properties beyond its own (direction, gap, grid cell-min, plus the raw escape-hatch
// fields for each tab's "Advanced" disclosure) -- this struct is how it declares them as data
// instead of the editor hardcoding property names (see the "Editor Plugin Agnosticism" note in
// CLAUDE.md). `gap`/`cell_min` carry full FieldDefs (not just key strings) so the editor can hand
// them straight to the existing generic StyleField component, exactly like `advanced`/
// `grid_advanced` already must.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ArrangeKeys {
    // Property the Direction (Stack) / Axis (Split) segmented control writes -- "flex-direction".
    direction_key: String,
    gap: FieldDef,
    cell_min: FieldDef,
    // Stack/Cluster/Split/Center's "Advanced flex" disclosure: raw flex-direction/align-items/
    // justify-content/flex-wrap/display fields, still real panel controls, one click away.
    advanced: Vec<FieldDef>,
    // Grid's "Custom tracks" disclosure: raw grid-template-*/grid-auto-*/grid-column/grid-row/
    // grid-template-areas/justify-self text fields -- the CSS-Grid sublanguage the friendly
    // controls below replace as the *default* surface, not as a capability. Stays available
    // underneath them, same "advanced, not first contact" stance as `advanced` above.
    grid_advanced: Vec<FieldDef>,
    // Grid's own friendly controls -- full FieldDefs (same `inputType`-tagged shape `gap`/
    // `cell_min` already are) for the track-list builder, area painter, and alignment/flow
    // pickers, so those new editor widgets read/write the SAME underlying properties as
    // `grid_advanced`'s raw text fields (two views onto one property, never a shadow copy) without
    // ever hardcoding a property key themselves.
    grid_columns: FieldDef,
    grid_rows: FieldDef,
    grid_areas: FieldDef,
    grid_auto_flow: FieldDef,
    grid_justify_items: FieldDef,
    grid_align_content: FieldDef,
}

// Declared only on the two "resize" FieldDefs (width/height in box_categories). Phase 4 of
// layout-affordances: min/max limits matter only when a dimension can actually vary with context
// (Fill, or a fixed percent of a parent that isn't self-sized -- see CLAUDE.md's `min_width`
// percent-floor note), so instead of four permanent top-level rows they ride the resize control
// as its own inline follow-ons, revealed exactly when meaningful. Full FieldDefs, same reason as
// ArrangeKeys: the editor hands them straight to the generic StyleField, hardcoding nothing.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResizeKeys {
    min: FieldDef,
    max: FieldDef,
}

// Declared only on "radius" FieldDefs (border-radius). Squircle mode is a companion boolean
// property riding the SAME visible Radius row as its own inline toggle button, never a second
// top-level row -- same side-channel shape as ResizeKeys' min/max. The boolean is carried as an
// ordinary resolved property, parsed truthy on "1" (see extract_paint_props), empty/absent = off.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RadiusKeys {
    squircle: FieldDef,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
enum ArrangeKind {
    Stack,
    Cluster,
    Split,
    Center,
    Grid,
}

impl Default for ArrangeKind {
    fn default() -> Self {
        ArrangeKind::Stack
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct FieldCategory {
    name: String,
    fields: Vec<FieldDef>,
}


// No rename_all here -- viewport_data/node_view_ids are read as snake_case by
// manager.svelte.ts (matching the pre-existing viewport_data convention), unlike the
// camelCase-input structs elsewhere in this file that come from JS-authored payloads.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct OnResolveResult {
    categories: Vec<FieldCategory>,
    viewport_data: Vec<UiNode>,
    // Parallel to viewport_data (same length/order) - which view each node belongs to, for the
    // editor to resolve a viewport click-to-select hit-test index back to a view id. "" for
    // structural grid scaffolding nodes that don't belong to any view. Deliberately not a field
    // on UiNode itself: view identity has zero rendering relevance, so it never crosses into
    // the wire format Vellum deserializes.
    node_view_ids: Vec<String>,
    // Parallel to viewport_data (same length/order) - this node's OCCURRENCE key: the referencing
    // `view`-typed token's own id for a nested child, or the view's own id (same as node_view_ids'
    // entry) for a root. "" for structural scaffolding, matching node_view_ids. Lets the editor
    // disambiguate a click/hover/selection to the SPECIFIC rendered instance rather than the first
    // node sharing that view id, when the same view is rendered more than once (see
    // OverriddenOccurrence / SelectionCtx).
    #[serde(default)]
    node_occurrence_ids: Vec<String>,
    // Parallel to viewport_data (same length/order) - the highest-priority composed Kit's id for
    // each node, "" for structural scaffolding or a kit-less view. Lets WebCodium's Kit-basis
    // export (Phase 3) name which Kit a node came from -- a Kit has no subtree of its own in the
    // merged output (merge_kits collapses composed kits into one property map per node), so this
    // is the only place that fact survives past resolution. See resources/webcodium-export-plan.md.
    #[serde(default)]
    node_kit_ids: Vec<String>,
    // The concrete (family, weight, style) set the viewport renders, post weight-snapping -
    // what the editor's font scan should fetch (see resolve_font_weight). snake_case like the
    // rest of this Charter-authored struct.
    #[serde(default)]
    font_requests: Vec<FontRequest>,
    // MessagePack-encoded Vec<UiNode>, base64-encoded for JSON transport. Present when the
    // viewport data is non-empty. The JS side decodes this and calls `vellum.set_data_binary()`
    // instead of JSON-stringifying viewport_data and calling `vellum.set_data()`. This avoids
    // the ~47ms JSON parse wall at 10k views on Vellum's side, plus the redundant
    // JSON.stringify on the JS side.
    #[serde(skip_serializing_if = "Option::is_none")]
    viewport_data_binary: Option<String>,
}

// One entry in a panel manifest the plugin publishes via `kit10_panel_publish`. The editor's
// panels are generic renderers over this shape. The schema carries only the plugin's
// *opinionated* facts per item - never generic graph math. Concretely: a panel-item carries
// identity, the write-alias for composition edits, and the ops the plugin declares available on
// it. Tree topology (parent/child, root-ness) is computed host-side from `resolvedViews` +
// `PanelManifest.composition_field_keys`, because that's a generic graph walk the host is
// perfectly positioned to do - routing it through the plugin just to "dedupe" wrapped a
// universal computation across the WASM boundary for nothing. Similarly, the panel icon comes
// from the view's `hints.view_icon`, authorable directly - Charter has no business emitting
// icon strings for the editor's panel.
//
// No rename_all - plugin-authored output the editor reads, same snake_case rule as
// OnResolveResult (see the camelCase pitfall in CLAUDE.md).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct PanelItem {
    id: String,
    // Token alias to upsert when the editor's DnD writes this item's children list. None when
    // this item's primitive has no `children` field (e.g. Text/Image) - editor hides the DnD
    // nesting affordance in that case. The alias itself comes from the resolved `children`
    // property's `token_alias`, since that's what the editor's `api.upsertViewToken` writes-by-alias
    // call already targets (see CLAUDE.md's View-token override pitfalls).
    #[serde(default)]
    write_alias: Option<String>,
    // Ops the plugin declares available on this item - drives the editor's right-click context
    // menu for this item. Each op is self-describing: `name` is the dispatch key the editor
    // switches on, `label`/`icon` are what to render. Editor shows the menu item iff `name` is
    // in this list; plugin owns what's available, editor owns how to execute. The op set is
    // per-primitive (a Box gets `add-child` ops; a Text/Image doesn't - see
    // build_views_panel_manifest).
    #[serde(default)]
    ops: Vec<PanelOp>,
}

// One operation the plugin declares available on a panel item (or a panel header, via
// `PanelManifest.header_ops`). Self-describing: the editor renders menu items straight off
// `{label, icon}` and switches on `name` to dispatch. `kind` is an op-specific payload - today
// only `add-child` uses it to carry which primitive to create ("box"|"text"|"image"); other ops
// leave it None. Future ops can extend `kind`'s vocabulary without changing this struct.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct PanelOp {
    name: String,
    label: String,
    #[serde(default)]
    icon: String,
    #[serde(default)]
    kind: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct PanelManifest {
    panel_id: String,
    // The resolved-property keys Charter treats as view-composition fields (its fields whose
    // `inputType` is the composition kind). VIEW-INDEPENDENT - this is the full, stable set
    // across every primitive, so the editor can nest the Views tree by field-kind no matter
    // which view happens to be active. The host walks `resolvedViews` for these keys' `viewRefs`
    // to build the DAG client-side (the same math `build_viewport`'s `referenced` set uses, but
    // generic and host-owned, not in the manifest). This is Charter's whole opinion on nesting:
    // *which field is the composition one*. Everything else - root detection, ordering, cycle
    // guarding - is the host's.
    #[serde(default)]
    composition_field_keys: Vec<String>,
    // One entry per opaque id (today: one per project view id). The editor indexes by `id` and
    // applies each write_alias/ops as it renders. Topology lives host-side now (computed from
    // `resolvedViews` × `composition_field_keys`), so there's no `child_ids`/`is_root` here.
    #[serde(default)]
    items: Vec<PanelItem>,
    // Ops declared for the panel's header affordance (e.g. the "+" menu in the Views panel
    // header). Same shape as per-item `ops`; the editor renders the header menu straight off
    // this list. Today Charter uses it for `add-child` (the "create a top-level Box/Text/Image"
    // trio). Separate from per-item ops because the header isn't tied to a specific item.
    #[serde(default)]
    header_ops: Vec<PanelOp>,
}

// Input to the `kit10_panel_publish` host fn - Charter authors this, JS reads it. No
// rename_all (snake_case wire, same reasoning as WriteRenderEntryInput above).
#[derive(Debug, Clone, Serialize, Deserialize, ToBytes, FromBytes, Default)]
#[encoding(Json)]
struct PanelPublishInput {
    panel_id: String,
    manifest: PanelManifest,
}

// No rename_all here -- same reasoning as OnResolveResult above.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct OnSelectionChangeResult {
    viewport_data: Vec<UiNode>,
    node_view_ids: Vec<String>,
    #[serde(default)]
    node_kit_ids: Vec<String>,
    #[serde(default)]
    node_occurrence_ids: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    viewport_data_binary: Option<String>,
}
fn encode_viewport_data_binary(data: &[UiNode]) -> Option<String> {
    if data.is_empty() {
        return None;
    }
    use serde::Serialize;
    let mut buf = Vec::new();
    // rmp_serde serializes structs as arrays by default, but Vellum's deserializer
    // expects maps (struct-variant format). with_struct_map() fixes this - see
    // CLAUDE.md's "bincode was unmaintained" and the rmp_serde replace note.
    let mut ser = rmp_serde::Serializer::new(&mut buf).with_struct_map();
    data.serialize(&mut ser).ok()?;
    Some(base64::Engine::encode(
        &base64::engine::general_purpose::STANDARD,
        &buf,
    ))
}
struct CreatablePrimitive {
    kind: &'static str,
    item_label: &'static str,
    header_label: &'static str,
    icon: &'static str,
}

// Charter's single canonical opinion on which view primitives can be created from the Views
// panel. container_item_ops()/views_header_ops() both derive from this instead of hand-typing
// the box/text/image trio twice. `kind` must match the vocabulary detect_primitive()/
// CharterHints.primitive use elsewhere in this file.
const CREATABLE_PRIMITIVES: &[CreatablePrimitive] = &[
    CreatablePrimitive {
        kind: "box",
        item_label: "Add Box",
        header_label: "Box",
        icon: "fa-regular fa-window-maximize",
    },
    CreatablePrimitive {
        kind: "text",
        item_label: "Add Text",
        header_label: "Text",
        icon: "fa-solid fa-italic",
    },
    CreatablePrimitive {
        kind: "image",
        item_label: "Add Image",
        header_label: "Image",
        icon: "fa-solid fa-image",
    },
    CreatablePrimitive {
        kind: "shape",
        item_label: "Add Shape",
        header_label: "Shape",
        icon: "fa-solid fa-shapes",
    },
    CreatablePrimitive {
        kind: "sprite-batch",
        item_label: "Add Sprite Batch",
        header_label: "Sprite Batch",
        icon: "fa-solid fa-icons",
    },
];

// Convention mapping from a view primitive to its FA icon class - authoritative for what
// `hints.view_icon` values the seed sets. Derived from `CREATABLE_PRIMITIVES` so it can't drift
// from the real add-child table. `#[cfg(test)]` because production code no longer calls it
// (Phase 3 moved icon authoring to the seed's `hints.view_icon`), but the test
// (`primitive_icon_maps_text_to_italic_and_box_to_window`) still references it as the
// documented convention that seed.ts follows, guarding against drift.
#[cfg(test)]
fn primitive_icon(primitive: &str) -> &'static str {
    CREATABLE_PRIMITIVES
        .iter()
        .find(|p| p.kind == primitive)
        .map(|p| p.icon)
        .unwrap_or("fa-regular fa-window-maximize")
}

// Charter's composition fields, across all primitives -- the fields it declares with the
// composition inputType. This is the single plugin-owned fact about nesting: "this resolved
// property name is the one whose `viewRefs` are the children." Everything else in nesting
// (root detection, ordering, cycle guarding) is host-side generic graph math over
// `resolvedViews` + this list - see build_views_panel_manifest's caller in Views.svelte.
fn composition_field_keys() -> Vec<String> {
    box_categories()
        .into_iter()
        .chain(text_categories())
        .flat_map(|c| c.fields)
        .filter(|f| f.input_type.as_deref() == Some("children"))
        .map(|f| f.key)
        .collect()
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct CharterHints {
    primitive: Option<String>,
}

// Hints consumed straight-through into Vellum's UiNode wire fields with no Charter-side
// interpretation, kept separate from CharterHints (which holds Charter's own translation
// choices - currently just the primitive override).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct VellumHints {
    position: Option<[f32; 2]>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct ViewMeta {
    view_id: String,
    view_name: String,
    #[serde(default)]
    hints: std::collections::HashMap<String, serde_json::Value>,
    #[serde(default)]
    resolved_kits: Vec<ResolvedKit>,
}

// One occurrence whose reference (a `view`-typed token, `occurrence_key` == that token's own id)
// carries an axis override that changed its own resolution independently of its target view's
// plain `ViewMeta` entry in `project_views`. `render_view_nodes` consults this (keyed by
// `occurrence_key`) FIRST when recursing into a child reference, falling back to `view_map` when
// no entry exists -- the common, non-overridden case. See manager's `resolveViewsFromRows`'s
// `OverriddenOccurrence`, which this mirrors field-for-field.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct OverriddenOccurrence {
    occurrence_key: String,
    view_id: String,
    #[serde(default)]
    resolved_kits: Vec<ResolvedKit>,
}

// One weight-range + style a font family actually has. Host-assembled from Fontavious's
// catalogue (`family_facts`) today; a future uploaded-font path would contribute entries from
// Vellum's loaded bytes instead - same shape either way (see resources/text-affordances.md's
// two-oracle note). camelCase: this JSON is JS-authored.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct FontFactVariant {
    weight_min: u16,
    weight_max: u16,
    #[serde(default)]
    style: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct FamilyFacts {
    variants: Vec<FontFactVariant>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct OnResolveInput {
    active_view_id: Option<String>,
    resolved_kits: Vec<ResolvedKit>,
    view_hints: std::collections::HashMap<String, serde_json::Value>,
    #[serde(default)]
    project_views: Vec<ViewMeta>,
    // Additive: one entry per `view`-typed token reference whose axis override changed its own
    // resolution. Empty for the common (no overrides anywhere) case. See `OverriddenOccurrence`.
    #[serde(default)]
    overridden_occurrences: Vec<OverriddenOccurrence>,
    // Occurrence keys, not view ids -- "active" (below) stays view-level (editing target, shared
    // by every occurrence of a view), but click-selection/hover are properties of ONE specific
    // rendered instance. See `SelectionCtx`.
    #[serde(default)]
    selected_occurrence_primary: Option<String>,
    #[serde(default)]
    selected_occurrence_secondary: Vec<String>,
    // Patched in by on_selection_change alongside the selection fields above - persisted here
    // (rather than only in OnSelectionChangeInput) so it survives being stashed into
    // last_resolve_input and re-read on the next selection-only patch.
    #[serde(default)]
    hovered_occurrence_id: Option<String>,
    // Keyed by family name as the kit property spells it (matched case-insensitively). Absent
    // families pass their requested weight through untouched - no facts, no opinion. Riding
    // last_resolve_input like everything else, so the selection fast path snaps identically.
    #[serde(default)]
    font_facts: std::collections::HashMap<String, FamilyFacts>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToBytes, FromBytes, Default)]
#[encoding(Json)]
struct WriteRenderEntryInput {
    layer_id: String,
    property: String,
    #[serde(default)]
    value: Option<String>,
    #[serde(default)]
    token_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToBytes, FromBytes, Default)]
#[encoding(Json)]
struct WriteRenderEntryResult {
    success: bool,
    #[serde(default)]
    entry_id: Option<String>,
    #[serde(default)]
    error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct FieldUpdate {
    layer_id: String,
    property: String,
    #[serde(default)]
    value: Option<String>,
    #[serde(default)]
    token_id: Option<String>,
}

// rename_all is required here -- the host (manager.svelte.ts) sends camelCase
// (activeViewId/hoveredViewId). This struct was previously missing it entirely; that went
// unnoticed for active_view_id because a mismatched key just silently deserializes to None
// (#[serde(default)]), and active_view_id happened to get re-synced via the next full
// on_resolve call anyway (OnResolveInput does have rename_all). hovered_occurrence_id has no such
// fallback -- without this attribute it was always silently None, so hover never worked at all.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct OnSelectionChangeInput {
    // Occurrence keys (not view ids) -- see OnResolveInput's selected_occurrence_primary/secondary.
    primary: Option<String>,
    #[serde(default)]
    secondary: Vec<String>,
    // Host always sends this so active_view_id in last_resolve_input never goes stale.
    #[serde(default)]
    active_view_id: Option<String>,
    // Unlike active_view_id, always overwritten unconditionally (including with null) - the
    // host sends null exactly when the mouse leaves a hoverable area, and that must actually
    // clear the hover border, not leave the last-hovered occurrence highlighted. An occurrence
    // key (not a view id) -- see OnResolveInput's hovered_occurrence_id.
    #[serde(default)]
    hovered_occurrence_id: Option<String>,
}

#[host_fn]
extern "ExtismHost" {
    pub fn kit10_write_render_entry_to_layer(
        input: WriteRenderEntryInput,
    ) -> WriteRenderEntryResult;

    // Plugin publishes a panel manifest (e.g. the Views tree topology) to the host. Decoupled
    // from `OnResolveResult`'s return shape: the manifest rides a separate channel so panel
    // content can refresh on the plugin's own cadence, and so a future plugin's panel (not
    // driven by resolve at all) can publish through the same surface. The host stores the
    // manifest keyed by `panel_id` in a Svelte `$state` map; panels derive off that map.
    // Returns true unconditionally - failure to publish is non-fatal (panel just stays empty).
    pub fn kit10_panel_publish(input: PanelPublishInput) -> bool;
}

// Cross-kit merge: for each property key, the kit with the SINGLE MOST SPECIFIC matching layer
// wins outright, regardless of kit composition order -- kit order only breaks a tie between two
// equally-specific candidates (later/higher-priority kit wins, preserving plain-overwrite
// behavior for the common case). Mirrors manager's flattenKitResults (resolve.ts) exactly -- the
// two must never disagree, since this is what actually renders/exports while flattenKitResults
// only ever feeds the editor's Render-panel inspector. See that function's doc comment for the
// full rationale (a lower-priority kit's real, correctly-conditioned layer used to be invisible
// forever once any higher-priority kit defined that property at all, even unconditionally).
fn merge_kits(kits: &[ResolvedKit]) -> std::collections::HashMap<String, ResolvedProperty> {
    let mut merged: std::collections::HashMap<String, ResolvedProperty> =
        std::collections::HashMap::new();
    for kit in kits {
        for (k, v) in &kit.properties {
            if let Some(existing) = merged.get(k) {
                if existing.condition_count > v.condition_count {
                    continue;
                }
            }
            merged.insert(k.clone(), v.clone());
        }
    }
    merged
}

// Charter's composition opinion: its own `children` field, when it resolves to one or more
// `view`-typed token rows, names the views to nest. The resolver stays name-neutral (it only knows
// the property carries view_refs); "children means nest these" is decided here, in the plugin.
const CHILDREN_FIELD: &str = "children";

// Every child reference, deduped by TOKEN id (not view id) -- two different tokens referencing the
// same view are two real, independent children/occurrences, never collapsed together. (A view id
// appearing twice here is legitimate; only an exact duplicate token_id, which shouldn't normally
// occur, is deduped as a defensive measure.)
fn collect_child_view_ids(kits: &[ResolvedKit]) -> Vec<ViewRef> {
    let mut seen = std::collections::HashSet::new();
    let mut refs_out = Vec::new();
    for kit in kits {
        if let Some(refs) = kit
            .properties
            .get(CHILDREN_FIELD)
            .and_then(|p| p.view_refs.as_ref())
        {
            for r in refs {
                if seen.insert(r.token_id.clone()) {
                    refs_out.push(r.clone());
                }
            }
        }
    }
    refs_out
}

// Oklab is the internal + wire color representation -- see kit10's resources/oklch.md. `parse_color`
// (below) parses OKLCH/Oklab first-class, and hex/rgb/hsl as legacy INPUT formats only (accepted,
// converted on ingest, never round-tripped). The `OklabColor` type AND the sRGB->Oklab conversion
// (`OklabColor::from_srgb`) now live in the shared kit10-scene crate; Charter only parses.

/// A clearly-wrong, saturated marker color for genuinely unparseable input -- deliberately NOT
/// black, so a bad value is visually obvious in the preview rather than silently blending in
/// (see parse_color's fallback below; the doc's own "panel marker" affordance is editor-scope,
/// not built yet -- this is the plugin-side stand-in until then).
fn unparseable_marker() -> OklabColor {
    OklabColor::from_srgb([1.0, 0.0, 1.0, 1.0])
}


/// Polar OKLCH `(l, chroma, hue_degrees)` -> cartesian Oklab `(l, a, b)`.
fn oklch_to_oklab(l: f32, c: f32, h_degrees: f32) -> (f32, f32, f32) {
    let h = h_degrees.to_radians();
    (l, c * h.cos(), c * h.sin())
}

/// CSS `hsl(h, s%, l%)` -> sRGB `[r, g, b]` (each `0.0..=1.0`, gamma-encoded). Standard HSL->RGB
/// conversion (h in degrees, s/l as fractions).
fn hsl_to_srgb(h: f32, s: f32, l: f32) -> [f32; 3] {
    if s <= 0.0 {
        return [l, l, l];
    }
    let h = h.rem_euclid(360.0) / 360.0;
    let q = if l < 0.5 { l * (1.0 + s) } else { l + s - l * s };
    let p = 2.0 * l - q;
    let hue_to_rgb = |p: f32, q: f32, mut t: f32| -> f32 {
        if t < 0.0 {
            t += 1.0;
        }
        if t > 1.0 {
            t -= 1.0;
        }
        if t < 1.0 / 6.0 {
            return p + (q - p) * 6.0 * t;
        }
        if t < 1.0 / 2.0 {
            return q;
        }
        if t < 2.0 / 3.0 {
            return p + (q - p) * (2.0 / 3.0 - t) * 6.0;
        }
        p
    };
    [
        hue_to_rgb(p, q, h + 1.0 / 3.0),
        hue_to_rgb(p, q, h),
        hue_to_rgb(p, q, h - 1.0 / 3.0),
    ]
}

/// Parses a percentage (`"70%"`) or bare number (`"0.7"`) into a `0.0..=1.0` fraction. Used for
/// OKLCH's `L` and HSL's `s`/`l` components, which both accept either form in CSS.
fn parse_percent_or_fraction(s: &str) -> Option<f32> {
    let s = s.trim();
    if let Some(pct) = s.strip_suffix('%') {
        pct.trim().parse::<f32>().ok().map(|v| v / 100.0)
    } else {
        s.parse::<f32>().ok()
    }
}

/// Splits an OKLCH/OKLAB/HSL functional color's argument list on whitespace and/or commas, and
/// splits off an optional `/ alpha` suffix (alpha itself may be a bare fraction or a percentage).
fn split_color_args(inner: &str) -> (Vec<String>, f32) {
    let (main, alpha_part) = match inner.split_once('/') {
        Some((m, a)) => (m, Some(a)),
        None => (inner, None),
    };
    let parts = main
        .split(|c: char| c == ',' || c.is_whitespace())
        .map(str::trim)
        .filter(|p| !p.is_empty())
        .map(str::to_string)
        .collect();
    let alpha = alpha_part
        .and_then(|a| parse_percent_or_fraction(a.trim()))
        .unwrap_or(1.0);
    (parts, alpha)
}

/// Parses a color from OKLCH/Oklab (first-class, no legacy detour) or hex/`rgb()`/`hsl()`
/// (legacy input formats, accepted and converted to Oklab on ingest -- never the storage or
/// interpolation form, per resources/oklch.md). Anything genuinely unparseable warns via the
/// host's log channel and returns a visually-obvious marker color instead of silently
/// defaulting to black -- a bad value should be discoverable, not invisible.
fn parse_color(s: &str) -> OklabColor {
    let s = s.trim();

    if let Some(inner) = s.strip_prefix("oklch(").and_then(|v| v.strip_suffix(')')) {
        let (parts, alpha) = split_color_args(inner);
        if parts.len() >= 3 {
            if let (Some(l), Some(c), Some(h)) = (
                parse_percent_or_fraction(&parts[0]),
                parts[1].parse::<f32>().ok(),
                parts[2].parse::<f32>().ok(),
            ) {
                let (l, a, b) = oklch_to_oklab(l, c, h);
                return OklabColor::new(l, a, b, alpha);
            }
        }
        return warn_unparseable(s);
    }

    if let Some(inner) = s.strip_prefix("oklab(").and_then(|v| v.strip_suffix(')')) {
        let (parts, alpha) = split_color_args(inner);
        if parts.len() >= 3 {
            if let (Some(l), Some(a), Some(b)) = (
                parse_percent_or_fraction(&parts[0]),
                parts[1].parse::<f32>().ok(),
                parts[2].parse::<f32>().ok(),
            ) {
                return OklabColor::new(l, a, b, alpha);
            }
        }
        return warn_unparseable(s);
    }

    if s.eq_ignore_ascii_case("transparent") {
        return OklabColor::new(0.0, 0.0, 0.0, 0.0);
    }

    if s.starts_with('#') {
        let hex = &s[1..];
        return match hex.len() {
            6 => {
                let r = u8::from_str_radix(&hex[0..2], 16).unwrap_or(0) as f32 / 255.0;
                let g = u8::from_str_radix(&hex[2..4], 16).unwrap_or(0) as f32 / 255.0;
                let b = u8::from_str_radix(&hex[4..6], 16).unwrap_or(0) as f32 / 255.0;
                OklabColor::from_srgb([r, g, b, 1.0])
            }
            8 => {
                let r = u8::from_str_radix(&hex[0..2], 16).unwrap_or(0) as f32 / 255.0;
                let g = u8::from_str_radix(&hex[2..4], 16).unwrap_or(0) as f32 / 255.0;
                let b = u8::from_str_radix(&hex[4..6], 16).unwrap_or(0) as f32 / 255.0;
                let a = u8::from_str_radix(&hex[6..8], 16).unwrap_or(255) as f32 / 255.0;
                OklabColor::from_srgb([r, g, b, a])
            }
            _ => warn_unparseable(s),
        };
    }

    if let Some(inner) = s
        .strip_prefix("rgba(")
        .or_else(|| s.strip_prefix("rgb("))
        .and_then(|v| v.strip_suffix(')'))
    {
        let (parts, slash_alpha) = split_color_args(inner);
        if parts.len() >= 3 {
            let r = parts[0].trim().parse::<f32>().unwrap_or(0.0) / 255.0;
            let g = parts[1].trim().parse::<f32>().unwrap_or(0.0) / 255.0;
            let b = parts[2].trim().parse::<f32>().unwrap_or(0.0) / 255.0;
            // A 4th comma-separated arg (legacy `rgba(r,g,b,a)`) is already a 0-1 fraction, not
            // a `/ alpha` suffix -- `split_color_args` only extracts a `/`-form alpha, so a comma
            // form lands as parts[3] instead and wins over the (default 1.0) slash-parsed value.
            let a = parts
                .get(3)
                .and_then(|p| p.parse::<f32>().ok())
                .unwrap_or(slash_alpha);
            return OklabColor::from_srgb([r, g, b, a]);
        }
        return warn_unparseable(s);
    }

    if let Some(inner) = s
        .strip_prefix("hsla(")
        .or_else(|| s.strip_prefix("hsl("))
        .and_then(|v| v.strip_suffix(')'))
    {
        let (parts, slash_alpha) = split_color_args(inner);
        if parts.len() >= 3 {
            if let (Some(h), Some(sat), Some(lig)) = (
                parts[0].trim().trim_end_matches("deg").parse::<f32>().ok(),
                parse_percent_or_fraction(&parts[1]),
                parse_percent_or_fraction(&parts[2]),
            ) {
                let [r, g, b] = hsl_to_srgb(h, sat, lig);
                let a = parts
                    .get(3)
                    .and_then(|p| parse_percent_or_fraction(p))
                    .unwrap_or(slash_alpha);
                return OklabColor::from_srgb([r, g, b, a]);
            }
        }
        return warn_unparseable(s);
    }

    warn_unparseable(s)
}

fn warn_unparseable(s: &str) -> OklabColor {
    // The Extism host-log import only exists in the real wasm32 plugin runtime -- calling it from
    // `parse_color` (exercised extensively by native `cargo test`) would otherwise fail to link
    // natively, since these symbols are host imports satisfied by the Extism runtime, not libc.
    #[cfg(target_arch = "wasm32")]
    {
        if let Ok(mem) = Memory::from_bytes(&format!(
            "parse_color: unparseable color value {s:?}, using marker color instead of black"
        )) {
            mem.log(LogLevel::Warn);
        }
    }
    #[cfg(not(target_arch = "wasm32"))]
    let _ = s;
    unparseable_marker()
}

fn parse_px(s: Option<&str>) -> f32 {
    match s {
        Some(v) => {
            let v = v.trim().trim_end_matches("px");
            v.parse::<f32>().unwrap_or(0.0)
        }
        None => 0.0,
    }
}

// A box-model size dimension. `auto`/empty/unparseable -> Auto (the historical `width:0` default);
// `N%` -> Percent(N/100); `Npx` or bare `N` -> Px(N). No `fr` here on purpose (that's a grid track
// / flex-grow concern, not a self-declared size - see the Extent enum). Percent parsing is what
// gives designers a fractional width without hardcoding pixels.
fn parse_extent(s: Option<&str>) -> Extent {
    let Some(v) = s else { return Extent::Auto };
    let v = v.trim();
    if v.is_empty() || v == "auto" {
        return Extent::Auto;
    }
    if let Some(pct) = v.strip_suffix('%') {
        return match pct.trim().parse::<f32>() {
            Ok(n) => Extent::Percent(n / 100.0),
            Err(_) => Extent::Auto,
        };
    }
    let num = v.trim_end_matches("px");
    match num.parse::<f32>() {
        Ok(n) => Extent::Px(n),
        Err(_) => Extent::Auto,
    }
}

// Extracts the `<n>px` from a `minmax(<n>px, 1fr)` fragment inside a `repeat(auto-fit/auto-fill,
// ...)` call -- the one responsive-grid shape AutoFit/AutoFill represent, never a general repeat().
fn extract_repeat_minmax_px(s: &str) -> Option<f32> {
    let inner = s.trim().strip_prefix("minmax(")?.strip_suffix(')')?;
    let min = inner.splitn(2, ',').next()?.trim();
    min.strip_suffix("px")?.trim().parse::<f32>().ok()
}

fn parse_track_min(s: &str) -> TrackMin {
    let s = s.trim();
    match s {
        "auto" => TrackMin::Auto,
        "min-content" => TrackMin::MinContent,
        "max-content" => TrackMin::MaxContent,
        _ => {
            if let Some(n) = s.strip_suffix('%') {
                if let Ok(v) = n.trim().parse::<f32>() {
                    return TrackMin::Percent(v);
                }
            }
            if let Some(n) = s.strip_suffix("px") {
                return TrackMin::Px(n.trim().parse().unwrap_or(0.0));
            }
            match s.parse::<f32>() {
                Ok(n) => TrackMin::Px(n),
                Err(_) => TrackMin::Auto,
            }
        }
    }
}

fn parse_track_max(s: &str) -> TrackMax {
    let s = s.trim();
    match s {
        "auto" => TrackMax::Auto,
        "min-content" => TrackMax::MinContent,
        "max-content" => TrackMax::MaxContent,
        _ => {
            if let Some(n) = s.strip_suffix("fr") {
                return TrackMax::Fr(n.trim().parse().unwrap_or(1.0));
            }
            if let Some(n) = s.strip_suffix('%') {
                if let Ok(v) = n.trim().parse::<f32>() {
                    return TrackMax::Percent(v);
                }
            }
            if let Some(n) = s.strip_suffix("px") {
                return TrackMax::Px(n.trim().parse().unwrap_or(0.0));
            }
            match s.parse::<f32>() {
                Ok(n) => TrackMax::Px(n),
                Err(_) => TrackMax::Auto,
            }
        }
    }
}

fn parse_track(s: &str) -> TrackSize {
    let s = s.trim();
    if s == "auto" {
        return TrackSize::Auto;
    }
    if s == "min-content" {
        return TrackSize::MinContent;
    }
    if s == "max-content" {
        return TrackSize::MaxContent;
    }
    if let Some(inner) = s.strip_prefix("repeat(").and_then(|r| r.strip_suffix(')')) {
        let mut parts = inner.splitn(2, ',');
        let kind = parts.next().unwrap_or("").trim();
        let track = parts.next().unwrap_or("").trim();
        if let Some(px) = extract_repeat_minmax_px(track) {
            if kind == "auto-fit" {
                return TrackSize::AutoFit(px);
            }
            if kind == "auto-fill" {
                return TrackSize::AutoFill(px);
            }
        }
        return TrackSize::Auto;
    }
    if let Some(inner) = s.strip_prefix("fit-content(").and_then(|r| r.strip_suffix(')')) {
        return TrackSize::FitContent(parse_px(Some(inner)));
    }
    if let Some(inner) = s.strip_prefix("minmax(").and_then(|r| r.strip_suffix(')')) {
        let mut parts = inner.splitn(2, ',');
        let min = parse_track_min(parts.next().unwrap_or("auto"));
        let max = parse_track_max(parts.next().unwrap_or("auto"));
        return TrackSize::MinMax(min, max);
    }
    if let Some(n) = s.strip_suffix("fr") {
        return TrackSize::Fr(n.trim().parse().unwrap_or(1.0));
    }
    if let Some(n) = s.strip_suffix('%') {
        return match n.trim().parse::<f32>() {
            Ok(v) => TrackSize::Percent(v),
            Err(_) => TrackSize::Auto,
        };
    }
    if let Some(n) = s.strip_suffix("px") {
        return TrackSize::Px(n.trim().parse().unwrap_or(0.0));
    }
    if let Ok(n) = s.parse::<f32>() {
        return TrackSize::Px(n);
    }
    TrackSize::Auto
}

fn parse_track_list(s: &str) -> Vec<TrackSize> {
    split_respecting_parens(s).iter().map(|t| parse_track(t)).collect()
}

// Splits a space-separated track list on whitespace OUTSIDE parentheses. A single track
// descriptor like `repeat(auto-fit, minmax(160px, 1fr))` or `minmax(10%, 1fr)` contains internal
// spaces (CSS's comma-separator convention) that must never be treated as track boundaries --
// naive `split_whitespace` used to shred exactly these shapes into several unparseable fragments.
fn split_respecting_parens(s: &str) -> Vec<&str> {
    let mut tokens = Vec::new();
    let mut depth = 0i32;
    let mut start: Option<usize> = None;
    for (i, c) in s.char_indices() {
        if c == '(' {
            depth += 1;
        } else if c == ')' {
            depth -= 1;
        }
        if depth == 0 && c.is_whitespace() {
            if let Some(st) = start.take() {
                tokens.push(&s[st..i]);
            }
        } else if start.is_none() {
            start = Some(i);
        }
    }
    if let Some(st) = start {
        tokens.push(&s[st..]);
    }
    tokens
}

fn parse_grid_line(s: &str) -> GridLine {
    let s = s.trim();
    if s == "auto" || s.is_empty() {
        return GridLine::Auto;
    }
    if let Some(rest) = s.strip_prefix("span") {
        let rest = rest.trim();
        if let Ok(n) = rest.parse::<u16>() {
            return GridLine::Span(n);
        }
        if !rest.is_empty() {
            // `span <name>` or `span <n> <name>` -- a named span, count defaults to 1.
            let mut parts = rest.split_whitespace();
            let first = parts.next().unwrap_or("");
            return match first.parse::<u16>() {
                Ok(n) => GridLine::NamedSpan(parts.next().unwrap_or(first).to_string(), n),
                Err(_) => GridLine::NamedSpan(first.to_string(), 1),
            };
        }
        return GridLine::Span(1);
    }
    if let Ok(n) = s.parse::<i16>() {
        return GridLine::Line(n);
    }
    // `<name>` or `<name> <n>` -- a named line reference, nth occurrence defaults to 1.
    let mut parts = s.split_whitespace();
    let first = parts.next().unwrap_or(s);
    match parts.next().and_then(|n| n.parse::<i16>().ok()) {
        Some(n) => GridLine::NamedLine(first.to_string(), n),
        None => GridLine::NamedLine(first.to_string(), 1),
    }
}

fn parse_grid_line_pair(s: &str) -> (GridLine, GridLine) {
    let mut parts = s.splitn(2, '/');
    let start = parse_grid_line(parts.next().unwrap_or("auto"));
    let end = parse_grid_line(parts.next().unwrap_or("auto"));
    (start, end)
}

fn parse_auto_flow(s: &str) -> GridAutoFlow {
    match s.trim() {
        "column" => GridAutoFlow::Column,
        "row dense" => GridAutoFlow::RowDense,
        "column dense" => GridAutoFlow::ColumnDense,
        _ => GridAutoFlow::Row,
    }
}

// Parses CSS's real `grid-template-areas` quoted-row syntax (`"a a b" "c c b"`) into resolved
// named regions with numeric line coordinates -- the inverse of the editor's visual area painter,
// which serializes its own painted cells back into this exact same string shape, so the stored
// value always round-trips as genuine, spec-correct CSS (never a bespoke internal format). `.` is
// CSS's null-cell token (never a real area). Computes each name's bounding box across every cell
// it appears in rather than validating strict rectangularity -- forgiving of hand-typed input in
// the raw "Custom tracks" escape hatch, same fallback-not-error philosophy as `parse_track`/
// `parse_grid_line` elsewhere in this file; the painter itself can only ever produce valid
// rectangles by construction.
fn parse_grid_template_areas(s: &str) -> Vec<GridTemplateArea> {
    let rows: Vec<Vec<&str>> = s
        .split('"')
        .enumerate()
        .filter(|(i, _)| i % 2 == 1)
        .map(|(_, row)| row.split_whitespace().collect())
        .collect();

    let mut areas: std::collections::HashMap<&str, (u16, u16, u16, u16)> =
        std::collections::HashMap::new();
    for (row_idx, row) in rows.iter().enumerate() {
        for (col_idx, &name) in row.iter().enumerate() {
            if name == "." {
                continue;
            }
            let row_line = row_idx as u16 + 1;
            let col_line = col_idx as u16 + 1;
            areas
                .entry(name)
                .and_modify(|(rs, re, cs, ce)| {
                    *rs = (*rs).min(row_line);
                    *re = (*re).max(row_line + 1);
                    *cs = (*cs).min(col_line);
                    *ce = (*ce).max(col_line + 1);
                })
                .or_insert((row_line, row_line + 1, col_line, col_line + 1));
        }
    }

    let mut result: Vec<GridTemplateArea> = areas
        .into_iter()
        .map(|(name, (row_start, row_end, column_start, column_end))| GridTemplateArea {
            name: name.to_string(),
            row_start,
            row_end,
            column_start,
            column_end,
        })
        .collect();
    result.sort_by(|a, b| a.name.cmp(&b.name));
    result
}

fn parse_align(s: Option<&str>) -> Option<AlignValue> {
    match s? {
        "start" => Some(AlignValue::Start),
        "end" => Some(AlignValue::End),
        "flex-start" => Some(AlignValue::FlexStart),
        "flex-end" => Some(AlignValue::FlexEnd),
        "center" => Some(AlignValue::Center),
        "baseline" => Some(AlignValue::Baseline),
        "stretch" => Some(AlignValue::Stretch),
        _ => None,
    }
}

fn parse_justify(s: Option<&str>) -> Option<JustifyValue> {
    match s? {
        "start" => Some(JustifyValue::Start),
        "end" => Some(JustifyValue::End),
        "flex-start" => Some(JustifyValue::FlexStart),
        "flex-end" => Some(JustifyValue::FlexEnd),
        "center" => Some(JustifyValue::Center),
        "stretch" => Some(JustifyValue::Stretch),
        "space-between" => Some(JustifyValue::SpaceBetween),
        "space-evenly" => Some(JustifyValue::SpaceEvenly),
        "space-around" => Some(JustifyValue::SpaceAround),
        _ => None,
    }
}

fn parse_wrap(s: Option<&str>) -> FlexWrapValue {
    match s {
        Some("wrap") => FlexWrapValue::Wrap,
        Some("wrap-reverse") => FlexWrapValue::WrapReverse,
        _ => FlexWrapValue::NoWrap,
    }
}

fn get_prop(
    props: &std::collections::HashMap<String, ResolvedProperty>,
    key: &str,
) -> Option<String> {
    props.get(key).map(|p| p.value.clone())
}

// Fill/border/radius are paint properties, not structural ones -- plain text can legitimately
// have a background, a border, and padding in real CSS (a highlighted/pill label, say), so both
// build_box_node and build_text_node read them the same way. Both also default to a fully
// TRANSPARENT fill when no `background` is declared -- matching CSS (a `<div>` with no background
// is transparent, not gray), so "no fill" reads as transparent for boxes and text alike. (A box
// used to fall back to an opaque neutral-gray placeholder; that diverged from CSS and is gone. An
// unstyled box now shows only its border, if any -- Vellum still draws the selection/hover overlay
// so it stays selectable.)
struct PaintProps {
    bg_color: OklabColor,
    show_border: bool,
    border_color: OklabColor,
    border_width: f32,
    corner_radius: f32,
    squircle: bool,
    padding: [f32; 4],
}

// CSS padding shorthand: 1 value (all sides), 2 (vert|horiz), 3 (top|horiz|bottom), or 4
// (top|right|bottom|left, verbatim). Output order matches taf_can_do's BoxData.padding
// convention (confirmed against its layout code): [top, right, bottom, left].
fn parse_padding_shorthand(s: Option<&str>) -> [f32; 4] {
    let Some(v) = s else { return [0.0; 4] };
    let parts: Vec<f32> = v
        .split_whitespace()
        .map(|part| parse_px(Some(part)))
        .collect();
    match parts.as_slice() {
        [] => [0.0; 4],
        [all] => [*all; 4],
        [v, h] => [*v, *h, *v, *h],
        [t, h, b] => [*t, *h, *b, *h],
        [t, r, b, l, ..] => [*t, *r, *b, *l],
    }
}

fn extract_paint_props(
    props: &std::collections::HashMap<String, ResolvedProperty>,
    default_bg: OklabColor,
) -> PaintProps {
    let bg = get_prop(props, "background").unwrap_or_default();
    let border = get_prop(props, "border").unwrap_or_default();
    let border_width = parse_px(get_prop(props, "border-width").as_deref());
    let radius = parse_px(get_prop(props, "border-radius").as_deref());
    // "1" is truthy, empty/absent is false -- same sentinel this file's own test fixtures already
    // use to mark a boolean-ish property present (see the box-forcing detect_primitive tests).
    let squircle = get_prop(props, "border-radius-squircle").as_deref() == Some("1");
    let padding = parse_padding_shorthand(get_prop(props, "padding").as_deref());
    let has_border = !border.is_empty() && border != "none";

    PaintProps {
        bg_color: if !bg.is_empty() {
            parse_color(&bg)
        } else {
            default_bg
        },
        show_border: has_border,
        border_color: if has_border {
            parse_color(&border)
        } else {
            OklabColor::default()
        },
        border_width: if border_width > 0.0 {
            border_width
        } else if has_border {
            1.0
        } else {
            0.0
        },
        corner_radius: radius,
        squircle,
        padding,
    }
}

// --- Phase 2: Figma-style per-axis resizing, compiled to taffy primitives ---
//
// A view's `width`/`height` can be `fill` or `hug` (in addition to a length/percent/auto). This is
// Charter's OPINION about sizing -- a designer picks an intent, Charter emits the flex machinery
// (flex-grow/shrink/basis, align-self, min:0) so they never hand-wire it. The raw flex fields stay
// as an escape hatch for now (marked TEMPORARY in box_categories) but are meant to retire behind
// this. Only an explicit `fill`/`hug` keyword engages compilation; a plain length/percent/absent
// width keeps the prior CSS behavior verbatim, so existing layouts don't shift.
#[derive(Clone, Copy, PartialEq)]
enum ResizeKw {
    Fill,
    Hug,
}

fn resize_keyword(s: Option<&str>) -> Option<ResizeKw> {
    match s.map(|v| v.trim()) {
        Some("fill") => Some(ResizeKw::Fill),
        Some("hug") => Some(ResizeKw::Hug),
        _ => None,
    }
}

struct ResizeCompile {
    width: Extent,
    height: Extent,
    min_width: Extent,
    min_height: Extent,
    // `None` = leave whatever the raw flex prop produced; `Some` = resize intent overrides it.
    flex_grow: Option<f32>,
    flex_shrink: Option<f32>,
    flex_basis: Option<Extent>,
    align_self: Option<AlignValue>,
}

// Fill/Hug are direction-aware: the parent's MAIN axis gets grow/shrink/basis, the CROSS axis gets
// align-self. `parent_main_horizontal` is Some(true) when the parent flexes in a row (width = main),
// Some(false) for a column (height = main), None when there's no flex parent (a top-level view on
// the infinite canvas) -- in which case Fill has nothing to fill and degrades to plain auto.
fn compile_resize(
    width_kw: Option<ResizeKw>,
    height_kw: Option<ResizeKw>,
    base_width: Extent,
    base_height: Extent,
    base_min_width: Extent,
    base_min_height: Extent,
    parent_main_horizontal: Option<bool>,
    // The flex parent's own resolved cross-axis align-items (BoxExtra.align_items after
    // compile_arrange + raw override) -- None means taffy's own default, which IS stretch (see
    // BoxExtra's align_items doc comment), so None is treated identically to Some(Stretch) below.
    parent_align_items: Option<AlignValue>,
) -> ResizeCompile {
    let mut out = ResizeCompile {
        // A keyword axis becomes content-sized (auto); a non-keyword axis keeps its parsed extent.
        width: if width_kw.is_some() {
            Extent::Auto
        } else {
            base_width
        },
        height: if height_kw.is_some() {
            Extent::Auto
        } else {
            base_height
        },
        min_width: base_min_width,
        min_height: base_min_height,
        flex_grow: None,
        flex_shrink: None,
        flex_basis: None,
        align_self: None,
    };

    let Some(main_is_width) = parent_main_horizontal else {
        // No flex parent: keywords collapse to auto sizing with no flex/align overrides.
        return out;
    };

    let main_kw = if main_is_width { width_kw } else { height_kw };
    let cross_kw = if main_is_width { height_kw } else { width_kw };

    match main_kw {
        Some(ResizeKw::Fill) => {
            out.flex_grow = Some(1.0);
            out.flex_shrink = Some(1.0);
            out.flex_basis = Some(Extent::Px(0.0)); // equal share of free space, not content+leftover
                                                    // Drop the automatic min-content floor so a Fill item can shrink to its share.
            if main_is_width {
                out.min_width = Extent::Px(0.0);
            } else {
                out.min_height = Extent::Px(0.0);
            }
        }
        Some(ResizeKw::Hug) => {
            // Content size, never grows or shrinks -- overflows a too-tight row, exactly like
            // Figma's Hug (reach for Fill/Fixed to avoid overflow).
            out.flex_grow = Some(0.0);
            out.flex_shrink = Some(0.0);
        }
        None => {}
    }

    // An unset cross-axis property must NOT default to a fixed align-self -- align-self on an
    // item always wins over the container's own align-items, so forcing one here would silently
    // defeat Split/Center's align-items:Center and Cluster's align-items:FlexStart
    // (compile_arrange) for every child that hasn't explicitly picked fill/hug. (Regressed once:
    // see unset_cross_axis_leaves_align_self_unset below and the Stack-Column default in
    // compile_arrange, which is the correct place for that default.)
    //
    // An EXPLICIT hug is different: Hug's whole point is a per-item override of the container's
    // own alignment default, exactly like Figma's Hug/Fill sizing is orthogonal to alignment. But
    // "override" only makes sense relative to what the container would otherwise do:
    //   - Parent's cross-axis align-items is stretch (explicit, or None == taffy's default) ->
    //     forcing flex-start is the correction (this is what fixed the original "Hug still fills
    //     the row" bug: a Column Stack/an untouched container has no other opinion, so its
    //     children default to stretch and Hug must override that back to content-sized).
    //   - Parent's cross-axis align-items is a DELIBERATE non-stretch value (Center/FlexEnd/etc,
    //     e.g. a Center or Split arrangement) -> that deliberate value has nothing to do with
    //     Hug's sizing decision, so align-self must stay None and let the child inherit it. Once
    //     forced to flex-start unconditionally, a Hug'd child inside a Center container always sat
    //     flush at the start edge instead of centering, even though its WIDTH was already
    //     correctly hugging -- alignment and sizing got conflated.
    let parent_cross_defaults_to_stretch =
        matches!(parent_align_items, None | Some(AlignValue::Stretch));
    out.align_self = match cross_kw {
        Some(ResizeKw::Fill) => Some(AlignValue::Stretch),
        Some(ResizeKw::Hug) if parent_cross_defaults_to_stretch => Some(AlignValue::FlexStart),
        Some(ResizeKw::Hug) | None => None,
    };

    out
}

// --- Arrangement: Stack/Cluster/Split/Center/Grid, compiled to taffy primitives ---
//
// Charter's second earned layout opinion (see resources/layout-affordances.md), same template as
// compile_resize above: a designer picks a named outcome, Charter fills in the flex/grid
// machinery. Every output field here is a DEFAULT, not a force -- it only takes effect when the
// corresponding raw property was never explicitly set (via its tab's own follow-on OR the
// per-tab "Advanced"/"Custom tracks" escape hatch). This keeps Advanced a genuinely live override
// for every tab, not just Stack: a hidden field whose edits have no visible effect would be
// exactly the unexplained-mode-behavior Figma failure this whole feature exists to avoid.
fn parse_arrange(s: Option<&str>) -> ArrangeKind {
    match s.map(str::trim) {
        Some("cluster") => ArrangeKind::Cluster,
        Some("split") => ArrangeKind::Split,
        Some("center") => ArrangeKind::Center,
        Some("grid") => ArrangeKind::Grid,
        // "stack", absent, or unrecognized -- Default hard (a fresh box needs zero panel touches).
        _ => ArrangeKind::Stack,
    }
}

struct ArrangeCompile {
    // Fully resolved -- folds in the old inline row/row-reverse/column-reverse/else-column match
    // plus each kind's own directional default, so there's a single source of truth for it.
    flex_direction: String,
    align_items: Option<AlignValue>,
    justify_content: Option<JustifyValue>,
    flex_wrap: Option<FlexWrapValue>,
    grid_template_columns: Option<Vec<TrackSize>>,
}

fn resolve_flex_direction(raw: Option<&str>, kind: ArrangeKind) -> String {
    match raw {
        Some("row") => "Row",
        Some("row-reverse") => "RowReverse",
        Some("column-reverse") => "ColumnReverse",
        Some("column") => "Column",
        // Absent or unrecognized: Cluster/Split default to Row (their common case -- a wrapping
        // chip row, a horizontal header split); everything else defaults to Column, unchanged
        // from the original fallback.
        _ => match kind {
            ArrangeKind::Cluster | ArrangeKind::Split => "Row",
            _ => "Column",
        },
    }
    .to_string()
}

#[allow(clippy::too_many_arguments)]
fn compile_arrange(
    kind: ArrangeKind,
    raw_flex_direction: Option<&str>,
    raw_align_items: Option<AlignValue>,
    raw_justify_content: Option<JustifyValue>,
    raw_flex_wrap: Option<FlexWrapValue>,
    raw_grid_template_columns_set: bool,
    cell_min: f32,
) -> ArrangeCompile {
    let flex_direction = resolve_flex_direction(raw_flex_direction, kind);
    let mut out = ArrangeCompile {
        flex_direction,
        align_items: None,
        justify_content: None,
        flex_wrap: None,
        grid_template_columns: None,
    };

    match kind {
        ArrangeKind::Stack => {
            // Direction is a free choice with no Justify/Wrap opinion, but the cross axis always
            // gets a sensible default either way: Row centers cross-axis (vertically centering a
            // horizontal stack's items); Column defaults cross-axis (width) to flex-start so an
            // untouched child -- which StyleField.svelte's resize control already shows as "Hug"
            // selected -- actually sizes to content instead of silently inheriting taffy's
            // implicit align-items:normal (== stretch) and filling the Stack's width.
            if raw_align_items.is_none() {
                out.align_items = Some(if out.flex_direction == "Row" {
                    AlignValue::Center
                } else {
                    AlignValue::FlexStart
                });
            }
        }
        ArrangeKind::Cluster => {
            // Cluster IS row-flow-that-wraps by definition -- no Direction follow-on exists for
            // it, so its identity comes entirely from these defaults.
            if raw_flex_wrap.is_none() {
                out.flex_wrap = Some(FlexWrapValue::Wrap);
            }
            if raw_align_items.is_none() {
                out.align_items = Some(AlignValue::FlexStart);
            }
        }
        ArrangeKind::Split => {
            if raw_justify_content.is_none() {
                out.justify_content = Some(JustifyValue::SpaceBetween);
            }
            if raw_align_items.is_none() {
                out.align_items = Some(AlignValue::Center);
            }
        }
        ArrangeKind::Center => {
            if raw_justify_content.is_none() {
                out.justify_content = Some(JustifyValue::Center);
            }
            if raw_align_items.is_none() {
                out.align_items = Some(AlignValue::Center);
            }
        }
        ArrangeKind::Grid => {
            // "Custom tracks" (raw grid-template-columns) wins if the user reached for it;
            // otherwise Cell-min alone produces a responsive grid the instant Grid is picked.
            if !raw_grid_template_columns_set {
                out.grid_template_columns = Some(vec![TrackSize::AutoFit(cell_min)]);
            }
        }
    }

    out
}

fn build_box_node(
    props: &std::collections::HashMap<String, ResolvedProperty>,
    parent_id: Option<usize>,
    parent_main_horizontal: Option<bool>,
    // The flex parent's own resolved cross-axis align-items -- see compile_resize's doc comment.
    parent_align_items: Option<AlignValue>,
) -> UiNode {
    let paint = extract_paint_props(props, OklabColor::default());
    let width_str = get_prop(props, "width");
    let height_str = get_prop(props, "height");
    let width_kw = resize_keyword(width_str.as_deref());
    let height_kw = resize_keyword(height_str.as_deref());
    // parse_extent turns a `fill`/`hug` keyword into Auto already; compile_resize only consults
    // these bases for non-keyword axes, so they line up.
    let base_width = parse_extent(width_str.as_deref());
    let base_height = parse_extent(height_str.as_deref());
    let base_min_width = parse_extent(get_prop(props, "min-width").as_deref());
    let base_min_height = parse_extent(get_prop(props, "min-height").as_deref());
    let max_width = parse_extent(get_prop(props, "max-width").as_deref());
    let max_height = parse_extent(get_prop(props, "max-height").as_deref());

    // Raw values, kept as Option so compile_arrange can tell "never set" apart from "explicitly
    // set to the same thing a default would pick" -- an explicit set (via a tab's own follow-on,
    // or the Advanced/Custom-tracks escape hatch) always wins.
    let raw_flex_direction = get_prop(props, "flex-direction");
    let raw_align_items = parse_align(get_prop(props, "align-items").as_deref());
    let raw_justify_content = parse_justify(get_prop(props, "justify-content").as_deref());
    let raw_flex_wrap = get_prop(props, "flex-wrap")
        .as_deref()
        .map(|s| parse_wrap(Some(s)));
    let raw_grid_template_columns =
        get_prop(props, "grid-template-columns").map(|s| parse_track_list(&s));
    let cell_min = get_prop(props, "grid-cell-min")
        .map(|s| parse_px(Some(&s)))
        .filter(|&v| v > 0.0)
        .unwrap_or(160.0);

    let arrange_kind = parse_arrange(get_prop(props, "arrange").as_deref());
    let ac = compile_arrange(
        arrange_kind,
        raw_flex_direction.as_deref(),
        raw_align_items,
        raw_justify_content,
        raw_flex_wrap,
        raw_grid_template_columns.is_some(),
        cell_min,
    );

    let raw_align_self = parse_align(get_prop(props, "align-self").as_deref());

    let mut extra = BoxExtra {
        gap: parse_px(get_prop(props, "gap").as_deref()),
        align_items: raw_align_items.or(ac.align_items),
        justify_content: raw_justify_content.or(ac.justify_content),
        flex_wrap: raw_flex_wrap.or(ac.flex_wrap).unwrap_or_default(),
        flex_grow: get_prop(props, "flex-grow")
            .map(|s| parse_px(Some(&s)))
            .unwrap_or(0.0),
        flex_shrink: get_prop(props, "flex-shrink").map(|s| parse_px(Some(&s))),
        align_self: raw_align_self,
        flex_basis: None,
        // Charter deliberately does not expose margin - spacing between siblings is a container
        // concern (gap / justify-content), not a per-child opinion. The field stays in the wire
        // struct (Vellum + other plugins may use it) but Charter always emits the default 0.
        margin: 0.0,
        position: NodePosition::default(),
        // grid-template-columns/rows, grid-auto-rows/columns, grid-template-areas, grid-auto-flow,
        // justify-items, align-content are this box's own Grid-CONTAINER opinions (ArrangeKeys'
        // `grid_advanced`/friendly-control set) -- meaningful only while `arrange` is actually
        // Grid. A raw property left over in the DB from a previous Grid stint must NOT leak
        // through once the box is switched to Stack/Cluster/Split/Center, or it silently flips
        // taffy's own Display::Grid decision (`!grid_template_columns.is_empty() ||
        // !grid_template_rows.is_empty()`, taf_can_do's apply_box_extra) back on and keeps
        // Vellum's grid-line overlay showing for a box that's no longer Grid. Gated on
        // `arrange_kind` directly, never as a fallback.
        grid_template_columns: if arrange_kind == ArrangeKind::Grid {
            ac.grid_template_columns
                .unwrap_or_else(|| raw_grid_template_columns.unwrap_or_default())
        } else {
            Vec::new()
        },
        grid_template_rows: if arrange_kind == ArrangeKind::Grid {
            get_prop(props, "grid-template-rows")
                .map(|s| parse_track_list(&s))
                .unwrap_or_default()
        } else {
            Vec::new()
        },
        grid_auto_rows: if arrange_kind == ArrangeKind::Grid {
            get_prop(props, "grid-auto-rows")
                .map(|s| parse_track_list(&s))
                .unwrap_or_default()
        } else {
            Vec::new()
        },
        grid_auto_columns: if arrange_kind == ArrangeKind::Grid {
            get_prop(props, "grid-auto-columns")
                .map(|s| parse_track_list(&s))
                .unwrap_or_default()
        } else {
            Vec::new()
        },
        // grid-column/grid-row/justify-self are CHILD placement properties: meaningful based on
        // whether this box's PARENT is a Grid, entirely independent of this box's own arrange kind
        // (see resources/grid-child-placement-plan.md). Deliberately NOT gated on arrange_kind --
        // a Stack/Cluster child sitting inside a Grid parent still needs these to place itself.
        grid_column: get_prop(props, "grid-column")
            .map(|s| parse_grid_line_pair(&s))
            .unwrap_or_default(),
        grid_row: get_prop(props, "grid-row")
            .map(|s| parse_grid_line_pair(&s))
            .unwrap_or_default(),
        grid_template_areas: if arrange_kind == ArrangeKind::Grid {
            get_prop(props, "grid-template-areas")
                .map(|s| parse_grid_template_areas(&s))
                .unwrap_or_default()
        } else {
            Vec::new()
        },
        grid_auto_flow: if arrange_kind == ArrangeKind::Grid {
            get_prop(props, "grid-auto-flow")
                .map(|s| parse_auto_flow(&s))
                .unwrap_or_default()
        } else {
            GridAutoFlow::default()
        },
        justify_items: if arrange_kind == ArrangeKind::Grid {
            parse_align(get_prop(props, "justify-items").as_deref())
        } else {
            None
        },
        align_content: if arrange_kind == ArrangeKind::Grid {
            parse_justify(get_prop(props, "align-content").as_deref())
        } else {
            None
        },
        justify_self: parse_align(get_prop(props, "justify-self").as_deref()),
    };

    // Compile fill/hug intent and let it override the raw flex fields for keyword axes only.
    let rc = compile_resize(
        width_kw,
        height_kw,
        base_width,
        base_height,
        base_min_width,
        base_min_height,
        parent_main_horizontal,
        parent_align_items,
    );
    if let Some(g) = rc.flex_grow {
        extra.flex_grow = g;
    }
    if let Some(s) = rc.flex_shrink {
        extra.flex_shrink = Some(s);
    }
    if let Some(b) = rc.flex_basis {
        extra.flex_basis = Some(b);
    }
    // An explicit raw align-self always wins, same "explicit set wins" convention as every other
    // property here -- compile_resize's Hug-forces-flex-start default must not silently clobber a
    // user's own align-self choice via the Advanced escape hatch.
    if raw_align_self.is_none() {
        if let Some(a) = rc.align_self {
            extra.align_self = Some(a);
        }
    }

    UiNode::Box(BoxData {
        parent_id,
        width: rc.width,
        height: rc.height,
        min_width: rc.min_width,
        min_height: rc.min_height,
        max_width,
        max_height,
        padding: paint.padding,
        bg_color: paint.bg_color,
        flex_direction: flex_dir_from_str(&ac.flex_direction),
        show_border: paint.show_border,
        border_color: paint.border_color,
        border_width: paint.border_width,
        corner_radius: paint.corner_radius,
        squircle: paint.squircle,
        opacity: 1.0,
        shadow: None,
        extra,
        selected: 0,
        hovered: false,
    })
}

// text-align: "left" (default hard, absent/unrecognized reads as Left -- same fallback grammar
// as parse_arrange) | "center" | "right" | "justify". Wire value is Vellum's TextAlign variant
// name verbatim.
fn parse_text_align(s: Option<&str>) -> TextAlign {
    match s.map(str::trim) {
        Some("center") => TextAlign::Center,
        Some("right") => TextAlign::Right,
        Some("justify") => TextAlign::Justify,
        _ => TextAlign::Left,
    }
}

// text-decoration: single-choice, mirroring the "Decor" FieldDef -- never underline AND
// line-through at once. "none" (default) | "underline" | "line-through". Wire value is
// Vellum's TextDecorationKind variant name verbatim.
fn parse_text_decoration(s: Option<&str>) -> TextDecorationKind {
    match s.map(str::trim) {
        Some("underline") => TextDecorationKind::Underline,
        Some("line-through") => TextDecorationKind::LineThrough,
        _ => TextDecorationKind::None,
    }
}

// Resolves `line-height` to a concrete absolute px value -- Vellum never receives an "unset"
// number (see TextData.line_height's doc). Same only-when-unset rule as compile_arrange: an
// explicit raw `line-height` always wins over the derived ramp, parsed CSS-style --
// - a `px` value is absolute ("24px" -> 24.0), independent of font_size;
// - a bare number is a MULTIPLIER of font_size ("1.5" -> font_size * 1.5), matching CSS's own
//   unitless line-height semantics (deliberately NOT routed through parse_px, which treats a
//   bare number as literal px -- that's the wrong reading for this property specifically).
// Unset/unparseable derives a ratio ramp: ~1.5× at body sizes, tightening toward ~1.1× at
// display sizes -- tight leading reads fine on one giant headline, but the same ratio across
// several lines of body text collides. 20px/48px are the ramp's flat-below/flat-above anchors;
// linear in between.
fn compile_line_height(font_size: f32, raw: Option<&str>) -> f32 {
    if let Some(s) = raw {
        let s = s.trim();
        if let Some(px) = s.strip_suffix("px") {
            if let Ok(v) = px.trim().parse::<f32>() {
                return v;
            }
        } else if let Ok(mult) = s.parse::<f32>() {
            return font_size * mult;
        }
    }
    let t = ((font_size - 20.0) / (48.0 - 20.0)).clamp(0.0, 1.0);
    let ratio = 1.5 - t * (1.5 - 1.1);
    font_size * ratio
}

// Parses `text-path` (Pillar C's text-on-path, `resources/foundation.md`/`text.md` §2) into a
// `Deform::ArclengthPath`. The raw value is a JSON array of `[x, y]` pairs in the text node's own
// box-local space (same origin/units convention as `ShapeKind::Path`'s segments) -- a plain
// JSON-array text field, same "raw escape hatch" posture `grid-template-areas`/custom grid tracks
// already use for a shape too structured for a dedicated widget. Fewer than 2 points can't define
// a path (nothing to walk), so it's treated the same as unset/unparseable -- `None`, not an error;
// this dialect never surfaces a magenta-marker-style failure for a structural (non-paint) property.
fn parse_text_path(raw: Option<&str>) -> Option<Vec<[f32; 2]>> {
    let points: Vec<[f32; 2]> = serde_json::from_str(raw?.trim()).ok()?;
    if points.len() < 2 {
        return None;
    }
    Some(points)
}

fn build_text_node(
    props: &std::collections::HashMap<String, ResolvedProperty>,
    parent_id: usize,
) -> UiNode {
    let color = get_prop(props, "color").unwrap_or_default();
    let font_size = parse_px(get_prop(props, "font-size").as_deref());
    let font_weight = parse_px(get_prop(props, "font-weight").as_deref()) as u16;
    let content = get_prop(props, "content").unwrap_or_else(|| "Text".to_string());
    let font_family = get_prop(props, "font-family").unwrap_or_else(|| "sans-serif".to_string());
    let text_align = parse_text_align(get_prop(props, "text-align").as_deref());
    let text_decoration = parse_text_decoration(get_prop(props, "text-decoration").as_deref());
    let resolved_font_size = if font_size > 0.0 { font_size } else { 16.0 };
    let line_height = compile_line_height(resolved_font_size, get_prop(props, "line-height").as_deref());
    // A text node with no declared fill stays fully transparent -- same default as a Box now
    // (both `[0.0; 4]`); no `background` means transparent, matching CSS.
    let paint = extract_paint_props(props, OklabColor::default());
    let deform = parse_text_path(get_prop(props, "text-path").as_deref()).map(|points| Deform::ArclengthPath {
        points,
        offset: parse_px(get_prop(props, "text-path-offset").as_deref()),
    });

    UiNode::Text(TextData {
        parent_id: Some(parent_id),
        width: Extent::Auto,
        height: Extent::Auto,
        padding: paint.padding,
        bg_color: paint.bg_color,
        show_border: paint.show_border,
        border_color: paint.border_color,
        border_width: paint.border_width,
        corner_radius: paint.corner_radius,
        squircle: paint.squircle,
        opacity: 1.0,
        content,
        font_size: resolved_font_size,
        font_family,
        font_weight: if font_weight > 0 { font_weight } else { 400 },
        font_style: FontStyle::Normal,
        text_color: if !color.is_empty() {
            parse_color(&color)
        } else {
            OklabColor::from_srgb([0.2, 0.2, 0.2, 1.0])
        },
        text_align,
        text_decoration,
        line_height,
        deform,
        selected: 0,
        hovered: false,
    })
}

fn build_img_node(
    props: &std::collections::HashMap<String, ResolvedProperty>,
    parent_id: Option<usize>,
) -> UiNode {
    let src = get_prop(props, "src").unwrap_or_default();
    // Normalize to the three fits vellum understands; anything else falls back to cover (vellum's
    // own default), so a typo can't silently produce a blank/oddly-fit image.
    let fit = match get_prop(props, "fit").as_deref() {
        Some("contain") => "contain",
        Some("fill") => "fill",
        _ => "cover",
    }
    .to_string();
    let pos_str = get_prop(props, "object-position").unwrap_or_else(|| "0.5 0.5".to_string());
    let pos: [f32; 2] = {
        let parts: Vec<f32> = pos_str
            .split_whitespace()
            .filter_map(|s| s.parse::<f32>().ok())
            .collect();
        [
            parts.first().copied().unwrap_or(0.5).clamp(0.0, 1.0),
            parts.get(1).copied().unwrap_or(0.5).clamp(0.0, 1.0),
        ]
    };

    UiNode::Img(ImgData {
        parent_id,
        width: parse_extent(get_prop(props, "width").as_deref()),
        height: parse_extent(get_prop(props, "height").as_deref()),
        source: if src.is_empty() {
            ImageSource::None
        } else {
            ImageSource::Ref(src)
        },
        fit,
        object_position: pos,
        selected: 0,
        hovered: false,
    })
}

// kind: "rect" (default) | "ellipse" | "line" | "polygon" | "star" | "path". sides/points below 3
// fall back to a sane default rather than producing a degenerate 0/1/2-vertex shape.
fn parse_shape_kind(props: &std::collections::HashMap<String, ResolvedProperty>) -> ShapeKind {
    match get_prop(props, "kind").as_deref() {
        Some("ellipse") => ShapeKind::Ellipse,
        Some("line") => ShapeKind::Line,
        Some("polygon") => {
            let sides = parse_px(get_prop(props, "sides").as_deref()) as u32;
            ShapeKind::Polygon { sides: if sides >= 3 { sides } else { 5 } }
        }
        Some("star") => {
            let points = parse_px(get_prop(props, "points").as_deref()) as u32;
            let inner_ratio = get_prop(props, "inner-ratio")
                .and_then(|s| s.trim().parse::<f32>().ok())
                .map(|v| v.clamp(0.0, 1.0))
                .unwrap_or(0.5);
            ShapeKind::Star { points: if points >= 3 { points } else { 5 }, inner_ratio }
        }
        Some("path") => {
            // `segments` is a resolved property carrying the wire type's own natural JSON
            // serialization (`serde_json::to_string(&Vec<PathSegment>)`), not a hand-typed
            // CSS-like shorthand -- unlike `grid-template-columns`/`-areas`, a raw segment list is
            // authored programmatically (a pen/brush tool, per resources/vellum-sprite-batch-
            // plan.md), never hand-typed, so there is no shorthand grammar worth inventing here.
            let segments: Vec<PathSegment> = get_prop(props, "segments")
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_default();
            let fill_rule = match get_prop(props, "fill-rule").as_deref() {
                Some("odd") => FillRule::Odd,
                Some("positive") => FillRule::Positive,
                Some("negative") => FillRule::Negative,
                _ => FillRule::Nonzero,
            };
            // v1 scope cut (resources/vellum-sprite-batch-plan.md's Part 0): closed fills only.
            // An explicit `closed: false` is preserved on the wire (Vellum's own bake auto-closes
            // regardless), but Charter doesn't yet expose any authoring path that produces it.
            let closed = get_prop(props, "closed").as_deref() != Some("false");
            ShapeKind::Path { segments, fill_rule, closed }
        }
        _ => ShapeKind::Rect,
    }
}

// A parametric vector shape - sized like Box (mirrors its width/height/min/max, including
// Fixed/Hug/Fill via compile_resize as a flex item), but always a leaf: no arrange/grid-container
// opinion, since a Shape has no children (see resources/shapes-drawing-plan.md's Phase 1 scope).
fn build_shape_node(
    props: &std::collections::HashMap<String, ResolvedProperty>,
    parent_id: Option<usize>,
    parent_main_horizontal: Option<bool>,
    parent_align_items: Option<AlignValue>,
) -> UiNode {
    let kind = parse_shape_kind(props);

    let width_str = get_prop(props, "width");
    let height_str = get_prop(props, "height");
    let width_kw = resize_keyword(width_str.as_deref());
    let height_kw = resize_keyword(height_str.as_deref());
    let base_width = parse_extent(width_str.as_deref());
    let base_height = parse_extent(height_str.as_deref());
    let base_min_width = parse_extent(get_prop(props, "min-width").as_deref());
    let base_min_height = parse_extent(get_prop(props, "min-height").as_deref());
    let max_width = parse_extent(get_prop(props, "max-width").as_deref());
    let max_height = parse_extent(get_prop(props, "max-height").as_deref());

    let rc = compile_resize(
        width_kw,
        height_kw,
        base_width,
        base_height,
        base_min_width,
        base_min_height,
        parent_main_horizontal,
        parent_align_items,
    );

    let mut extra = BoxExtra {
        flex_grow: rc.flex_grow.unwrap_or(0.0),
        flex_shrink: rc.flex_shrink,
        flex_basis: rc.flex_basis,
        align_self: rc.align_self,
        // grid-column/grid-row are CHILD placement properties, meaningful based on whether this
        // shape's PARENT is a Grid, independent of the shape's own leaf status -- same posture as
        // build_box_node's own grid_column/grid_row (see the comment there).
        grid_column: get_prop(props, "grid-column")
            .map(|s| parse_grid_line_pair(&s))
            .unwrap_or_default(),
        grid_row: get_prop(props, "grid-row")
            .map(|s| parse_grid_line_pair(&s))
            .unwrap_or_default(),
        ..BoxExtra::default()
    };
    // An explicit raw align-self always wins over compile_resize's Hug default -- same
    // "explicit set wins" convention build_box_node follows.
    if let Some(raw) = parse_align(get_prop(props, "align-self").as_deref()) {
        extra.align_self = Some(raw);
    }

    let fill = get_prop(props, "fill");
    let stroke = get_prop(props, "stroke");
    let stroke_width = parse_px(get_prop(props, "stroke-width").as_deref());
    let opacity = get_prop(props, "opacity")
        .and_then(|s| s.trim().parse::<f32>().ok())
        .unwrap_or(1.0);

    UiNode::Shape(ShapeData {
        parent_id,
        kind,
        width: rc.width,
        height: rc.height,
        min_width: rc.min_width,
        min_height: rc.min_height,
        max_width,
        max_height,
        fill: fill.map(|c| parse_color(&c)).unwrap_or_default(),
        stroke: stroke.map(|c| parse_color(&c)).unwrap_or_default(),
        stroke_width,
        opacity,
        extra,
        selected: 0,
        hovered: false,
    })
}

// A batch of already-computed sprite instances - sized like Box/Shape (mirrors width/height/min/
// max via compile_resize as a flex item), but always a leaf: no arrange/grid-container opinion,
// no children (resources/vellum-sprite-batch-plan.md). Charter's ENTIRE opinion here is generic
// plumbing - parse `sprites` JSON into the wire's own Vec<SpriteInstance> shape, same precedent
// as parsing grid track lists or a Path's segments; it never computes what the list contains.
fn build_sprite_batch_node(
    props: &std::collections::HashMap<String, ResolvedProperty>,
    parent_id: Option<usize>,
    parent_main_horizontal: Option<bool>,
    parent_align_items: Option<AlignValue>,
) -> UiNode {
    let width_str = get_prop(props, "width");
    let height_str = get_prop(props, "height");
    let width_kw = resize_keyword(width_str.as_deref());
    let height_kw = resize_keyword(height_str.as_deref());
    let base_width = parse_extent(width_str.as_deref());
    let base_height = parse_extent(height_str.as_deref());
    let base_min_width = parse_extent(get_prop(props, "min-width").as_deref());
    let base_min_height = parse_extent(get_prop(props, "min-height").as_deref());
    let max_width = parse_extent(get_prop(props, "max-width").as_deref());
    let max_height = parse_extent(get_prop(props, "max-height").as_deref());

    let rc = compile_resize(
        width_kw,
        height_kw,
        base_width,
        base_height,
        base_min_width,
        base_min_height,
        parent_main_horizontal,
        parent_align_items,
    );

    let mut extra = BoxExtra {
        flex_grow: rc.flex_grow.unwrap_or(0.0),
        flex_shrink: rc.flex_shrink,
        flex_basis: rc.flex_basis,
        align_self: rc.align_self,
        // grid-column/grid-row are CHILD placement properties, meaningful based on whether this
        // batch's PARENT is a Grid, independent of its own leaf status -- same posture as
        // build_box_node's own grid_column/grid_row (see the comment there).
        grid_column: get_prop(props, "grid-column")
            .map(|s| parse_grid_line_pair(&s))
            .unwrap_or_default(),
        grid_row: get_prop(props, "grid-row")
            .map(|s| parse_grid_line_pair(&s))
            .unwrap_or_default(),
        ..BoxExtra::default()
    };
    if let Some(raw) = parse_align(get_prop(props, "align-self").as_deref()) {
        extra.align_self = Some(raw);
    }

    // `sprites` is the wire type's own natural JSON serialization (a brush-pen/particle/pattern
    // tool's output), not a hand-typed shorthand - same posture and same reasoning as
    // `parse_shape_kind`'s `segments` field for Path.
    let sprites: Vec<SpriteInstance> = get_prop(props, "sprites")
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    let opacity = get_prop(props, "opacity")
        .and_then(|s| s.trim().parse::<f32>().ok())
        .unwrap_or(1.0);

    UiNode::SpriteBatch(SpriteBatchData {
        parent_id,
        width: rc.width,
        height: rc.height,
        min_width: rc.min_width,
        min_height: rc.min_height,
        max_width,
        max_height,
        sprites,
        opacity,
        extra,
        selected: 0,
        hovered: false,
    })
}

fn detect_primitive(props: &std::collections::HashMap<String, ResolvedProperty>) -> &'static str {
    // An image view has a `src` property. Just having one doesn't preclude also having
    // text props (a label over an image), but the `src` presence makes it an image primitive.
    if props.contains_key("src") {
        return "image";
    }

    // A shape view has a `kind` property (rect/ellipse/line/polygon/star) -- unique to Shape,
    // same "one property this primitive alone has" test as `src` above.
    if props.contains_key("kind") {
        return "shape";
    }

    let has_text_props = props.contains_key("font-size")
        || props.contains_key("font-weight")
        || props.contains_key("text-align")
        || props.contains_key("text-decoration")
        || props.contains_key("color");

    // Only properties that Text has nowhere to put -- i.e. genuinely imply "this node arranges
    // children" -- count as box-forcing. Fill/border/radius/padding are deliberately excluded:
    // real CSS text can have a background, a border, and padding without stopping being text
    // (a highlighted/pill label), and build_text_node now actually reads and renders them
    // itself (Vellum already supports a Text node carrying its own paint properties). Forcing
    // a wrap into Box for those would silently swap the whole node's sizing algorithm (Text's
    // direct cosmic-text auto-measurement vs. Box's auto-size-to-children) for a property that
    // has nothing to do with layout structure. `width`/`height` stay box-forcing because
    // build_text_node always emits width:0/height:0 regardless -- an explicit size can only
    // ever take effect on a Box.
    let has_box_props = props.contains_key("width")
        || props.contains_key("height")
        || props.contains_key("min-width")
        || props.contains_key("min-height")
        || props.contains_key("max-width")
        || props.contains_key("max-height")
        || props.contains_key("display")
        || props.contains_key("arrange")
        || props.contains_key("flex-direction")
        || props.contains_key("gap")
        || props.contains_key("grid-template-columns")
        || props.contains_key("grid-template-rows")
        || props.contains_key("grid-cell-min")
        || props.contains_key("grid-auto-columns")
        || props.contains_key("grid-auto-rows")
        || props.contains_key("grid-column")
        || props.contains_key("grid-row")
        || props.contains_key("grid-template-areas");

    if has_text_props && !has_box_props {
        "text"
    } else {
        "box"
    }
}

// The item-level flex trio (flex-grow/flex-shrink/align-self) and margin are RETIRED from the
// panel entirely (no FieldDef anywhere, parse-only escape hatch) -- resize/compile_resize already
// own per-item sizing, and Charter's opinion is no margins (see build_box_node). This is the same
// "retired-opinion fields stay panel-absent, parse-only" tier the arrangement fields below join.
fn arrange_field() -> FieldDef {
    FieldDef::new("arrange", Some("Arrangement"))
        .with_input_type("arrange")
        .with_arrange_keys(ArrangeKeys {
            direction_key: "flex-direction".to_string(),
            gap: FieldDef::new("gap", Some("Gap"))
                .with_input_type("spacing")
                .with_spacing_mode("scalar"),
            cell_min: FieldDef::new("grid-cell-min", Some("Cell Min")),
            // Raw escape hatches for Stack/Cluster/Split/Center's "Advanced flex" disclosure --
            // still real, parseable panel controls (build_box_node/compile_arrange only fill
            // these in when unset), just no longer front-and-center.
            advanced: vec![
                FieldDef::new("flex-direction", Some("Direction")),
                FieldDef::new("align-items", Some("Align")),
                FieldDef::new("justify-content", Some("Justify")),
                FieldDef::new("flex-wrap", Some("Wrap")),
                FieldDef::new("display", Some("Display")),
            ],
            // Raw escape hatches for Grid's "Custom tracks" disclosure -- the CSS-Grid
            // sublanguage Phase 3 replaces as the *default* surface, not as a capability.
            grid_advanced: vec![
                FieldDef::new("grid-template-columns", Some("Columns")),
                FieldDef::new("grid-template-rows", Some("Rows")),
                FieldDef::new("grid-auto-columns", Some("Auto Cols")),
                FieldDef::new("grid-auto-rows", Some("Auto Rows")),
                FieldDef::new("grid-column", Some("Col Span")),
                FieldDef::new("grid-row", Some("Row Span")),
                FieldDef::new("grid-template-areas", Some("Areas")),
                FieldDef::new("justify-self", Some("Justify Self")),
            ],
            grid_columns: FieldDef::new("grid-template-columns", Some("Columns"))
                .with_input_type("grid-tracks"),
            grid_rows: FieldDef::new("grid-template-rows", Some("Rows"))
                .with_input_type("grid-tracks"),
            grid_areas: FieldDef::new("grid-template-areas", Some("Areas"))
                .with_input_type("grid-area-painter"),
            grid_auto_flow: FieldDef::new("grid-auto-flow", Some("Auto Flow"))
                .with_input_type("grid-auto-flow"),
            grid_justify_items: FieldDef::new("justify-items", Some("Justify Items"))
                .with_input_type("align-picker"),
            grid_align_content: FieldDef::new("align-content", Some("Align Content"))
                .with_input_type("align-picker"),
        })
}

fn box_categories() -> Vec<FieldCategory> {
    vec![
        FieldCategory {
            name: "layout".to_string(),
            fields: vec![
                arrange_field(),
                // min/max ride each dimension's resize control as contextual follow-ons
                // (ResizeKeys), not top-level rows -- see the ResizeKeys comment.
                FieldDef::new("width", None)
                    .with_input_type("resize")
                    .with_resize_keys(ResizeKeys {
                        min: FieldDef::new("min-width", Some("Min")),
                        max: FieldDef::new("max-width", Some("Max")),
                    }),
                FieldDef::new("height", None)
                    .with_input_type("resize")
                    .with_resize_keys(ResizeKeys {
                        min: FieldDef::new("min-height", Some("Min")),
                        max: FieldDef::new("max-height", Some("Max")),
                    }),
                FieldDef::new("padding", Some("Padding"))
                    .with_input_type("spacing")
                    .with_spacing_mode("box"),
            ],
        },
        FieldCategory {
            name: "box".to_string(),
            fields: vec![
                FieldDef::new("background", Some("Fill")).with_input_type("color"),
                FieldDef::new("border", None).with_input_type("color"),
                FieldDef::new("border-radius", Some("Radius"))
                    .with_input_type("radius")
                    .with_radius_keys(RadiusKeys {
                        squircle: FieldDef::new("border-radius-squircle", Some("Squircle")),
                    }),
                FieldDef::new("outline", None),
            ],
        },
        // A Box's only "contents" are its child views -- it never renders inline text of its own
        // (that's what a nested Text primitive is for), so there is deliberately no `content`
        // field here, unlike text_categories.
        FieldCategory {
            name: "content".to_string(),
            fields: vec![FieldDef::new("children", Some("Children")).with_input_type("children")],
        },
    ]
}

fn text_categories() -> Vec<FieldCategory> {
    vec![
        FieldCategory {
            name: "text".to_string(),
            fields: vec![
                FieldDef::new("content", Some("Content")),
                FieldDef::new("color", Some("Fill")).with_input_type("color"),
                FieldDef::new("font-family", Some("Family")).with_input_type("font"),
                FieldDef::new("font-size", Some("Size")),
                // Options are enumerated editor-side from the font-facts channel (the currently
                // resolved font-family's real weights) -- Charter only needs to say "this is a
                // weight field", not declare the choices, since they're runtime/per-family data
                // it doesn't carry (unlike arrangeKeys/resizeKeys, which are static per FieldDef).
                FieldDef::new("font-weight", Some("Weight")).with_input_type("weight"),
                // Plain field, no inputType -- same as font-size. Deliberately NOT a numeric
                // stepper: compile_line_height's raw value is CSS-style dual-syntax (a bare
                // number is a MULTIPLIER of font-size, a `px` value is absolute -- see its own
                // doc comment), and a stepper that always wrote bare numbers would silently
                // collide with the multiplier reading. Free text lets a designer type either
                // form directly, matching how real CSS line-height authoring already works.
                // Per text-affordances Phase 4/5: this is deliberately standalone now (user
                // asked for it ahead of Phase 5's grouped Typography control, which is deferred)
                // rather than waiting to ride in as a follow-on there.
                FieldDef::new("line-height", Some("Leading")),
                // Fixed, Charter-known choice sets (unlike "weight"'s runtime facts) -- same
                // "hardcoded segmented buttons" shape as "resize"'s Fixed/Hug/Fill, handled
                // inline in StyleField.svelte rather than a dedicated wrapper component.
                FieldDef::new("text-align", Some("Align")).with_input_type("align"),
                FieldDef::new("text-decoration", Some("Decor")).with_input_type("decoration"),
            ],
        },
        // Pillar C's text-on-path (`resources/foundation.md`/`text.md` §2, M5's remainder). A raw
        // JSON-array escape hatch, same posture as grid-template-areas/custom grid tracks -- no
        // dedicated path-point-picker widget exists yet. See parse_text_path's own doc comment for
        // the exact shape (`[[x, y], ...]`, box-local space) and why it's kept out of the main
        // "text" category (a rare/advanced field, not one every text node needs surfaced).
        FieldCategory {
            name: "path".to_string(),
            fields: vec![
                FieldDef::new("text-path", Some("Points")),
                FieldDef::new("text-path-offset", Some("Offset")),
            ],
        },
        // Paint properties a text node can carry directly (a highlighted/pill label) without
        // becoming a Box -- see build_text_node/extract_paint_props and the note in
        // detect_primitive about why these don't force box treatment.
        FieldCategory {
            name: "highlight".to_string(),
            fields: vec![
                FieldDef::new("background", Some("Highlight")).with_input_type("color"),
                FieldDef::new("border", Some("Border")).with_input_type("color"),
                FieldDef::new("border-radius", Some("Radius"))
                    .with_input_type("radius")
                    .with_radius_keys(RadiusKeys {
                        squircle: FieldDef::new("border-radius-squircle", Some("Squircle")),
                    }),
                FieldDef::new("padding", Some("Padding"))
                    .with_input_type("spacing")
                    .with_spacing_mode("box"),
            ],
        },
    ]
}

fn image_categories() -> Vec<FieldCategory> {
    vec![
        FieldCategory {
            name: "image".to_string(),
            fields: vec![
                FieldDef::new("src", Some("Source")).with_input_type("asset"),
                FieldDef::new("fit", Some("Fit")),
                FieldDef::new("object-position", Some("Position")),
            ],
        },
        FieldCategory {
            name: "box".to_string(),
            fields: vec![
                FieldDef::new("width", None),
                FieldDef::new("height", None),
                FieldDef::new("background", Some("Fill")).with_input_type("color"),
                FieldDef::new("border", None).with_input_type("color"),
                FieldDef::new("border-radius", Some("Radius"))
                    .with_input_type("radius")
                    .with_radius_keys(RadiusKeys {
                        squircle: FieldDef::new("border-radius-squircle", Some("Squircle")),
                    }),
                FieldDef::new("padding", Some("Padding"))
                    .with_input_type("spacing")
                    .with_spacing_mode("box"),
            ],
        },
    ]
}

// `kind`/`sides`/`points`/`inner-ratio` are plain fields (no inputType), same precedent as
// image_categories' `fit` field (also conceptually a fixed-choice value) -- there is no "select"
// inputType widget actually implemented in the editor yet (the inputType doc comment above lists
// it aspirationally), so a plain text field is the real "reuse existing widgets" choice for
// Phase 1, not a speculative one. `sides`/`points`/`inner-ratio` only take effect for their
// matching `kind` (polygon/star) -- Charter doesn't hide the inapplicable ones; that's an editor
// polish opportunity, not a resolvability concern (an unused property is simply never read).
fn shape_categories() -> Vec<FieldCategory> {
    vec![
        FieldCategory {
            name: "layout".to_string(),
            fields: vec![
                FieldDef::new("width", None)
                    .with_input_type("resize")
                    .with_resize_keys(ResizeKeys {
                        min: FieldDef::new("min-width", Some("Min")),
                        max: FieldDef::new("max-width", Some("Max")),
                    }),
                FieldDef::new("height", None)
                    .with_input_type("resize")
                    .with_resize_keys(ResizeKeys {
                        min: FieldDef::new("min-height", Some("Min")),
                        max: FieldDef::new("max-height", Some("Max")),
                    }),
                // build_shape_node already reads all three into `extra` - only the panel exposure
                // was missing (a composability audit finding: the wire capacity existed but was
                // only reachable by hand-authoring a raw render entry, never through the UI).
                FieldDef::new("align-self", Some("Align")).with_input_type("align"),
                FieldDef::new("grid-column", Some("Col Span")),
                FieldDef::new("grid-row", Some("Row Span")),
            ],
        },
        FieldCategory {
            name: "shape".to_string(),
            fields: vec![
                FieldDef::new("kind", Some("Kind")),
                FieldDef::new("sides", Some("Sides")),
                FieldDef::new("points", Some("Points")),
                FieldDef::new("inner-ratio", Some("Inner Ratio")),
                // `kind: "path"` only -- `segments` is raw JSON (see `parse_shape_kind`'s doc
                // comment), authored programmatically (a future pen/brush tool), not through a
                // dedicated widget yet, so this rides the same plain-text fallback `sides`/
                // `points` already use rather than a bespoke inputType.
                FieldDef::new("segments", Some("Segments")),
                FieldDef::new("fill-rule", Some("Fill Rule")),
                FieldDef::new("closed", Some("Closed")),
                FieldDef::new("fill", Some("Fill")).with_input_type("color"),
                FieldDef::new("stroke", Some("Stroke")).with_input_type("color"),
                FieldDef::new("stroke-width", Some("Stroke Width")),
                FieldDef::new("opacity", Some("Opacity")),
            ],
        },
    ]
}

fn sprite_batch_categories() -> Vec<FieldCategory> {
    vec![
        FieldCategory {
            name: "layout".to_string(),
            fields: vec![
                FieldDef::new("width", None)
                    .with_input_type("resize")
                    .with_resize_keys(ResizeKeys {
                        min: FieldDef::new("min-width", Some("Min")),
                        max: FieldDef::new("max-width", Some("Max")),
                    }),
                FieldDef::new("height", None)
                    .with_input_type("resize")
                    .with_resize_keys(ResizeKeys {
                        min: FieldDef::new("min-height", Some("Min")),
                        max: FieldDef::new("max-height", Some("Max")),
                    }),
                // build_sprite_batch_node already reads all three into `extra` - only the panel
                // exposure was missing (same composability audit finding as Shape's own, above).
                FieldDef::new("align-self", Some("Align")).with_input_type("align"),
                FieldDef::new("grid-column", Some("Col Span")),
                FieldDef::new("grid-row", Some("Row Span")),
            ],
        },
        FieldCategory {
            name: "sprite-batch".to_string(),
            fields: vec![
                // Raw JSON (see `build_sprite_batch_node`'s doc comment) -- authored
                // programmatically (a brush-pen/particle/pattern tool), not through a dedicated
                // widget yet, same plain-text-fallback posture Path's `segments` field uses.
                FieldDef::new("sprites", Some("Sprites")),
                FieldDef::new("opacity", Some("Opacity")),
            ],
        },
    ]
}

fn transparent_box(parent_id: Option<usize>, flex_direction: &str, padding: [f32; 4]) -> UiNode {
    UiNode::Box(BoxData {
        parent_id,
        width: Extent::Auto,
        height: Extent::Auto,
        max_width: Extent::Auto,
        max_height: Extent::Auto,
        min_width: Extent::Auto,
        min_height: Extent::Auto,
        padding,
        bg_color: OklabColor::default(),
        flex_direction: flex_dir_from_str(flex_direction),
        show_border: false,
        border_color: OklabColor::default(),
        border_width: 0.0,
        corner_radius: 0.0,
        squircle: false,
        opacity: 1.0,
        shadow: None,
        extra: BoxExtra::default(),
        selected: 0,
        hovered: false,
    })
}

// A top-level view cell placed at a fixed world-space position, escaping the auto-flow grid
// entirely (see build_viewport). Always a root (parent_id: None).
fn absolute_box(flex_direction: &str, pos: [f32; 2]) -> UiNode {
    UiNode::Box(BoxData {
        parent_id: None,
        width: Extent::Auto,
        height: Extent::Auto,
        max_width: Extent::Auto,
        max_height: Extent::Auto,
        min_width: Extent::Auto,
        min_height: Extent::Auto,
        padding: [0.0; 4],
        bg_color: OklabColor::default(),
        flex_direction: flex_dir_from_str(flex_direction),
        show_border: false,
        border_color: OklabColor::default(),
        border_width: 0.0,
        corner_radius: 0.0,
        squircle: false,
        opacity: 1.0,
        shadow: None,
        extra: BoxExtra {
            position: NodePosition::Absolute {
                x: pos[0],
                y: pos[1],
            },
            ..BoxExtra::default()
        },
        selected: 0,
        hovered: false,
    })
}

// Bundles the interaction-state fields needed to answer "is this node selected/hovered right
// now" - passed down through render_view_nodes' recursion so both a top-level view and any view
// reached via child_view_ids resolve their own selection/hover against the same source of truth,
// instead of the caller precomputing it only for the top level.
//
// `active_view_id` stays VIEW-level: it's the Render/Axes/Tokens panel's current editing target,
// a property of the view itself, so every rendered occurrence of that view highlights as active
// simultaneously. `selected_occurrence_*`/`hovered_occurrence_id`, by contrast, are OCCURRENCE-
// level: they identify one specific rendered instance (see `ViewRef`/`OverriddenOccurrence`), so
// clicking/hovering one occurrence of a doubly-referenced view never also highlights its sibling.
struct SelectionCtx<'a> {
    active_view_id: Option<&'a str>,
    selected_occurrence_primary: Option<&'a str>,
    selected_occurrence_secondary: &'a [String],
    hovered_occurrence_id: Option<&'a str>,
}

// 0 = none, 1 = secondary selection, 2 = primary / active.
fn compute_selection(view_id: &str, occurrence_id: &str, ctx: &SelectionCtx) -> u8 {
    let is_active = ctx.active_view_id == Some(view_id);
    let is_primary = ctx.selected_occurrence_primary == Some(occurrence_id);
    let is_secondary = ctx
        .selected_occurrence_secondary
        .iter()
        .any(|id| id == occurrence_id);
    if is_active || is_primary {
        2
    } else if is_secondary {
        1
    } else {
        0
    }
}

fn compute_hovered(occurrence_id: &str, ctx: &SelectionCtx) -> bool {
    ctx.hovered_occurrence_id == Some(occurrence_id)
}

// Shared by render_view_nodes' own primitive computation and by a parent view deciding whether
// a candidate child is even eligible to be recursed into (see the containment rule in
// render_view_nodes below) -- same charter_hints-override-else-detect_primitive logic either
// way, just returning an owned String so it can be computed for a view this function isn't
// already "inside" of (detect_primitive's &'static str can't be returned when the hint-override
// path needs to hand back a String owned by a local CharterHints instead).
fn primitive_for_kits(
    kits: &[ResolvedKit],
    hints: &std::collections::HashMap<String, serde_json::Value>,
) -> String {
    let merged = merge_kits(kits);
    let charter_hints: CharterHints = hints
        .get("charter")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();
    charter_hints
        .primitive
        .unwrap_or_else(|| detect_primitive(&merged).to_string())
}

// The highest-priority (last, winning) composed Kit's id for a view -- matches merge_kits'
// own "later kit wins" convention exactly, so node_kit_ids always names whichever Kit a
// view's rendered properties actually came from. "" for a view with no composed kit.
fn kit_id_for(kits: &[ResolvedKit]) -> String {
    kits.last().map(|k| k.kit_id.clone()).unwrap_or_default()
}

// Render a view's nodes into the flat viewport buffer.
// parent_id: the parent box index (grid cell for top-level, box idx for children).
// depth guard prevents runaway recursion from circular view references.
// view_id/occurrence_id: `view_id` is this node's underlying view; `occurrence_id` is the
// specific rendered INSTANCE's identity (the referencing `view`-typed token's own id for a
// nested child, or `view_id` itself for a root/top-level view -- see `ViewRef`). Two different
// occurrences of the same view_id get two independent nodes with the SAME view_id but DIFFERENT
// occurrence_id, each resolving/selecting/hovering independently.
// node_view_ids: parallel accumulator to viewport - every push here is paired with a push
// there recording which view (view_id) that node belongs to, for the editor's viewport
// click-to-select hit-test lookup.
// node_occurrence_ids: a third parallel accumulator, recording each node's occurrence_id -- lets
// the editor disambiguate a click/hover/selection to the specific instance, not just the view.
// node_kit_ids: a second parallel accumulator (same length/order as viewport/node_view_ids),
// recording the highest-priority composed Kit's id for that node -- "" for structural grid
// scaffolding or a kit-less view. Lets WebCodium's Kit-basis export (Phase 3, see
// resources/webcodium-export-plan.md) name which Kit a rendered node came from, since a Kit
// has no subtree of its own in the merged output (merge_kits collapses composed kits into one
// property map before a node is ever built).
fn render_view_nodes(
    kits: &[ResolvedKit],
    hints: &std::collections::HashMap<String, serde_json::Value>,
    view_id: &str,
    occurrence_id: &str,
    ctx: &SelectionCtx,
    parent_id: Option<usize>,
    // Whether this view's flex PARENT lays out in a row (Some(true)) or column (Some(false)); None
    // at a top level (no flex parent). Drives direction-aware fill/hug -- see compile_resize.
    parent_main_horizontal: Option<bool>,
    // The flex parent's own resolved cross-axis align-items -- see compile_resize's doc comment.
    parent_align_items: Option<AlignValue>,
    viewport: &mut Vec<UiNode>,
    node_view_ids: &mut Vec<String>,
    node_kit_ids: &mut Vec<String>,
    node_occurrence_ids: &mut Vec<String>,
    depth: u8,
    view_map: &std::collections::HashMap<String, &ViewMeta>,
    occurrence_map: &std::collections::HashMap<String, &OverriddenOccurrence>,
) {
    if depth > 4 {
        return;
    }

    let merged = merge_kits(kits);
    if merged.is_empty() {
        return;
    }

    let charter_hints: CharterHints = hints
        .get("charter")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();

    let primitive = charter_hints
        .primitive
        .as_deref()
        .unwrap_or_else(|| detect_primitive(&merged));

    let content_parent = parent_id;
    let selection = compute_selection(view_id, occurrence_id, ctx);
    let hovered = compute_hovered(occurrence_id, ctx);

    // Resolve a child ref's EFFECTIVE kits: an overriding occurrence's own resolved_kits (which
    // may differ from the plain view's, e.g. a different Layer winning `children` under the
    // override's axis args) if one exists for this reference's token_id, else the target view's
    // own plain resolution -- mirrors `view-tree.ts`'s `childrenOf` fallback exactly.
    let effective_child_kits = |child_view: &ViewMeta, token_id: &str| -> Vec<ResolvedKit> {
        occurrence_map
            .get(token_id)
            .map(|o| o.resolved_kits.clone())
            .unwrap_or_else(|| child_view.resolved_kits.clone())
    };

    if primitive == "text" {
        let mut node = build_text_node(&merged, content_parent.unwrap_or(0));
        if let UiNode::Text(text_data) = &mut node {
            text_data.selected = selection;
            text_data.hovered = hovered;
        }
        viewport.push(node);
        node_view_ids.push(view_id.to_string());
        node_kit_ids.push(kit_id_for(kits));
        node_occurrence_ids.push(occurrence_id.to_string());

        // Containment rule (Charter's own opinion, not enforced anywhere upstream): a Text
        // view may contain other Text views (e.g. multiple inline runs), never a Box -- a
        // candidate whose own resolved primitive isn't "text" is silently skipped, the same
        // way a missing/deleted view id already is below. Nested text children are parented to
        // this node's own container (content_parent), not to this text node's index -- Vellum's
        // layout tree expects a Box as a layout parent, and content_parent already traces back
        // to one (or None at a genuine root), so this reuses a proven relationship instead of
        // introducing an unverified "Text as layout parent" case.
        for child_ref in &collect_child_view_ids(kits) {
            if let Some(child_view) = view_map.get(&child_ref.view_id) {
                let child_kits = effective_child_kits(child_view, &child_ref.token_id);
                if primitive_for_kits(&child_kits, &child_view.hints) != "text" {
                    continue;
                }
                render_view_nodes(
                    &child_kits,
                    &child_view.hints,
                    &child_ref.view_id,
                    &child_ref.token_id,
                    ctx,
                    content_parent,
                    // Nested text shares this text's own container, so its flex parent is the same.
                    parent_main_horizontal,
                    parent_align_items,
                    viewport,
                    node_view_ids,
                    node_kit_ids,
                    node_occurrence_ids,
                    depth + 1,
                    view_map,
                    occurrence_map,
                );
            }
        }
    } else if primitive == "image" {
        let mut node = build_img_node(&merged, content_parent);
        if let UiNode::Img(img_data) = &mut node {
            img_data.selected = selection;
            img_data.hovered = hovered;
        }
        viewport.push(node);
        node_view_ids.push(view_id.to_string());
        node_kit_ids.push(kit_id_for(kits));
        node_occurrence_ids.push(occurrence_id.to_string());

        // An image is a leaf - it has no children (no content tab, no children field).
        // Any child views assigned to an image view are silently ignored.
    } else if primitive == "shape" {
        let mut node = build_shape_node(&merged, content_parent, parent_main_horizontal, parent_align_items);
        if let UiNode::Shape(shape_data) = &mut node {
            shape_data.selected = selection;
            shape_data.hovered = hovered;
        }
        viewport.push(node);
        node_view_ids.push(view_id.to_string());
        node_kit_ids.push(kit_id_for(kits));
        node_occurrence_ids.push(occurrence_id.to_string());

        // A shape is a leaf, same as image - Phase 1 shapes don't contain child views (see
        // resources/shapes-drawing-plan.md's "Explicitly deferred" section). Any child views
        // assigned to a shape view are silently ignored.
    } else if primitive == "sprite-batch" {
        let mut node = build_sprite_batch_node(&merged, content_parent, parent_main_horizontal, parent_align_items);
        if let UiNode::SpriteBatch(sprite_batch_data) = &mut node {
            sprite_batch_data.selected = selection;
            sprite_batch_data.hovered = hovered;
        }
        viewport.push(node);
        node_view_ids.push(view_id.to_string());
        node_kit_ids.push(kit_id_for(kits));
        node_occurrence_ids.push(occurrence_id.to_string());

        // A SpriteBatch is a leaf, same as Shape/Img - no children. Any child views assigned to
        // a sprite-batch view are silently ignored.
    } else {
        let box_idx = viewport.len();
        let mut node = build_box_node(&merged, content_parent, parent_main_horizontal, parent_align_items);

        if let UiNode::Box(box_data) = &mut node {
            box_data.selected = selection;
            box_data.hovered = hovered;
        }

        // This box is the flex parent of its children; their fill/hug resolves against THIS box's
        // main axis (row -> width is main, column -> height is main), and their cross-axis
        // align-self default (compile_resize) resolves against THIS box's own resolved
        // align-items -- both captured before the node moves into viewport below. Read from the
        // box's own already-resolved `flex_direction`/`align_items` (post compile_arrange), never
        // by re-parsing the raw `flex-direction` prop directly -- Cluster/Split default to Row
        // without the raw prop ever being set, so a raw-prop check silently reported Column here.
        let (child_main_horizontal, child_align_items) = match &node {
            UiNode::Box(box_data) => (
                Some(matches!(box_data.flex_direction, FlexDir::Row | FlexDir::RowReverse)),
                box_data.extra.align_items,
            ),
            _ => (None, None),
        };

        viewport.push(node);
        node_view_ids.push(view_id.to_string());
        node_kit_ids.push(kit_id_for(kits));
        node_occurrence_ids.push(occurrence_id.to_string());

        // A Box is a pure container -- it never renders its own inline text. If a design wants
        // text inside a box, it nests a Text primitive as one of the box's children. So there is
        // no `content` fallback here (and no `content` field in box_categories): the box's only
        // "contents" are its child views, recursed into below. A childless box just renders empty.
        let child_refs = collect_child_view_ids(kits);
        for child_ref in &child_refs {
            if let Some(child_view) = view_map.get(&child_ref.view_id) {
                let child_kits = effective_child_kits(child_view, &child_ref.token_id);
                render_view_nodes(
                    &child_kits,
                    &child_view.hints,
                    &child_ref.view_id,
                    &child_ref.token_id,
                    ctx,
                    Some(box_idx),
                    child_main_horizontal,
                    child_align_items,
                    viewport,
                    node_view_ids,
                    node_kit_ids,
                    node_occurrence_ids,
                    depth + 1,
                    view_map,
                    occurrence_map,
                );
            }
        }
    }
}

#[plugin_fn]
pub fn on_init(_input: String) -> FnResult<String> {
    let mem = Memory::from_bytes("Charter plugin initialized")?;
    mem.log(LogLevel::Info);
    Ok("ok".to_string())
}

// Returns (viewport_data, node_view_ids) - the two are always parallel (same length/order).
// "" entries in node_view_ids mark structural grid scaffolding (root/row/cell wrapper boxes)
// that don't belong to any view; a click resolving to one of those should be treated the same
// as clicking empty space.
// The CSS font-weight matching algorithm over the weights a family actually has, per its
// facts. Charter's single decision point for weight substitution (text-affordances Phase 1):
// the editor's font fetching consumes this function's OUTPUT (via `font_requests`), never
// re-deciding - so the panel's requested weight, the fetched file, and the rendered glyphs
// can't disagree. A family with no facts (uncatalogued) returns the request untouched;
// cosmic-text's own nearest-loaded matching remains the last-line fallback for that case and
// for the not-yet-loaded window.
fn resolve_font_weight(requested: u16, facts: &FamilyFacts) -> u16 {
    if facts.variants.is_empty() {
        return requested;
    }
    // A variable range covering the request serves it exactly; otherwise each range's nearest
    // endpoint is a discrete candidate.
    if facts
        .variants
        .iter()
        .any(|v| requested >= v.weight_min && requested <= v.weight_max)
    {
        return requested;
    }
    let candidates: std::collections::BTreeSet<u16> = facts
        .variants
        .iter()
        .map(|v| requested.clamp(v.weight_min, v.weight_max))
        .collect();

    let below = candidates.iter().rev().find(|&&w| w < requested).copied();
    let above = candidates.iter().find(|&&w| w > requested).copied();

    // CSS: <400 prefers lighter first; >500 prefers heavier first; the 400..=500 zone looks
    // up toward 500, then below, then above.
    let pick = if requested < 400 {
        below.or(above)
    } else if requested > 500 {
        above.or(below)
    } else {
        candidates
            .range(requested..=500)
            .next()
            .copied()
            .or(below)
            .or(above)
    };
    pick.unwrap_or(requested)
}

// Post-walk over the built viewport: snap every Text node's weight to what its family can
// actually render. Runs at the very end of build_viewport so both on_resolve and
// on_selection_change's rebuild get identical treatment, and no per-node code needs facts
// threaded through it.
fn snap_text_weights(nodes: &mut [UiNode], facts: &std::collections::HashMap<String, FamilyFacts>) {
    if facts.is_empty() {
        return;
    }
    for node in nodes {
        if let UiNode::Text(t) = node {
            let family_facts = facts
                .iter()
                .find(|(k, _)| k.eq_ignore_ascii_case(&t.font_family))
                .map(|(_, v)| v);
            if let Some(f) = family_facts {
                t.font_weight = resolve_font_weight(t.font_weight, f);
            }
        }
    }
}

// The concrete (family, weight, style) set the viewport actually renders - post-snapping - so
// the editor fetches exactly the files Charter decided on, instead of re-deriving weights from
// raw kit properties (which may name weights that don't exist).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
struct FontRequest {
    family: String,
    weight: u16,
    style: String,
}

fn collect_font_requests(nodes: &[UiNode]) -> Vec<FontRequest> {
    let mut set = std::collections::BTreeSet::new();
    for node in nodes {
        if let UiNode::Text(t) = node {
            if t.font_family.is_empty() {
                continue;
            }
            // Lowercased: Fontavious's catalogue styles are "normal"/"italic" and its variant
            // matching is case-sensitive, while font_style is the Vellum-cased `FontStyle` enum.
            let style = match t.font_style {
                FontStyle::Normal => "normal",
                FontStyle::Italic => "italic",
                FontStyle::Oblique => "oblique",
            };
            set.insert(FontRequest {
                family: t.font_family.clone(),
                weight: t.font_weight,
                style: style.to_string(),
            });
        }
    }
    set.into_iter().collect()
}

fn build_viewport(parsed: &OnResolveInput) -> (Vec<UiNode>, Vec<String>, Vec<String>, Vec<String>) {
    let mut viewport_data: Vec<UiNode> = Vec::new();
    let mut node_view_ids: Vec<String> = Vec::new();
    let mut node_kit_ids: Vec<String> = Vec::new();
    let mut node_occurrence_ids: Vec<String> = Vec::new();

    let ctx = SelectionCtx {
        active_view_id: parsed.active_view_id.as_deref(),
        selected_occurrence_primary: parsed.selected_occurrence_primary.as_deref(),
        selected_occurrence_secondary: &parsed.selected_occurrence_secondary,
        hovered_occurrence_id: parsed.hovered_occurrence_id.as_deref(),
    };

    let view_map: std::collections::HashMap<String, &ViewMeta> = parsed
        .project_views
        .iter()
        .map(|v| (v.view_id.clone(), v))
        .collect();

    // Keyed by occurrence_key (== the referencing token's own id) -- consulted FIRST when
    // recursing into a child reference, falling back to `view_map` in the common (no override)
    // case. See `OverriddenOccurrence`/`render_view_nodes`'s `effective_child_kits`.
    let occurrence_map: std::collections::HashMap<String, &OverriddenOccurrence> = parsed
        .overridden_occurrences
        .iter()
        .map(|o| (o.occurrence_key.clone(), o))
        .collect();

    // A view is never "top-level" or "child" by its own declaration -- that's derived from
    // whether some other view's box currently lists it in `children`. Union every view's own
    // child references (collect_child_view_ids is already used per-view for recursion below;
    // here it's run across the whole project) into one set, so a referenced view is
    // automatically excluded from the top-level grid no matter which view claims it, with no
    // separate flag to keep in sync by hand. View-id granularity here is correct: a view is
    // "referenced" (non-root) if ANY occurrence references it, regardless of which one.
    let referenced: std::collections::HashSet<String> = parsed
        .project_views
        .iter()
        .flat_map(|v| {
            collect_child_view_ids(&v.resolved_kits)
                .into_iter()
                .map(|r| r.view_id)
        })
        .collect();

    let top_views: Vec<(&ViewMeta, &Vec<ResolvedKit>, Option<[f32; 2]>)> = parsed
        .project_views
        .iter()
        .filter_map(|view| {
            if referenced.contains(&view.view_id) {
                return None;
            }
            let kits: &Vec<ResolvedKit> = &view.resolved_kits;
            if kits.is_empty() {
                return None;
            }
            let vellum_hints: VellumHints = view
                .hints
                .get("vellum")
                .and_then(|v| serde_json::from_value(v.clone()).ok())
                .unwrap_or_default();
            Some((view, kits, vellum_hints.position))
        })
        .collect();

    // Views with an explicit world position float independently, each as its own root -
    // no shared flex parent to couple their placement to a sibling's content size.
    let (positioned, flowing): (Vec<_>, Vec<_>) =
        top_views.into_iter().partition(|(_, _, pos)| pos.is_some());

    for (view, kits, pos) in &positioned {
        let cell_idx = viewport_data.len();
        viewport_data.push(absolute_box("Column", pos.unwrap()));
        node_view_ids.push(String::new());
        node_kit_ids.push(String::new());
        node_occurrence_ids.push(String::new());
        render_view_nodes(
            kits,
            &view.hints,
            &view.view_id,
            // A root view is unreferenced by definition, so it has exactly one occurrence: itself.
            &view.view_id,
            &ctx,
            Some(cell_idx),
            // Top-level cell is auto-sized scaffolding, not a meaningful flex container -> None,
            // so a view's own fill/hug degrades to auto rather than stretching to nothing.
            None,
            None,
            &mut viewport_data,
            &mut node_view_ids,
            &mut node_kit_ids,
            &mut node_occurrence_ids,
            0,
            &view_map,
            &occurrence_map,
        );
    }

    // Views without a position hint keep flowing through the legacy auto-flow grid.
    if !flowing.is_empty() {
        // Auto-grid arrangement of unpositioned top-level views is Charter's own structural opinion
        // about canvas layout -- not a user-tunable global preference and not per-view data, so these
        // stay constants here rather than being surfaced anywhere.
        const COLS: usize = 4;
        const GAP: f32 = 32.0;
        const PAD: f32 = 40.0;

        let root_idx = viewport_data.len();
        viewport_data.push(transparent_box(None, "Column", [PAD; 4]));
        node_view_ids.push(String::new());
        node_kit_ids.push(String::new());
        node_occurrence_ids.push(String::new());

        for row in flowing.chunks(COLS) {
            let row_idx = viewport_data.len();
            viewport_data.push(transparent_box(Some(root_idx), "Row", [0.0, 0.0, GAP, 0.0]));
            node_view_ids.push(String::new());
            node_kit_ids.push(String::new());
            node_occurrence_ids.push(String::new());

            for (view, kits, _) in row {
                let cell_idx = viewport_data.len();
                viewport_data.push(transparent_box(
                    Some(row_idx),
                    "Column",
                    [0.0, GAP, 0.0, 0.0],
                ));
                node_view_ids.push(String::new());
                node_kit_ids.push(String::new());
                node_occurrence_ids.push(String::new());

                render_view_nodes(
                    kits,
                    &view.hints,
                    &view.view_id,
                    &view.view_id,
                    &ctx,
                    Some(cell_idx),
                    // Auto-sized grid cell -> no meaningful flex parent (see positioned branch).
                    None,
                    None,
                    &mut viewport_data,
                    &mut node_view_ids,
                    &mut node_kit_ids,
                    &mut node_occurrence_ids,
                    0,
                    &view_map,
                    &occurrence_map,
                );
            }
        }
    }

    snap_text_weights(&mut viewport_data, &parsed.font_facts);

    (viewport_data, node_view_ids, node_kit_ids, node_occurrence_ids)
}

fn build_categories(parsed: &OnResolveInput) -> Vec<FieldCategory> {
    if parsed.resolved_kits.is_empty() {
        return vec![];
    }
    let merged = merge_kits(&parsed.resolved_kits);
    let charter_hints: CharterHints = parsed
        .view_hints
        .get("charter")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();
    let primitive = charter_hints
        .primitive
        .as_deref()
        .unwrap_or_else(|| detect_primitive(&merged));
    if primitive == "text" {
        text_categories()
    } else if primitive == "image" {
        image_categories()
    } else if primitive == "shape" {
        shape_categories()
    } else if primitive == "sprite-batch" {
        sprite_batch_categories()
    } else {
        box_categories()
    }
}

// Build the Views panel manifest from the resolve graph. Every piece here is already computed
// elsewhere in this file - `collect_child_view_ids` (the per-view child list), the `referenced`
// set (which views are claimed as somebody's child - computed identically in `build_viewport`),
// `primitive_for_view` + `primitive_icon` (the icon), and the `children` property's `token_alias`
// (the write alias for DnD). This function just bundles them into a PanelManifest and ships them
// through `kit10_panel_publish` instead of leaving the editor to re-derive all four client-side
// (which it did, as `childrenByViewId`/`referencedViewIds`/`rootViews`/`childrenPropOf` in
// Views.svelte - all deleted in favor of this).
//
// `panel_id` is fixed to "views" today. A future plugin publishing a different panel would use a
// different id; the editor's panel renderer is generic over the manifest shape.
// The op set every panel item gets, regardless of primitive - operations that make sense for
// any view. Per-primitive ops (e.g. `add-child` for Boxes) are layered on top in
// `build_views_panel_manifest`. Labels/icons are plugin-authored so a future plugin can re-skin
// the menu without editor changes; `name` is the dispatch key the editor switches on.
fn common_item_ops() -> Vec<PanelOp> {
    vec![
        PanelOp {
            name: "rename".to_string(),
            label: "Rename".to_string(),
            icon: "fa-solid fa-i-cursor".to_string(),
            kind: None,
        },
        PanelOp {
            name: "clone".to_string(),
            label: "Clone View".to_string(),
            icon: "fa-solid fa-clone".to_string(),
            kind: None,
        },
        PanelOp {
            name: "lock".to_string(),
            label: "Lock/Unlock".to_string(),
            icon: "fa-solid fa-lock".to_string(),
            kind: None,
        },
        PanelOp {
            name: "hide".to_string(),
            label: "Hide/Show".to_string(),
            icon: "fa-solid fa-eye".to_string(),
            kind: None,
        },
        PanelOp {
            name: "deselect".to_string(),
            label: "Deselect".to_string(),
            icon: "fa-solid fa-minus".to_string(),
            kind: None,
        },
        PanelOp {
            name: "delete".to_string(),
            label: "Delete View".to_string(),
            icon: "fa-solid fa-trash-can".to_string(),
            kind: None,
        },
    ]
}

// Ops only a container (Box primitive with a `children` field) gets - currently the
// "add child of kind X" trio. Gated on `write_alias.is_some()` so a Box that somehow has no
// `children` field (no kit declares it) doesn't get an "add child" affordance that would have
// nowhere to write.
fn container_item_ops() -> Vec<PanelOp> {
    CREATABLE_PRIMITIVES
        .iter()
        .map(|p| PanelOp {
            name: "add-child".to_string(),
            label: p.item_label.to_string(),
            icon: p.icon.to_string(),
            kind: Some(p.kind.to_string()),
        })
        .collect()
}

// Ops for the panel header's affordance menu (the "+" menu in the Views panel). Today this is
// the same "add a top-level view of kind X" trio - header ops aren't tied to a specific item, so
// they create top-level orphans (the editor's resolve loop will pick them up and the next
// manifest publish will mark them `is_root: true`).
fn views_header_ops() -> Vec<PanelOp> {
    CREATABLE_PRIMITIVES
        .iter()
        .map(|p| PanelOp {
            name: "add-child".to_string(),
            label: p.header_label.to_string(),
            icon: p.icon.to_string(),
            kind: Some(p.kind.to_string()),
        })
        .collect()
}

fn build_views_panel_manifest(parsed: &OnResolveInput) -> PanelManifest {
    let items = parsed
        .project_views
        .iter()
        .map(|view| {
            // The write alias is the token alias on this view's `children` property, if any kit
            // layer already declares one. `None` when no children write has happened yet (a
            // freshly composed Box) - the editor's `write_alias ?? 'children'` fallback (see
            // Views.svelte) writes the canonical alias name on first use. The alias itself, when
            // present, comes from the resolved property's `token_alias`, which is what the
            // editor's `api.upsertViewToken` already targets (see CLAUDE.md's View-token
            // override pitfalls); Charter only surfaces the value here, it doesn't invent or
            // remap it.
            let write_alias = view.resolved_kits.iter().find_map(|k| {
                k.properties
                    .get(CHILDREN_FIELD)
                    .and_then(|p| p.token_alias.clone())
            });

            // Per-item op set: common ops always, container ops only for a Box primitive. Gated
            // on primitive rather than write_alias.is_some() - a Box that has never had a child
            // added yet has no live `children` token, but it can still get one (the editor
            // upserts on first use), so it must still show the "Add Box/Text/Image" affordance.
            // A Text/Image primitive gets the common ops only - no add-child sub-menu, since it
            // has nowhere to attach them.
            let mut ops = common_item_ops();
            if primitive_for_kits(&view.resolved_kits, &view.hints) == "box" {
                // Prepend container ops so "Add Box/Text/Image" groups appear above the generic
                // rename/clone/lock/... - visual grouping the original hardcoded menu had.
                let mut container = container_item_ops();
                container.append(&mut ops);
                ops = container;
            }

            PanelItem {
                id: view.view_id.clone(),
                write_alias,
                ops,
            }
        })
        .collect();

    PanelManifest {
        panel_id: "views".to_string(),
        // Charter's whole opinion on nesting: "this field's `viewRefs` are the children."
        // The host walks `resolvedViews` for these keys to build the DAG itself - no
        // `child_ids`/`is_root` shipped in the manifest. See PanelItem's doc comment.
        composition_field_keys: composition_field_keys(),
        items,
        header_ops: views_header_ops(),
    }
}

#[plugin_fn]
pub fn on_resolve(input: String) -> FnResult<String> {
    let parsed: OnResolveInput = if input.is_empty() {
        OnResolveInput::default()
    } else {
        serde_json::from_str(&input).unwrap_or_default()
    };

    let _ = extism_pdk::var::set("last_resolve_input", input.as_str());

    let (viewport_data, node_view_ids, node_kit_ids, node_occurrence_ids) = build_viewport(&parsed);
    let viewport_data_binary = encode_viewport_data_binary(&viewport_data);
    let font_requests = collect_font_requests(&viewport_data);
    let result = OnResolveResult {
        categories: build_categories(&parsed),
        viewport_data,
        node_view_ids,
        node_kit_ids,
        node_occurrence_ids,
        font_requests,
        viewport_data_binary,
    };

    // Publish the Views panel manifest as a side effect of resolve. The topology is a pure
    // function of the resolve graph, so the manifest's lifecycle is coupled to resolve - but
    // the *channel* is separate from `OnResolveResult`'s return value. Decoupling lets a future
    // plugin publish a panel manifest on whatever cadence it wants (e.g. a non-Charter utility
    // plugin refreshing its own panel without a full resolve), and keeps `OnResolveResult` focused
    // on viewport data + categories instead of accumulating per-panel fields. See CLAUDE.md's
    // panel-manifest section.
    let manifest = build_views_panel_manifest(&parsed);
    let _ = unsafe {
        kit10_panel_publish(PanelPublishInput {
            panel_id: "views".to_string(),
            manifest,
        })
    };

    Ok(serde_json::to_string(&result).unwrap_or_default())
}

#[plugin_fn]
pub fn on_selection_change(input: String) -> FnResult<String> {
    let selection: OnSelectionChangeInput = serde_json::from_str(&input).unwrap_or_default();

    let last_bytes = extism_pdk::var::get_memory("last_resolve_input")
        .ok()
        .flatten()
        .map(|m| m.to_vec())
        .unwrap_or_default();

    if last_bytes.is_empty() {
        return Ok(serde_json::to_string(&OnSelectionChangeResult {
            viewport_data: vec![],
            node_view_ids: vec![],
            node_kit_ids: vec![],
            node_occurrence_ids: vec![],
            viewport_data_binary: None,
        })?);
    }

    let mut parsed: OnResolveInput = serde_json::from_slice(&last_bytes).unwrap_or_default();
    parsed.selected_occurrence_primary = selection.primary;
    parsed.selected_occurrence_secondary = selection.secondary;
    // Keep active_view_id in sync so the correct view gets its selection highlight.
    if selection.active_view_id.is_some() {
        parsed.active_view_id = selection.active_view_id;
    }
    parsed.hovered_occurrence_id = selection.hovered_occurrence_id;

    let (viewport_data, node_view_ids, node_kit_ids, node_occurrence_ids) = build_viewport(&parsed);
    let viewport_data_binary = encode_viewport_data_binary(&viewport_data);
    Ok(serde_json::to_string(&OnSelectionChangeResult {
        viewport_data,
        node_view_ids,
        node_kit_ids,
        node_occurrence_ids,
        viewport_data_binary,
    })?)
}

#[plugin_fn]
pub fn on_field_update(input: String) -> FnResult<String> {
    let update: FieldUpdate = serde_json::from_str(&input).unwrap_or_default();

    let write_input = WriteRenderEntryInput {
        layer_id: update.layer_id,
        property: update.property,
        value: update.value,
        token_id: update.token_id,
    };

    let result = unsafe { kit10_write_render_entry_to_layer(write_input)? };

    Ok(serde_json::to_string(&result).unwrap_or_default())
}

#[cfg(test)]
mod field_update_tests {
    use super::FieldUpdate;

    #[test]
    fn deserializes_camel_case_from_js() {
        let json =
            r##"{"layerId":"layer-123","property":"color","value":"#ff0000","tokenId":null}"##;
        let update: FieldUpdate = serde_json::from_str(json)
            .expect("should deserialize camelCase JSON sent by StyleField.svelte");
        assert_eq!(update.layer_id, "layer-123");
        assert_eq!(update.property, "color");
        assert_eq!(update.value.as_deref(), Some("#ff0000"));
        assert_eq!(update.token_id, None);
    }
}

#[cfg(test)]
mod selection_change_input_wire_tests {
    use super::OnSelectionChangeInput;

    // Regression test: this struct previously had no rename_all at all. A mismatched key
    // silently deserializes to None (#[serde(default)]) instead of erroring, so this class of
    // bug produces no test failure unless a test actually asserts the field ends up Some(..)
    // from real camelCase JSON -- exactly what manager.svelte.ts's payload looks like.
    #[test]
    fn deserializes_camel_case_from_js() {
        let json = r##"{"primary":"v1","secondary":[],"activeViewId":"v1","hoveredOccurrenceId":"v2"}"##;
        let input: OnSelectionChangeInput = serde_json::from_str(json)
            .expect("should deserialize camelCase JSON sent by manager.svelte.ts");
        assert_eq!(input.primary.as_deref(), Some("v1"));
        assert_eq!(
            input.active_view_id.as_deref(),
            Some("v1"),
            "activeViewId must not silently become None"
        );
        assert_eq!(
            input.hovered_occurrence_id.as_deref(),
            Some("v2"),
            "hoveredOccurrenceId must not silently become None"
        );
    }

    #[test]
    fn hovered_occurrence_id_null_deserializes_to_none() {
        let json = r##"{"primary":null,"secondary":[],"activeViewId":null,"hoveredOccurrenceId":null}"##;
        let input: OnSelectionChangeInput = serde_json::from_str(json).unwrap();
        assert_eq!(input.hovered_occurrence_id, None);
    }
}

#[cfg(test)]
mod position_wire_tests {
    use super::*;

    #[test]
    fn absolute_position_serializes_as_expected() {
        let extra = BoxExtra {
            position: NodePosition::Absolute { x: 500.0, y: 400.0 },
            ..BoxExtra::default()
        };
        let json = serde_json::to_string(&extra).unwrap();
        println!("BoxExtra JSON: {}", json);
        assert!(
            json.contains(r#""position":{"Absolute":{"x":500.0,"y":400.0}}"#),
            "json was: {}",
            json
        );
    }

    #[test]
    fn build_viewport_places_positioned_view_as_independent_root() {
        let mut hints = std::collections::HashMap::new();
        hints.insert(
            "vellum".to_string(),
            serde_json::json!({ "position": [500.0, 400.0] }),
        );

        let view = ViewMeta {
            view_id: "v1".to_string(),
            view_name: "View 1".to_string(),
            hints,
            resolved_kits: vec![ResolvedKit {
                kit_id: "k1".to_string(),
                kit_name: "Kit".to_string(),
                properties: {
                    let mut m = std::collections::HashMap::new();
                    m.insert(
                        "background".to_string(),
                        ResolvedProperty {
                            property: "background".to_string(),
                            value: "#ff0000".to_string(),
                            source_layer_id: "l1".to_string(),
                            kit_id: "k1".to_string(),
                            is_token: false,
                            token_alias: None,
                            condition_count: 0,
                            view_refs: None,
                        },
                    );
                    m
                },
            }],
        };

        let input = OnResolveInput {
            active_view_id: None,
            resolved_kits: vec![],
            view_hints: std::collections::HashMap::new(),
            project_views: vec![view],
            overridden_occurrences: vec![],
            selected_occurrence_primary: None,
            selected_occurrence_secondary: vec![],
            hovered_occurrence_id: None,
            font_facts: Default::default(),
        };

        let (viewport, node_view_ids, _node_kit_ids, _node_occurrence_ids) = build_viewport(&input);
        println!(
            "viewport JSON: {}",
            serde_json::to_string_pretty(&viewport).unwrap()
        );
        assert_eq!(
            viewport.len(),
            2,
            "expected the positioned root cell + its one content box"
        );
        assert_eq!(
            node_view_ids,
            vec![String::new(), "v1".to_string()],
            "root cell is structural (\"\"), content box belongs to v1"
        );
        if let UiNode::Box(box_data) = &viewport[0] {
            assert_eq!(box_data.parent_id, None);
            assert_eq!(
                box_data.extra.position,
                NodePosition::Absolute { x: 500.0, y: 400.0 }
            );
        } else {
            panic!("expected a Box node");
        }
    }
}

#[cfg(test)]
mod selection_and_hover_tests {
    use super::*;

    fn box_prop(name: &str, value: &str) -> ResolvedProperty {
        ResolvedProperty {
            property: name.to_string(),
            value: value.to_string(),
            source_layer_id: "layer".to_string(),
            kit_id: "kit".to_string(),
            is_token: false,
            token_alias: None,
            condition_count: 0,
            view_refs: None,
        }
    }

    // A `children` property whose view-list value names the child views (mirrors what the resolver
    // produces; Charter reads its own `children` field's view_refs to nest).
    fn children_prop(ids: Vec<String>) -> ResolvedProperty {
        let mut p = box_prop("children", "");
        p.view_refs = Some(
            ids.into_iter()
                .map(|id| ViewRef {
                    token_id: format!("{id}-token"),
                    view_id: id,
                })
                .collect(),
        );
        p
    }

    fn box_view(view_id: &str, child_view_ids: Vec<String>) -> ViewMeta {
        ViewMeta {
            view_id: view_id.to_string(),
            view_name: view_id.to_string(),
            hints: std::collections::HashMap::new(),
            resolved_kits: vec![ResolvedKit {
                kit_id: "kit".to_string(),
                kit_name: "Kit".to_string(),
                properties: {
                    let mut m = std::collections::HashMap::new();
                    m.insert("width".to_string(), box_prop("width", "100px"));
                    if !child_view_ids.is_empty() {
                        m.insert("children".to_string(), children_prop(child_view_ids));
                    }
                    m
                },
            }],
        }
    }

    fn text_view(view_id: &str) -> ViewMeta {
        ViewMeta {
            view_id: view_id.to_string(),
            view_name: view_id.to_string(),
            hints: std::collections::HashMap::new(),
            resolved_kits: vec![ResolvedKit {
                kit_id: "kit".to_string(),
                kit_name: "Kit".to_string(),
                properties: {
                    let mut m = std::collections::HashMap::new();
                    m.insert("font-size".to_string(), box_prop("font-size", "14px"));
                    m.insert("color".to_string(), box_prop("color", "#111111"));
                    m
                },
            }],
        }
    }

    fn input(
        project_views: Vec<ViewMeta>,
        primary: Option<&str>,
        hovered: Option<&str>,
    ) -> OnResolveInput {
        OnResolveInput {
            active_view_id: None,
            resolved_kits: vec![],
            view_hints: std::collections::HashMap::new(),
            project_views,
            overridden_occurrences: vec![],
            selected_occurrence_primary: primary.map(str::to_string),
            selected_occurrence_secondary: vec![],
            hovered_occurrence_id: hovered.map(str::to_string),
            font_facts: Default::default(),
        }
    }

    #[test]
    fn text_primitive_view_gets_selected_marking() {
        let input = input(vec![text_view("t1")], Some("t1"), None);
        let (viewport, node_view_ids, _node_kit_ids, _node_occurrence_ids) = build_viewport(&input);

        let text_idx = node_view_ids
            .iter()
            .position(|id| id == "t1")
            .expect("t1 node present");
        let UiNode::Text(text_data) = &viewport[text_idx] else {
            panic!("expected a Text node for a text-primitive view");
        };
        assert_eq!(
            text_data.selected, 2,
            "selected view's Text primitive must be marked selected"
        );
    }

    #[test]
    fn referenced_child_view_gets_own_selection_when_it_is_the_active_selection() {
        let parent = box_view("parent", vec!["child".to_string()]);
        let child = box_view("child", vec![]);
        let input = input(vec![parent, child], Some("child-token"), None);
        let (viewport, node_view_ids, _node_kit_ids, _node_occurrence_ids) = build_viewport(&input);

        let parent_idx = node_view_ids
            .iter()
            .position(|id| id == "parent")
            .expect("parent node present");
        let child_idx = node_view_ids
            .iter()
            .position(|id| id == "child")
            .expect("child node present");

        let UiNode::Box(parent_data) = &viewport[parent_idx]
        else {
            panic!("expected Box")
        };
        let UiNode::Box(child_data) = &viewport[child_idx]
        else {
            panic!("expected Box")
        };
        assert_eq!(parent_data.selected, 0, "parent itself isn't selected");
        assert_eq!(child_data.selected, 2, "nested referenced-as-child view that IS the active selection must show selected, not a hardcoded 0");
    }

    #[test]
    fn hover_is_independent_from_selection() {
        let parent = box_view("parent", vec!["child".to_string()]);
        let child = box_view("child", vec![]);
        let input = input(vec![parent, child], Some("parent"), Some("child-token"));
        let (viewport, node_view_ids, _node_kit_ids, _node_occurrence_ids) = build_viewport(&input);

        let parent_idx = node_view_ids.iter().position(|id| id == "parent").unwrap();
        let child_idx = node_view_ids.iter().position(|id| id == "child").unwrap();

        let UiNode::Box(parent_data) = &viewport[parent_idx]
        else {
            panic!("expected Box")
        };
        let UiNode::Box(child_data) = &viewport[child_idx]
        else {
            panic!("expected Box")
        };
        assert_eq!(parent_data.selected, 2, "parent is selected");
        assert!(!parent_data.hovered, "parent is not hovered");
        assert_eq!(child_data.selected, 0, "child is not selected");
        assert!(
            child_data.hovered,
            "child is hovered, independently of parent's selection"
        );
    }

    #[test]
    fn overridden_occurrence_changes_only_its_own_rendering_and_selection() {
        // The same view ("target") is referenced twice, by two different parents, via two
        // different token ids -- one plain (parent_a, auto-generated token_id "target-token" via
        // children_prop), one carrying an axis override that changes its own rendered width
        // (parent_b, token_id "target-token-override"). Both occurrences must render
        // independently: the plain one uses target's own resolution untouched, the overridden
        // one uses OverriddenOccurrence's resolved_kits -- mirroring resolve.ts's
        // resolveViewsFromRows exactly (the shared `views` entry for `target` is never mutated by
        // an override; only the specific occurrence that names it is).
        let target = box_view("target", vec![]);
        let parent_a = box_view("parent-a", vec!["target".to_string()]);

        let parent_b = ViewMeta {
            view_id: "parent-b".to_string(),
            view_name: "parent-b".to_string(),
            hints: std::collections::HashMap::new(),
            resolved_kits: vec![ResolvedKit {
                kit_id: "kit".to_string(),
                kit_name: "Kit".to_string(),
                properties: {
                    let mut m = std::collections::HashMap::new();
                    m.insert("width".to_string(), box_prop("width", "100px"));
                    let mut children = box_prop("children", "");
                    children.view_refs = Some(vec![ViewRef {
                        view_id: "target".to_string(),
                        token_id: "target-token-override".to_string(),
                    }]);
                    m.insert("children".to_string(), children);
                    m
                },
            }],
        };

        let overridden = OverriddenOccurrence {
            occurrence_key: "target-token-override".to_string(),
            view_id: "target".to_string(),
            resolved_kits: vec![ResolvedKit {
                kit_id: "kit".to_string(),
                kit_name: "Kit".to_string(),
                properties: {
                    let mut m = std::collections::HashMap::new();
                    m.insert("width".to_string(), box_prop("width", "250px"));
                    m
                },
            }],
        };

        let mut resolve_input = input(vec![parent_a, parent_b, target], None, None);
        resolve_input.overridden_occurrences = vec![overridden];

        let (viewport, node_view_ids, _node_kit_ids, node_occurrence_ids) =
            build_viewport(&resolve_input);

        let target_indices: Vec<usize> = node_view_ids
            .iter()
            .enumerate()
            .filter(|(_, id)| *id == "target")
            .map(|(i, _)| i)
            .collect();
        assert_eq!(
            target_indices.len(),
            2,
            "target should render once per occurrence, not deduped by view_id"
        );

        let occ_ids: Vec<String> = target_indices
            .iter()
            .map(|&i| node_occurrence_ids[i].clone())
            .collect();
        assert_ne!(
            occ_ids[0], occ_ids[1],
            "the two occurrences must have distinct occurrence ids"
        );
        assert!(occ_ids.contains(&"target-token".to_string()));
        assert!(occ_ids.contains(&"target-token-override".to_string()));

        for &i in &target_indices {
            let UiNode::Box(box_data) = &viewport[i] else {
                panic!("expected Box")
            };
            if node_occurrence_ids[i] == "target-token-override" {
                assert_eq!(
                    box_data.width,
                    Extent::Px(250.0),
                    "the overridden occurrence renders its OWN resolved_kits"
                );
            } else {
                assert_eq!(
                    box_data.width,
                    Extent::Px(100.0),
                    "the plain occurrence renders target's own resolution, untouched by its sibling's override"
                );
            }
        }

        // Selecting the overridden occurrence's key marks only that one node -- its sibling
        // occurrence of the same view_id stays unselected.
        resolve_input.selected_occurrence_primary = Some("target-token-override".to_string());
        let (viewport2, node_view_ids2, _k2, occ2) = build_viewport(&resolve_input);
        for (i, id) in node_view_ids2.iter().enumerate() {
            if id != "target" {
                continue;
            }
            let UiNode::Box(box_data) = &viewport2[i] else {
                panic!("expected Box")
            };
            if occ2[i] == "target-token-override" {
                assert_eq!(box_data.selected, 2, "the overridden occurrence is selected");
            } else {
                assert_eq!(
                    box_data.selected, 0,
                    "the plain occurrence of the SAME view_id must not also show selected"
                );
            }
        }
    }

    #[test]
    fn node_view_ids_tags_nested_child_with_its_own_view_id_not_parents() {
        let parent = box_view("parent", vec!["child".to_string()]);
        let child = box_view("child", vec![]);
        let input = input(vec![parent, child], None, None);
        let (_viewport, node_view_ids, _node_kit_ids, _node_occurrence_ids) = build_viewport(&input);

        assert!(node_view_ids.contains(&"parent".to_string()));
        assert!(node_view_ids.contains(&"child".to_string()));
    }

    #[test]
    fn structural_grid_scaffolding_has_empty_view_id() {
        let input = input(vec![box_view("v1", vec![])], None, None);
        let (_viewport, node_view_ids, _node_kit_ids, _node_occurrence_ids) = build_viewport(&input);
        assert!(
            node_view_ids.contains(&String::new()),
            "root/row/cell wrapper boxes should be tagged as belonging to no view"
        );
    }

    #[test]
    fn node_kit_ids_is_parallel_to_node_view_ids_and_empty_for_structural_nodes() {
        let input = input(vec![box_view("v1", vec![])], None, None);
        let (_viewport, node_view_ids, node_kit_ids, _node_occurrence_ids) = build_viewport(&input);

        assert_eq!(
            node_view_ids.len(),
            node_kit_ids.len(),
            "node_kit_ids must be parallel (same length) to node_view_ids"
        );
        let v1_idx = node_view_ids.iter().position(|id| id == "v1").unwrap();
        assert_eq!(node_kit_ids[v1_idx], "kit", "v1's node names its composed kit");
        for (i, view_id) in node_view_ids.iter().enumerate() {
            if view_id.is_empty() {
                assert_eq!(
                    node_kit_ids[i],
                    String::new(),
                    "structural scaffolding nodes must have an empty kit id too"
                );
            }
        }
    }

    #[test]
    fn node_kit_ids_names_the_highest_priority_composed_kit() {
        let mut view = box_view("v1", vec![]);
        // A second, higher-priority kit composed after the first -- merge_kits' own "later kit
        // wins" convention means this one's properties win, so its id should be what node_kit_ids
        // reports, not the first kit's.
        view.resolved_kits.push(ResolvedKit {
            kit_id: "kit-2".to_string(),
            kit_name: "Kit Two".to_string(),
            properties: std::collections::HashMap::new(),
        });
        let input = input(vec![view], None, None);
        let (_viewport, node_view_ids, node_kit_ids, _node_occurrence_ids) = build_viewport(&input);

        let v1_idx = node_view_ids.iter().position(|id| id == "v1").unwrap();
        assert_eq!(node_kit_ids[v1_idx], "kit-2");
    }

    // Regression test: OnResolveResult/OnSelectionChangeResult must serialize their fields as
    // snake_case ("viewport_data"/"node_view_ids"), matching what manager.svelte.ts's
    // `parsed.viewport_data`/`parsed.node_view_ids` reads. Every other test above only checks
    // Rust-side struct fields, never the actual wire JSON -- an accidental
    // #[serde(rename_all = "camelCase")] on these two structs would pass every one of them while
    // silently producing "viewportData"/"nodeViewIds" keys the JS side never reads, and the
    // whole viewport would go blank with zero errors anywhere.
    //
    // The panel manifest (panel_id/items/child_ids/is_root/write_alias) follows the same rule --
    // it's plugin-authored output the editor reads back. Asserting its snake-case wire keys
    // here guards against the same silent-drift class of bug. composition_field_keys/view_icons
    // used to live on OnResolveResult; they've moved to the manifest (composition_field_keys is
    // implicit in which items appear, view_icons became PanelItem.icon).
    #[test]
    fn on_resolve_result_serializes_snake_case_keys() {
        let result = OnResolveResult {
            categories: vec![],
            viewport_data: vec![],
            node_view_ids: vec![],
            node_kit_ids: vec![],
            node_occurrence_ids: vec![],
            font_requests: vec![],
            viewport_data_binary: None,
        };
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"viewport_data\""), "json was: {json}");
        assert!(json.contains("\"node_view_ids\""), "json was: {json}");
        assert!(!json.contains("\"viewportData\""), "json was: {json}");
        assert!(!json.contains("\"nodeViewIds\""), "json was: {json}");
        // The removed fields must NOT appear -- guards against a stale copy left behind silently
        // re-serializing data nothing reads anymore.
        assert!(
            !json.contains("\"composition_field_keys\""),
            "composition_field_keys moved to the panel manifest, json was: {json}"
        );
        assert!(
            !json.contains("\"view_icons\""),
            "view_icons moved to the panel manifest (PanelItem.icon), json was: {json}"
        );
    }

    #[test]
    fn primitive_icon_maps_text_to_italic_and_box_to_window() {
        // primitive_icon is no longer called from build_views_panel_manifest (the editor reads
        // `hints.view_icon` directly), but detect_primitive still runs for the active view's own
        // primitive detection inside build_viewport/build_categories, so primitive_icon remains
        // a tested helper. The wiring from primitive -> FA class is 1:1 with what seed.ts sets
        // as `hints.view_icon` for each primitive kind, by convention.
        assert_eq!(primitive_icon("text"), "fa-solid fa-italic");
        assert_eq!(primitive_icon("box"), "fa-regular fa-window-maximize");
    }

    // The panel manifest serializes its fields as snake_case: panel_id, items,
    // composition_field_keys, header_ops, write_alias, ops. An accidental
    // #[serde(rename_all = "camelCase")] on PanelManifest or PanelItem would silently produce
    // panelId/compositionFieldKeys/writeAlias the editor's JS never reads (matching the same
    // pitfall as OnResolveResult above).
    #[test]
    fn panel_manifest_serializes_snake_case_keys() {
        let manifest = PanelManifest {
            panel_id: "views".to_string(),
            composition_field_keys: vec!["children".to_string()],
            items: vec![PanelItem {
                id: "v1".to_string(),
                write_alias: Some("children".to_string()),
                ops: vec![PanelOp {
                    name: "rename".to_string(),
                    label: "Rename".to_string(),
                    icon: "fa-solid fa-i-cursor".to_string(),
                    kind: None,
                }],
            }],
            header_ops: vec![PanelOp {
                name: "add-child".to_string(),
                label: "Box".to_string(),
                icon: "fa-regular fa-window-maximize".to_string(),
                kind: Some("box".to_string()),
            }],
        };
        let json = serde_json::to_string(&manifest).unwrap();
        assert!(json.contains("\"panel_id\""), "json was: {json}");
        assert!(json.contains("\"items\""), "json was: {json}");
        assert!(
            json.contains("\"composition_field_keys\""),
            "json was: {json}"
        );
        assert!(json.contains("\"write_alias\""), "json was: {json}");
        assert!(json.contains("\"ops\""), "json was: {json}");
        assert!(json.contains("\"header_ops\""), "json was: {json}");
        assert!(!json.contains("\"panelId\""), "json was: {json}");
        assert!(
            !json.contains("\"compositionFieldKeys\""),
            "json was: {json}"
        );
        assert!(!json.contains("\"writeAlias\""), "json was: {json}");
        assert!(!json.contains("\"headerOps\""), "json was: {json}");
        // Removed in Phase 3: `icon` on PanelItem (now read from `hints.view_icon` host-side),
        // `child_ids` and `is_root` (host computes topology from resolvedViews +
        // composition_field_keys - generic graph walk that doesn't need to round-trip through
        // the plugin). Asserting they're absent guards against someone restoring the old shape.
        assert!(!json.contains("\"child_ids\""), "json was: {json}");
        assert!(!json.contains("\"is_root\""), "json was: {json}");
    }

    // build_views_panel_manifest carries `composition_field_keys` so the host can do the DAG
    // walk itself, instead of the manifest carrying pre-computed `child_ids`/`is_root` (which
    // Phase 1 did - shipping a generic graph computation across the WASM boundary just to dedupe
    // it, when the host already had `resolvedViews` in scope). Charter's whole nesting opinion
    // lives in this one field: "this is the resolved-property name whose `viewRefs` nest."
    #[test]
    fn build_views_panel_manifest_carries_composition_field_keys() {
        let manifest = build_views_panel_manifest(&input(vec![box_view("v1", vec![])], None, None));
        assert_eq!(
            manifest.composition_field_keys,
            vec!["children".to_string()],
            "Charter declares `children` as its composition field"
        );
    }

    // A Text primitive has no `children` field, so its manifest item carries no write_alias --
    // the editor uses this to suppress the DnD-nest affordance. A Box with a `children`-declaring
    // kit layer carries the alias Charter obtained from the resolved property's token_alias.
    #[test]
    fn build_views_panel_manifest_write_alias_only_for_views_with_children_field() {
        let mut box_kit_props = std::collections::HashMap::new();
        box_kit_props.insert("width".to_string(), box_prop("width", "100px"));
        box_kit_props.insert(
            "children".to_string(),
            ResolvedProperty {
                property: "children".to_string(),
                value: "".to_string(),
                source_layer_id: "layer".to_string(),
                kit_id: "kit".to_string(),
                is_token: true,
                token_alias: Some("children".to_string()),
                condition_count: 0,
                view_refs: None,
            },
        );
        let box_with_children = ViewMeta {
            view_id: "box".to_string(),
            view_name: "box".to_string(),
            hints: std::collections::HashMap::new(),
            resolved_kits: vec![ResolvedKit {
                kit_id: "kit".to_string(),
                kit_name: "Kit".to_string(),
                properties: box_kit_props,
            }],
        };
        let text_view = text_view("text");

        let manifest =
            build_views_panel_manifest(&input(vec![box_with_children, text_view], None, None));
        let by_id: std::collections::HashMap<String, &PanelItem> =
            manifest.items.iter().map(|i| (i.id.clone(), i)).collect();

        assert_eq!(
            by_id.get("box").unwrap().write_alias.as_deref(),
            Some("children"),
            "Box with a children-declaring kit layer carries the alias"
        );
        assert!(
            by_id.get("text").unwrap().write_alias.is_none(),
            "Text primitive has no children field -> no write_alias"
        );
    }

    // Per-item op set: a container (Box with a `children` field) gets the `add-child` ops on top
    // of the common ops; a leaf (Text/Image) gets only the common ops. The op set is plugin-owned
    // - the editor's context menu is built straight off this list, no editor-side hardcoded menu.
    #[test]
    fn build_views_panel_manifest_container_gets_add_child_ops_leaf_does_not() {
        let mut box_kit_props = std::collections::HashMap::new();
        box_kit_props.insert("width".to_string(), box_prop("width", "100px"));
        box_kit_props.insert(
            "children".to_string(),
            ResolvedProperty {
                property: "children".to_string(),
                value: "".to_string(),
                source_layer_id: "layer".to_string(),
                kit_id: "kit".to_string(),
                is_token: true,
                token_alias: Some("children".to_string()),
                condition_count: 0,
                view_refs: None,
            },
        );
        let box_view = ViewMeta {
            view_id: "box".to_string(),
            view_name: "box".to_string(),
            hints: std::collections::HashMap::new(),
            resolved_kits: vec![ResolvedKit {
                kit_id: "kit".to_string(),
                kit_name: "Kit".to_string(),
                properties: box_kit_props,
            }],
        };
        let leaf = text_view("leaf");

        let manifest = build_views_panel_manifest(&input(vec![box_view, leaf], None, None));
        let by_id: std::collections::HashMap<String, &PanelItem> =
            manifest.items.iter().map(|i| (i.id.clone(), i)).collect();

        let box_ops: Vec<String> = by_id
            .get("box")
            .unwrap()
            .ops
            .iter()
            .map(|o| o.name.clone())
            .collect();
        let leaf_ops: Vec<String> = by_id
            .get("leaf")
            .unwrap()
            .ops
            .iter()
            .map(|o| o.name.clone())
            .collect();

        assert!(
            box_ops.iter().any(|n| n == "add-child"),
            "Box (children-declaring) gets add-child ops, got: {box_ops:?}"
        );
        assert!(
            !leaf_ops.iter().any(|n| n == "add-child"),
            "Text leaf does NOT get add-child ops, got: {leaf_ops:?}"
        );
        // Both get the common ops (rename/clone/lock/hide/deselect/delete).
        for expected in ["rename", "clone", "lock", "hide", "deselect", "delete"] {
            assert!(
                box_ops.iter().any(|n| n == expected),
                "box ops missing {expected}: {box_ops:?}"
            );
            assert!(
                leaf_ops.iter().any(|n| n == expected),
                "leaf ops missing {expected}: {leaf_ops:?}"
            );
        }
    }

    // The core fix this test guards: a freshly composed Box (a kit is attached, but nobody has
    // ever written a `children` value yet, so there's no live token/write_alias) must still get
    // the add-child ops. Gating on write_alias.is_some() regressed this - a brand-new Box would
    // never show "Add Child" until some other write happened to seed the token first. Gating on
    // primitive instead means the affordance is available the moment a view is a Box, and the
    // editor's `write_alias ?? 'children'` fallback (Views.svelte) writes the canonical alias on
    // first use.
    #[test]
    fn build_views_panel_manifest_container_gets_add_child_ops_before_first_child_write() {
        let mut box_kit_props = std::collections::HashMap::new();
        box_kit_props.insert("width".to_string(), box_prop("width", "100px"));
        let box_no_children_yet = ViewMeta {
            view_id: "fresh-box".to_string(),
            view_name: "fresh-box".to_string(),
            hints: std::collections::HashMap::new(),
            resolved_kits: vec![ResolvedKit {
                kit_id: "kit".to_string(),
                kit_name: "Kit".to_string(),
                properties: box_kit_props,
            }],
        };

        let manifest = build_views_panel_manifest(&input(vec![box_no_children_yet], None, None));
        let item = manifest.items.iter().find(|i| i.id == "fresh-box").unwrap();

        assert!(
            item.write_alias.is_none(),
            "no children write has happened yet, so there's no live token"
        );
        assert!(
            item.ops.iter().any(|o| o.name == "add-child"),
            "a Box with no children field yet still gets add-child ops, got: {:?}",
            item.ops.iter().map(|o| &o.name).collect::<Vec<_>>()
        );
    }

    // Header ops are populated - the "+" menu in the Views panel header renders straight off this
    // list. Currently Charter ships the add-child (box/text/image) trio.
    #[test]
    fn build_views_panel_manifest_carries_header_ops() {
        let manifest = build_views_panel_manifest(&input(vec![box_view("v1", vec![])], None, None));
        let header_names: Vec<String> =
            manifest.header_ops.iter().map(|o| o.name.clone()).collect();
        assert!(
            header_names.iter().any(|n| n == "add-child"),
            "header_ops include add-child, got: {header_names:?}"
        );
        let kinds: Vec<String> = manifest
            .header_ops
            .iter()
            .filter(|o| o.name == "add-child")
            .filter_map(|o| o.kind.clone())
            .collect();
        assert!(
            kinds.contains(&"box".to_string())
                && kinds.contains(&"text".to_string())
                && kinds.contains(&"image".to_string()),
            "add-child header ops cover box/text/image, got: {kinds:?}"
        );
    }

    #[test]
    fn composition_field_keys_is_children_and_view_independent() {
        // Charter's only composition field is `children` (on Box). The set is stable regardless of
        // the active view's primitive -- that's what lets the editor nest by field-kind always.
        // (Still true even though the field no longer rides OnResolveResult -- the manifest's
        // child_ids come from this same `children` field's view_refs, see build_views_panel_manifest.)
        assert_eq!(composition_field_keys(), vec!["children".to_string()]);
    }

    #[test]
    fn on_selection_change_result_serializes_snake_case_keys() {
        let result = OnSelectionChangeResult {
            viewport_data: vec![],
            node_view_ids: vec![],
            node_kit_ids: vec![],
            node_occurrence_ids: vec![],
            viewport_data_binary: None,
        };
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"viewport_data\""), "json was: {json}");
        assert!(json.contains("\"node_view_ids\""), "json was: {json}");
        assert!(!json.contains("\"viewportData\""), "json was: {json}");
        assert!(!json.contains("\"nodeViewIds\""), "json was: {json}");
    }
}

#[cfg(test)]
mod children_containment_tests {
    use super::*;

    fn prop(name: &str, value: &str) -> ResolvedProperty {
        ResolvedProperty {
            property: name.to_string(),
            value: value.to_string(),
            source_layer_id: "layer".to_string(),
            kit_id: "kit".to_string(),
            is_token: false,
            token_alias: None,
            condition_count: 0,
            view_refs: None,
        }
    }

    // A `children` property whose view-list value names the child views (Charter reads its own
    // `children` field's view_refs to nest). A "child" fixture being listed here is what excludes
    // it from the top-level grid (build_viewport's `referenced` set), so node_view_ids.contains(...)
    // being true only ever means recursion actually worked.
    fn children_prop(ids: Vec<String>) -> ResolvedProperty {
        let mut p = prop("children", "");
        p.view_refs = Some(
            ids.into_iter()
                .map(|id| ViewRef {
                    token_id: format!("{id}-token"),
                    view_id: id,
                })
                .collect(),
        );
        p
    }

    fn box_view(view_id: &str, child_view_ids: Vec<String>) -> ViewMeta {
        ViewMeta {
            view_id: view_id.to_string(),
            view_name: view_id.to_string(),
            hints: std::collections::HashMap::new(),
            resolved_kits: vec![ResolvedKit {
                kit_id: "kit".to_string(),
                kit_name: "Kit".to_string(),
                properties: {
                    let mut m = std::collections::HashMap::new();
                    m.insert("width".to_string(), prop("width", "100px"));
                    if !child_view_ids.is_empty() {
                        m.insert("children".to_string(), children_prop(child_view_ids));
                    }
                    m
                },
            }],
        }
    }

    fn text_view(view_id: &str, child_view_ids: Vec<String>) -> ViewMeta {
        ViewMeta {
            view_id: view_id.to_string(),
            view_name: view_id.to_string(),
            hints: std::collections::HashMap::new(),
            resolved_kits: vec![ResolvedKit {
                kit_id: "kit".to_string(),
                kit_name: "Kit".to_string(),
                properties: {
                    let mut m = std::collections::HashMap::new();
                    m.insert("font-size".to_string(), prop("font-size", "14px"));
                    m.insert("color".to_string(), prop("color", "#111111"));
                    if !child_view_ids.is_empty() {
                        m.insert("children".to_string(), children_prop(child_view_ids));
                    }
                    m
                },
            }],
        }
    }

    fn input(project_views: Vec<ViewMeta>) -> OnResolveInput {
        OnResolveInput {
            active_view_id: None,
            resolved_kits: vec![],
            view_hints: std::collections::HashMap::new(),
            project_views,
            overridden_occurrences: vec![],
            selected_occurrence_primary: None,
            selected_occurrence_secondary: vec![],
            hovered_occurrence_id: None,
            font_facts: Default::default(),
        }
    }

    #[test]
    fn box_categories_declares_a_children_field() {
        let categories = box_categories();
        let found = categories
            .iter()
            .flat_map(|c| &c.fields)
            .any(|f| f.key == "children");
        assert!(
            found,
            "box_categories() should declare a \"children\" field"
        );
    }

    #[test]
    fn text_categories_does_not_declare_a_children_field() {
        let categories = text_categories();
        let found = categories
            .iter()
            .flat_map(|c| &c.fields)
            .any(|f| f.key == "children");
        assert!(!found, "text_categories() should not declare \"children\" -- children are only ever authored on a Box");
    }

    #[test]
    fn text_categories_declares_a_content_field() {
        let categories = text_categories();
        let found = categories
            .iter()
            .flat_map(|c| &c.fields)
            .any(|f| f.key == "content");
        assert!(found, "text_categories() should declare a \"content\" field -- a Text node's own string is otherwise only ever settable via seed data");
    }

    #[test]
    fn box_categories_does_not_declare_a_content_field() {
        // A Box is a pure container: it never renders inline text of its own (a design that wants
        // text nests a Text primitive as a child), so `content` is a Text-only field. See the
        // content-less recursion in render_view_nodes and text_categories_declares_a_content_field.
        let categories = box_categories();
        let found = categories
            .iter()
            .flat_map(|c| &c.fields)
            .any(|f| f.key == "content");
        assert!(!found, "box_categories() must NOT declare a \"content\" field -- a Box has no inline text; nest a Text primitive instead");
    }

    #[test]
    fn box_parent_recurses_into_a_text_child() {
        let parent = box_view("parent", vec!["child".to_string()]);
        let child = text_view("child", vec![]);
        let (viewport, node_view_ids, _node_kit_ids, _node_occurrence_ids) = build_viewport(&input(vec![parent, child]));

        let child_idx = node_view_ids.iter().position(|id| id == "child");
        assert!(
            child_idx.is_some(),
            "a Box parent's Text child should be rendered"
        );
        assert!(matches!(viewport[child_idx.unwrap()], UiNode::Text(_)));
    }

    #[test]
    fn text_parent_recurses_into_a_text_child() {
        let parent = text_view("parent", vec!["child".to_string()]);
        let child = text_view("child", vec![]);
        let (viewport, node_view_ids, _node_kit_ids, _node_occurrence_ids) = build_viewport(&input(vec![parent, child]));

        let child_idx = node_view_ids.iter().position(|id| id == "child");
        assert!(
            child_idx.is_some(),
            "a Text parent's Text child should be rendered"
        );
        assert!(matches!(viewport[child_idx.unwrap()], UiNode::Text(_)));
    }

    #[test]
    fn text_parent_skips_a_box_child() {
        let parent = text_view("parent", vec!["child".to_string()]);
        let child = box_view("child", vec![]);
        let (_viewport, node_view_ids, _node_kit_ids, _node_occurrence_ids) = build_viewport(&input(vec![parent, child]));

        assert!(
            !node_view_ids.contains(&"child".to_string()),
            "a Text parent must never render a Box child"
        );
    }

    #[test]
    fn box_parent_still_recurses_into_a_box_child() {
        let parent = box_view("parent", vec!["child".to_string()]);
        let child = box_view("child", vec![]);
        let (viewport, node_view_ids, _node_kit_ids, _node_occurrence_ids) = build_viewport(&input(vec![parent, child]));

        let child_idx = node_view_ids.iter().position(|id| id == "child");
        assert!(
            child_idx.is_some(),
            "a Box parent's Box child should still be rendered (unchanged existing behavior)"
        );
        assert!(matches!(viewport[child_idx.unwrap()], UiNode::Box(_)));
    }

    #[test]
    fn referenced_child_view_is_excluded_from_the_top_level_grid_automatically() {
        // No childOnly-equivalent flag anywhere on any of these fixtures -- being listed in
        // "parent"'s child_view_ids is the only thing that should keep "child" out of its own
        // top-level grid cell.
        let parent = box_view("parent", vec!["child".to_string()]);
        let child = box_view("child", vec![]);
        let orphan = box_view("orphan", vec![]);
        let (_viewport, node_view_ids, _node_kit_ids, _node_occurrence_ids) = build_viewport(&input(vec![parent, child, orphan]));

        let child_occurrences = node_view_ids.iter().filter(|id| **id == "child").count();
        assert_eq!(
            child_occurrences, 1,
            "a referenced child should render exactly once, via recursion under its parent -- not also get its own top-level cell"
        );

        let orphan_occurrences = node_view_ids.iter().filter(|id| **id == "orphan").count();
        assert_eq!(
            orphan_occurrences, 1,
            "a view referenced by nobody must still render, as its own top-level cell"
        );
    }
}

#[cfg(test)]
mod text_align_decoration_tests {
    use super::*;

    fn prop(value: &str) -> ResolvedProperty {
        ResolvedProperty {
            property: "x".to_string(),
            value: value.to_string(),
            source_layer_id: "layer".to_string(),
            kit_id: "kit".to_string(),
            is_token: false,
            token_alias: None,
            condition_count: 0,
            view_refs: None,
        }
    }

    #[test]
    fn parse_text_align_maps_known_keywords_and_defaults_to_left() {
        assert_eq!(parse_text_align(Some("center")), TextAlign::Center);
        assert_eq!(parse_text_align(Some("right")), TextAlign::Right);
        assert_eq!(parse_text_align(Some("justify")), TextAlign::Justify);
        assert_eq!(parse_text_align(Some("left")), TextAlign::Left);
        assert_eq!(parse_text_align(Some("garbage")), TextAlign::Left);
        assert_eq!(parse_text_align(None), TextAlign::Left);
    }

    #[test]
    fn parse_text_decoration_maps_known_keywords_and_defaults_to_none() {
        assert_eq!(parse_text_decoration(Some("underline")), TextDecorationKind::Underline);
        assert_eq!(parse_text_decoration(Some("line-through")), TextDecorationKind::LineThrough);
        assert_eq!(parse_text_decoration(Some("none")), TextDecorationKind::None);
        assert_eq!(parse_text_decoration(Some("garbage")), TextDecorationKind::None);
        assert_eq!(parse_text_decoration(None), TextDecorationKind::None);
    }

    #[test]
    fn build_text_node_reads_align_and_decoration_from_props() {
        let mut props: std::collections::HashMap<String, ResolvedProperty> = Default::default();
        props.insert("content".to_string(), prop("Hi"));
        props.insert("text-align".to_string(), prop("center"));
        props.insert("text-decoration".to_string(), prop("underline"));
        let node = build_text_node(&props, 0);
        let UiNode::Text(t) = node else { panic!("expected Text") };
        assert_eq!(t.text_align, TextAlign::Center);
        assert_eq!(t.text_decoration, TextDecorationKind::Underline);
    }

    #[test]
    fn build_text_node_defaults_align_and_decoration_when_unset() {
        let mut props: std::collections::HashMap<String, ResolvedProperty> = Default::default();
        props.insert("content".to_string(), prop("Hi"));
        let node = build_text_node(&props, 0);
        let UiNode::Text(t) = node else { panic!("expected Text") };
        assert_eq!(t.text_align, TextAlign::Left);
        assert_eq!(t.text_decoration, TextDecorationKind::None);
    }

    // Wire-key test, per the serde-rename pitfall: TextData is Charter-authored output that
    // Vellum deserializes -- assert on the serialized JSON's key/value strings, not just the
    // Rust struct's fields, since a rename in either place fails silently (unwrap_or_default).
    #[test]
    fn text_categories_declares_align_and_decoration_as_segmented_input_types() {
        let categories = text_categories();
        let fields: Vec<&FieldDef> = categories.iter().flat_map(|c| &c.fields).collect();
        let align = fields.iter().find(|f| f.key == "text-align").expect("text-align field");
        assert_eq!(align.input_type.as_deref(), Some("align"));
        let decor = fields.iter().find(|f| f.key == "text-decoration").expect("text-decoration field");
        assert_eq!(decor.input_type.as_deref(), Some("decoration"));
    }

    #[test]
    fn text_data_serializes_align_and_decoration_as_vellum_enum_variant_names() {
        let mut props: std::collections::HashMap<String, ResolvedProperty> = Default::default();
        props.insert("content".to_string(), prop("Hi"));
        props.insert("text-align".to_string(), prop("right"));
        props.insert("text-decoration".to_string(), prop("line-through"));
        let node = build_text_node(&props, 0);
        let json = serde_json::to_string(&node).unwrap();
        assert!(json.contains("\"text_align\":\"Right\""), "json was: {json}");
        assert!(json.contains("\"text_decoration\":\"LineThrough\""), "json was: {json}");
    }
}

#[cfg(test)]
mod line_height_tests {
    use super::*;

    fn prop(value: &str) -> ResolvedProperty {
        ResolvedProperty {
            property: "x".to_string(),
            value: value.to_string(),
            source_layer_id: "layer".to_string(),
            kit_id: "kit".to_string(),
            is_token: false,
            token_alias: None,
            condition_count: 0,
            view_refs: None,
        }
    }

    #[test]
    fn explicit_px_value_wins_regardless_of_font_size() {
        assert_eq!(compile_line_height(16.0, Some("24px")), 24.0);
        assert_eq!(compile_line_height(48.0, Some("24px")), 24.0, "px is absolute, ignores font_size");
    }

    #[test]
    fn explicit_bare_number_is_a_multiplier_of_font_size() {
        assert_eq!(compile_line_height(16.0, Some("1.5")), 24.0);
        assert_eq!(compile_line_height(40.0, Some("2")), 80.0);
    }

    #[test]
    fn unset_or_unparseable_derives_the_ratio_ramp() {
        // Body-size flat anchor: <= 20px always gets the full 1.5x ratio.
        assert_eq!(compile_line_height(16.0, None), 16.0 * 1.5);
        assert_eq!(compile_line_height(20.0, None), 20.0 * 1.5);
        // Display-size flat anchor: >= 48px always gets the tight 1.1x ratio.
        assert_eq!(compile_line_height(48.0, None), 48.0 * 1.1);
        assert_eq!(compile_line_height(64.0, None), 64.0 * 1.1);
        // Midpoint (34px, halfway 20..48) interpolates to the ramp's midpoint ratio (1.3x).
        let mid = compile_line_height(34.0, None);
        assert!((mid - 34.0 * 1.3).abs() < 0.01, "got {mid}");
        // Garbage text falls through to the same derived ramp as None.
        assert_eq!(compile_line_height(16.0, Some("garbage")), compile_line_height(16.0, None));
    }

    #[test]
    fn build_text_node_reads_line_height_from_props() {
        let mut props: std::collections::HashMap<String, ResolvedProperty> = Default::default();
        props.insert("content".to_string(), prop("Hi"));
        props.insert("font-size".to_string(), prop("16px"));
        props.insert("line-height".to_string(), prop("1.5"));
        let node = build_text_node(&props, 0);
        let UiNode::Text(t) = node else { panic!("expected Text") };
        assert_eq!(t.line_height, 24.0);
    }

    #[test]
    fn build_text_node_derives_line_height_when_unset() {
        let mut props: std::collections::HashMap<String, ResolvedProperty> = Default::default();
        props.insert("content".to_string(), prop("Hi"));
        // No font-size set either -- resolved_font_size falls back to 16.0, matching the
        // 1.5x ratio for body sizes.
        let node = build_text_node(&props, 0);
        let UiNode::Text(t) = node else { panic!("expected Text") };
        assert_eq!(t.line_height, 16.0 * 1.5);
    }

    // Wire-key test, per the serde-rename pitfall: TextData is Charter-authored output Vellum
    // deserializes -- assert on the serialized JSON key, not just the Rust struct field.
    #[test]
    fn text_categories_declares_a_plain_line_height_field() {
        let categories = text_categories();
        let fields: Vec<&FieldDef> = categories.iter().flat_map(|c| &c.fields).collect();
        let field = fields.iter().find(|f| f.key == "line-height").expect("line-height field");
        // No inputType -- free text, same as font-size, so a designer can type either CSS form
        // (a bare multiplier or an absolute px value) directly. Deliberately standalone ahead of
        // Phase 5's grouped Typography control (deferred), per explicit user request.
        assert_eq!(field.input_type, None);
        assert_eq!(field.display_text.as_deref(), Some("Leading"));
    }

    #[test]
    fn text_data_serializes_line_height_as_snake_case() {
        let mut props: std::collections::HashMap<String, ResolvedProperty> = Default::default();
        props.insert("content".to_string(), prop("Hi"));
        props.insert("font-size".to_string(), prop("20px"));
        props.insert("line-height".to_string(), prop("30px"));
        let node = build_text_node(&props, 0);
        let json = serde_json::to_string(&node).unwrap();
        assert!(json.contains("\"line_height\":30"), "json was: {json}");
    }
}

#[cfg(test)]
mod text_path_tests {
    use super::*;

    fn prop(value: &str) -> ResolvedProperty {
        ResolvedProperty {
            property: "x".to_string(),
            value: value.to_string(),
            source_layer_id: "layer".to_string(),
            kit_id: "kit".to_string(),
            is_token: false,
            token_alias: None,
            condition_count: 0,
            view_refs: None,
        }
    }

    #[test]
    fn parses_a_valid_point_array() {
        let points = parse_text_path(Some("[[0,0],[10,20],[30,0]]"));
        assert_eq!(points, Some(vec![[0.0, 0.0], [10.0, 20.0], [30.0, 0.0]]));
    }

    #[test]
    fn fewer_than_two_points_is_treated_as_unset() {
        assert_eq!(parse_text_path(Some("[[0,0]]")), None);
        assert_eq!(parse_text_path(Some("[]")), None);
    }

    #[test]
    fn malformed_or_missing_json_is_treated_as_unset_not_a_panic() {
        assert_eq!(parse_text_path(Some("not json")), None);
        assert_eq!(parse_text_path(Some("")), None);
        assert_eq!(parse_text_path(None), None);
    }

    #[test]
    fn build_text_node_emits_an_arclength_path_deform_when_text_path_is_set() {
        let mut props: std::collections::HashMap<String, ResolvedProperty> = Default::default();
        props.insert("content".to_string(), prop("Hi"));
        props.insert("text-path".to_string(), prop("[[0,0],[100,0]]"));
        props.insert("text-path-offset".to_string(), prop("12px"));
        let node = build_text_node(&props, 0);
        let UiNode::Text(t) = node else { panic!("expected Text") };
        assert_eq!(t.deform, Some(Deform::ArclengthPath { points: vec![[0.0, 0.0], [100.0, 0.0]], offset: 12.0 }));
    }

    #[test]
    fn build_text_node_leaves_deform_unset_when_text_path_is_absent() {
        let mut props: std::collections::HashMap<String, ResolvedProperty> = Default::default();
        props.insert("content".to_string(), prop("Hi"));
        let node = build_text_node(&props, 0);
        let UiNode::Text(t) = node else { panic!("expected Text") };
        assert_eq!(t.deform, None);
    }

    #[test]
    fn text_data_serializes_deform_as_snake_case_arclength_path() {
        let mut props: std::collections::HashMap<String, ResolvedProperty> = Default::default();
        props.insert("content".to_string(), prop("Hi"));
        props.insert("text-path".to_string(), prop("[[0,0],[100,0]]"));
        let node = build_text_node(&props, 0);
        let json = serde_json::to_string(&node).unwrap();
        assert!(json.contains("\"deform\":{\"ArclengthPath\""), "json was: {json}");
    }

    #[test]
    fn text_categories_declares_the_path_fields_as_plain_text() {
        let categories = text_categories();
        let fields: Vec<&FieldDef> = categories.iter().flat_map(|c| &c.fields).collect();
        let points = fields.iter().find(|f| f.key == "text-path").expect("text-path field");
        let offset = fields.iter().find(|f| f.key == "text-path-offset").expect("text-path-offset field");
        assert_eq!(points.input_type, None);
        assert_eq!(offset.input_type, None);
    }
}

#[cfg(test)]
mod text_paint_properties_tests {
    use super::*;

    fn prop(value: &str) -> ResolvedProperty {
        ResolvedProperty {
            property: "x".to_string(),
            value: value.to_string(),
            source_layer_id: "layer".to_string(),
            kit_id: "kit".to_string(),
            is_token: false,
            token_alias: None,
            condition_count: 0,
            view_refs: None,
        }
    }

    #[test]
    fn paint_only_properties_never_force_box_detection() {
        let mut props: std::collections::HashMap<String, ResolvedProperty> = Default::default();
        props.insert("font-size".to_string(), prop("14px"));
        props.insert("color".to_string(), prop("#111111"));
        assert_eq!(detect_primitive(&props), "text");

        for key in ["background", "border", "border-radius", "padding"] {
            let mut with_paint = props.clone();
            with_paint.insert(key.to_string(), prop("#eeeeee"));
            assert_eq!(
                detect_primitive(&with_paint),
                "text",
                "{key} is a paint property and must not flip text to box"
            );
        }
    }

    #[test]
    fn structural_properties_still_force_box_detection() {
        let mut props: std::collections::HashMap<String, ResolvedProperty> = Default::default();
        props.insert("font-size".to_string(), prop("14px"));
        props.insert("color".to_string(), prop("#111111"));

        for key in [
            "width",
            "height",
            "display",
            "flex-direction",
            "gap",
            "grid-template-columns",
        ] {
            let mut with_structural = props.clone();
            with_structural.insert(key.to_string(), prop("1px"));
            assert_eq!(
                detect_primitive(&with_structural),
                "box",
                "{key} genuinely implies a container and should still force box"
            );
        }
    }

    #[test]
    fn build_text_node_renders_its_own_background_and_border() {
        let mut props: std::collections::HashMap<String, ResolvedProperty> = Default::default();
        props.insert("content".to_string(), prop("Hi"));
        props.insert("background".to_string(), prop("#ff0000"));
        props.insert("border".to_string(), prop("#00ff00"));
        props.insert("border-radius".to_string(), prop("4px"));
        props.insert("border-radius-squircle".to_string(), prop("1"));
        props.insert("padding".to_string(), prop("8px"));

        let node = build_text_node(&props, 0);
        let UiNode::Text(text_data) = node else {
            panic!("expected a Text node");
        };
        assert_eq!(text_data.bg_color, OklabColor::from_srgb([1.0, 0.0, 0.0, 1.0]));
        assert!(text_data.show_border);
        assert_eq!(text_data.border_color, OklabColor::from_srgb([0.0, 1.0, 0.0, 1.0]));
        assert_eq!(text_data.corner_radius, 4.0);
        assert!(text_data.squircle);
        assert_eq!(text_data.padding, [8.0; 4]);
        // Still always auto-measured -- paint properties never affect sizing.
        assert_eq!(text_data.width, Extent::Auto);
        assert_eq!(text_data.height, Extent::Auto);
    }

    #[test]
    fn build_text_node_with_no_paint_stays_fully_transparent() {
        let mut props: std::collections::HashMap<String, ResolvedProperty> = Default::default();
        props.insert("content".to_string(), prop("Hi"));

        let node = build_text_node(&props, 0);
        let UiNode::Text(text_data) = node else {
            panic!("expected a Text node");
        };
        assert_eq!(text_data.bg_color, OklabColor::default());
        assert!(!text_data.show_border);
    }

    #[test]
    fn build_box_node_reads_squircle_mode_off_the_companion_property() {
        let mut props: std::collections::HashMap<String, ResolvedProperty> = Default::default();
        props.insert("border-radius".to_string(), prop("12px"));
        props.insert("border-radius-squircle".to_string(), prop("1"));

        let node = build_box_node(&props, None, None, None);
        let UiNode::Box(box_data) = node else {
            panic!("expected a Box node");
        };
        assert_eq!(box_data.corner_radius, 12.0);
        assert!(box_data.squircle);
    }

    #[test]
    fn build_box_node_defaults_squircle_to_false_when_unset() {
        let mut props: std::collections::HashMap<String, ResolvedProperty> = Default::default();
        props.insert("border-radius".to_string(), prop("12px"));

        let node = build_box_node(&props, None, None, None);
        let UiNode::Box(box_data) = node else {
            panic!("expected a Box node");
        };
        assert!(!box_data.squircle);
    }

    #[test]
    fn build_box_node_with_no_fill_is_fully_transparent_not_a_gray_placeholder() {
        // No `background` prop -> transparent, matching CSS (a <div> with no background is
        // transparent). Boxes used to fall back to opaque neutral-gray; that's gone.
        let props: std::collections::HashMap<String, ResolvedProperty> = Default::default();
        let node = build_box_node(&props, None, None, None);
        let UiNode::Box(box_data) = node else {
            panic!("expected a Box node");
        };
        assert_eq!(
            box_data.bg_color, OklabColor::default(),
            "unstyled box must be transparent"
        );
    }

    #[test]
    fn build_text_node_reads_font_weight_from_props() {
        let mut props: std::collections::HashMap<String, ResolvedProperty> = Default::default();
        props.insert("content".to_string(), prop("Hi"));
        props.insert("font-weight".to_string(), prop("600"));

        let node = build_text_node(&props, 0);
        let UiNode::Text(text_data) = node else {
            panic!("expected a Text node");
        };
        assert_eq!(text_data.font_weight, 600);
    }

    #[test]
    fn build_text_node_defaults_font_weight_to_400_when_unset() {
        let mut props: std::collections::HashMap<String, ResolvedProperty> = Default::default();
        props.insert("content".to_string(), prop("Hi"));

        let node = build_text_node(&props, 0);
        let UiNode::Text(text_data) = node else {
            panic!("expected a Text node");
        };
        assert_eq!(text_data.font_weight, 400);
    }

    #[test]
    fn encode_viewport_data_binary_roundtrips_through_base64_and_rmp_serde() {
        use super::{encode_viewport_data_binary, BoxData, UiNode};

        let data = vec![UiNode::Box(BoxData {
            parent_id: None,
            width: Extent::Auto,
            height: Extent::Auto,
            max_width: Extent::Auto,
            max_height: Extent::Auto,
            min_width: Extent::Auto,
            min_height: Extent::Auto,
            padding: [16.0; 4],
            bg_color: OklabColor::from_srgb([0.9, 0.9, 0.9, 1.0]),
            flex_direction: FlexDir::Column,
            show_border: true,
            border_color: OklabColor::from_srgb([0.8, 0.8, 0.8, 1.0]),
            border_width: 1.0,
            corner_radius: 8.0,
            squircle: false,
            opacity: 1.0,
            shadow: None,
            extra: Default::default(),
            selected: 0,
            hovered: false,
        })];

        let b64 = encode_viewport_data_binary(&data).expect("encoding should succeed");
        assert!(!b64.is_empty(), "base64 string should not be empty");

        // Simulate the JS side: atob decode
        let decoded_bytes =
            base64::Engine::decode(&base64::engine::general_purpose::STANDARD, b64.as_bytes())
                .expect("base64 decode should succeed");

        // The decoded bytes should be valid rmp-serde data that Vellum's UiNode can deserialize.
        // We can't import Vellum's UiNode here, so we just verify it deserializes as Charter's UiNode.
        let back: Vec<UiNode> = rmp_serde::from_slice(&decoded_bytes)
            .expect("rmp_serde should deserialize the decoded bytes");
        assert_eq!(back.len(), 1);
    }

    #[test]
    fn on_resolve_result_includes_viewport_data_binary() {
        use super::OnResolveResult;

        let result = OnResolveResult {
            categories: vec![],
            viewport_data: vec![],
            node_view_ids: vec![],
            node_kit_ids: vec![],
            node_occurrence_ids: vec![],
            font_requests: vec![],
            viewport_data_binary: Some("AAAA".to_string()),
        };
        let json = serde_json::to_string(&result).unwrap();
        assert!(
            json.contains("\"viewport_data_binary\""),
            "OnResolveResult JSON should include viewport_data_binary when Some, got: {json}"
        );

        // Also verify it's ABSENT when None.
        let result2 = OnResolveResult {
            viewport_data_binary: None,
            ..result
        };
        let json2 = serde_json::to_string(&result2).unwrap();
        assert!(
            !json2.contains("viewport_data_binary"),
            "OnResolveResult JSON should omit viewport_data_binary when None, got: {json2}"
        );
    }
}

#[cfg(test)]
mod parse_color_tests {
    use super::*;

    const EPS: f32 = 1e-3;

    fn approx(a: f32, b: f32) -> bool {
        (a - b).abs() < EPS
    }

    fn approx_color(a: OklabColor, b: OklabColor) -> bool {
        approx(a.l, b.l) && approx(a.a, b.a) && approx(a.b, b.b) && approx(a.alpha, b.alpha)
    }

    #[test]
    fn oklch_parses_first_class_no_legacy_detour() {
        // oklch(L C H) with L as a bare fraction.
        let got = parse_color("oklch(0.7 0.15 30)");
        let (l, a, b) = oklch_to_oklab(0.7, 0.15, 30.0);
        let want = OklabColor::new(l, a, b, 1.0);
        assert!(approx_color(got, want), "got {got:?} want {want:?}");
    }

    #[test]
    fn oklch_accepts_percent_lightness_and_slash_alpha() {
        let got = parse_color("oklch(70% 0.15 30 / 0.5)");
        let (l, a, b) = oklch_to_oklab(0.7, 0.15, 30.0);
        let want = OklabColor::new(l, a, b, 0.5);
        assert!(approx_color(got, want), "got {got:?} want {want:?}");
    }

    #[test]
    fn oklab_parses_direct_cartesian_no_conversion() {
        let got = parse_color("oklab(0.6 0.1 -0.05)");
        let want = OklabColor::new(0.6, 0.1, -0.05, 1.0);
        assert!(approx_color(got, want), "got {got:?} want {want:?}");
    }

    #[test]
    fn hex_still_converts_through_srgb_to_oklab() {
        let got = parse_color("#ff0000");
        let want = OklabColor::from_srgb([1.0, 0.0, 0.0, 1.0]);
        assert!(approx_color(got, want), "got {got:?} want {want:?}");
    }

    #[test]
    fn rgb_and_rgba_are_legacy_srgb_input() {
        let got_rgb = parse_color("rgb(255, 0, 0)");
        let got_rgba = parse_color("rgba(255, 0, 0, 0.5)");
        let want_opaque = OklabColor::from_srgb([1.0, 0.0, 0.0, 1.0]);
        let want_half = OklabColor::from_srgb([1.0, 0.0, 0.0, 0.5]);
        assert!(approx_color(got_rgb, want_opaque));
        assert!(approx_color(got_rgba, want_half));
    }

    #[test]
    fn hsl_and_hsla_are_now_supported_not_black() {
        // Closes the documented CLAUDE.md pitfall: hsl() used to fall through to black.
        let red_hsl = parse_color("hsl(0, 100%, 50%)");
        let red_hex = parse_color("#ff0000");
        assert!(
            approx_color(red_hsl, red_hex),
            "hsl(0,100%,50%) should equal #ff0000, got {red_hsl:?} vs {red_hex:?}"
        );

        let translucent = parse_color("hsla(0, 100%, 50%, 0.25)");
        assert!(approx(translucent.alpha, 0.25));
    }

    #[test]
    fn transparent_keyword_is_zero_alpha_not_black() {
        // Closes the other documented CLAUDE.md pitfall: `transparent` used to fall through to
        // opaque black.
        let got = parse_color("transparent");
        assert_eq!(got, OklabColor::new(0.0, 0.0, 0.0, 0.0));
    }

    #[test]
    fn genuinely_unparseable_value_warns_and_returns_marker_not_black() {
        let got = parse_color("not-a-real-color");
        assert_ne!(
            got,
            OklabColor::default(),
            "unparseable input must not silently become black/transparent"
        );
        assert_eq!(got, unparseable_marker());
    }
}

#[cfg(test)]
mod color_input_type_tests {
    use super::*;

    // Every paint FieldDef (background/border/color) reports inputType: "color" -- the editor's
    // ColorField.svelte dispatches on exactly this string (src/lib/editor/panels/Styles.svelte).
    fn assert_color_input_type(fields: &[FieldDef], key: &str) {
        let f = fields.iter().find(|f| f.key == key).unwrap_or_else(|| panic!("{key} field"));
        assert_eq!(f.input_type.as_deref(), Some("color"), "{key} should be inputType: color");
    }

    #[test]
    fn box_categories_declares_background_and_border_as_color_fields() {
        let categories = box_categories();
        let fields: Vec<&FieldDef> = categories.iter().flat_map(|c| &c.fields).collect();
        let fields: Vec<FieldDef> = fields.into_iter().cloned().collect();
        assert_color_input_type(&fields, "background");
        assert_color_input_type(&fields, "border");
    }

    #[test]
    fn text_categories_declares_color_and_highlight_paint_fields_as_color_fields() {
        let categories = text_categories();
        let fields: Vec<FieldDef> = categories.iter().flat_map(|c| c.fields.clone()).collect();
        assert_color_input_type(&fields, "color");
        assert_color_input_type(&fields, "background");
        assert_color_input_type(&fields, "border");
    }

    #[test]
    fn image_categories_declares_background_and_border_as_color_fields() {
        let categories = image_categories();
        let fields: Vec<FieldDef> = categories.iter().flat_map(|c| c.fields.clone()).collect();
        assert_color_input_type(&fields, "background");
        assert_color_input_type(&fields, "border");
    }
}

#[cfg(test)]
mod shape_kind_tests {
    use super::*;
    use std::collections::HashMap;

    fn prop(name: &str, value: &str) -> ResolvedProperty {
        ResolvedProperty {
            property: name.to_string(),
            value: value.to_string(),
            source_layer_id: "layer".to_string(),
            kit_id: "kit".to_string(),
            is_token: false,
            token_alias: None,
            condition_count: 0,
            view_refs: None,
        }
    }

    #[test]
    fn parses_path_segments_from_json_and_defaults_fill_rule_and_closed() {
        let mut props: HashMap<String, ResolvedProperty> = HashMap::new();
        props.insert("kind".into(), prop("kind", "path"));
        props.insert(
            "segments".into(),
            prop(
                "segments",
                r#"[{"Line":{"p0":[0.0,0.0],"p1":[10.0,0.0]}}]"#,
            ),
        );
        let ShapeKind::Path { segments, fill_rule, closed } = parse_shape_kind(&props) else {
            panic!("expected ShapeKind::Path");
        };
        assert_eq!(segments.len(), 1);
        assert!(matches!(segments[0], PathSegment::Line { .. }));
        // Neither `fill-rule` nor `closed` was set -- defaults are Nonzero / true.
        assert!(matches!(fill_rule, FillRule::Nonzero));
        assert!(closed);
    }

    #[test]
    fn reads_fill_rule_and_explicit_closed_false() {
        let mut props: HashMap<String, ResolvedProperty> = HashMap::new();
        props.insert("kind".into(), prop("kind", "path"));
        props.insert("fill-rule".into(), prop("fill-rule", "odd"));
        props.insert("closed".into(), prop("closed", "false"));
        let ShapeKind::Path { fill_rule, closed, .. } = parse_shape_kind(&props) else {
            panic!("expected ShapeKind::Path");
        };
        assert!(matches!(fill_rule, FillRule::Odd));
        assert!(!closed);
    }

    #[test]
    fn missing_or_malformed_segments_json_degrades_to_an_empty_list_not_a_panic() {
        let mut props: HashMap<String, ResolvedProperty> = HashMap::new();
        props.insert("kind".into(), prop("kind", "path"));
        props.insert("segments".into(), prop("segments", "not json"));
        let ShapeKind::Path { segments, .. } = parse_shape_kind(&props) else {
            panic!("expected ShapeKind::Path");
        };
        assert!(segments.is_empty());
    }

    #[test]
    fn unrecognized_kind_still_falls_back_to_rect() {
        let mut props: HashMap<String, ResolvedProperty> = HashMap::new();
        props.insert("kind".into(), prop("kind", "not-a-real-kind"));
        assert!(matches!(parse_shape_kind(&props), ShapeKind::Rect));
    }

    #[test]
    fn build_shape_node_reads_grid_column_and_row_from_props() {
        let mut props: HashMap<String, ResolvedProperty> = HashMap::new();
        props.insert("kind".into(), prop("kind", "rect"));
        props.insert("grid-column".into(), prop("grid-column", "2"));
        props.insert("grid-row".into(), prop("grid-row", "span 2"));
        let UiNode::Shape(data) = build_shape_node(&props, None, None, None) else {
            panic!("expected UiNode::Shape");
        };
        assert!(matches!(data.extra.grid_column.0, GridLine::Line(2)));
        assert!(matches!(data.extra.grid_row.0, GridLine::Span(2)));
    }

    #[test]
    fn shape_categories_declares_align_self_and_grid_placement_fields() {
        let categories = shape_categories();
        let fields: Vec<&FieldDef> = categories.iter().flat_map(|c| &c.fields).collect();
        assert!(fields.iter().any(|f| f.key == "align-self"));
        assert!(fields.iter().any(|f| f.key == "grid-column"));
        assert!(fields.iter().any(|f| f.key == "grid-row"));
    }
}

#[cfg(test)]
mod sprite_batch_tests {
    use super::*;
    use std::collections::HashMap;

    fn prop(name: &str, value: &str) -> ResolvedProperty {
        ResolvedProperty {
            property: name.to_string(),
            value: value.to_string(),
            source_layer_id: "layer".to_string(),
            kit_id: "kit".to_string(),
            is_token: false,
            token_alias: None,
            condition_count: 0,
            view_refs: None,
        }
    }

    fn sample_sprite_json() -> &'static str {
        r#"[{"position":[10.0,20.0],"size":[32.0,32.0],"rotation":0.0,"sprite_id":"brush-tip","color":{"l":1.0,"a":0.0,"b":0.0,"alpha":1.0},"opacity":1.0,"tint":true}]"#
    }

    #[test]
    fn parses_sprites_from_json_and_defaults_opacity() {
        let mut props: HashMap<String, ResolvedProperty> = HashMap::new();
        props.insert("sprites".into(), prop("sprites", sample_sprite_json()));
        let node = build_sprite_batch_node(&props, None, None, None);
        let UiNode::SpriteBatch(data) = &node else {
            panic!("expected UiNode::SpriteBatch");
        };
        assert_eq!(data.sprites.len(), 1);
        assert_eq!(data.sprites[0].sprite_id, "brush-tip");
        assert!(data.sprites[0].tint);
        // No `opacity` property set -- defaults to 1.0, same convention build_shape_node follows.
        assert_eq!(data.opacity, 1.0);
    }

    #[test]
    fn missing_or_malformed_sprites_json_degrades_to_an_empty_list_not_a_panic() {
        let mut props: HashMap<String, ResolvedProperty> = HashMap::new();
        props.insert("sprites".into(), prop("sprites", "not json"));
        let node = build_sprite_batch_node(&props, None, None, None);
        let UiNode::SpriteBatch(data) = &node else {
            panic!("expected UiNode::SpriteBatch");
        };
        assert!(data.sprites.is_empty());
    }

    #[test]
    fn no_sprites_property_at_all_is_an_empty_batch_not_a_panic() {
        let props: HashMap<String, ResolvedProperty> = HashMap::new();
        let node = build_sprite_batch_node(&props, None, None, None);
        let UiNode::SpriteBatch(data) = &node else {
            panic!("expected UiNode::SpriteBatch");
        };
        assert!(data.sprites.is_empty());
    }

    // Regression guard for the camelCase-mismatch pitfall (CLAUDE.md): SpriteInstance/
    // SpriteBatchData cross into the wire the same way ShapeData/PathSegment already do (no
    // #[serde(rename_all = "camelCase")] anywhere in kit10-scene's wire types) -- asserting on
    // the ACTUAL SERIALIZED JSON key names, not just Rust field names, is what would catch it if
    // that ever silently changed.
    #[test]
    fn sprite_batch_node_serializes_with_snake_case_wire_keys_not_camel_case() {
        let mut props: HashMap<String, ResolvedProperty> = HashMap::new();
        props.insert("sprites".into(), prop("sprites", sample_sprite_json()));
        let node = build_sprite_batch_node(&props, None, None, None);
        let json = serde_json::to_string(&node).unwrap();

        for key in ["parent_id", "min_width", "min_height", "max_width", "max_height", "sprites"] {
            assert!(json.contains(&format!("\"{key}\"")), "missing snake_case key '{key}' in {json}");
        }
        for key in ["sprite_id", "rotation", "position", "size", "color", "opacity", "tint"] {
            assert!(json.contains(&format!("\"{key}\"")), "missing snake_case key '{key}' in {json}");
        }
        for camel in ["spriteId", "minWidth", "maxWidth", "parentId"] {
            assert!(!json.contains(camel), "unexpected camelCase key '{camel}' in {json}");
        }
    }

    #[test]
    fn build_sprite_batch_node_reads_grid_column_and_row_from_props() {
        let mut props: HashMap<String, ResolvedProperty> = HashMap::new();
        props.insert("grid-column".into(), prop("grid-column", "2"));
        props.insert("grid-row".into(), prop("grid-row", "span 2"));
        let UiNode::SpriteBatch(data) = build_sprite_batch_node(&props, None, None, None) else {
            panic!("expected UiNode::SpriteBatch");
        };
        assert!(matches!(data.extra.grid_column.0, GridLine::Line(2)));
        assert!(matches!(data.extra.grid_row.0, GridLine::Span(2)));
    }

    #[test]
    fn sprite_batch_categories_declares_align_self_and_grid_placement_fields() {
        let categories = sprite_batch_categories();
        let fields: Vec<&FieldDef> = categories.iter().flat_map(|c| &c.fields).collect();
        assert!(fields.iter().any(|f| f.key == "align-self"));
        assert!(fields.iter().any(|f| f.key == "grid-column"));
        assert!(fields.iter().any(|f| f.key == "grid-row"));
    }
}

#[cfg(test)]
mod extent_parse_tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn parse_extent_handles_percent_px_bare_and_auto() {
        assert_eq!(parse_extent(Some("50%")), Extent::Percent(0.5));
        assert_eq!(parse_extent(Some("100px")), Extent::Px(100.0));
        assert_eq!(parse_extent(Some("40")), Extent::Px(40.0));
        assert_eq!(parse_extent(Some("auto")), Extent::Auto);
        assert_eq!(parse_extent(Some("")), Extent::Auto);
        assert_eq!(parse_extent(None), Extent::Auto);
        // 1fr is NOT a self-declared size -> falls through to Auto, never Px/Percent.
        assert_eq!(parse_extent(Some("1fr")), Extent::Auto);
    }

    fn prop(name: &str, value: &str) -> ResolvedProperty {
        ResolvedProperty {
            property: name.to_string(),
            value: value.to_string(),
            source_layer_id: "layer".to_string(),
            kit_id: "kit".to_string(),
            is_token: false,
            token_alias: None,
            condition_count: 0,
            view_refs: None,
        }
    }

    #[test]
    fn build_img_node_emits_fit_string_not_cover_bool() {
        let mut props: HashMap<String, ResolvedProperty> = HashMap::new();
        props.insert("src".into(), prop("src", "logo"));
        props.insert("fit".into(), prop("fit", "contain"));
        let UiNode::Img(img) = build_img_node(&props, None) else {
            panic!("expected Img")
        };
        // The wire field must be the `fit` string vellum reads -- not a `cover` bool that vellum
        // would silently drop, leaving every image at the "cover" default.
        assert_eq!(img.fit, "contain");

        // Unknown/absent fit falls back to cover (vellum's own default).
        let mut p2: HashMap<String, ResolvedProperty> = HashMap::new();
        p2.insert("src".into(), prop("src", "logo"));
        p2.insert("fit".into(), prop("fit", "bogus"));
        let UiNode::Img(img2) = build_img_node(&p2, None) else {
            panic!("expected Img")
        };
        assert_eq!(img2.fit, "cover");
    }

    #[test]
    fn build_box_node_emits_percent_width_and_min_floor() {
        let mut props: HashMap<String, ResolvedProperty> = HashMap::new();
        props.insert("width".into(), prop("width", "50%"));
        props.insert("min-width".into(), prop("min-width", "80px"));
        let node = build_box_node(&props, None, None, None);
        let UiNode::Box(b) = node else {
            panic!("expected Box")
        };
        assert_eq!(b.width, Extent::Percent(0.5));
        assert_eq!(b.min_width, Extent::Px(80.0));
        // Charter never emits margin -- its opinion.
        assert_eq!(b.extra.margin, 0.0);
    }
}

#[cfg(test)]
mod resize_tests {
    use super::*;
    use std::collections::HashMap;

    fn prop(name: &str, value: &str) -> ResolvedProperty {
        ResolvedProperty {
            property: name.to_string(),
            value: value.to_string(),
            source_layer_id: "l".to_string(),
            kit_id: "k".to_string(),
            is_token: false,
            token_alias: None,
            condition_count: 0,
            view_refs: None,
        }
    }

    fn box_with(props: &[(&str, &str)], parent_main_horizontal: Option<bool>) -> BoxData {
        box_with_parent_align(props, parent_main_horizontal, None)
    }

    fn box_with_parent_align(
        props: &[(&str, &str)],
        parent_main_horizontal: Option<bool>,
        parent_align_items: Option<AlignValue>,
    ) -> BoxData {
        let mut map: HashMap<String, ResolvedProperty> = HashMap::new();
        for (k, v) in props {
            map.insert((*k).to_string(), prop(k, v));
        }
        match build_box_node(&map, None, parent_main_horizontal, parent_align_items) {
            UiNode::Box(b) => b,
            _ => panic!("expected Box"),
        }
    }

    #[test]
    fn fill_on_main_axis_row_becomes_grow_shrink_basis_zero_min_zero() {
        let d = box_with(&[("width", "fill")], Some(true));
        assert_eq!(d.width, Extent::Auto);
        assert_eq!(d.min_width, Extent::Px(0.0));
        assert_eq!(d.extra.flex_grow, 1.0);
        assert_eq!(d.extra.flex_shrink, Some(1.0));
        assert_eq!(d.extra.flex_basis, Some(Extent::Px(0.0)));
        assert!(
            d.extra.align_self.is_none(),
            "width is the main axis in a row -> no align-self"
        );
    }

    #[test]
    fn fill_on_cross_axis_column_stretches_not_grows() {
        let d = box_with(&[("width", "fill")], Some(false));
        assert_eq!(d.width, Extent::Auto);
        assert_eq!(d.extra.flex_grow, 0.0);
        assert_eq!(d.extra.align_self, Some(AlignValue::Stretch));
    }

    #[test]
    fn hug_on_main_axis_pins_grow_and_shrink_to_zero() {
        let d = box_with(&[("width", "hug")], Some(true));
        assert_eq!(d.width, Extent::Auto);
        assert_eq!(d.extra.flex_grow, 0.0);
        assert_eq!(d.extra.flex_shrink, Some(0.0));
    }

    #[test]
    fn unset_cross_axis_leaves_align_self_unset() {
        // Must NOT default to a fixed align-self here -- align-self on the item always wins over
        // the container's own align-items, so a default here would silently defeat Split/Center's
        // align-items:Center and Cluster's align-items:FlexStart for every untouched child. The
        // "unset width reads as Hug" default belongs on the Stack container instead (see
        // compile_arrange's stack_column_defaults_align_items_to_flex_start_when_unset).
        let d = box_with(&[], Some(false));
        assert!(d.extra.align_self.is_none());
    }

    #[test]
    fn fill_with_no_flex_parent_degrades_to_plain_auto() {
        let d = box_with(&[("width", "fill")], None);
        assert_eq!(d.width, Extent::Auto);
        assert_eq!(d.extra.flex_grow, 0.0);
        assert!(d.extra.flex_basis.is_none());
        assert!(d.extra.align_self.is_none());
    }

    #[test]
    fn plain_length_width_keeps_raw_flex_and_is_untouched_by_resize() {
        let d = box_with(&[("width", "200px"), ("flex-grow", "3")], Some(true));
        assert_eq!(d.width, Extent::Px(200.0));
        assert_eq!(d.extra.flex_grow, 3.0);
        assert!(d.extra.flex_basis.is_none());
    }

    #[test]
    fn fill_both_axes_row_grows_main_and_stretches_cross() {
        let d = box_with(&[("width", "fill"), ("height", "fill")], Some(true));
        assert_eq!(d.extra.flex_grow, 1.0);
        assert_eq!(d.extra.align_self, Some(AlignValue::Stretch));
        assert_eq!(d.min_width, Extent::Px(0.0));
    }

    #[test]
    fn hug_on_cross_axis_forces_flex_start_when_parent_defaults_to_stretch() {
        // The original bug: an untouched Column Stack has no other opinion (None == taffy's own
        // stretch default), so an explicit Hug must override that back to content-sized.
        let d = box_with_parent_align(&[("width", "hug")], Some(false), None);
        assert_eq!(d.extra.align_self, Some(AlignValue::FlexStart));
    }

    #[test]
    fn hug_on_cross_axis_does_not_override_a_deliberate_center_parent() {
        // The regression this fixes: a Hug'd child inside a Center/Split container (a DELIBERATE
        // non-stretch align-items) must leave align-self unset so it inherits the parent's real
        // alignment intent -- forcing flex-start here made it sit flush at the start edge instead
        // of centering, even though its width was already correctly hugging.
        let d = box_with_parent_align(&[("width", "hug")], Some(false), Some(AlignValue::Center));
        assert!(
            d.extra.align_self.is_none(),
            "hug must not clobber a deliberate Center parent's alignment"
        );
    }

    #[test]
    fn hug_on_cross_axis_still_overrides_an_explicit_raw_stretch_parent() {
        // Hug's whole point is a per-item override of the container's default -- an explicit
        // `align-items: stretch` on the parent is exactly the case Hug must still win against,
        // same as the implicit (None) stretch default.
        let d = box_with_parent_align(&[("width", "hug")], Some(false), Some(AlignValue::Stretch));
        assert_eq!(d.extra.align_self, Some(AlignValue::FlexStart));
    }

    #[test]
    fn explicit_raw_align_self_is_never_overridden_by_the_hug_default() {
        let d = box_with(&[("width", "hug"), ("align-self", "center")], Some(false));
        assert_eq!(
            d.extra.align_self,
            Some(AlignValue::Center),
            "an explicit align-self (e.g. via the Advanced escape hatch) always wins"
        );
    }
}

#[cfg(test)]
mod font_facts_tests {
    use super::*;

    fn prop(value: &str) -> ResolvedProperty {
        ResolvedProperty {
            property: "x".to_string(),
            value: value.to_string(),
            source_layer_id: "layer".to_string(),
            kit_id: "kit".to_string(),
            is_token: false,
            token_alias: None,
            condition_count: 0,
            view_refs: None,
        }
    }

    fn facts(ranges: &[(u16, u16)]) -> FamilyFacts {
        FamilyFacts {
            variants: ranges
                .iter()
                .map(|&(lo, hi)| FontFactVariant {
                    weight_min: lo,
                    weight_max: hi,
                    style: "normal".to_string(),
                })
                .collect(),
        }
    }

    #[test]
    fn weight_inside_a_variable_range_passes_through_exactly() {
        // Inter-shaped: one 400-700 variable range.
        assert_eq!(resolve_font_weight(550, &facts(&[(400, 700)])), 550);
        assert_eq!(resolve_font_weight(400, &facts(&[(400, 700)])), 400);
    }

    #[test]
    fn heavy_request_snaps_up_first_then_down() {
        // Lato-shaped: static 400 + 700. CSS: >500 prefers heavier.
        let lato = facts(&[(400, 400), (700, 700)]);
        assert_eq!(resolve_font_weight(600, &lato), 700);
        assert_eq!(resolve_font_weight(900, &lato), 700, "nothing above -> nearest below");
    }

    #[test]
    fn light_request_snaps_down_first_then_up() {
        let lato = facts(&[(400, 400), (700, 700)]);
        assert_eq!(resolve_font_weight(300, &lato), 400, "nothing below -> nearest above");
        let three_weights = facts(&[(200, 200), (400, 400), (700, 700)]);
        assert_eq!(resolve_font_weight(300, &three_weights), 200, "<400 prefers lighter");
    }

    #[test]
    fn the_400_500_zone_looks_up_toward_500_first() {
        let f = facts(&[(300, 300), (500, 500), (700, 700)]);
        assert_eq!(resolve_font_weight(450, &f), 500);
        assert_eq!(resolve_font_weight(400, &f), 500, "400 checks 500 before below");
        let no_500 = facts(&[(300, 300), (700, 700)]);
        assert_eq!(resolve_font_weight(450, &no_500), 300, "nothing in 450..=500 -> below next");
    }

    #[test]
    fn no_facts_for_family_passes_weight_through() {
        assert_eq!(resolve_font_weight(600, &facts(&[])), 600);
    }

    #[test]
    fn snap_text_weights_matches_family_case_insensitively_and_leaves_unknown_families_alone() {
        let mut props = std::collections::HashMap::new();
        props.insert("content".to_string(), prop("hi"));
        props.insert("font-family".to_string(), prop("Lato"));
        props.insert("font-weight".to_string(), prop("600"));
        let mut nodes = vec![build_text_node(&props, 0)];

        let mut facts_map = std::collections::HashMap::new();
        facts_map.insert("lato".to_string(), facts(&[(400, 400), (700, 700)]));
        snap_text_weights(&mut nodes, &facts_map);
        let UiNode::Text(t) = &nodes[0] else { panic!("expected Text") };
        assert_eq!(t.font_weight, 700, "600 on Lato snaps to 700, key case-insensitive");

        // A family with no facts entry is untouched.
        props.insert("font-family".to_string(), prop("Mystery Serif"));
        let mut nodes2 = vec![build_text_node(&props, 0)];
        snap_text_weights(&mut nodes2, &facts_map);
        let UiNode::Text(t2) = &nodes2[0] else { panic!("expected Text") };
        assert_eq!(t2.font_weight, 600);
    }

    #[test]
    fn collect_font_requests_dedupes_and_defaults_style() {
        let mut props = std::collections::HashMap::new();
        props.insert("content".to_string(), prop("hi"));
        props.insert("font-family".to_string(), prop("Inter"));
        props.insert("font-weight".to_string(), prop("700"));
        let a = build_text_node(&props, 0);
        let b = build_text_node(&props, 0);
        let requests = collect_font_requests(&[a, b]);
        assert_eq!(requests.len(), 1, "identical variants dedupe");
        assert_eq!(requests[0].family, "Inter");
        assert_eq!(requests[0].weight, 700);
        assert_eq!(requests[0].style, "normal");
    }

    // Wire-key tests, per the serde-rename pitfall: the INPUT is JS-authored (camelCase key
    // `fontFacts`), the OUTPUT is Charter-authored (snake_case key `font_requests`) - a test
    // asserting only on struct fields would pass even if either rename regressed.
    #[test]
    fn on_resolve_input_deserializes_camel_case_font_facts() {
        let json = r#"{
            "activeViewId": null,
            "resolvedKits": [],
            "viewHints": {},
            "fontFacts": { "Lato": { "variants": [{ "weightMin": 400, "weightMax": 400, "style": "normal" }] } }
        }"#;
        let parsed: OnResolveInput = serde_json::from_str(json).expect("deserialize");
        let lato = parsed.font_facts.get("Lato").expect("Lato facts present");
        assert_eq!(lato.variants[0].weight_min, 400);
    }

    #[test]
    fn on_resolve_result_serializes_snake_case_font_requests() {
        let result = OnResolveResult {
            categories: vec![],
            viewport_data: vec![],
            node_view_ids: vec![],
            node_kit_ids: vec![],
            node_occurrence_ids: vec![],
            font_requests: vec![FontRequest {
                family: "Lato".to_string(),
                weight: 700,
                style: "normal".to_string(),
            }],
            viewport_data_binary: None,
        };
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"font_requests\""), "snake_case output key, got: {json}");
        assert!(!json.contains("fontRequests"), "must NOT be camelCase: {json}");
        assert!(json.contains("\"weight\":700"));
    }
}

#[cfg(test)]
mod arrange_tests {
    use super::*;
    use std::collections::HashMap;

    fn prop(name: &str, value: &str) -> ResolvedProperty {
        ResolvedProperty {
            property: name.to_string(),
            value: value.to_string(),
            source_layer_id: "l".to_string(),
            kit_id: "k".to_string(),
            is_token: false,
            token_alias: None,
            condition_count: 0,
            view_refs: None,
        }
    }

    fn box_with(props: &[(&str, &str)]) -> BoxData {
        let mut map: HashMap<String, ResolvedProperty> = HashMap::new();
        for (k, v) in props {
            map.insert((*k).to_string(), prop(k, v));
        }
        match build_box_node(&map, None, None, None) {
            UiNode::Box(b) => b,
            _ => panic!("expected Box"),
        }
    }

    // --- box_categories() shape ---

    #[test]
    fn box_categories_declares_an_arrange_field_with_populated_arrange_keys() {
        let categories = box_categories();
        let field = categories
            .iter()
            .flat_map(|c| &c.fields)
            .find(|f| f.key == "arrange")
            .expect("box_categories() should declare an \"arrange\" field");
        assert_eq!(field.input_type.as_deref(), Some("arrange"));
        let keys = field
            .arrange_keys
            .as_ref()
            .expect("arrange field should carry arrangeKeys");
        assert_eq!(keys.direction_key, "flex-direction");
        assert_eq!(keys.gap.key, "gap");
        assert_eq!(keys.cell_min.key, "grid-cell-min");
        assert!(!keys.advanced.is_empty());
        assert!(!keys.grid_advanced.is_empty());
    }

    #[test]
    fn box_categories_top_level_no_longer_lists_arrangement_knobs() {
        // These now live only inside arrange_keys (advanced/grid_advanced/gap/cell_min), not as
        // standalone top-level FieldDefs -- see the layout-affordances.md Phase 1 payoff.
        let categories = box_categories();
        let top_level_keys: Vec<&str> = categories
            .iter()
            .flat_map(|c| &c.fields)
            .map(|f| f.key.as_str())
            .collect();
        for retired in [
            "flex-direction",
            "gap",
            "align-items",
            "justify-content",
            "flex-wrap",
            "display",
            "grid-template-columns",
            "grid-template-rows",
            "grid-auto-columns",
            "grid-auto-rows",
            "grid-column",
            "grid-row",
            "grid-cell-min",
        ] {
            assert!(
                !top_level_keys.contains(&retired),
                "\"{retired}\" should not be a top-level layout FieldDef anymore"
            );
        }
    }

    // --- box_categories() min/max limit fold (layout-affordances Phase 4) ---

    #[test]
    fn box_categories_top_level_no_longer_lists_min_max_fields() {
        let categories = box_categories();
        let top_level_keys: Vec<&str> = categories
            .iter()
            .flat_map(|c| &c.fields)
            .map(|f| f.key.as_str())
            .collect();
        for retired in ["min-width", "min-height", "max-width", "max-height"] {
            assert!(
                !top_level_keys.contains(&retired),
                "\"{retired}\" should ride its dimension's resize control (ResizeKeys), not be a top-level FieldDef"
            );
        }
    }

    #[test]
    fn resize_fields_carry_their_own_limit_keys() {
        let categories = box_categories();
        let fields: Vec<&FieldDef> = categories.iter().flat_map(|c| &c.fields).collect();

        let width = fields.iter().find(|f| f.key == "width").expect("width field");
        let rk = width.resize_keys.as_ref().expect("width should carry resizeKeys");
        assert_eq!(rk.min.key, "min-width");
        assert_eq!(rk.max.key, "max-width");

        let height = fields.iter().find(|f| f.key == "height").expect("height field");
        let rk = height.resize_keys.as_ref().expect("height should carry resizeKeys");
        assert_eq!(rk.min.key, "min-height");
        assert_eq!(rk.max.key, "max-height");
    }

    #[test]
    fn radius_field_carries_its_own_squircle_key() {
        let categories = box_categories();
        let fields: Vec<&FieldDef> = categories.iter().flat_map(|c| &c.fields).collect();
        let radius = fields
            .iter()
            .find(|f| f.key == "border-radius")
            .expect("border-radius field");
        assert_eq!(radius.input_type.as_deref(), Some("radius"));
        let rk = radius.radius_keys.as_ref().expect("border-radius should carry radiusKeys");
        assert_eq!(rk.squircle.key, "border-radius-squircle");
    }

    // --- parse_padding_shorthand ---

    #[test]
    fn padding_shorthand_one_value_applies_to_all_sides() {
        assert_eq!(
            parse_padding_shorthand(Some("12")),
            [12.0, 12.0, 12.0, 12.0]
        );
    }

    #[test]
    fn padding_shorthand_two_values_are_vert_then_horiz() {
        assert_eq!(
            parse_padding_shorthand(Some("8 16")),
            [8.0, 16.0, 8.0, 16.0]
        );
    }

    #[test]
    fn padding_shorthand_three_values_are_top_horiz_bottom() {
        assert_eq!(
            parse_padding_shorthand(Some("4 8 12")),
            [4.0, 8.0, 12.0, 8.0]
        );
    }

    #[test]
    fn padding_shorthand_four_values_are_top_right_bottom_left() {
        assert_eq!(
            parse_padding_shorthand(Some("1 2 3 4")),
            [1.0, 2.0, 3.0, 4.0]
        );
    }

    #[test]
    fn padding_shorthand_absent_is_zero() {
        assert_eq!(parse_padding_shorthand(None), [0.0; 4]);
    }

    // --- TrackSize::AutoFit wire shape ---

    #[test]
    fn track_size_autofit_serializes_as_expected() {
        let json = serde_json::to_string(&TrackSize::AutoFit(160.0)).unwrap();
        assert_eq!(json, r#"{"AutoFit":160.0}"#);
    }

    // --- direction defaulting (resolve_flex_direction) ---

    #[test]
    fn cluster_and_split_default_direction_to_row_when_unset() {
        assert_eq!(resolve_flex_direction(None, ArrangeKind::Cluster), "Row");
        assert_eq!(resolve_flex_direction(None, ArrangeKind::Split), "Row");
    }

    #[test]
    fn stack_and_center_default_direction_to_column_when_unset() {
        assert_eq!(resolve_flex_direction(None, ArrangeKind::Stack), "Column");
        assert_eq!(resolve_flex_direction(None, ArrangeKind::Center), "Column");
    }

    #[test]
    fn explicit_direction_always_wins_regardless_of_kind() {
        assert_eq!(
            resolve_flex_direction(Some("column"), ArrangeKind::Cluster),
            "Column"
        );
        assert_eq!(
            resolve_flex_direction(Some("row-reverse"), ArrangeKind::Stack),
            "RowReverse"
        );
    }

    // --- compile_arrange / build_box_node integration, per ArrangeKind ---

    #[test]
    fn fresh_box_defaults_to_stack_column_zero_touches() {
        let d = box_with(&[]);
        assert_eq!(d.flex_direction, FlexDir::Column);
        assert_eq!(d.extra.align_items, Some(AlignValue::FlexStart));
        assert_eq!(d.extra.justify_content, None);
    }

    #[test]
    fn stack_row_defaults_align_items_center_when_unset() {
        let d = box_with(&[("arrange", "stack"), ("flex-direction", "row")]);
        assert_eq!(d.flex_direction, FlexDir::Row);
        assert_eq!(d.extra.align_items, Some(AlignValue::Center));
    }

    #[test]
    fn stack_column_defaults_align_items_to_flex_start_when_unset() {
        // The reported bug: a fresh Column Stack (the default) must not leave align-items unset,
        // since taffy/CSS's own implicit default (align-items: normal) behaves as stretch --
        // silently filling an untouched child's width despite the resize control showing it as
        // "Hug" selected. flex-start (not stretch) matches that "Hug" default.
        let d = box_with(&[("arrange", "stack")]);
        assert_eq!(d.flex_direction, FlexDir::Column);
        assert_eq!(d.extra.align_items, Some(AlignValue::FlexStart));
    }

    #[test]
    fn stack_column_respects_explicit_align_items_override() {
        let d = box_with(&[
            ("arrange", "stack"),
            ("align-items", "center"),
        ]);
        assert_eq!(d.extra.align_items, Some(AlignValue::Center));
    }

    #[test]
    fn stack_row_respects_explicit_align_items_override() {
        let d = box_with(&[
            ("arrange", "stack"),
            ("flex-direction", "row"),
            ("align-items", "flex-end"),
        ]);
        assert_eq!(d.extra.align_items, Some(AlignValue::FlexEnd));
    }

    #[test]
    fn cluster_forces_row_wrap_defaults_when_unset() {
        let d = box_with(&[("arrange", "cluster")]);
        assert_eq!(d.flex_direction, FlexDir::Row);
        assert_eq!(d.extra.flex_wrap, FlexWrapValue::Wrap);
        assert_eq!(d.extra.align_items, Some(AlignValue::FlexStart));
    }

    #[test]
    fn cluster_respects_explicit_advanced_overrides() {
        // The "Advanced flex" escape hatch stays live even while Cluster is active.
        let d = box_with(&[
            ("arrange", "cluster"),
            ("flex-wrap", "nowrap"),
            ("align-items", "center"),
        ]);
        assert_eq!(d.extra.flex_wrap, FlexWrapValue::NoWrap);
        assert_eq!(d.extra.align_items, Some(AlignValue::Center));
    }

    #[test]
    fn split_defaults_row_space_between_center_when_unset() {
        let d = box_with(&[("arrange", "split")]);
        assert_eq!(d.flex_direction, FlexDir::Row);
        assert_eq!(d.extra.justify_content, Some(JustifyValue::SpaceBetween));
        assert_eq!(d.extra.align_items, Some(AlignValue::Center));
    }

    #[test]
    fn split_axis_column_is_a_vertical_split() {
        let d = box_with(&[("arrange", "split"), ("flex-direction", "column")]);
        assert_eq!(d.flex_direction, FlexDir::Column);
        assert_eq!(d.extra.justify_content, Some(JustifyValue::SpaceBetween));
    }

    #[test]
    fn center_defaults_justify_and_align_center_and_leaves_direction_untouched() {
        let d = box_with(&[("arrange", "center")]);
        // Center is axis-free -- no follow-on touches direction, so it falls through to the
        // plain absent-flex-direction default (Column), same as a fresh box.
        assert_eq!(d.flex_direction, FlexDir::Column);
        assert_eq!(d.extra.justify_content, Some(JustifyValue::Center));
        assert_eq!(d.extra.align_items, Some(AlignValue::Center));
    }

    #[test]
    fn grid_defaults_to_autofit_from_cell_min() {
        let d = box_with(&[("arrange", "grid"), ("grid-cell-min", "200")]);
        assert_eq!(
            d.extra.grid_template_columns,
            vec![TrackSize::AutoFit(200.0)]
        );
    }

    #[test]
    fn grid_falls_back_to_160_when_cell_min_unset() {
        let d = box_with(&[("arrange", "grid")]);
        assert_eq!(
            d.extra.grid_template_columns,
            vec![TrackSize::AutoFit(160.0)]
        );
    }

    #[test]
    fn grid_custom_tracks_override_wins_over_cell_min() {
        let d = box_with(&[
            ("arrange", "grid"),
            ("grid-cell-min", "200"),
            ("grid-template-columns", "1fr 2fr"),
        ]);
        assert_eq!(
            d.extra.grid_template_columns,
            vec![TrackSize::Fr(1.0), TrackSize::Fr(2.0)]
        );
    }

    #[test]
    fn unrecognized_arrange_value_falls_back_to_stack() {
        let d = box_with(&[("arrange", "bogus"), ("flex-direction", "row")]);
        // Falls back to Stack's rules: Row + unset align-items -> defaults to Center.
        assert_eq!(d.extra.align_items, Some(AlignValue::Center));
    }

    // --- detect_primitive: arrange/grid-cell-min are box-forcing ---

    #[test]
    fn arrange_property_forces_box_detection() {
        let mut props: HashMap<String, ResolvedProperty> = HashMap::new();
        props.insert("font-size".to_string(), prop("font-size", "14px"));
        props.insert("arrange".to_string(), prop("arrange", "stack"));
        assert_eq!(detect_primitive(&props), "box");
    }

    #[test]
    fn grid_cell_min_property_forces_box_detection() {
        let mut props: HashMap<String, ResolvedProperty> = HashMap::new();
        props.insert("color".to_string(), prop("color", "#111111"));
        props.insert("grid-cell-min".to_string(), prop("grid-cell-min", "160"));
        assert_eq!(detect_primitive(&props), "box");
    }

    #[test]
    fn grid_auto_columns_and_grid_column_also_force_box_detection() {
        // Pre-existing gap: only grid-template-*/grid-cell-min counted as box-forcing, so a node
        // with ONLY grid-auto-columns/grid-column/etc set (and no other box signal) was
        // misdetected as text. Now closed for every grid-advanced key.
        for key in ["grid-auto-columns", "grid-auto-rows", "grid-column", "grid-row", "grid-template-areas"] {
            let mut props: HashMap<String, ResolvedProperty> = HashMap::new();
            props.insert("color".to_string(), prop("color", "#111111"));
            props.insert(key.to_string(), prop(key, "1"));
            assert_eq!(detect_primitive(&props), "box", "{key} should force box detection");
        }
    }

    // --- parse_track: new track shapes ---

    #[test]
    fn parse_track_handles_percent_fit_content_and_minmax() {
        assert_eq!(parse_track("50%"), TrackSize::Percent(50.0));
        assert_eq!(parse_track("fit-content(220px)"), TrackSize::FitContent(220.0));
        assert_eq!(
            parse_track("minmax(100px, 1fr)"),
            TrackSize::MinMax(TrackMin::Px(100.0), TrackMax::Fr(1.0))
        );
        assert_eq!(
            parse_track("minmax(10%, max-content)"),
            TrackSize::MinMax(TrackMin::Percent(10.0), TrackMax::MaxContent)
        );
    }

    #[test]
    fn parse_track_handles_repeat_auto_fit_and_auto_fill() {
        assert_eq!(
            parse_track("repeat(auto-fit, minmax(160px, 1fr))"),
            TrackSize::AutoFit(160.0)
        );
        assert_eq!(
            parse_track("repeat(auto-fill, minmax(120px, 1fr))"),
            TrackSize::AutoFill(120.0)
        );
    }

    #[test]
    fn parse_track_list_does_not_split_inside_a_tracks_own_parentheses() {
        // A naive whitespace split shreds `repeat(auto-fit, minmax(160px, 1fr))` into
        // "repeat(auto-fit,"/"minmax(160px,"/"1fr))" -- three unparseable fragments, all falling
        // back to Auto. Real regression coverage for split_respecting_parens.
        assert_eq!(
            parse_track_list("repeat(auto-fit, minmax(160px, 1fr))"),
            vec![TrackSize::AutoFit(160.0)]
        );
        assert_eq!(
            parse_track_list("minmax(10%, 1fr) minmax(100px, max-content)"),
            vec![
                TrackSize::MinMax(TrackMin::Percent(10.0), TrackMax::Fr(1.0)),
                TrackSize::MinMax(TrackMin::Px(100.0), TrackMax::MaxContent),
            ]
        );
    }

    #[test]
    fn parse_track_list_round_trips_a_mixed_custom_tracks_string() {
        let tracks = parse_track_list("100px 1fr repeat(auto-fit, minmax(160px, 1fr)) 50% fit-content(200px)");
        assert_eq!(
            tracks,
            vec![
                TrackSize::Px(100.0),
                TrackSize::Fr(1.0),
                TrackSize::AutoFit(160.0),
                TrackSize::Percent(50.0),
                TrackSize::FitContent(200.0),
            ]
        );
    }

    // --- parse_grid_line: named lines ---

    #[test]
    fn parse_grid_line_handles_named_lines_and_named_spans() {
        assert_eq!(parse_grid_line("sidebar-start"), GridLine::NamedLine("sidebar-start".to_string(), 1));
        assert_eq!(parse_grid_line("sidebar 2"), GridLine::NamedLine("sidebar".to_string(), 2));
        assert_eq!(parse_grid_line("span content"), GridLine::NamedSpan("content".to_string(), 1));
        assert_eq!(parse_grid_line("span 2 content"), GridLine::NamedSpan("content".to_string(), 2));
        // Numeric forms still resolve exactly as before.
        assert_eq!(parse_grid_line("3"), GridLine::Line(3));
        assert_eq!(parse_grid_line("span 2"), GridLine::Span(2));
    }

    // --- parse_grid_template_areas ---

    #[test]
    fn parse_grid_template_areas_resolves_named_regions_to_line_coordinates() {
        let areas = parse_grid_template_areas(r#""header header" "sidebar main" "footer footer""#);
        let header = areas.iter().find(|a| a.name == "header").unwrap();
        assert_eq!((header.row_start, header.row_end, header.column_start, header.column_end), (1, 2, 1, 3));
        let sidebar = areas.iter().find(|a| a.name == "sidebar").unwrap();
        assert_eq!((sidebar.row_start, sidebar.row_end, sidebar.column_start, sidebar.column_end), (2, 3, 1, 2));
        let main = areas.iter().find(|a| a.name == "main").unwrap();
        assert_eq!((main.row_start, main.row_end, main.column_start, main.column_end), (2, 3, 2, 3));
        let footer = areas.iter().find(|a| a.name == "footer").unwrap();
        assert_eq!((footer.row_start, footer.row_end, footer.column_start, footer.column_end), (3, 4, 1, 3));
    }

    #[test]
    fn parse_grid_template_areas_skips_the_null_cell_token() {
        let areas = parse_grid_template_areas(r#""a . b""#);
        assert_eq!(areas.len(), 2);
        assert!(areas.iter().all(|a| a.name != "."));
    }

    // --- build_box_node: new BoxExtra fields wired from raw props ---
    //
    // grid-template-areas/grid-auto-flow/justify-items/align-content are Grid-CONTAINER opinions
    // (ArrangeKeys' grid_advanced set, same bucket as grid-template-columns/rows) so they only
    // wire through while `arrange` is actually "grid" -- see the arrange_kind gate added to
    // build_box_node. justify-self stays a child-placement field and wires unconditionally.

    #[test]
    fn build_box_node_wires_the_five_new_grid_fields() {
        let d = box_with(&[
            ("arrange", "grid"),
            ("grid-template-areas", r#""a a" "b b""#),
            ("grid-auto-flow", "column dense"),
            ("justify-items", "center"),
            ("align-content", "space-between"),
            ("justify-self", "end"),
        ]);
        assert_eq!(d.extra.grid_template_areas.len(), 2);
        assert_eq!(d.extra.grid_auto_flow, GridAutoFlow::ColumnDense);
        assert_eq!(d.extra.justify_items, Some(AlignValue::Center));
        assert_eq!(d.extra.align_content, Some(JustifyValue::SpaceBetween));
        assert_eq!(d.extra.justify_self, Some(AlignValue::End));
    }

    #[test]
    fn build_box_node_defaults_the_five_new_grid_fields_when_unset() {
        let d = box_with(&[("arrange", "grid")]);
        assert!(d.extra.grid_template_areas.is_empty());
        assert_eq!(d.extra.grid_auto_flow, GridAutoFlow::Row);
        assert_eq!(d.extra.justify_items, None);
        assert_eq!(d.extra.align_content, None);
        assert_eq!(d.extra.justify_self, None);
    }

    #[test]
    fn switching_arrange_away_from_grid_drops_stale_grid_container_fields() {
        // Regression for the grid-overlay-stuck-on bug: a box that was previously Grid (raw
        // grid-template-columns/rows/etc still sitting in the DB from that stint) but whose
        // `arrange` property now reads e.g. "stack" must compile with an EMPTY/default grid
        // container surface -- never fall back to the leftover raw values. This is exactly the
        // field taf_can_do's apply_box_extra and Vellum's grid-line overlay both gate on
        // (`!grid_template_columns.is_empty() || !grid_template_rows.is_empty()`), so leaking it
        // silently keeps the box rendering/overlaying as Grid after the user switched away.
        let d = box_with(&[
            ("arrange", "stack"),
            ("grid-template-columns", "1fr 2fr"),
            ("grid-template-rows", "100px 200px"),
            ("grid-auto-rows", "50px"),
            ("grid-auto-columns", "50px"),
            ("grid-template-areas", r#""a a" "b b""#),
            ("grid-auto-flow", "column dense"),
            ("justify-items", "center"),
            ("align-content", "space-between"),
        ]);
        assert!(d.extra.grid_template_columns.is_empty());
        assert!(d.extra.grid_template_rows.is_empty());
        assert!(d.extra.grid_auto_rows.is_empty());
        assert!(d.extra.grid_auto_columns.is_empty());
        assert!(d.extra.grid_template_areas.is_empty());
        assert_eq!(d.extra.grid_auto_flow, GridAutoFlow::Row);
        assert_eq!(d.extra.justify_items, None);
        assert_eq!(d.extra.align_content, None);
    }

    #[test]
    fn switching_arrange_away_from_grid_still_honors_child_placement_props() {
        // grid-column/grid-row/justify-self are the CHILD's own placement within a Grid PARENT,
        // independent of this box's own arrange kind -- must NOT be gated the same way.
        let d = box_with(&[
            ("arrange", "stack"),
            ("grid-column", "2"),
            ("grid-row", "span 2"),
            ("justify-self", "end"),
        ]);
        assert_eq!(d.extra.grid_column, (GridLine::Line(2), GridLine::Auto));
        assert_eq!(d.extra.grid_row, (GridLine::Span(2), GridLine::Auto));
        assert_eq!(d.extra.justify_self, Some(AlignValue::End));
    }

    // --- arrange_field()'s new grid FieldDefs ---

    #[test]
    fn arrange_keys_declares_the_new_friendly_grid_fields_with_the_right_input_types() {
        let keys = arrange_field()
            .arrange_keys
            .expect("arrange field should carry arrangeKeys");
        assert_eq!(keys.grid_columns.key, "grid-template-columns");
        assert_eq!(keys.grid_columns.input_type.as_deref(), Some("grid-tracks"));
        assert_eq!(keys.grid_rows.key, "grid-template-rows");
        assert_eq!(keys.grid_rows.input_type.as_deref(), Some("grid-tracks"));
        assert_eq!(keys.grid_areas.key, "grid-template-areas");
        assert_eq!(keys.grid_areas.input_type.as_deref(), Some("grid-area-painter"));
        assert_eq!(keys.grid_auto_flow.key, "grid-auto-flow");
        assert_eq!(keys.grid_auto_flow.input_type.as_deref(), Some("grid-auto-flow"));
        assert_eq!(keys.grid_justify_items.input_type.as_deref(), Some("align-picker"));
        assert_eq!(keys.grid_align_content.input_type.as_deref(), Some("align-picker"));
        // The raw escape hatch grows to cover the two new raw-text fields too.
        assert!(keys.grid_advanced.iter().any(|f| f.key == "grid-template-areas"));
        assert!(keys.grid_advanced.iter().any(|f| f.key == "justify-self"));
    }
}


// --- Wire-type JSON Schema (feature = "schema") ---------------------------------------------
// schemars derives a machine-truth JSON Schema from the actual wire structs; the schema is the
// source of truth for PLUGINS.md's generated "Wire types" reference (scripts/generate-plugin-docs
// renders it). Gated behind the `schema` feature so the SHIPPED wasm build never pulls schemars
// in. Root aggregates the three node bodies into ONE schema so schemars emits a single `$defs`
// map covering every nested leaf (Extent/OklabColor/BoxExtra/TrackSize/...), deduplicated.
#[cfg(feature = "schema")]
#[derive(schemars::JsonSchema)]
#[allow(dead_code)]
struct WireSchemaRoot {
    box_node: BoxData,
    text_node: TextData,
    img_node: ImgData,
    shape_node: ShapeData,
}

#[cfg(all(feature = "schema", test))]
mod wire_schema_tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    fn schema_path() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("generated/wire-schema.json")
    }

    // Dumps the derived schema AND guards it: `cargo test --features schema` fails if the
    // committed generated/wire-schema.json is stale vs the actual structs. Regenerate with
    // UPDATE_WIRE_SCHEMA=1. The JS side (scripts/generate-plugin-docs) then renders this file
    // into PLUGINS.md, guarded again there -- so the whole Rust struct -> schema -> docs chain
    // is drift-checked end to end. This test is run by `npm test` (package.json's
    // `test:wire-schema` script) precisely so that guarantee holds without anyone remembering to
    // run `cargo test` by hand -- it silently didn't for weeks after Grid mastery shipped new
    // BoxExtra fields, until wire-schema.json's own staleness was found by accident.
    #[test]
    fn wire_schema_matches_committed() {
        let schema = schemars::schema_for!(WireSchemaRoot);
        let actual = serde_json::to_string_pretty(&schema).unwrap() + "\n";
        let path = schema_path();

        if std::env::var("UPDATE_WIRE_SCHEMA").is_ok() || !path.exists() {
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(&path, &actual).unwrap();
        }

        let expected = fs::read_to_string(&path).unwrap();
        assert_eq!(
            actual, expected,
            "wire-schema.json is stale vs the wire structs. Regenerate with \
             UPDATE_WIRE_SCHEMA=1 cargo test --features schema, then `npm run generate-docs`."
        );
    }
}

// `merge_kits` (this file) and manager's `flattenKitResults` (manager/src/resolve/resolve.ts)
// are two independent implementations of the SAME rule - CLAUDE.md documents "keep in lockstep
// by hand," with no automated enforcement prior to this test. Both load the same
// ../../fixtures/kit-flatten-golden.json and must agree with its `expected` block; a future
// divergence in either implementation now fails a test instead of silently drifting.
#[cfg(test)]
mod merge_kits_golden_tests {
    use super::*;
    use std::path::PathBuf;

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct GoldenExpectedEntry {
        value: String,
        kit_id: String,
    }

    #[derive(Deserialize)]
    struct GoldenFixture {
        kits: Vec<ResolvedKit>,
        expected: std::collections::HashMap<String, GoldenExpectedEntry>,
    }

    #[test]
    fn merge_kits_agrees_with_the_shared_golden_fixture_flatten_kit_results_also_asserts_against() {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/kit-flatten-golden.json");
        let raw = std::fs::read_to_string(&path)
            .unwrap_or_else(|e| panic!("failed to read {}: {e}", path.display()));
        let fixture: GoldenFixture = serde_json::from_str(&raw).expect("fixture must parse");

        let merged = merge_kits(&fixture.kits);

        for (property, expected) in &fixture.expected {
            let resolved = merged
                .get(property)
                .unwrap_or_else(|| panic!("expected a resolved value for \"{property}\""));
            assert_eq!(resolved.value, expected.value, "\"{property}\".value");
            assert_eq!(resolved.kit_id, expected.kit_id, "\"{property}\".kit_id");
        }
    }
}
