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
    position: Option<[f32; 2]>,
    #[serde(default)]
    child_only: bool,
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

fn build_box_node(
    props: &std::collections::HashMap<String, ResolvedProperty>,
    parent_id: Option<usize>,
) -> UiNode {
    let bg = get_prop(props, "background").unwrap_or_default();
    let border = get_prop(props, "border").unwrap_or_default();
    let border_width = parse_px(get_prop(props, "border-width").as_deref());
    let radius = parse_px(get_prop(props, "border-radius").as_deref());
    let padding = parse_px(get_prop(props, "padding").as_deref());
    let width = parse_px(get_prop(props, "width").as_deref());
    let height = parse_px(get_prop(props, "height").as_deref());

    let has_border = !border.is_empty() && border != "none";

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
            padding: [padding; 4],
            bg_color: if !bg.is_empty() {
                parse_color(&bg)
            } else {
                [0.9, 0.9, 0.9, 1.0]
            },
            flex_direction,
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
    let content = get_prop(props, "content").unwrap_or_else(|| "Text".to_string());

    UiNode::Text(UiTextNode {
        text_data: TextData {
            parent_id: Some(parent_id),
            width: 0.0,
            height: 0.0,
            padding: [0.0; 4],
            bg_color: [0.0; 4],
            show_border: false,
            border_color: [0.0; 4],
            border_width: 0.0,
            corner_radius: 0.0,
            opacity: 1.0,
            content,
            font_size: if font_size > 0.0 { font_size } else { 16.0 },
            font_family: "sans-serif".to_string(),
            font_weight: 400,
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

    let has_box_props = props.contains_key("background")
        || props.contains_key("border")
        || props.contains_key("border-radius")
        || props.contains_key("padding")
        || props.contains_key("width")
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
                FieldDef { key: "width".to_string(), display_text: None },
                FieldDef { key: "height".to_string(), display_text: None },
                FieldDef { key: "padding".to_string(), display_text: Some("Padding".to_string()) },
                FieldDef { key: "flex-direction".to_string(), display_text: Some("Direction".to_string()) },
                FieldDef { key: "gap".to_string(), display_text: Some("Gap".to_string()) },
                FieldDef { key: "display".to_string(), display_text: Some("Display".to_string()) },
                FieldDef { key: "grid-template-columns".to_string(), display_text: Some("Columns".to_string()) },
                FieldDef { key: "grid-template-rows".to_string(), display_text: Some("Rows".to_string()) },
                FieldDef { key: "grid-auto-columns".to_string(), display_text: Some("Auto Cols".to_string()) },
                FieldDef { key: "grid-auto-rows".to_string(), display_text: Some("Auto Rows".to_string()) },
                FieldDef { key: "grid-column".to_string(), display_text: Some("Col Span".to_string()) },
                FieldDef { key: "grid-row".to_string(), display_text: Some("Row Span".to_string()) },
            ],
        },
        FieldCategory {
            name: "box".to_string(),
            fields: vec![
                FieldDef { key: "background".to_string(), display_text: Some("Fill".to_string()) },
                FieldDef { key: "border".to_string(), display_text: None },
                FieldDef { key: "border-radius".to_string(), display_text: Some("Radius".to_string()) },
                FieldDef { key: "outline".to_string(), display_text: None },
            ],
        },
    ]
}

fn text_categories() -> Vec<FieldCategory> {
    vec![FieldCategory {
        name: "text".to_string(),
        fields: vec![
            FieldDef {
                key: "color".to_string(),
                display_text: Some("Fill".to_string()),
            },
            FieldDef {
                key: "font-size".to_string(),
                display_text: Some("Size".to_string()),
            },
            FieldDef {
                key: "font-weight".to_string(),
                display_text: Some("Weight".to_string()),
            },
            FieldDef {
                key: "text-align".to_string(),
                display_text: Some("Align".to_string()),
            },
            FieldDef {
                key: "text-decoration".to_string(),
                display_text: Some("Decor".to_string()),
            },
        ],
    }]
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

    let top_views: Vec<(&ViewMeta, &Vec<ResolvedKit>, u8)> = parsed.project_views
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
            Some((view, kits, sel))
        })
        .collect();

    if !top_views.is_empty() {
        const COLS: usize = 4;
        const GAP: f32 = 32.0;
        const PAD: f32 = 40.0;

        let root_idx = viewport_data.len();
        viewport_data.push(transparent_box(None, "Column", [PAD; 4]));

        for row in top_views.chunks(COLS) {
            let row_idx = viewport_data.len();
            viewport_data.push(transparent_box(Some(root_idx), "Row", [0.0, 0.0, GAP, 0.0]));

            for (view, kits, sel) in row {
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
