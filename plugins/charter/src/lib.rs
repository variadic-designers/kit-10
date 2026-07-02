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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct FieldCategory {
    name: String,
    fields: Vec<FieldDef>,
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
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct ResolvedView {
    view_id: String,
    view_name: String,
    hints: std::collections::HashMap<String, serde_json::Value>,
    resolved_kits: Vec<ResolvedKit>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct OnResolveInput {
    active_view_id: Option<String>,
    resolved_kits: Vec<ResolvedKit>,
    view_hints: std::collections::HashMap<String, serde_json::Value>,
    all_views: Vec<ResolvedView>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct WriteRenderEntryInput {
    layer_id: String,
    property: String,
    #[serde(default)]
    value: Option<String>,
    #[serde(default)]
    token_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct WriteRenderEntryResult {
    success: bool,
    #[serde(default)]
    entry_id: Option<String>,
    #[serde(default)]
    error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct FieldUpdate {
    layer_id: String,
    property: String,
    #[serde(default)]
    value: Option<String>,
    #[serde(default)]
    token_id: Option<String>,
}

#[host_fn]
extern "ExtismHost" {
    pub fn kit10_write_render_entry_to_layer(input: u64) -> u64;
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

fn get_prop(
    props: &std::collections::HashMap<String, ResolvedProperty>,
    key: &str,
) -> Option<String> {
    props.get(key).map(|p| p.value.clone())
}

fn build_box_node(props: &std::collections::HashMap<String, ResolvedProperty>) -> UiNode {
    let bg = get_prop(props, "background").unwrap_or_default();
    let border = get_prop(props, "border").unwrap_or_default();
    let border_width = parse_px(get_prop(props, "border-width").as_deref());
    let radius = parse_px(get_prop(props, "border-radius").as_deref());
    let padding = parse_px(get_prop(props, "padding").as_deref());
    let width = parse_px(get_prop(props, "width").as_deref());
    let height = parse_px(get_prop(props, "height").as_deref());

    let has_border = !border.is_empty() && border != "none";

    UiNode::Box(UiBoxNode {
        box_data: BoxData {
            parent_id: None,
            width: if width > 0.0 { width } else { 200.0 },
            height: if height > 0.0 { height } else { 100.0 },
            max_width: 0.0,
            max_height: 0.0,
            padding: [padding; 4],
            bg_color: if !bg.is_empty() {
                parse_color(&bg)
            } else {
                [0.9, 0.9, 0.9, 1.0]
            },
            flex_direction: "Column".to_string(),
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
        },
    })
}

fn build_text_node(
    props: &std::collections::HashMap<String, ResolvedProperty>,
    parent: usize,
) -> UiNode {
    let color = get_prop(props, "color").unwrap_or_default();
    let font_size = parse_px(get_prop(props, "font-size").as_deref());
    let content = get_prop(props, "content").unwrap_or_else(|| "Text".to_string());

    UiNode::Text(UiTextNode {
        text_data: TextData {
            parent_id: Some(parent),
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

fn box_categories() -> Vec<FieldCategory> {
    vec![
        FieldCategory {
            name: "layout".to_string(),
            fields: vec![
                FieldDef {
                    key: "padding".to_string(),
                    display_text: Some("Padding".to_string()),
                },
                FieldDef {
                    key: "width".to_string(),
                    display_text: None,
                },
                FieldDef {
                    key: "height".to_string(),
                    display_text: None,
                },
            ],
        },
        FieldCategory {
            name: "box".to_string(),
            fields: vec![
                FieldDef {
                    key: "background".to_string(),
                    display_text: Some("Fill".to_string()),
                },
                FieldDef {
                    key: "border".to_string(),
                    display_text: None,
                },
                FieldDef {
                    key: "border-radius".to_string(),
                    display_text: Some("Radius".to_string()),
                },
                FieldDef {
                    key: "outline".to_string(),
                    display_text: None,
                },
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
        || props.contains_key("height");

    if has_text_props && !has_box_props {
        "text"
    } else {
        "box"
    }
}

#[plugin_fn]
pub fn on_init(_input: String) -> FnResult<String> {
    let mem = Memory::from_bytes("Charter plugin initialized")?;
    mem.log(LogLevel::Info);
    Ok("ok".to_string())
}

#[plugin_fn]
pub fn on_resolve(input: String) -> FnResult<String> {
    let parsed: OnResolveInput = if input.is_empty() {
        OnResolveInput::default()
    } else {
        serde_json::from_str(&input).unwrap_or_default()
    };

    let mut viewport_data: Vec<UiNode> = Vec::new();

    for view in &parsed.all_views {
        let merged: std::collections::HashMap<String, ResolvedProperty> = view
            .resolved_kits
            .iter()
            .flat_map(|k| k.properties.iter())
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect();

        if merged.is_empty() {
            continue;
        }

        let charter_hints: CharterHints = view
            .hints
            .get("charter")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default();

        let primitive = charter_hints
            .primitive
            .as_deref()
            .unwrap_or_else(|| detect_primitive(&merged));

        let is_active = parsed.active_view_id.as_deref() == Some(view.view_id.as_str());

        let pos = charter_hints.position.unwrap_or([0.0, 0.0]);

        let wrapper_idx = viewport_data.len();
        viewport_data.push(UiNode::Box(UiBoxNode {
            box_data: BoxData {
                parent_id: None,
                width: 240.0,
                height: 80.0,
                max_width: 0.0,
                max_height: 0.0,
                padding: [pos[1], pos[0], pos[1], pos[0]],
                bg_color: [0.0; 4],
                flex_direction: "Column".to_string(),
                show_border: false,
                border_color: [0.0; 4],
                border_width: 0.0,
                corner_radius: 0.0,
                opacity: 1.0,
                shadow: None,
            },
        }));

        if primitive == "text" {
            viewport_data.push(build_text_node(&merged, wrapper_idx));
        } else {
            let box_idx = viewport_data.len();
            let mut node = build_box_node(&merged);

            if is_active {
                if let UiNode::Box(UiBoxNode { box_data }) = &mut node {
                    box_data.border_color = [0.0, 0.48, 1.0, 1.0];
                    box_data.show_border = true;
                    box_data.border_width = 2.0;
                }
            }

            viewport_data.push(node);

            if merged.contains_key("color") || merged.contains_key("content") {
                viewport_data.push(build_text_node(&merged, box_idx));
            }
        }
    }

    let active_view = parsed
        .all_views
        .iter()
        .find(|v| parsed.active_view_id.as_deref() == Some(v.view_id.as_str()));

    let categories: Vec<FieldCategory> = if let Some(active) = active_view {
        let merged: std::collections::HashMap<String, ResolvedProperty> = active
            .resolved_kits
            .iter()
            .flat_map(|k| k.properties.iter())
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect();

        let charter_hints: CharterHints = active
            .hints
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
    } else {
        vec![]
    };

    let result = OnResolveResult {
        categories,
        viewport_data,
    };

    Ok(serde_json::to_string(&result).unwrap_or_default())
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

    let json = serde_json::to_string(&write_input).unwrap_or_default();
    let input_mem = Memory::from_bytes(&json)?;
    let result_offs = unsafe { kit10_write_render_entry_to_layer(input_mem.offset()) }?;

    let result_mem = Memory::find(result_offs).unwrap_or(Memory::null());
    let result: WriteRenderEntryResult =
        serde_json::from_slice(&result_mem.to_vec()).unwrap_or_default();

    Ok(serde_json::to_string(&result).unwrap_or_default())
}
