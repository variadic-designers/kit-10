use extism_pdk::*;
use kit10_scene::{Extent, FlexDir, FontStyle, OklabColor, TextAlign, TextDecorationKind, UiNode};
use serde::Deserialize;
use std::collections::{HashMap, HashSet};

// kit10_get_interpreter_output ignores its input and always returns a plain JSON string (not an
// #[encoding(Json)]-tagged struct) -- verified against its actual JS implementation
// (manager.svelte.ts's makeHostFunctions). Declared the same plain-String-in/out shape as
// Fontavious's kit10_kv_get, not Tenner's typed-struct kit10_get_project_export.
#[host_fn]
extern "ExtismHost" {
    fn kit10_get_interpreter_output(_unused: String) -> String;
}

// Mirrors interpreter-output.ts's discriminated union, but flattened -- serde's tagged-enum
// machinery doesn't fit a boolean discriminant cleanly, and categories/font_requests aren't
// needed for HTML/CSS translation, so they're simply not declared here (unknown JSON fields are
// ignored by default, same posture as Tenner's ExportProjectInput).
#[derive(Debug, Clone, Deserialize, Default)]
struct InterpreterOutput {
    available: bool,
    #[serde(default)]
    viewport_data: Vec<UiNode>,
    // Parallel to viewport_data -- node_view_ids[i] is the view id that node belongs to ("" for
    // structural grid scaffolding that isn't a view at all). Used to resolve which nodes a
    // view_ids selection actually refers to (see resolve_export_roots).
    #[serde(default)]
    node_view_ids: Vec<String>,
    #[serde(default)]
    reason: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
struct ExportInput {
    #[serde(default)]
    #[allow(dead_code)]
    project_id: String,
    // Which views to export. Empty means "export nothing" -- there is no hidden fallback to
    // "everything" when this is empty, the checkbox state in the Export panel literally
    // determines the output. Selecting every view (the panel's default) reproduces the same
    // output as an unfiltered export -- see resolve_export_roots's doc comment for why.
    #[serde(default)]
    view_ids: Vec<String>,
}

#[plugin_fn]
pub fn on_init(_input: String) -> FnResult<String> {
    Ok("ok".to_string())
}

/// Translates Charter's resolved UiNode tree (fetched via kit10_get_interpreter_output, the
/// public host function any plugin declaring `supports: ["charter"]` can request) into a single
/// HTML document with its CSS inlined in a `<style>` block, rather than a separate stylesheet --
/// simpler for now than the multiFile envelope's two-file download (see download.ts's known
/// rapid-successive-download browser quirk). Splitting CSS back out into its own linked file is a
/// natural follow-up once that's worth the multi-file plumbing again.
///
/// v1 scope, deliberate: Box (layout/color) and Text (content/fonts) nodes only -- Img is
/// skipped entirely.
#[plugin_fn]
pub fn export_html_css(input: String) -> FnResult<String> {
    let req: ExportInput = serde_json::from_str(&input).unwrap_or_default();

    let raw = unsafe { kit10_get_interpreter_output(String::new())? };
    let output: InterpreterOutput = serde_json::from_str(&raw)?;
    if !output.available {
        return Err(Error::msg(format!(
            "interpreter output unavailable: {}",
            output.reason.unwrap_or_default()
        ))
        .into());
    }

    let children = build_children_map(&output.viewport_data);
    let roots = resolve_export_roots(&output.viewport_data, &output.node_view_ids, &req.view_ids);
    let included = collect_descendants(&children, &roots);

    let css = render_css(&output.viewport_data, &included);
    let html = render_html(&output.viewport_data, &children, &roots, &css);

    Ok(html)
}

// -- translation --------------------------------------------------------------------------

fn class_name(index: usize) -> String {
    format!("k10-{index}")
}

fn escape_html(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

// OklabColor's fields map directly onto CSS Color 4's oklab() function -- L as a percentage
// (matching this codebase's own convention, e.g. manager.svelte.ts's log-color comments), a/b as
// plain numbers, no gamut conversion needed since the browser interprets oklab() natively.
fn oklab_css(c: &OklabColor) -> String {
    format!("oklab({}% {} {} / {})", c.l * 100.0, c.a, c.b, c.alpha)
}

fn extent_css(e: &Extent) -> Option<String> {
    match e {
        Extent::Auto => None,
        Extent::Px(n) => Some(format!("{n}px")),
        Extent::Percent(n) => Some(format!("{}%", n * 100.0)),
    }
}

fn flex_dir_css(d: &FlexDir) -> &'static str {
    match d {
        FlexDir::Row => "row",
        FlexDir::Column => "column",
        FlexDir::RowReverse => "row-reverse",
        FlexDir::ColumnReverse => "column-reverse",
    }
}

fn text_align_css(a: &TextAlign) -> &'static str {
    match a {
        TextAlign::Left => "left",
        TextAlign::Center => "center",
        TextAlign::Right => "right",
        TextAlign::Justify => "justify",
    }
}

fn text_decoration_css(d: &TextDecorationKind) -> &'static str {
    match d {
        TextDecorationKind::None => "none",
        TextDecorationKind::Underline => "underline",
        TextDecorationKind::LineThrough => "line-through",
    }
}

fn font_style_css(s: &FontStyle) -> &'static str {
    match s {
        FontStyle::Normal => "normal",
        FontStyle::Italic => "italic",
        FontStyle::Oblique => "oblique",
    }
}

fn parent_of(node: &UiNode) -> Option<usize> {
    match node {
        UiNode::Box(d) => d.parent_id,
        UiNode::Text(d) => d.parent_id,
        UiNode::Img(d) => d.parent_id,
    }
}

// children[i] = indices whose parent_id == Some(i).
fn build_children_map(nodes: &[UiNode]) -> HashMap<usize, Vec<usize>> {
    let mut children: HashMap<usize, Vec<usize>> = HashMap::new();
    for (i, node) in nodes.iter().enumerate() {
        if let Some(p) = parent_of(node) {
            children.entry(p).or_default().push(i);
        }
    }
    children
}

// Every view (top-level or nested as a child via composition) gets exactly one entry in
// node_view_ids tagged with its own view id (verified against Charter's render_view_nodes,
// plugins/charter/src/lib.rs) -- a nested view's parent_id points directly at its containing
// view's own node, while a top-level view's parent_id chain only ever passes through structural
// grid scaffolding (tagged ""), never another view. So: a selected view only becomes an
// independent export root if no ancestor (walking parent_id) is ALSO a selected view's node --
// otherwise it's already going to render as part of that ancestor's subtree, and treating it as
// a second root would duplicate it. Selecting every view (the Export panel's default) therefore
// reproduces exactly the same output as an unfiltered export: every nested view's parent is also
// selected, so nested views are correctly excluded as independent roots.
fn resolve_export_roots(
    nodes: &[UiNode],
    node_view_ids: &[String],
    selected_view_ids: &[String],
) -> Vec<usize> {
    let is_selected = |i: usize| -> bool {
        node_view_ids
            .get(i)
            .map(|v| !v.is_empty() && selected_view_ids.contains(v))
            .unwrap_or(false)
    };

    let candidates: HashSet<usize> = (0..nodes.len()).filter(|&i| is_selected(i)).collect();

    // Collected in ascending index order (not HashSet iteration order, which is unspecified) so
    // the exported HTML/CSS has a stable, deterministic node ordering run to run -- and so
    // selecting every view reproduces bit-for-bit the same output as an unfiltered export.
    let mut roots: Vec<usize> = candidates
        .iter()
        .copied()
        .filter(|&c| {
            let mut cur = parent_of(&nodes[c]);
            while let Some(p) = cur {
                if candidates.contains(&p) {
                    return false;
                }
                cur = parent_of(&nodes[p]);
            }
            true
        })
        .collect();
    roots.sort_unstable();
    roots
}

// BFS over the children map from the resolved roots, so render_css only emits rules for nodes
// actually reachable from an included root -- not the whole project's tree.
fn collect_descendants(children: &HashMap<usize, Vec<usize>>, roots: &[usize]) -> HashSet<usize> {
    let mut included = HashSet::new();
    let mut stack: Vec<usize> = roots.to_vec();
    while let Some(i) = stack.pop() {
        if !included.insert(i) {
            continue;
        }
        if let Some(kids) = children.get(&i) {
            stack.extend(kids.iter().copied());
        }
    }
    included
}

fn render_html(
    nodes: &[UiNode],
    children: &HashMap<usize, Vec<usize>>,
    roots: &[usize],
    css: &str,
) -> String {
    let mut body = String::new();
    for &i in roots {
        render_html_node(nodes, children, i, &mut body);
    }
    format!(
        "<!doctype html>\n<html>\n<head>\n<meta charset=\"utf-8\">\n<style>\n{css}</style>\n</head>\n<body>\n{body}</body>\n</html>\n"
    )
}

fn render_html_node(
    nodes: &[UiNode],
    children: &HashMap<usize, Vec<usize>>,
    i: usize,
    out: &mut String,
) {
    let class = class_name(i);
    match &nodes[i] {
        UiNode::Text(d) => {
            out.push_str(&format!("<p class=\"{class}\">{}</p>\n", escape_html(&d.content)));
        }
        UiNode::Box(_) => {
            out.push_str(&format!("<div class=\"{class}\">\n"));
            if let Some(kids) = children.get(&i) {
                for &k in kids {
                    render_html_node(nodes, children, k, out);
                }
            }
            out.push_str("</div>\n");
        }
        // Img nodes are out of scope for v1 -- emitting nothing rather than a broken <img> with
        // no real src (ImageSource::Bytes/Ref both need decisions -- data URI vs. asset
        // pipeline -- deferred).
        UiNode::Img(_) => {}
    }
}

fn render_css(nodes: &[UiNode], included: &HashSet<usize>) -> String {
    let mut out = String::new();
    for (i, node) in nodes.iter().enumerate() {
        if !included.contains(&i) {
            continue;
        }
        let class = class_name(i);
        let mut props: Vec<String> = Vec::new();
        match node {
            UiNode::Box(d) => {
                if let Some(w) = extent_css(&d.width) {
                    props.push(format!("width: {w};"));
                }
                if let Some(h) = extent_css(&d.height) {
                    props.push(format!("height: {h};"));
                }
                props.push(format!(
                    "padding: {}px {}px {}px {}px;",
                    d.padding[0], d.padding[1], d.padding[2], d.padding[3]
                ));
                props.push(format!("background: {};", oklab_css(&d.bg_color)));
                props.push("display: flex;".to_string());
                props.push(format!("flex-direction: {};", flex_dir_css(&d.flex_direction)));
                if d.show_border {
                    props.push(format!(
                        "border: {}px solid {};",
                        d.border_width,
                        oklab_css(&d.border_color)
                    ));
                }
                if d.corner_radius > 0.0 {
                    props.push(format!("border-radius: {}px;", d.corner_radius));
                }
                if d.opacity < 1.0 {
                    props.push(format!("opacity: {};", d.opacity));
                }
                if d.extra.gap > 0.0 {
                    props.push(format!("gap: {}px;", d.extra.gap));
                }
            }
            UiNode::Text(d) => {
                if let Some(w) = extent_css(&d.width) {
                    props.push(format!("width: {w};"));
                }
                props.push(format!("color: {};", oklab_css(&d.text_color)));
                props.push(format!("font-family: \"{}\";", d.font_family));
                props.push(format!("font-size: {}px;", d.font_size));
                props.push(format!("font-weight: {};", d.font_weight));
                props.push(format!("font-style: {};", font_style_css(&d.font_style)));
                props.push(format!("text-align: {};", text_align_css(&d.text_align)));
                let decoration = text_decoration_css(&d.text_decoration);
                if decoration != "none" {
                    props.push(format!("text-decoration: {decoration};"));
                }
                if d.line_height > 0.0 {
                    props.push(format!("line-height: {}px;", d.line_height));
                }
            }
            UiNode::Img(_) => continue,
        }
        if !props.is_empty() {
            out.push_str(&format!(".{class} {{\n  {}\n}}\n", props.join("\n  ")));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use kit10_scene::{BoxData, BoxExtra, TextData};

    fn test_box(parent_id: Option<usize>) -> BoxData {
        BoxData {
            parent_id,
            width: Extent::Px(200.0),
            height: Extent::Auto,
            min_width: Extent::Auto,
            min_height: Extent::Auto,
            max_width: Extent::Auto,
            max_height: Extent::Auto,
            padding: [8.0, 8.0, 8.0, 8.0],
            bg_color: OklabColor { l: 0.9, a: 0.0, b: 0.0, alpha: 1.0 },
            flex_direction: FlexDir::Column,
            show_border: false,
            border_color: OklabColor { l: 0.0, a: 0.0, b: 0.0, alpha: 0.0 },
            border_width: 0.0,
            corner_radius: 0.0,
            opacity: 1.0,
            shadow: None,
            extra: BoxExtra::default(),
            selected: 0,
            hovered: false,
        }
    }

    fn test_text(parent_id: Option<usize>, content: &str) -> TextData {
        TextData {
            parent_id,
            width: Extent::Auto,
            height: Extent::Auto,
            padding: [0.0, 0.0, 0.0, 0.0],
            bg_color: OklabColor { l: 0.0, a: 0.0, b: 0.0, alpha: 0.0 },
            show_border: false,
            border_color: OklabColor { l: 0.0, a: 0.0, b: 0.0, alpha: 0.0 },
            border_width: 0.0,
            corner_radius: 0.0,
            opacity: 1.0,
            content: content.to_string(),
            font_size: 16.0,
            font_family: "Satoshi".to_string(),
            font_weight: 400,
            font_style: FontStyle::Normal,
            text_color: OklabColor { l: 0.1, a: 0.0, b: 0.0, alpha: 1.0 },
            text_align: TextAlign::Left,
            text_decoration: TextDecorationKind::None,
            line_height: 0.0,
            selected: 0,
            hovered: false,
        }
    }

    #[test]
    fn extent_css_variants() {
        assert_eq!(extent_css(&Extent::Auto), None);
        assert_eq!(extent_css(&Extent::Px(200.0)), Some("200px".to_string()));
        assert_eq!(extent_css(&Extent::Percent(0.5)), Some("50%".to_string()));
    }

    #[test]
    fn oklab_css_formats_percentage_lightness() {
        let c = OklabColor { l: 0.7, a: 0.1, b: -0.05, alpha: 1.0 };
        assert_eq!(oklab_css(&c), "oklab(70% 0.1 -0.05 / 1)");
    }

    #[test]
    fn escapes_text_content() {
        assert_eq!(escape_html("<script>&\""), "&lt;script&gt;&amp;&quot;");
    }

    // Renders the whole tree unfiltered -- roots are every node with no parent, matching what
    // resolve_export_roots would produce if every view were selected (see the
    // selecting_every_view_reproduces_unfiltered_output test below for that exact guarantee).
    fn render_all(nodes: &[UiNode]) -> (String, String) {
        let children = build_children_map(nodes);
        let roots: Vec<usize> = (0..nodes.len())
            .filter(|&i| parent_of(&nodes[i]).is_none())
            .collect();
        let included = collect_descendants(&children, &roots);
        let css = render_css(nodes, &included);
        let html = render_html(nodes, &children, &roots, &css);
        (html, css)
    }

    #[test]
    fn renders_a_box_with_a_text_child() {
        let nodes = vec![
            UiNode::Box(test_box(None)),
            UiNode::Text(test_text(Some(0), "Hello")),
        ];

        let (html, css) = render_all(&nodes);
        assert!(html.contains("<div class=\"k10-0\">"));
        assert!(html.contains("<p class=\"k10-1\">Hello</p>"));
        assert!(html.contains("<style>"));
        assert!(html.contains(".k10-0 {"));

        assert!(css.contains(".k10-0 {"));
        assert!(css.contains("width: 200px;"));
        assert!(css.contains(".k10-1 {"));
        assert!(css.contains("font-family: \"Satoshi\";"));
    }

    #[test]
    fn skips_img_nodes_in_both_outputs() {
        let nodes = vec![
            UiNode::Box(test_box(None)),
            UiNode::Img(kit10_scene::ImgData {
                parent_id: Some(0),
                width: Extent::Px(100.0),
                height: Extent::Px(100.0),
                source: kit10_scene::ImageSource::None,
                fit: "cover".to_string(),
                object_position: [0.5, 0.5],
                selected: 0,
                hovered: false,
            }),
        ];

        let (html, css) = render_all(&nodes);
        assert!(!html.contains("<img"));
        assert!(!css.contains("k10-1"));
    }

    #[test]
    fn export_input_tolerates_missing_fields() {
        let input: ExportInput = serde_json::from_str("{}").unwrap();
        assert_eq!(input.project_id, "");
        assert!(input.view_ids.is_empty());
    }

    // Fixture used by every resolve_export_roots test below: two sibling top-level views
    // ("view-a", "view-b"), and "view-c" nested inside "view-a" (parent_id: Some(0)) -- mirrors
    // exactly how Charter tags a nested child view's node (parent_id points at the containing
    // view's own node, per render_view_nodes).
    fn view_fixture() -> (Vec<UiNode>, Vec<String>) {
        let nodes = vec![
            UiNode::Box(test_box(None)),
            UiNode::Box(test_box(None)),
            UiNode::Box(test_box(Some(0))),
        ];
        let node_view_ids = vec!["view-a".to_string(), "view-b".to_string(), "view-c".to_string()];
        (nodes, node_view_ids)
    }

    #[test]
    fn resolve_export_roots_selects_only_the_chosen_top_level_view() {
        let (nodes, node_view_ids) = view_fixture();
        let roots = resolve_export_roots(&nodes, &node_view_ids, &["view-a".to_string()]);
        assert_eq!(roots, vec![0]);
    }

    #[test]
    fn resolve_export_roots_excludes_a_nested_view_whose_parent_is_also_selected() {
        let (nodes, node_view_ids) = view_fixture();
        let selected = vec!["view-a".to_string(), "view-c".to_string()];
        let roots = resolve_export_roots(&nodes, &node_view_ids, &selected);
        // view-c (index 2) is nested inside view-a (index 0), which is also selected -- it must
        // NOT be treated as a second independent root (it already renders as part of view-a's
        // subtree; including it again would duplicate it).
        assert_eq!(roots, vec![0]);
    }

    #[test]
    fn resolve_export_roots_is_empty_for_no_selection() {
        let (nodes, node_view_ids) = view_fixture();
        let roots = resolve_export_roots(&nodes, &node_view_ids, &[]);
        assert!(roots.is_empty());
    }

    #[test]
    fn resolve_export_roots_ignores_an_unknown_view_id() {
        let (nodes, node_view_ids) = view_fixture();
        let roots = resolve_export_roots(&nodes, &node_view_ids, &["view-zzz".to_string()]);
        assert!(roots.is_empty());
    }

    #[test]
    fn selecting_every_view_reproduces_unfiltered_output() {
        let (nodes, node_view_ids) = view_fixture();
        let selected = vec!["view-a".to_string(), "view-b".to_string(), "view-c".to_string()];

        let children = build_children_map(&nodes);
        let roots = resolve_export_roots(&nodes, &node_view_ids, &selected);
        let included = collect_descendants(&children, &roots);
        let filtered_css = render_css(&nodes, &included);
        let filtered_html = render_html(&nodes, &children, &roots, &filtered_css);

        let (unfiltered_html, unfiltered_css) = render_all(&nodes);

        assert_eq!(filtered_html, unfiltered_html);
        assert_eq!(filtered_css, unfiltered_css);
    }

    #[test]
    fn interpreter_output_deserializes_the_binary_only_unavailable_shape() {
        let output: InterpreterOutput =
            serde_json::from_str(r#"{"available":false,"reason":"binary-only"}"#).unwrap();
        assert!(!output.available);
        assert_eq!(output.reason.as_deref(), Some("binary-only"));
        assert!(output.viewport_data.is_empty());
    }
}
