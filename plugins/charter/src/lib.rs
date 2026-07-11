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
    // "color" | "text" | "number" | "select" | "slider" | "font" -- how the editor should render
    // this field's input. None means the editor's default (plain text).
    #[serde(rename = "inputType", default)]
    input_type: Option<String>,
    // Names which utility plugin + functions serve suggestions for this field -- the editor
    // never hardcodes a specific plugin (e.g. Fontavious) or property key. See VISION.md's
    // 1st Principle: "no lock-in to a specific tool for a specific job."
    #[serde(rename = "suggestionsFrom", default)]
    suggestions_from: Option<SuggestionSource>,
}

impl FieldDef {
    fn new(key: &str, display_text: Option<&str>) -> Self {
        FieldDef {
            key: key.to_string(),
            display_text: display_text.map(str::to_string),
            input_type: None,
            suggestions_from: None,
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SuggestionSource {
    plugin: String,
    search_fn: String,
    #[serde(default)]
    fetch_fn: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct FieldCategory {
    name: String,
    fields: Vec<FieldDef>,
}

// Track/grid types mirror vellum's api.rs — serde output must match exactly.
#[derive(Debug, Clone, Serialize, Deserialize)]
enum TrackSize {
    Px(f32),
    Fr(f32),
    Auto,
    MinContent,
    MaxContent,
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

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
enum AlignValue {
    Start,
    End,
    FlexStart,
    FlexEnd,
    Center,
    Baseline,
    Stretch,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
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

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
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
    width: f32,
    height: f32,
    max_width: f32,
    max_height: f32,
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
    width: f32,
    height: f32,
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
    #[serde(default)]
    selected: u8,
    #[serde(default)]
    hovered: bool,
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
    width: f32,
    height: f32,
    source: ImageSource,
    cover: bool,
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
    // The property keys Charter treats as view-composition fields (its fields whose inputType is
    // the composition kind). VIEW-INDEPENDENT -- unlike `categories` (which reflects the active
    // view's primitive), this is the full, stable set across every primitive, so the editor can
    // nest the Views tree by field-kind no matter which view happens to be active. Charter owns
    // the "children means nest" opinion here; the resolver never does.
    composition_field_keys: Vec<String>,
    // Per view_id, the icon Charter wants that view shown with in the editor's Views tree. Charter
    // owns this the same way it owns primitive detection -- the editor stays agnostic: it never
    // learns a view's primitive ("box"/"text"), it just renders whatever icon string the plugin
    // hands back here. A view absent from the map (e.g. no resolved kits) falls back editor-side.
    view_icons: std::collections::HashMap<String, String>,
    // MessagePack-encoded Vec<UiNode>, base64-encoded for JSON transport. Present when the
    // viewport data is non-empty. The JS side decodes this and calls `vellum.set_data_binary()`
    // instead of JSON-stringifying viewport_data and calling `vellum.set_data()`. This avoids
    // the ~47ms JSON parse wall at 10k views on Vellum's side, plus the redundant
    // JSON.stringify on the JS side.
    #[serde(skip_serializing_if = "Option::is_none")]
    viewport_data_binary: Option<String>,
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
fn primitive_icon(primitive: &str) -> &'static str {
    match primitive {
        "text" => "fa-solid fa-italic",
        "image" => "fa-regular fa-image",
        _ => "fa-regular fa-window-maximize",
    }
}

// Charter's composition fields, across all primitives -- the fields it declares with the
// composition inputType. The editor reads these (view-independently) to know which resolved
// properties' view_refs to nest in the Views tree.
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

fn extract_paint_props(
    props: &std::collections::HashMap<String, ResolvedProperty>,
    default_bg: [f32; 4],
) -> PaintProps {
    let bg = get_prop(props, "background").unwrap_or_default();
    let border = get_prop(props, "border").unwrap_or_default();
    let border_width = parse_px(get_prop(props, "border-width").as_deref());
    let radius = parse_px(get_prop(props, "border-radius").as_deref());
    let padding = parse_px(get_prop(props, "padding").as_deref());
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
        padding: [padding; 4],
    }
}

fn build_box_node(
    props: &std::collections::HashMap<String, ResolvedProperty>,
    parent_id: Option<usize>,
) -> UiNode {
    let paint = extract_paint_props(props, [0.0; 4]);
    let width = parse_px(get_prop(props, "width").as_deref());
    let height = parse_px(get_prop(props, "height").as_deref());

    let flex_direction = match get_prop(props, "flex-direction").as_deref().unwrap_or("") {
        "row" => "Row",
        "row-reverse" => "RowReverse",
        "column-reverse" => "ColumnReverse",
        _ => "Column",
    }
    .to_string();

    let extra = BoxExtra {
        gap: parse_px(get_prop(props, "gap").as_deref()),
        align_items: parse_align(get_prop(props, "align-items").as_deref()),
        justify_content: parse_justify(get_prop(props, "justify-content").as_deref()),
        flex_wrap: parse_wrap(get_prop(props, "flex-wrap").as_deref()),
        flex_grow: get_prop(props, "flex-grow")
            .map(|s| parse_px(Some(&s)))
            .unwrap_or(0.0),
        flex_shrink: get_prop(props, "flex-shrink").map(|s| parse_px(Some(&s))),
        align_self: parse_align(get_prop(props, "align-self").as_deref()),
        margin: parse_px(get_prop(props, "margin").as_deref()),
        position: NodePosition::default(),
        grid_template_columns: get_prop(props, "grid-template-columns")
            .map(|s| parse_track_list(&s))
            .unwrap_or_default(),
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

    UiNode::Box(UiBoxNode {
        box_data: BoxData {
            parent_id,
            width,
            height,
            max_width: 0.0,
            max_height: 0.0,
            padding: paint.padding,
            bg_color: paint.bg_color,
            flex_direction,
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

fn build_text_node(
    props: &std::collections::HashMap<String, ResolvedProperty>,
    parent_id: usize,
) -> UiNode {
    let color = get_prop(props, "color").unwrap_or_default();
    let font_size = parse_px(get_prop(props, "font-size").as_deref());
    let font_weight = parse_px(get_prop(props, "font-weight").as_deref()) as u16;
    let content = get_prop(props, "content").unwrap_or_else(|| "Text".to_string());
    let font_family = get_prop(props, "font-family").unwrap_or_else(|| "sans-serif".to_string());
    // A text node with no declared fill stays fully transparent -- same default as a Box now
    // (both `[0.0; 4]`); no `background` means transparent, matching CSS.
    let paint = extract_paint_props(props, [0.0; 4]);

    UiNode::Text(UiTextNode {
        text_data: TextData {
            parent_id: Some(parent_id),
            width: 0.0,
            height: 0.0,
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
    let fit = get_prop(props, "fit")
        .as_deref()
        .unwrap_or("cover")
        .to_string();
    let cover = fit == "cover";
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
            width: parse_px(get_prop(props, "width").as_deref()),
            height: parse_px(get_prop(props, "height").as_deref()),
            source: if src.is_empty() {
                ImageSource::None
            } else {
                ImageSource::Ref(src)
            },
            cover,
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
        || props.contains_key("display")
        || props.contains_key("flex-direction")
        || props.contains_key("gap")
        || props.contains_key("grid-template-columns")
        || props.contains_key("grid-template-rows");

    if has_text_props && !has_box_props {
        "text"
    } else {
        "box"
    }
}

fn box_categories() -> Vec<FieldCategory> {
    vec![
        FieldCategory {
            name: "layout".to_string(),
            fields: vec![
                FieldDef::new("width", None),
                FieldDef::new("height", None),
                FieldDef::new("padding", Some("Padding")),
                FieldDef::new("flex-direction", Some("Direction")),
                FieldDef::new("gap", Some("Gap")),
                FieldDef::new("display", Some("Display")),
                FieldDef::new("grid-template-columns", Some("Columns")),
                FieldDef::new("grid-template-rows", Some("Rows")),
                FieldDef::new("grid-auto-columns", Some("Auto Cols")),
                FieldDef::new("grid-auto-rows", Some("Auto Rows")),
                FieldDef::new("grid-column", Some("Col Span")),
                FieldDef::new("grid-row", Some("Row Span")),
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
                FieldDef::new("font-weight", Some("Weight")),
                FieldDef::new("text-align", Some("Align")),
                FieldDef::new("text-decoration", Some("Decor")),
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
            width: 0.0,
            height: 0.0,
            max_width: 0.0,
            max_height: 0.0,
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
            width: 0.0,
            height: 0.0,
            max_width: 0.0,
            max_height: 0.0,
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
        let mut node = build_box_node(&merged, content_parent);

        if let UiNode::Box(UiBoxNode { box_data }) = &mut node {
            box_data.selected = selection;
            box_data.hovered = hovered;
        }

        viewport.push(node);
        node_view_ids.push(view_id.to_string());

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
                    &mut viewport_data,
                    &mut node_view_ids,
                    0,
                    &view_map,
                );
            }
        }
    }

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

#[plugin_fn]
pub fn on_resolve(input: String) -> FnResult<String> {
    let parsed: OnResolveInput = if input.is_empty() {
        OnResolveInput::default()
    } else {
        serde_json::from_str(&input).unwrap_or_default()
    };

    let _ = extism_pdk::var::set("last_resolve_input", input.as_str());

    let (viewport_data, node_view_ids) = build_viewport(&parsed);
    let view_icons = parsed
        .project_views
        .iter()
        .map(|v| {
            (
                v.view_id.clone(),
                primitive_icon(&primitive_for_view(v)).to_string(),
            )
        })
        .collect();
    let viewport_data_binary = encode_viewport_data_binary(&viewport_data);
    let result = OnResolveResult {
        categories: build_categories(&parsed),
        viewport_data,
        node_view_ids,
        composition_field_keys: composition_field_keys(),
        view_icons,
        viewport_data_binary,
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
    #[test]
    fn on_resolve_result_serializes_snake_case_keys() {
        let result = OnResolveResult {
            categories: vec![],
            viewport_data: vec![],
            node_view_ids: vec![],
            composition_field_keys: vec![],
            view_icons: std::collections::HashMap::new(),
            viewport_data_binary: None,
        };
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"viewport_data\""), "json was: {json}");
        assert!(json.contains("\"node_view_ids\""), "json was: {json}");
        assert!(
            json.contains("\"composition_field_keys\""),
            "json was: {json}"
        );
        assert!(json.contains("\"view_icons\""), "json was: {json}");
        assert!(!json.contains("\"viewportData\""), "json was: {json}");
        assert!(!json.contains("\"nodeViewIds\""), "json was: {json}");
        assert!(
            !json.contains("\"compositionFieldKeys\""),
            "json was: {json}"
        );
        assert!(!json.contains("\"viewIcons\""), "json was: {json}");
    }

    #[test]
    fn primitive_icon_maps_text_to_italic_and_box_to_window() {
        assert_eq!(primitive_icon("text"), "fa-solid fa-italic");
        assert_eq!(primitive_icon("box"), "fa-regular fa-window-maximize");
    }

    #[test]
    fn composition_field_keys_is_children_and_view_independent() {
        // Charter's only composition field is `children` (on Box). The set is stable regardless of
        // the active view's primitive -- that's what lets the editor nest by field-kind always.
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
        assert_eq!(text_data.width, 0.0);
        assert_eq!(text_data.height, 0.0);
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
        let node = build_box_node(&props, None);
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
                width: 0.0,
                height: 0.0,
                max_width: 0.0,
                max_height: 0.0,
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
            composition_field_keys: vec![],
            view_icons: std::collections::HashMap::new(),
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
