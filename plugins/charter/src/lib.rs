use extism_pdk::*;
use serde::{Deserialize, Serialize};

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
    // View ids this property's value references (set by the resolver for any `view-list` value,
    // name-neutrally). Charter treats its OWN `children` field's view_refs as nested children --
    // that opinion lives here, in the plugin, not in the resolver.
    #[serde(default)]
    view_refs: Option<Vec<String>>,
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
    // "weight" | "align" | "decoration" -- how the editor should render this field's input.
    // None means the editor's default (plain text).
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
    // Grid's "Custom tracks" disclosure: raw grid-template-*/grid-auto-*/grid-column/grid-row.
    grid_advanced: Vec<FieldDef>,
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

// Track/grid types mirror vellum's api.rs — serde output must match exactly.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
enum TrackSize {
    Px(f32),
    Fr(f32),
    Auto,
    MinContent,
    MaxContent,
    // Responsive auto-fit repeat, opinionated (not raw CSS `repeat()`): as many tracks as fit,
    // each `minmax(f32 px, 1fr)`. This is what compile_arrange's Grid tab emits from a single
    // "Cell min" number -- must match Vellum's TrackSize::AutoFit exactly (see the module-level
    // comment above).
    AutoFit(f32),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
enum GridLine {
    Auto,
    Line(i16),
    Span(u16),
}

impl Default for GridLine {
    fn default() -> Self {
        GridLine::Auto
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
enum AlignValue {
    Start,
    End,
    FlexStart,
    FlexEnd,
    Center,
    Baseline,
    Stretch,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
enum JustifyValue {
    Start,
    End,
    FlexStart,
    FlexEnd,
    Center,
    Stretch,
    SpaceBetween,
    SpaceEvenly,
    SpaceAround,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
enum FlexWrapValue {
    NoWrap,
    Wrap,
    WrapReverse,
}

impl Default for FlexWrapValue {
    fn default() -> Self {
        FlexWrapValue::NoWrap
    }
}

// Mirrors vellum's api.rs — serde output must match exactly.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
enum NodePosition {
    Relative,
    Absolute { x: f32, y: f32 },
}

impl Default for NodePosition {
    fn default() -> Self {
        NodePosition::Relative
    }
}

// Mirrors vellum's api.rs Extent — serde output must match exactly. A box-model size dimension:
// Auto | fixed px | percent-of-parent. `fr` is intentionally absent (that's a grid TrackSize /
// flex_grow concern, never a value a child declares about its own size).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
enum Extent {
    Auto,
    Px(f32),
    Percent(f32),
}

impl Default for Extent {
    fn default() -> Self {
        Extent::Auto
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct BoxExtra {
    #[serde(default)]
    gap: f32,
    #[serde(default)]
    align_items: Option<AlignValue>,
    #[serde(default)]
    justify_content: Option<JustifyValue>,
    #[serde(default)]
    flex_wrap: FlexWrapValue,
    #[serde(default)]
    flex_grow: f32,
    #[serde(default)]
    flex_shrink: Option<f32>,
    #[serde(default)]
    align_self: Option<AlignValue>,
    #[serde(default)]
    flex_basis: Option<Extent>,
    #[serde(default)]
    margin: f32,
    #[serde(default)]
    position: NodePosition,
    #[serde(default)]
    grid_template_columns: Vec<TrackSize>,
    #[serde(default)]
    grid_template_rows: Vec<TrackSize>,
    #[serde(default)]
    grid_auto_rows: Vec<TrackSize>,
    #[serde(default)]
    grid_auto_columns: Vec<TrackSize>,
    #[serde(default)]
    grid_column: (GridLine, GridLine),
    #[serde(default)]
    grid_row: (GridLine, GridLine),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct BoxShadow {
    offset_x: f32,
    offset_y: f32,
    blur_radius: f32,
    spread_radius: f32,
    color: [f32; 4],
    inset: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct BoxData {
    parent_id: Option<usize>,
    width: Extent,
    height: Extent,
    #[serde(default)]
    min_width: Extent,
    #[serde(default)]
    min_height: Extent,
    max_width: Extent,
    max_height: Extent,
    padding: [f32; 4],
    bg_color: [f32; 4],
    flex_direction: String,
    show_border: bool,
    border_color: [f32; 4],
    border_width: f32,
    corner_radius: f32,
    opacity: f32,
    shadow: Option<BoxShadow>,
    #[serde(default)]
    extra: BoxExtra,
    // 0 = none, 1 = secondary, 2 = primary/active. Vellum draws its own outside outline +
    // corner handles from this — never encode selection by mutating border_color/border_width.
    #[serde(default)]
    selected: u8,
    // Independent from `selected` — a view can be hovered while a different view stays
    // selected. Vellum draws a plain highlight border for this, no corner handles.
    #[serde(default)]
    hovered: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct UiBoxNode {
    #[serde(rename = "Box")]
    box_data: BoxData,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct TextData {
    parent_id: Option<usize>,
    width: Extent,
    height: Extent,
    padding: [f32; 4],
    bg_color: [f32; 4],
    show_border: bool,
    border_color: [f32; 4],
    border_width: f32,
    corner_radius: f32,
    opacity: f32,
    content: String,
    font_size: f32,
    font_family: String,
    font_weight: u16,
    font_style: String,
    text_color: [f32; 4],
    // Wire values are Vellum's TextAlign/TextDecorationKind enum variant names verbatim
    // ("Left"/"Center"/"Right"/"Justify", "None"/"Underline"/"LineThrough") -- see
    // parse_text_align/parse_text_decoration. Plain String like font_style, not a Rust enum on
    // this side: Charter never round-trips these, it only ever writes them.
    #[serde(default = "default_text_align")]
    text_align: String,
    #[serde(default = "default_text_decoration")]
    text_decoration: String,
    #[serde(default)]
    selected: u8,
    #[serde(default)]
    hovered: bool,
}

fn default_text_align() -> String {
    "Left".to_string()
}

fn default_text_decoration() -> String {
    "None".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct UiTextNode {
    #[serde(rename = "Text")]
    text_data: TextData,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
enum UiNode {
    Box(UiBoxNode),
    Text(UiTextNode),
    Img(UiImgNode),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
enum ImageSource {
    None,
    Url(String),
    Bytes(Vec<u8>),
    Ref(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ImgData {
    parent_id: Option<usize>,
    width: Extent,
    height: Extent,
    source: ImageSource,
    // CSS object-fit: "cover" | "contain" | "fill". Must be the field NAME vellum reads
    // (`fit: String`) — an earlier `cover: bool` here silently never reached vellum (unknown key),
    // so every image rendered as the `fit` default ("cover") regardless of this value.
    fit: String,
    #[serde(default = "default_object_position")]
    object_position: [f32; 2],
    #[serde(default)]
    selected: u8,
    #[serde(default)]
    hovered: bool,
}

fn default_object_position() -> [f32; 2] {
    [0.5, 0.5]
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct UiImgNode {
    #[serde(rename = "Img")]
    img_data: ImgData,
}

// No rename_all here -- viewport_data/node_view_ids are read as snake_case by
// manager.svelte.ts (matching the pre-existing viewport_data convention), unlike the
// camelCase-input structs elsewhere in this file that come from JS-authored payloads.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct OnResolveResult {
    categories: Vec<FieldCategory>,
    viewport_data: Vec<UiNode>,
    // Parallel to viewport_data (same length/order) — which view each node belongs to, for the
    // editor to resolve a viewport click-to-select hit-test index back to a view id. "" for
    // structural grid scaffolding nodes that don't belong to any view. Deliberately not a field
    // on UiNode itself: view identity has zero rendering relevance, so it never crosses into
    // the wire format Vellum deserializes.
    node_view_ids: Vec<String>,
    // The concrete (family, weight, style) set the viewport renders, post weight-snapping —
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
// *opinionated* facts per item — never generic graph math. Concretely: a panel-item carries
// identity, the write-alias for composition edits, and the ops the plugin declares available on
// it. Tree topology (parent/child, root-ness) is computed host-side from `resolvedViews` +
// `PanelManifest.composition_field_keys`, because that's a generic graph walk the host is
// perfectly positioned to do — routing it through the plugin just to "dedupe" wrapped a
// universal computation across the WASM boundary for nothing. Similarly, the panel icon comes
// from the view's `hints.view_icon`, authorable directly — Charter has no business emitting
// icon strings for the editor's panel.
//
// No rename_all — plugin-authored output the editor reads, same snake_case rule as
// OnResolveResult (see the camelCase pitfall in CLAUDE.md).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct PanelItem {
    id: String,
    // Token alias to upsert when the editor's DnD writes this item's children list. None when
    // this item's primitive has no `children` field (e.g. Text/Image) — editor hides the DnD
    // nesting affordance in that case. The alias itself comes from the resolved `children`
    // property's `token_alias`, since that's what the editor's `api.upsertViewToken` writes-by-alias
    // call already targets (see CLAUDE.md's View-token override pitfalls).
    #[serde(default)]
    write_alias: Option<String>,
    // Ops the plugin declares available on this item — drives the editor's right-click context
    // menu for this item. Each op is self-describing: `name` is the dispatch key the editor
    // switches on, `label`/`icon` are what to render. Editor shows the menu item iff `name` is
    // in this list; plugin owns what's available, editor owns how to execute. The op set is
    // per-primitive (a Box gets `add-child` ops; a Text/Image doesn't — see
    // build_views_panel_manifest).
    #[serde(default)]
    ops: Vec<PanelOp>,
}

// One operation the plugin declares available on a panel item (or a panel header, via
// `PanelManifest.header_ops`). Self-describing: the editor renders menu items straight off
// `{label, icon}` and switches on `name` to dispatch. `kind` is an op-specific payload — today
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
    // `inputType` is the composition kind). VIEW-INDEPENDENT — this is the full, stable set
    // across every primitive, so the editor can nest the Views tree by field-kind no matter
    // which view happens to be active. The host walks `resolvedViews` for these keys' `viewRefs`
    // to build the DAG client-side (the same math `build_viewport`'s `referenced` set uses, but
    // generic and host-owned, not in the manifest). This is Charter's whole opinion on nesting:
    // *which field is the composition one*. Everything else — root detection, ordering, cycle
    // guarding — is the host's.
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

// Input to the `kit10_panel_publish` host fn — Charter authors this, JS reads it. No
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
    // expects maps (struct-variant format). with_struct_map() fixes this — see
    // CLAUDE.md's "bincode was unmaintained" and the rmp_serde replace note.
    let mut ser = rmp_serde::Serializer::new(&mut buf).with_struct_map();
    data.serialize(&mut ser).ok()?;
    Some(base64::Engine::encode(
        &base64::engine::general_purpose::STANDARD,
        &buf,
    ))
}
// Convention mapping from a view primitive to its FA icon class — authoritative for what
// `hints.view_icon` values the seed sets. `#[cfg(test)]` because production code no longer
// calls it (Phase 3 moved icon authoring to the seed's `hints.view_icon`), but the test
// (`primitive_icon_maps_text_to_italic_and_box_to_window`) still references it as the
// documented convention that seed.ts follows, guarding against drift.
#[cfg(test)]
fn primitive_icon(primitive: &str) -> &'static str {
    match primitive {
        "text" => "fa-solid fa-italic",
        "image" => "fa-solid fa-image",
        _ => "fa-regular fa-window-maximize",
    }
}

// Charter's composition fields, across all primitives -- the fields it declares with the
// composition inputType. This is the single plugin-owned fact about nesting: "this resolved
// property name is the one whose `viewRefs` are the children." Everything else in nesting
// (root detection, ordering, cycle guarding) is host-side generic graph math over
// `resolvedViews` + this list — see build_views_panel_manifest's caller in Views.svelte.
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
// choices — currently just the primitive override).
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

// One weight-range + style a font family actually has. Host-assembled from Fontavious's
// catalogue (`family_facts`) today; a future uploaded-font path would contribute entries from
// Vellum's loaded bytes instead — same shape either way (see resources/text-affordances.md's
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
    #[serde(default)]
    selected_view_primary: Option<String>,
    #[serde(default)]
    selected_view_secondary: Vec<String>,
    // Patched in by on_selection_change alongside the selection fields above — persisted here
    // (rather than only in OnSelectionChangeInput) so it survives being stashed into
    // last_resolve_input and re-read on the next selection-only patch.
    #[serde(default)]
    hovered_view_id: Option<String>,
    // Keyed by family name as the kit property spells it (matched case-insensitively). Absent
    // families pass their requested weight through untouched — no facts, no opinion. Riding
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
// on_resolve call anyway (OnResolveInput does have rename_all). hovered_view_id has no such
// fallback -- without this attribute it was always silently None, so hover never worked at all.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct OnSelectionChangeInput {
    primary: Option<String>,
    #[serde(default)]
    secondary: Vec<String>,
    // Host always sends this so active_view_id in last_resolve_input never goes stale.
    #[serde(default)]
    active_view_id: Option<String>,
    // Unlike active_view_id, always overwritten unconditionally (including with null) — the
    // host sends null exactly when the mouse leaves a hoverable area, and that must actually
    // clear the hover border, not leave the last-hovered view highlighted.
    #[serde(default)]
    hovered_view_id: Option<String>,
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
    // Returns true unconditionally — failure to publish is non-fatal (panel just stays empty).
    pub fn kit10_panel_publish(input: PanelPublishInput) -> bool;
}

fn merge_kits(kits: &[ResolvedKit]) -> std::collections::HashMap<String, ResolvedProperty> {
    let mut merged = std::collections::HashMap::new();
    for kit in kits {
        for (k, v) in &kit.properties {
            merged.insert(k.clone(), v.clone());
        }
    }
    merged
}

// Charter's composition opinion: its own `children` field, when it resolved to a `view-list`
// value, names the views to nest. The resolver stays name-neutral (it only knows the property
// carries view_refs); "children means nest these" is decided here, in the plugin.
const CHILDREN_FIELD: &str = "children";

fn collect_child_view_ids(kits: &[ResolvedKit]) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut ids = Vec::new();
    for kit in kits {
        if let Some(refs) = kit
            .properties
            .get(CHILDREN_FIELD)
            .and_then(|p| p.view_refs.as_ref())
        {
            for id in refs {
                if seen.insert(id.clone()) {
                    ids.push(id.clone());
                }
            }
        }
    }
    ids
}

fn parse_color(s: &str) -> [f32; 4] {
    let s = s.trim();
    if s.starts_with('#') {
        let hex = &s[1..];
        match hex.len() {
            6 => {
                let r = u8::from_str_radix(&hex[0..2], 16).unwrap_or(0) as f32 / 255.0;
                let g = u8::from_str_radix(&hex[2..4], 16).unwrap_or(0) as f32 / 255.0;
                let b = u8::from_str_radix(&hex[4..6], 16).unwrap_or(0) as f32 / 255.0;
                [r, g, b, 1.0]
            }
            8 => {
                let r = u8::from_str_radix(&hex[0..2], 16).unwrap_or(0) as f32 / 255.0;
                let g = u8::from_str_radix(&hex[2..4], 16).unwrap_or(0) as f32 / 255.0;
                let b = u8::from_str_radix(&hex[4..6], 16).unwrap_or(0) as f32 / 255.0;
                let a = u8::from_str_radix(&hex[6..8], 16).unwrap_or(255) as f32 / 255.0;
                [r, g, b, a]
            }
            _ => [0.0, 0.0, 0.0, 1.0],
        }
    } else if s.starts_with("rgb(") {
        let inner = s.trim_start_matches("rgb(").trim_end_matches(')');
        let parts: Vec<&str> = inner.split(',').collect();
        if parts.len() >= 3 {
            let r = parts[0].trim().parse::<f32>().unwrap_or(0.0) / 255.0;
            let g = parts[1].trim().parse::<f32>().unwrap_or(0.0) / 255.0;
            let b = parts[2].trim().parse::<f32>().unwrap_or(0.0) / 255.0;
            let a = if parts.len() >= 4 {
                parts[3].trim().parse::<f32>().unwrap_or(1.0)
            } else {
                1.0
            };
            [r, g, b, a]
        } else {
            [0.0, 0.0, 0.0, 1.0]
        }
    } else {
        [0.0, 0.0, 0.0, 1.0]
    }
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
// / flex-grow concern, not a self-declared size — see the Extent enum). Percent parsing is what
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
    if let Some(n) = s.strip_suffix("fr") {
        return TrackSize::Fr(n.trim().parse().unwrap_or(1.0));
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
    s.split_whitespace().map(parse_track).collect()
}

fn parse_grid_line(s: &str) -> GridLine {
    let s = s.trim();
    if s == "auto" || s.is_empty() {
        return GridLine::Auto;
    }
    if let Some(rest) = s.strip_prefix("span") {
        return GridLine::Span(rest.trim().parse().unwrap_or(1));
    }
    if let Ok(n) = s.parse::<i16>() {
        return GridLine::Line(n);
    }
    GridLine::Auto
}

fn parse_grid_line_pair(s: &str) -> (GridLine, GridLine) {
    let mut parts = s.splitn(2, '/');
    let start = parse_grid_line(parts.next().unwrap_or("auto"));
    let end = parse_grid_line(parts.next().unwrap_or("auto"));
    (start, end)
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
    bg_color: [f32; 4],
    show_border: bool,
    border_color: [f32; 4],
    border_width: f32,
    corner_radius: f32,
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
    default_bg: [f32; 4],
) -> PaintProps {
    let bg = get_prop(props, "background").unwrap_or_default();
    let border = get_prop(props, "border").unwrap_or_default();
    let border_width = parse_px(get_prop(props, "border-width").as_deref());
    let radius = parse_px(get_prop(props, "border-radius").as_deref());
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
            [0.0; 4]
        },
        border_width: if border_width > 0.0 {
            border_width
        } else if has_border {
            1.0
        } else {
            0.0
        },
        corner_radius: radius,
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

    out.align_self = match cross_kw {
        Some(ResizeKw::Fill) => Some(AlignValue::Stretch),
        Some(ResizeKw::Hug) => Some(AlignValue::FlexStart),
        None => None,
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
            // Direction is a free choice with no Justify/Wrap opinion; only the Row cross-axis
            // gets a sensible default (vertically centering a horizontal stack's items).
            if raw_align_items.is_none() && out.flex_direction == "Row" {
                out.align_items = Some(AlignValue::Center);
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
) -> UiNode {
    let paint = extract_paint_props(props, [0.0; 4]);
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

    let mut extra = BoxExtra {
        gap: parse_px(get_prop(props, "gap").as_deref()),
        align_items: raw_align_items.or(ac.align_items),
        justify_content: raw_justify_content.or(ac.justify_content),
        flex_wrap: raw_flex_wrap.or(ac.flex_wrap).unwrap_or_default(),
        flex_grow: get_prop(props, "flex-grow")
            .map(|s| parse_px(Some(&s)))
            .unwrap_or(0.0),
        flex_shrink: get_prop(props, "flex-shrink").map(|s| parse_px(Some(&s))),
        align_self: parse_align(get_prop(props, "align-self").as_deref()),
        flex_basis: None,
        // Charter deliberately does not expose margin — spacing between siblings is a container
        // concern (gap / justify-content), not a per-child opinion. The field stays in the wire
        // struct (Vellum + other plugins may use it) but Charter always emits the default 0.
        margin: 0.0,
        position: NodePosition::default(),
        grid_template_columns: ac
            .grid_template_columns
            .unwrap_or_else(|| raw_grid_template_columns.unwrap_or_default()),
        grid_template_rows: get_prop(props, "grid-template-rows")
            .map(|s| parse_track_list(&s))
            .unwrap_or_default(),
        grid_auto_rows: get_prop(props, "grid-auto-rows")
            .map(|s| parse_track_list(&s))
            .unwrap_or_default(),
        grid_auto_columns: get_prop(props, "grid-auto-columns")
            .map(|s| parse_track_list(&s))
            .unwrap_or_default(),
        grid_column: get_prop(props, "grid-column")
            .map(|s| parse_grid_line_pair(&s))
            .unwrap_or_default(),
        grid_row: get_prop(props, "grid-row")
            .map(|s| parse_grid_line_pair(&s))
            .unwrap_or_default(),
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
    if let Some(a) = rc.align_self {
        extra.align_self = Some(a);
    }

    UiNode::Box(UiBoxNode {
        box_data: BoxData {
            parent_id,
            width: rc.width,
            height: rc.height,
            min_width: rc.min_width,
            min_height: rc.min_height,
            max_width,
            max_height,
            padding: paint.padding,
            bg_color: paint.bg_color,
            flex_direction: ac.flex_direction,
            show_border: paint.show_border,
            border_color: paint.border_color,
            border_width: paint.border_width,
            corner_radius: paint.corner_radius,
            opacity: 1.0,
            shadow: None,
            extra,
            selected: 0,
            hovered: false,
        },
    })
}

// text-align: "left" (default hard, absent/unrecognized reads as Left -- same fallback grammar
// as parse_arrange) | "center" | "right" | "justify". Wire value is Vellum's TextAlign variant
// name verbatim.
fn parse_text_align(s: Option<&str>) -> String {
    match s.map(str::trim) {
        Some("center") => "Center",
        Some("right") => "Right",
        Some("justify") => "Justify",
        _ => "Left",
    }
    .to_string()
}

// text-decoration: single-choice, mirroring the "Decor" FieldDef -- never underline AND
// line-through at once. "none" (default) | "underline" | "line-through". Wire value is
// Vellum's TextDecorationKind variant name verbatim.
fn parse_text_decoration(s: Option<&str>) -> String {
    match s.map(str::trim) {
        Some("underline") => "Underline",
        Some("line-through") => "LineThrough",
        _ => "None",
    }
    .to_string()
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
    // A text node with no declared fill stays fully transparent -- same default as a Box now
    // (both `[0.0; 4]`); no `background` means transparent, matching CSS.
    let paint = extract_paint_props(props, [0.0; 4]);

    UiNode::Text(UiTextNode {
        text_data: TextData {
            parent_id: Some(parent_id),
            width: Extent::Auto,
            height: Extent::Auto,
            padding: paint.padding,
            bg_color: paint.bg_color,
            show_border: paint.show_border,
            border_color: paint.border_color,
            border_width: paint.border_width,
            corner_radius: paint.corner_radius,
            opacity: 1.0,
            content,
            font_size: if font_size > 0.0 { font_size } else { 16.0 },
            font_family,
            font_weight: if font_weight > 0 { font_weight } else { 400 },
            font_style: "Normal".to_string(),
            text_color: if !color.is_empty() {
                parse_color(&color)
            } else {
                [0.2, 0.2, 0.2, 1.0]
            },
            text_align,
            text_decoration,
            selected: 0,
            hovered: false,
        },
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

    UiNode::Img(UiImgNode {
        img_data: ImgData {
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
        },
    })
}

fn detect_primitive(props: &std::collections::HashMap<String, ResolvedProperty>) -> &'static str {
    // An image view has a `src` property. Just having one doesn't preclude also having
    // text props (a label over an image), but the `src` presence makes it an image primitive.
    if props.contains_key("src") {
        return "image";
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
        || props.contains_key("grid-cell-min");

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
            ],
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
                FieldDef::new("background", Some("Fill")),
                FieldDef::new("border", None),
                FieldDef::new("border-radius", Some("Radius")),
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
                FieldDef::new("color", Some("Fill")),
                FieldDef::new("font-family", Some("Family")).with_input_type("font"),
                FieldDef::new("font-size", Some("Size")),
                // Options are enumerated editor-side from the font-facts channel (the currently
                // resolved font-family's real weights) -- Charter only needs to say "this is a
                // weight field", not declare the choices, since they're runtime/per-family data
                // it doesn't carry (unlike arrangeKeys/resizeKeys, which are static per FieldDef).
                FieldDef::new("font-weight", Some("Weight")).with_input_type("weight"),
                // Fixed, Charter-known choice sets (unlike "weight"'s runtime facts) -- same
                // "hardcoded segmented buttons" shape as "resize"'s Fixed/Hug/Fill, handled
                // inline in StyleField.svelte rather than a dedicated wrapper component.
                FieldDef::new("text-align", Some("Align")).with_input_type("align"),
                FieldDef::new("text-decoration", Some("Decor")).with_input_type("decoration"),
            ],
        },
        // Paint properties a text node can carry directly (a highlighted/pill label) without
        // becoming a Box -- see build_text_node/extract_paint_props and the note in
        // detect_primitive about why these don't force box treatment.
        FieldCategory {
            name: "highlight".to_string(),
            fields: vec![
                FieldDef::new("background", Some("Highlight")),
                FieldDef::new("border", Some("Border")),
                FieldDef::new("border-radius", Some("Radius")),
                FieldDef::new("padding", Some("Padding")),
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
                FieldDef::new("background", Some("Fill")),
                FieldDef::new("border", None),
                FieldDef::new("border-radius", Some("Radius")),
                FieldDef::new("padding", Some("Padding")),
            ],
        },
    ]
}

fn transparent_box(parent_id: Option<usize>, flex_direction: &str, padding: [f32; 4]) -> UiNode {
    UiNode::Box(UiBoxNode {
        box_data: BoxData {
            parent_id,
            width: Extent::Auto,
            height: Extent::Auto,
            max_width: Extent::Auto,
            max_height: Extent::Auto,
            min_width: Extent::Auto,
            min_height: Extent::Auto,
            padding,
            bg_color: [0.0; 4],
            flex_direction: flex_direction.to_string(),
            show_border: false,
            border_color: [0.0; 4],
            border_width: 0.0,
            corner_radius: 0.0,
            opacity: 1.0,
            shadow: None,
            extra: BoxExtra::default(),
            selected: 0,
            hovered: false,
        },
    })
}

// A top-level view cell placed at a fixed world-space position, escaping the auto-flow grid
// entirely (see build_viewport). Always a root (parent_id: None).
fn absolute_box(flex_direction: &str, pos: [f32; 2]) -> UiNode {
    UiNode::Box(UiBoxNode {
        box_data: BoxData {
            parent_id: None,
            width: Extent::Auto,
            height: Extent::Auto,
            max_width: Extent::Auto,
            max_height: Extent::Auto,
            min_width: Extent::Auto,
            min_height: Extent::Auto,
            padding: [0.0; 4],
            bg_color: [0.0; 4],
            flex_direction: flex_direction.to_string(),
            show_border: false,
            border_color: [0.0; 4],
            border_width: 0.0,
            corner_radius: 0.0,
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
        },
    })
}

// Bundles the interaction-state fields needed to answer "is view X selected/hovered right
// now" — passed down through render_view_nodes' recursion so both a top-level view and any
// view reached via child_view_ids resolve their own selection/hover against the same source
// of truth, instead of the caller precomputing it only for the top level.
struct SelectionCtx<'a> {
    active_view_id: Option<&'a str>,
    selected_view_primary: Option<&'a str>,
    selected_view_secondary: &'a [String],
    hovered_view_id: Option<&'a str>,
}

// 0 = none, 1 = secondary selection, 2 = primary / active.
fn compute_selection(view_id: &str, ctx: &SelectionCtx) -> u8 {
    let is_active = ctx.active_view_id == Some(view_id);
    let is_primary = ctx.selected_view_primary == Some(view_id);
    let is_secondary = ctx.selected_view_secondary.iter().any(|id| id == view_id);
    if is_active || is_primary {
        2
    } else if is_secondary {
        1
    } else {
        0
    }
}

fn compute_hovered(view_id: &str, ctx: &SelectionCtx) -> bool {
    ctx.hovered_view_id == Some(view_id)
}

// Shared by render_view_nodes' own primitive computation and by a parent view deciding whether
// a candidate child is even eligible to be recursed into (see the containment rule in
// render_view_nodes below) -- same charter_hints-override-else-detect_primitive logic either
// way, just returning an owned String so it can be computed for a view this function isn't
// already "inside" of (detect_primitive's &'static str can't be returned when the hint-override
// path needs to hand back a String owned by a local CharterHints instead).
fn primitive_for_view(view: &ViewMeta) -> String {
    let merged = merge_kits(&view.resolved_kits);
    let charter_hints: CharterHints = view
        .hints
        .get("charter")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();
    charter_hints
        .primitive
        .unwrap_or_else(|| detect_primitive(&merged).to_string())
}

// Render a view's nodes into the flat viewport buffer.
// parent_id: the parent box index (grid cell for top-level, box idx for children).
// depth guard prevents runaway recursion from circular view references.
// node_view_ids: parallel accumulator to viewport — every push here is paired with a push
// there recording which view (view_id) that node belongs to, for the editor's viewport
// click-to-select hit-test lookup.
fn render_view_nodes(
    kits: &[ResolvedKit],
    hints: &std::collections::HashMap<String, serde_json::Value>,
    view_id: &str,
    ctx: &SelectionCtx,
    parent_id: Option<usize>,
    // Whether this view's flex PARENT lays out in a row (Some(true)) or column (Some(false)); None
    // at a top level (no flex parent). Drives direction-aware fill/hug -- see compile_resize.
    parent_main_horizontal: Option<bool>,
    viewport: &mut Vec<UiNode>,
    node_view_ids: &mut Vec<String>,
    depth: u8,
    view_map: &std::collections::HashMap<String, &ViewMeta>,
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
    let selection = compute_selection(view_id, ctx);
    let hovered = compute_hovered(view_id, ctx);

    if primitive == "text" {
        let mut node = build_text_node(&merged, content_parent.unwrap_or(0));
        if let UiNode::Text(UiTextNode { text_data }) = &mut node {
            text_data.selected = selection;
            text_data.hovered = hovered;
        }
        viewport.push(node);
        node_view_ids.push(view_id.to_string());

        // Containment rule (Charter's own opinion, not enforced anywhere upstream): a Text
        // view may contain other Text views (e.g. multiple inline runs), never a Box -- a
        // candidate whose own resolved primitive isn't "text" is silently skipped, the same
        // way a missing/deleted view id already is below. Nested text children are parented to
        // this node's own container (content_parent), not to this text node's index -- Vellum's
        // layout tree expects a Box as a layout parent, and content_parent already traces back
        // to one (or None at a genuine root), so this reuses a proven relationship instead of
        // introducing an unverified "Text as layout parent" case.
        for child_view_id in &collect_child_view_ids(kits) {
            if let Some(child_view) = view_map.get(child_view_id) {
                if primitive_for_view(child_view) != "text" {
                    continue;
                }
                render_view_nodes(
                    &child_view.resolved_kits,
                    &child_view.hints,
                    child_view_id,
                    ctx,
                    content_parent,
                    // Nested text shares this text's own container, so its flex parent is the same.
                    parent_main_horizontal,
                    viewport,
                    node_view_ids,
                    depth + 1,
                    view_map,
                );
            }
        }
    } else if primitive == "image" {
        let mut node = build_img_node(&merged, content_parent);
        if let UiNode::Img(UiImgNode { img_data }) = &mut node {
            img_data.selected = selection;
            img_data.hovered = hovered;
        }
        viewport.push(node);
        node_view_ids.push(view_id.to_string());

        // An image is a leaf — it has no children (no content tab, no children field).
        // Any child views assigned to an image view are silently ignored.
    } else {
        let box_idx = viewport.len();
        let mut node = build_box_node(&merged, content_parent, parent_main_horizontal);

        if let UiNode::Box(UiBoxNode { box_data }) = &mut node {
            box_data.selected = selection;
            box_data.hovered = hovered;
        }

        viewport.push(node);
        node_view_ids.push(view_id.to_string());

        // This box is the flex parent of its children; their fill/hug resolves against THIS box's
        // main axis (row -> width is main, column -> height is main). Default direction is Column.
        let child_main_horizontal = Some(matches!(
            get_prop(&merged, "flex-direction").as_deref(),
            Some("row") | Some("row-reverse")
        ));

        // A Box is a pure container -- it never renders its own inline text. If a design wants
        // text inside a box, it nests a Text primitive as one of the box's children. So there is
        // no `content` fallback here (and no `content` field in box_categories): the box's only
        // "contents" are its child views, recursed into below. A childless box just renders empty.
        let child_ids = collect_child_view_ids(kits);
        for child_view_id in &child_ids {
            if let Some(child_view) = view_map.get(child_view_id) {
                render_view_nodes(
                    &child_view.resolved_kits,
                    &child_view.hints,
                    child_view_id,
                    ctx,
                    Some(box_idx),
                    child_main_horizontal,
                    viewport,
                    node_view_ids,
                    depth + 1,
                    view_map,
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

// Returns (viewport_data, node_view_ids) — the two are always parallel (same length/order).
// "" entries in node_view_ids mark structural grid scaffolding (root/row/cell wrapper boxes)
// that don't belong to any view; a click resolving to one of those should be treated the same
// as clicking empty space.
// The CSS font-weight matching algorithm over the weights a family actually has, per its
// facts. Charter's single decision point for weight substitution (text-affordances Phase 1):
// the editor's font fetching consumes this function's OUTPUT (via `font_requests`), never
// re-deciding — so the panel's requested weight, the fetched file, and the rendered glyphs
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
                .find(|(k, _)| k.eq_ignore_ascii_case(&t.text_data.font_family))
                .map(|(_, v)| v);
            if let Some(f) = family_facts {
                t.text_data.font_weight = resolve_font_weight(t.text_data.font_weight, f);
            }
        }
    }
}

// The concrete (family, weight, style) set the viewport actually renders — post-snapping — so
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
            if t.text_data.font_family.is_empty() {
                continue;
            }
            // Lowercased: Fontavious's catalogue styles are "normal"/"italic" and its variant
            // matching is case-sensitive, while TextData's font_style is Vellum-cased ("Normal").
            let style = t.text_data.font_style.to_lowercase();
            set.insert(FontRequest {
                family: t.text_data.font_family.clone(),
                weight: t.text_data.font_weight,
                style: if style.is_empty() { "normal".to_string() } else { style },
            });
        }
    }
    set.into_iter().collect()
}

fn build_viewport(parsed: &OnResolveInput) -> (Vec<UiNode>, Vec<String>) {
    let mut viewport_data: Vec<UiNode> = Vec::new();
    let mut node_view_ids: Vec<String> = Vec::new();

    let ctx = SelectionCtx {
        active_view_id: parsed.active_view_id.as_deref(),
        selected_view_primary: parsed.selected_view_primary.as_deref(),
        selected_view_secondary: &parsed.selected_view_secondary,
        hovered_view_id: parsed.hovered_view_id.as_deref(),
    };

    let view_map: std::collections::HashMap<String, &ViewMeta> = parsed
        .project_views
        .iter()
        .map(|v| (v.view_id.clone(), v))
        .collect();

    // A view is never "top-level" or "child" by its own declaration -- that's derived from
    // whether some other view's box currently lists it in `children`. Union every view's own
    // child references (collect_child_view_ids is already used per-view for recursion below;
    // here it's run across the whole project) into one set, so a referenced view is
    // automatically excluded from the top-level grid no matter which view claims it, with no
    // separate flag to keep in sync by hand.
    let referenced: std::collections::HashSet<String> = parsed
        .project_views
        .iter()
        .flat_map(|v| collect_child_view_ids(&v.resolved_kits))
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

    // Views with an explicit world position float independently, each as its own root —
    // no shared flex parent to couple their placement to a sibling's content size.
    let (positioned, flowing): (Vec<_>, Vec<_>) =
        top_views.into_iter().partition(|(_, _, pos)| pos.is_some());

    for (view, kits, pos) in &positioned {
        let cell_idx = viewport_data.len();
        viewport_data.push(absolute_box("Column", pos.unwrap()));
        node_view_ids.push(String::new());
        render_view_nodes(
            kits,
            &view.hints,
            &view.view_id,
            &ctx,
            Some(cell_idx),
            // Top-level cell is auto-sized scaffolding, not a meaningful flex container -> None,
            // so a view's own fill/hug degrades to auto rather than stretching to nothing.
            None,
            &mut viewport_data,
            &mut node_view_ids,
            0,
            &view_map,
        );
    }

    // Views without a position hint keep flowing through the legacy auto-flow grid.
    if !flowing.is_empty() {
        const COLS: usize = 4;
        const GAP: f32 = 32.0;
        const PAD: f32 = 40.0;

        let root_idx = viewport_data.len();
        viewport_data.push(transparent_box(None, "Column", [PAD; 4]));
        node_view_ids.push(String::new());

        for row in flowing.chunks(COLS) {
            let row_idx = viewport_data.len();
            viewport_data.push(transparent_box(Some(root_idx), "Row", [0.0, 0.0, GAP, 0.0]));
            node_view_ids.push(String::new());

            for (view, kits, _) in row {
                let cell_idx = viewport_data.len();
                viewport_data.push(transparent_box(
                    Some(row_idx),
                    "Column",
                    [0.0, GAP, 0.0, 0.0],
                ));
                node_view_ids.push(String::new());

                render_view_nodes(
                    kits,
                    &view.hints,
                    &view.view_id,
                    &ctx,
                    Some(cell_idx),
                    // Auto-sized grid cell -> no meaningful flex parent (see positioned branch).
                    None,
                    &mut viewport_data,
                    &mut node_view_ids,
                    0,
                    &view_map,
                );
            }
        }
    }

    snap_text_weights(&mut viewport_data, &parsed.font_facts);

    (viewport_data, node_view_ids)
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
    } else {
        box_categories()
    }
}

// Build the Views panel manifest from the resolve graph. Every piece here is already computed
// elsewhere in this file — `collect_child_view_ids` (the per-view child list), the `referenced`
// set (which views are claimed as somebody's child — computed identically in `build_viewport`),
// `primitive_for_view` + `primitive_icon` (the icon), and the `children` property's `token_alias`
// (the write alias for DnD). This function just bundles them into a PanelManifest and ships them
// through `kit10_panel_publish` instead of leaving the editor to re-derive all four client-side
// (which it did, as `childrenByViewId`/`referencedViewIds`/`rootViews`/`childrenPropOf` in
// Views.svelte — all deleted in favor of this).
//
// `panel_id` is fixed to "views" today. A future plugin publishing a different panel would use a
// different id; the editor's panel renderer is generic over the manifest shape.
// The op set every panel item gets, regardless of primitive — operations that make sense for
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

// Ops only a container (Box primitive with a `children` field) gets — currently the
// "add child of kind X" trio. Gated on `write_alias.is_some()` so a Box that somehow has no
// `children` field (no kit declares it) doesn't get an "add child" affordance that would have
// nowhere to write.
fn container_item_ops() -> Vec<PanelOp> {
    vec![
        PanelOp {
            name: "add-child".to_string(),
            label: "Add Box".to_string(),
            icon: "fa-regular fa-window-maximize".to_string(),
            kind: Some("box".to_string()),
        },
        PanelOp {
            name: "add-child".to_string(),
            label: "Add Text".to_string(),
            icon: "fa-solid fa-italic".to_string(),
            kind: Some("text".to_string()),
        },
        PanelOp {
            name: "add-child".to_string(),
            label: "Add Image".to_string(),
            icon: "fa-solid fa-image".to_string(),
            kind: Some("image".to_string()),
        },
    ]
}

// Ops for the panel header's affordance menu (the "+" menu in the Views panel). Today this is
// the same "add a top-level view of kind X" trio — header ops aren't tied to a specific item, so
// they create top-level orphans (the editor's resolve loop will pick them up and the next
// manifest publish will mark them `is_root: true`).
fn views_header_ops() -> Vec<PanelOp> {
    vec![
        PanelOp {
            name: "add-child".to_string(),
            label: "Box".to_string(),
            icon: "fa-regular fa-window-maximize".to_string(),
            kind: Some("box".to_string()),
        },
        PanelOp {
            name: "add-child".to_string(),
            label: "Text".to_string(),
            icon: "fa-solid fa-italic".to_string(),
            kind: Some("text".to_string()),
        },
        PanelOp {
            name: "add-child".to_string(),
            label: "Image".to_string(),
            icon: "fa-solid fa-image".to_string(),
            kind: Some("image".to_string()),
        },
    ]
}

fn build_views_panel_manifest(parsed: &OnResolveInput) -> PanelManifest {
    let items = parsed
        .project_views
        .iter()
        .map(|view| {
            // The write alias is the token alias on this view's `children` property, if any kit
            // layer declares one. None when no kit declares children for this view (e.g. a Text
            // primitive) — the editor hides the DnD-nest affordance in that case. The alias
            // itself comes from the resolved property's `token_alias`, which is what the editor's
            // `api.upsertViewToken` already targets (see CLAUDE.md's View-token override
            // pitfalls); Charter only surfaces the value here, it doesn't invent or remap it.
            let write_alias = view.resolved_kits.iter().find_map(|k| {
                k.properties
                    .get(CHILDREN_FIELD)
                    .and_then(|p| p.token_alias.clone())
            });

            // Per-item op set: common ops always, container ops only when this item has a
            // `children` field (write_alias.is_some()). A Text/Image primitive gets the common
            // ops only — no "Add Box/Text/Image" sub-menu, since it has nowhere to attach them.
            let mut ops = common_item_ops();
            if write_alias.is_some() {
                // Prepend container ops so "Add Box/Text/Image" groups appear above the generic
                // rename/clone/lock/... — visual grouping the original hardcoded menu had.
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
        // The host walks `resolvedViews` for these keys to build the DAG itself — no
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

    let (viewport_data, node_view_ids) = build_viewport(&parsed);
    let viewport_data_binary = encode_viewport_data_binary(&viewport_data);
    let font_requests = collect_font_requests(&viewport_data);
    let result = OnResolveResult {
        categories: build_categories(&parsed),
        viewport_data,
        node_view_ids,
        font_requests,
        viewport_data_binary,
    };

    // Publish the Views panel manifest as a side effect of resolve. The topology is a pure
    // function of the resolve graph, so the manifest's lifecycle is coupled to resolve — but
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
            viewport_data_binary: None,
        })?);
    }

    let mut parsed: OnResolveInput = serde_json::from_slice(&last_bytes).unwrap_or_default();
    parsed.selected_view_primary = selection.primary;
    parsed.selected_view_secondary = selection.secondary;
    // Keep active_view_id in sync so the correct view gets its selection highlight.
    if selection.active_view_id.is_some() {
        parsed.active_view_id = selection.active_view_id;
    }
    parsed.hovered_view_id = selection.hovered_view_id;

    let (viewport_data, node_view_ids) = build_viewport(&parsed);
    let viewport_data_binary = encode_viewport_data_binary(&viewport_data);
    Ok(serde_json::to_string(&OnSelectionChangeResult {
        viewport_data,
        node_view_ids,
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
        let json = r##"{"primary":"v1","secondary":[],"activeViewId":"v1","hoveredViewId":"v2"}"##;
        let input: OnSelectionChangeInput = serde_json::from_str(json)
            .expect("should deserialize camelCase JSON sent by manager.svelte.ts");
        assert_eq!(input.primary.as_deref(), Some("v1"));
        assert_eq!(
            input.active_view_id.as_deref(),
            Some("v1"),
            "activeViewId must not silently become None"
        );
        assert_eq!(
            input.hovered_view_id.as_deref(),
            Some("v2"),
            "hoveredViewId must not silently become None"
        );
    }

    #[test]
    fn hovered_view_id_null_deserializes_to_none() {
        let json = r##"{"primary":null,"secondary":[],"activeViewId":null,"hoveredViewId":null}"##;
        let input: OnSelectionChangeInput = serde_json::from_str(json).unwrap();
        assert_eq!(input.hovered_view_id, None);
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
            selected_view_primary: None,
            selected_view_secondary: vec![],
            hovered_view_id: None,
            font_facts: Default::default(),
        };

        let (viewport, node_view_ids) = build_viewport(&input);
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
        if let UiNode::Box(UiBoxNode { box_data }) = &viewport[0] {
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
        p.view_refs = Some(ids);
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
            selected_view_primary: primary.map(str::to_string),
            selected_view_secondary: vec![],
            hovered_view_id: hovered.map(str::to_string),
            font_facts: Default::default(),
        }
    }

    #[test]
    fn text_primitive_view_gets_selected_marking() {
        let input = input(vec![text_view("t1")], Some("t1"), None);
        let (viewport, node_view_ids) = build_viewport(&input);

        let text_idx = node_view_ids
            .iter()
            .position(|id| id == "t1")
            .expect("t1 node present");
        let UiNode::Text(UiTextNode { text_data }) = &viewport[text_idx] else {
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
        let input = input(vec![parent, child], Some("child"), None);
        let (viewport, node_view_ids) = build_viewport(&input);

        let parent_idx = node_view_ids
            .iter()
            .position(|id| id == "parent")
            .expect("parent node present");
        let child_idx = node_view_ids
            .iter()
            .position(|id| id == "child")
            .expect("child node present");

        let UiNode::Box(UiBoxNode {
            box_data: parent_data,
        }) = &viewport[parent_idx]
        else {
            panic!("expected Box")
        };
        let UiNode::Box(UiBoxNode {
            box_data: child_data,
        }) = &viewport[child_idx]
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
        let input = input(vec![parent, child], Some("parent"), Some("child"));
        let (viewport, node_view_ids) = build_viewport(&input);

        let parent_idx = node_view_ids.iter().position(|id| id == "parent").unwrap();
        let child_idx = node_view_ids.iter().position(|id| id == "child").unwrap();

        let UiNode::Box(UiBoxNode {
            box_data: parent_data,
        }) = &viewport[parent_idx]
        else {
            panic!("expected Box")
        };
        let UiNode::Box(UiBoxNode {
            box_data: child_data,
        }) = &viewport[child_idx]
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
    fn node_view_ids_tags_nested_child_with_its_own_view_id_not_parents() {
        let parent = box_view("parent", vec!["child".to_string()]);
        let child = box_view("child", vec![]);
        let input = input(vec![parent, child], None, None);
        let (_viewport, node_view_ids) = build_viewport(&input);

        assert!(node_view_ids.contains(&"parent".to_string()));
        assert!(node_view_ids.contains(&"child".to_string()));
    }

    #[test]
    fn structural_grid_scaffolding_has_empty_view_id() {
        let input = input(vec![box_view("v1", vec![])], None, None);
        let (_viewport, node_view_ids) = build_viewport(&input);
        assert!(
            node_view_ids.contains(&String::new()),
            "root/row/cell wrapper boxes should be tagged as belonging to no view"
        );
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
        // composition_field_keys — generic graph walk that doesn't need to round-trip through
        // the plugin). Asserting they're absent guards against someone restoring the old shape.
        assert!(!json.contains("\"child_ids\""), "json was: {json}");
        assert!(!json.contains("\"is_root\""), "json was: {json}");
    }

    // build_views_panel_manifest carries `composition_field_keys` so the host can do the DAG
    // walk itself, instead of the manifest carrying pre-computed `child_ids`/`is_root` (which
    // Phase 1 did — shipping a generic graph computation across the WASM boundary just to dedupe
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
    // — the editor's context menu is built straight off this list, no editor-side hardcoded menu.
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

    // Header ops are populated — the "+" menu in the Views panel header renders straight off this
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
        p.view_refs = Some(ids);
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
            selected_view_primary: None,
            selected_view_secondary: vec![],
            hovered_view_id: None,
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
        let (viewport, node_view_ids) = build_viewport(&input(vec![parent, child]));

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
        let (viewport, node_view_ids) = build_viewport(&input(vec![parent, child]));

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
        let (_viewport, node_view_ids) = build_viewport(&input(vec![parent, child]));

        assert!(
            !node_view_ids.contains(&"child".to_string()),
            "a Text parent must never render a Box child"
        );
    }

    #[test]
    fn box_parent_still_recurses_into_a_box_child() {
        let parent = box_view("parent", vec!["child".to_string()]);
        let child = box_view("child", vec![]);
        let (viewport, node_view_ids) = build_viewport(&input(vec![parent, child]));

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
        let (_viewport, node_view_ids) = build_viewport(&input(vec![parent, child, orphan]));

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
        assert_eq!(parse_text_align(Some("center")), "Center");
        assert_eq!(parse_text_align(Some("right")), "Right");
        assert_eq!(parse_text_align(Some("justify")), "Justify");
        assert_eq!(parse_text_align(Some("left")), "Left");
        assert_eq!(parse_text_align(Some("garbage")), "Left");
        assert_eq!(parse_text_align(None), "Left");
    }

    #[test]
    fn parse_text_decoration_maps_known_keywords_and_defaults_to_none() {
        assert_eq!(parse_text_decoration(Some("underline")), "Underline");
        assert_eq!(parse_text_decoration(Some("line-through")), "LineThrough");
        assert_eq!(parse_text_decoration(Some("none")), "None");
        assert_eq!(parse_text_decoration(Some("garbage")), "None");
        assert_eq!(parse_text_decoration(None), "None");
    }

    #[test]
    fn build_text_node_reads_align_and_decoration_from_props() {
        let mut props: std::collections::HashMap<String, ResolvedProperty> = Default::default();
        props.insert("content".to_string(), prop("Hi"));
        props.insert("text-align".to_string(), prop("center"));
        props.insert("text-decoration".to_string(), prop("underline"));
        let node = build_text_node(&props, 0);
        let UiNode::Text(t) = node else { panic!("expected Text") };
        assert_eq!(t.text_data.text_align, "Center");
        assert_eq!(t.text_data.text_decoration, "Underline");
    }

    #[test]
    fn build_text_node_defaults_align_and_decoration_when_unset() {
        let mut props: std::collections::HashMap<String, ResolvedProperty> = Default::default();
        props.insert("content".to_string(), prop("Hi"));
        let node = build_text_node(&props, 0);
        let UiNode::Text(t) = node else { panic!("expected Text") };
        assert_eq!(t.text_data.text_align, "Left");
        assert_eq!(t.text_data.text_decoration, "None");
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
        props.insert("padding".to_string(), prop("8px"));

        let node = build_text_node(&props, 0);
        let UiNode::Text(UiTextNode { text_data }) = node else {
            panic!("expected a Text node");
        };
        assert_eq!(text_data.bg_color, [1.0, 0.0, 0.0, 1.0]);
        assert!(text_data.show_border);
        assert_eq!(text_data.border_color, [0.0, 1.0, 0.0, 1.0]);
        assert_eq!(text_data.corner_radius, 4.0);
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
        let UiNode::Text(UiTextNode { text_data }) = node else {
            panic!("expected a Text node");
        };
        assert_eq!(text_data.bg_color, [0.0; 4]);
        assert!(!text_data.show_border);
    }

    #[test]
    fn build_box_node_with_no_fill_is_fully_transparent_not_a_gray_placeholder() {
        // No `background` prop -> transparent, matching CSS (a <div> with no background is
        // transparent). Boxes used to fall back to opaque neutral-gray; that's gone.
        let props: std::collections::HashMap<String, ResolvedProperty> = Default::default();
        let node = build_box_node(&props, None, None);
        let UiNode::Box(UiBoxNode { box_data }) = node else {
            panic!("expected a Box node");
        };
        assert_eq!(
            box_data.bg_color, [0.0; 4],
            "unstyled box must be transparent"
        );
    }

    #[test]
    fn build_text_node_reads_font_weight_from_props() {
        let mut props: std::collections::HashMap<String, ResolvedProperty> = Default::default();
        props.insert("content".to_string(), prop("Hi"));
        props.insert("font-weight".to_string(), prop("600"));

        let node = build_text_node(&props, 0);
        let UiNode::Text(UiTextNode { text_data }) = node else {
            panic!("expected a Text node");
        };
        assert_eq!(text_data.font_weight, 600);
    }

    #[test]
    fn build_text_node_defaults_font_weight_to_400_when_unset() {
        let mut props: std::collections::HashMap<String, ResolvedProperty> = Default::default();
        props.insert("content".to_string(), prop("Hi"));

        let node = build_text_node(&props, 0);
        let UiNode::Text(UiTextNode { text_data }) = node else {
            panic!("expected a Text node");
        };
        assert_eq!(text_data.font_weight, 400);
    }

    #[test]
    fn encode_viewport_data_binary_roundtrips_through_base64_and_rmp_serde() {
        use super::{encode_viewport_data_binary, BoxData, UiBoxNode, UiNode};

        let data = vec![UiNode::Box(UiBoxNode {
            box_data: BoxData {
                parent_id: None,
                width: Extent::Auto,
                height: Extent::Auto,
                max_width: Extent::Auto,
                max_height: Extent::Auto,
                min_width: Extent::Auto,
                min_height: Extent::Auto,
                padding: [16.0; 4],
                bg_color: [0.9, 0.9, 0.9, 1.0],
                flex_direction: "Column".to_string(),
                show_border: true,
                border_color: [0.8, 0.8, 0.8, 1.0],
                border_width: 1.0,
                corner_radius: 8.0,
                opacity: 1.0,
                shadow: None,
                extra: Default::default(),
                selected: 0,
                hovered: false,
            },
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
        use super::{FieldCategory, OnResolveResult, OnSelectionChangeResult};

        let result = OnResolveResult {
            categories: vec![],
            viewport_data: vec![],
            node_view_ids: vec![],
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
        assert_eq!(img.img_data.fit, "contain");

        // Unknown/absent fit falls back to cover (vellum's own default).
        let mut p2: HashMap<String, ResolvedProperty> = HashMap::new();
        p2.insert("src".into(), prop("src", "logo"));
        p2.insert("fit".into(), prop("fit", "bogus"));
        let UiNode::Img(img2) = build_img_node(&p2, None) else {
            panic!("expected Img")
        };
        assert_eq!(img2.img_data.fit, "cover");
    }

    #[test]
    fn build_box_node_emits_percent_width_and_min_floor() {
        let mut props: HashMap<String, ResolvedProperty> = HashMap::new();
        props.insert("width".into(), prop("width", "50%"));
        props.insert("min-width".into(), prop("min-width", "80px"));
        let node = build_box_node(&props, None, None);
        let UiNode::Box(b) = node else {
            panic!("expected Box")
        };
        assert_eq!(b.box_data.width, Extent::Percent(0.5));
        assert_eq!(b.box_data.min_width, Extent::Px(80.0));
        // Charter never emits margin -- its opinion.
        assert_eq!(b.box_data.extra.margin, 0.0);
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
        let mut map: HashMap<String, ResolvedProperty> = HashMap::new();
        for (k, v) in props {
            map.insert((*k).to_string(), prop(k, v));
        }
        match build_box_node(&map, None, parent_main_horizontal) {
            UiNode::Box(b) => b.box_data,
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
        assert_eq!(t.text_data.font_weight, 700, "600 on Lato snaps to 700, key case-insensitive");

        // A family with no facts entry is untouched.
        props.insert("font-family".to_string(), prop("Mystery Serif"));
        let mut nodes2 = vec![build_text_node(&props, 0)];
        snap_text_weights(&mut nodes2, &facts_map);
        let UiNode::Text(t2) = &nodes2[0] else { panic!("expected Text") };
        assert_eq!(t2.text_data.font_weight, 600);
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
    // `fontFacts`), the OUTPUT is Charter-authored (snake_case key `font_requests`) — a test
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
        match build_box_node(&map, None, None) {
            UiNode::Box(b) => b.box_data,
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
        assert_eq!(d.flex_direction, "Column");
        assert_eq!(d.extra.align_items, None);
        assert_eq!(d.extra.justify_content, None);
    }

    #[test]
    fn stack_row_defaults_align_items_center_when_unset() {
        let d = box_with(&[("arrange", "stack"), ("flex-direction", "row")]);
        assert_eq!(d.flex_direction, "Row");
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
        assert_eq!(d.flex_direction, "Row");
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
        assert_eq!(d.flex_direction, "Row");
        assert_eq!(d.extra.justify_content, Some(JustifyValue::SpaceBetween));
        assert_eq!(d.extra.align_items, Some(AlignValue::Center));
    }

    #[test]
    fn split_axis_column_is_a_vertical_split() {
        let d = box_with(&[("arrange", "split"), ("flex-direction", "column")]);
        assert_eq!(d.flex_direction, "Column");
        assert_eq!(d.extra.justify_content, Some(JustifyValue::SpaceBetween));
    }

    #[test]
    fn center_defaults_justify_and_align_center_and_leaves_direction_untouched() {
        let d = box_with(&[("arrange", "center")]);
        // Center is axis-free -- no follow-on touches direction, so it falls through to the
        // plain absent-flex-direction default (Column), same as a fresh box.
        assert_eq!(d.flex_direction, "Column");
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
}
