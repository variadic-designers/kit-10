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
    #[serde(default)]
    child_view_ids: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResolvedKit {
    kit_id: String,
    kit_name: String,
    properties: std::collections::HashMap<String, ResolvedProperty>,
    #[serde(default)]
    child_view_ids: Vec<String>,
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
    fn default() -> Self { GridLine::Auto }
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
    fn default() -> Self { FlexWrapValue::NoWrap }
}

// Mirrors vellum's api.rs — serde output must match exactly.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
enum NodePosition {
    Relative,
    Absolute { x: f32, y: f32 },
}

impl Default for NodePosition {
    fn default() -> Self { NodePosition::Relative }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct BoxExtra {
    #[serde(default)] gap: f32,
    #[serde(default)] align_items: Option<AlignValue>,
    #[serde(default)] justify_content: Option<JustifyValue>,
    #[serde(default)] flex_wrap: FlexWrapValue,
    #[serde(default)] flex_grow: f32,
    #[serde(default)] flex_shrink: Option<f32>,
    #[serde(default)] align_self: Option<AlignValue>,
    #[serde(default)] margin: f32,
    #[serde(default)] position: NodePosition,
    #[serde(default)] grid_template_columns: Vec<TrackSize>,
    #[serde(default)] grid_template_rows: Vec<TrackSize>,
    #[serde(default)] grid_auto_rows: Vec<TrackSize>,
    #[serde(default)] grid_auto_columns: Vec<TrackSize>,
    #[serde(default)] grid_column: (GridLine, GridLine),
    #[serde(default)] grid_row: (GridLine, GridLine),
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct OnResolveResult {
    categories: Vec<FieldCategory>,
    viewport_data: Vec<UiNode>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct CharterHints {
    primitive: Option<String>,
    #[serde(default)]
    child_only: bool,
}

// Hints consumed straight-through into Vellum's UiNode wire fields with no Charter-side
// interpretation, kept separate from CharterHints (which holds Charter's own translation
// choices — primitive override, child_only filtering).
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

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct OnSelectionChangeInput {
    primary: Option<String>,
    #[serde(default)]
    secondary: Vec<String>,
    // Host always sends this so active_view_id in last_resolve_input never goes stale.
    #[serde(default)]
    active_view_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct OnSelectionChangeResult {
    viewport_data: Vec<UiNode>,
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

fn collect_child_view_ids(kits: &[ResolvedKit]) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut ids = Vec::new();
    for kit in kits {
        for id in &kit.child_view_ids {
            if seen.insert(id.clone()) {
                ids.push(id.clone());
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
    if s == "auto" { return TrackSize::Auto; }
    if s == "min-content" { return TrackSize::MinContent; }
    if s == "max-content" { return TrackSize::MaxContent; }
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
    if s == "auto" || s.is_empty() { return GridLine::Auto; }
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
        "start"      => Some(AlignValue::Start),
        "end"        => Some(AlignValue::End),
        "flex-start" => Some(AlignValue::FlexStart),
        "flex-end"   => Some(AlignValue::FlexEnd),
        "center"     => Some(AlignValue::Center),
        "baseline"   => Some(AlignValue::Baseline),
        "stretch"    => Some(AlignValue::Stretch),
        _            => None,
    }
}

fn parse_justify(s: Option<&str>) -> Option<JustifyValue> {
    match s? {
        "start"         => Some(JustifyValue::Start),
        "end"           => Some(JustifyValue::End),
        "flex-start"    => Some(JustifyValue::FlexStart),
        "flex-end"      => Some(JustifyValue::FlexEnd),
        "center"        => Some(JustifyValue::Center),
        "stretch"       => Some(JustifyValue::Stretch),
        "space-between" => Some(JustifyValue::SpaceBetween),
        "space-evenly"  => Some(JustifyValue::SpaceEvenly),
        "space-around"  => Some(JustifyValue::SpaceAround),
        _               => None,
    }
}

fn parse_wrap(s: Option<&str>) -> FlexWrapValue {
    match s {
        Some("wrap")         => FlexWrapValue::Wrap,
        Some("wrap-reverse") => FlexWrapValue::WrapReverse,
        _                    => FlexWrapValue::NoWrap,
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
// build_box_node and build_text_node read them the same way. `default_bg` differs: a box with no
// declared fill still reads as a visible neutral placeholder box in the editor; a text node with
// no declared fill should stay fully transparent (it's not a container by default).
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
        bg_color: if !bg.is_empty() { parse_color(&bg) } else { default_bg },
        show_border: has_border,
        border_color: if has_border { parse_color(&border) } else { [0.0; 4] },
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
    let paint = extract_paint_props(props, [0.9, 0.9, 0.9, 1.0]);
    let width = parse_px(get_prop(props, "width").as_deref());
    let height = parse_px(get_prop(props, "height").as_deref());

    let flex_direction = match get_prop(props, "flex-direction").as_deref().unwrap_or("") {
        "row"            => "Row",
        "row-reverse"    => "RowReverse",
        "column-reverse" => "ColumnReverse",
        _                => "Column",
    }.to_string();

    let extra = BoxExtra {
        gap: parse_px(get_prop(props, "gap").as_deref()),
        align_items: parse_align(get_prop(props, "align-items").as_deref()),
        justify_content: parse_justify(get_prop(props, "justify-content").as_deref()),
        flex_wrap: parse_wrap(get_prop(props, "flex-wrap").as_deref()),
        flex_grow: get_prop(props, "flex-grow")
            .map(|s| parse_px(Some(&s))).unwrap_or(0.0),
        flex_shrink: get_prop(props, "flex-shrink")
            .map(|s| parse_px(Some(&s))),
        align_self: parse_align(get_prop(props, "align-self").as_deref()),
        margin: parse_px(get_prop(props, "margin").as_deref()),
        position: NodePosition::default(),
        grid_template_columns: get_prop(props, "grid-template-columns")
            .map(|s| parse_track_list(&s)).unwrap_or_default(),
        grid_template_rows: get_prop(props, "grid-template-rows")
            .map(|s| parse_track_list(&s)).unwrap_or_default(),
        grid_auto_rows: get_prop(props, "grid-auto-rows")
            .map(|s| parse_track_list(&s)).unwrap_or_default(),
        grid_auto_columns: get_prop(props, "grid-auto-columns")
            .map(|s| parse_track_list(&s)).unwrap_or_default(),
        grid_column: get_prop(props, "grid-column")
            .map(|s| parse_grid_line_pair(&s)).unwrap_or_default(),
        grid_row: get_prop(props, "grid-row")
            .map(|s| parse_grid_line_pair(&s)).unwrap_or_default(),
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
    // A text node with no declared fill stays fully transparent -- unlike a Box, it isn't a
    // container by default, so there's no "neutral placeholder" to fall back to.
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
        },
    })
}

fn detect_primitive(props: &std::collections::HashMap<String, ResolvedProperty>) -> &'static str {
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
    ]
}

fn text_categories() -> Vec<FieldCategory> {
    vec![
        FieldCategory {
            name: "text".to_string(),
            fields: vec![
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

fn transparent_box(
    parent_id: Option<usize>,
    flex_direction: &str,
    padding: [f32; 4],
) -> UiNode {
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
                position: NodePosition::Absolute { x: pos[0], y: pos[1] },
                ..BoxExtra::default()
            },
            selected: 0,
        },
    })
}

// Render a view's nodes into the flat viewport buffer.
// parent_id: the parent box index (grid cell for top-level, box idx for children).
// depth guard prevents runaway recursion from circular view references.
fn render_view_nodes(
    kits: &[ResolvedKit],
    hints: &std::collections::HashMap<String, serde_json::Value>,
    // 0 = none, 1 = secondary selection, 2 = primary / active
    selection: u8,
    parent_id: Option<usize>,
    viewport: &mut Vec<UiNode>,
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

    if primitive == "text" {
        viewport.push(build_text_node(&merged, content_parent.unwrap_or(0)));
    } else {
        let box_idx = viewport.len();
        let mut node = build_box_node(&merged, content_parent);

        if let UiNode::Box(UiBoxNode { box_data }) = &mut node {
            box_data.selected = selection;
        }

        viewport.push(node);

        let child_ids = collect_child_view_ids(kits);

        if child_ids.is_empty() {
            // Only add inline text when the kit explicitly defines content.
            // Checking `color` alone would fire for any box kit that sets a text color
            // (e.g. Button) and produce a spurious "Text" placeholder node.
            if merged.contains_key("content") {
                viewport.push(build_text_node(&merged, box_idx));
            }
        } else {
            for child_view_id in &child_ids {
                if let Some(child_view) = view_map.get(child_view_id) {
                    render_view_nodes(
                        &child_view.resolved_kits,
                        &child_view.hints,
                        0,
                        Some(box_idx),
                        viewport,
                        depth + 1,
                        view_map,
                    );
                }
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

fn build_viewport(parsed: &OnResolveInput) -> Vec<UiNode> {
    let mut viewport_data: Vec<UiNode> = Vec::new();

    let view_map: std::collections::HashMap<String, &ViewMeta> = parsed.project_views
        .iter()
        .map(|v| (v.view_id.clone(), v))
        .collect();

    let top_views: Vec<(&ViewMeta, &Vec<ResolvedKit>, u8, Option<[f32; 2]>)> = parsed.project_views
        .iter()
        .filter_map(|view| {
            let hints: CharterHints = view.hints.get("charter")
                .and_then(|v| serde_json::from_value(v.clone()).ok())
                .unwrap_or_default();
            if hints.child_only {
                return None;
            }
            let kits: &Vec<ResolvedKit> = &view.resolved_kits;
            if kits.is_empty() {
                return None;
            }
            let is_active = parsed.active_view_id.as_deref() == Some(view.view_id.as_str());
            let is_primary = parsed.selected_view_primary.as_deref() == Some(view.view_id.as_str());
            let is_secondary = parsed.selected_view_secondary.iter().any(|id| id == &view.view_id);
            let sel: u8 = if is_active || is_primary { 2 } else if is_secondary { 1 } else { 0 };
            let vellum_hints: VellumHints = view.hints.get("vellum")
                .and_then(|v| serde_json::from_value(v.clone()).ok())
                .unwrap_or_default();
            Some((view, kits, sel, vellum_hints.position))
        })
        .collect();

    // Views with an explicit world position float independently, each as its own root —
    // no shared flex parent to couple their placement to a sibling's content size.
    let (positioned, flowing): (Vec<_>, Vec<_>) =
        top_views.into_iter().partition(|(_, _, _, pos)| pos.is_some());

    for (view, kits, sel, pos) in &positioned {
        let cell_idx = viewport_data.len();
        viewport_data.push(absolute_box("Column", pos.unwrap()));
        render_view_nodes(kits, &view.hints, *sel, Some(cell_idx), &mut viewport_data, 0, &view_map);
    }

    // Views without a position hint keep flowing through the legacy auto-flow grid.
    if !flowing.is_empty() {
        const COLS: usize = 4;
        const GAP: f32 = 32.0;
        const PAD: f32 = 40.0;

        let root_idx = viewport_data.len();
        viewport_data.push(transparent_box(None, "Column", [PAD; 4]));

        for row in flowing.chunks(COLS) {
            let row_idx = viewport_data.len();
            viewport_data.push(transparent_box(Some(root_idx), "Row", [0.0, 0.0, GAP, 0.0]));

            for (view, kits, sel, _) in row {
                let cell_idx = viewport_data.len();
                viewport_data.push(transparent_box(Some(row_idx), "Column", [0.0, GAP, 0.0, 0.0]));

                render_view_nodes(
                    kits,
                    &view.hints,
                    *sel,
                    Some(cell_idx),
                    &mut viewport_data,
                    0,
                    &view_map,
                );
            }
        }
    }

    viewport_data
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

    let result = OnResolveResult {
        categories: build_categories(&parsed),
        viewport_data: build_viewport(&parsed),
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
        return Ok(serde_json::to_string(&OnSelectionChangeResult { viewport_data: vec![] })?);
    }

    let mut parsed: OnResolveInput = serde_json::from_slice(&last_bytes).unwrap_or_default();
    parsed.selected_view_primary = selection.primary;
    parsed.selected_view_secondary = selection.secondary;
    // Keep active_view_id in sync so the correct view gets its selection highlight.
    if selection.active_view_id.is_some() {
        parsed.active_view_id = selection.active_view_id;
    }

    Ok(serde_json::to_string(&OnSelectionChangeResult {
        viewport_data: build_viewport(&parsed),
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
        let json = r##"{"layerId":"layer-123","property":"color","value":"#ff0000","tokenId":null}"##;
        let update: FieldUpdate = serde_json::from_str(json).expect("should deserialize camelCase JSON sent by StyleField.svelte");
        assert_eq!(update.layer_id, "layer-123");
        assert_eq!(update.property, "color");
        assert_eq!(update.value.as_deref(), Some("#ff0000"));
        assert_eq!(update.token_id, None);
    }
}

#[cfg(test)]
mod position_wire_tests {
    use super::*;

    #[test]
    fn absolute_position_serializes_as_expected() {
        let extra = BoxExtra { position: NodePosition::Absolute { x: 500.0, y: 400.0 }, ..BoxExtra::default() };
        let json = serde_json::to_string(&extra).unwrap();
        println!("BoxExtra JSON: {}", json);
        assert!(json.contains(r#""position":{"Absolute":{"x":500.0,"y":400.0}}"#), "json was: {}", json);
    }

    #[test]
    fn build_viewport_places_positioned_view_as_independent_root() {
        let mut hints = std::collections::HashMap::new();
        hints.insert("vellum".to_string(), serde_json::json!({ "position": [500.0, 400.0] }));

        let view = ViewMeta {
            view_id: "v1".to_string(),
            view_name: "View 1".to_string(),
            hints,
            resolved_kits: vec![ResolvedKit {
                kit_id: "k1".to_string(),
                kit_name: "Kit".to_string(),
                properties: {
                    let mut m = std::collections::HashMap::new();
                    m.insert("background".to_string(), ResolvedProperty {
                        property: "background".to_string(),
                        value: "#ff0000".to_string(),
                        source_layer_id: "l1".to_string(),
                        kit_id: "k1".to_string(),
                        is_token: false,
                        token_alias: None,
                        condition_count: 0,
                        child_view_ids: None,
                    });
                    m
                },
                child_view_ids: vec![],
            }],
        };

        let input = OnResolveInput {
            active_view_id: None,
            resolved_kits: vec![],
            view_hints: std::collections::HashMap::new(),
            project_views: vec![view],
            selected_view_primary: None,
            selected_view_secondary: vec![],
        };

        let viewport = build_viewport(&input);
        println!("viewport JSON: {}", serde_json::to_string_pretty(&viewport).unwrap());
        assert_eq!(viewport.len(), 2, "expected the positioned root cell + its one content box");
        if let UiNode::Box(UiBoxNode { box_data }) = &viewport[0] {
            assert_eq!(box_data.parent_id, None);
            assert_eq!(box_data.extra.position, NodePosition::Absolute { x: 500.0, y: 400.0 });
        } else {
            panic!("expected a Box node");
        }
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
            child_view_ids: None,
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

        for key in ["width", "height", "display", "flex-direction", "gap", "grid-template-columns"] {
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
}
