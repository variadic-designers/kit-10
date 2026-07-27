use extism_pdk::*;
use kit10_scene::UiNode;
use serde::Deserialize;
use std::collections::HashMap;

mod css;
mod html;
#[cfg(test)]
mod test_support;
mod tree;
mod variants;

// kit10_get_interpreter_output ignores its input and always returns a plain JSON string (not an
// #[encoding(Json)]-tagged struct) -- verified against its actual JS implementation
// (manager.svelte.ts's makeHostFunctions). Declared the same plain-String-in/out shape as
// Fontavious's kit10_kv_get, not Tenner's typed-struct kit10_get_project_export.
//
// kit10_get_kit_export_shape is the Phase 3 (Kit-basis export) addition: the unresolved,
// axis-args-independent per-Kit shape (every layer's full condition set/entries + axis metadata)
// -- see variants.rs's module doc comment and resources/webcodium-export-plan.md. Same plain
// JSON string in/out convention.
//
// kit10_get_asset_links resolves a batch of Img `src` asset ids to their `link` (a real URL) --
// backs Img export support, see fetch_asset_links below.
//
// kit10_get_font_links resolves a batch of (family, weight, style) font requests to the real URL
// Fontavious would fetch for each -- backs @font-face export support, see fetch_font_links below.
// No hardcoded font provider/URL anywhere in this plugin; every link comes from Fontavious's own
// catalogue via the host, the same `variant_url` export the editor's own font-fetch scan uses.
#[host_fn]
extern "ExtismHost" {
    fn kit10_get_interpreter_output(_unused: String) -> String;
    fn kit10_get_kit_export_shape(input: String) -> String;
    fn kit10_get_asset_links(input: String) -> String;
    fn kit10_get_font_links(input: String) -> String;
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
    // view_ids selection actually refers to (see tree::resolve_export_roots).
    #[serde(default)]
    node_view_ids: Vec<String>,
    // Parallel to viewport_data/node_view_ids -- the highest-priority composed Kit's id for each
    // node, "" for structural scaffolding or a kit-less view. Feeds tree::resolve_class_name and
    // tree::distinct_kit_ids (Phase 3, Kit-basis export).
    #[serde(default)]
    node_kit_ids: Vec<String>,
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
    // output as an unfiltered export -- see tree::resolve_export_roots's doc comment for why.
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
/// v1 scope, deliberate: Box (layout/color) and Text (content/fonts) nodes, plus Img nodes whose
/// asset id resolves to a real URL (kit10_get_asset_links) -- an Img with no known link
/// (ImageSource::None/Bytes, or a Ref id with no registered `link`) still emits nothing, no
/// data-URI embedding.
///
/// Phase 2 (resources/webcodium-export-plan.md): the inlined stylesheet is now nested SCSS
/// mirroring the DOM (css::render_scss) instead of Phase 1's flat per-node rules -- still one
/// file, still one class per rendered node instance, no axis/Kit awareness yet.
///
/// Phase 3: a node whose node_kit_ids names a Kit gets a semantic, Kit-basis class (and, for its
/// first instance, the Kit's own static/dynamic variant rules synthesized from
/// kit10_get_kit_export_shape -- see variants.rs) instead of the old positional `k10-N` class.
/// Fetching the shape is best-effort: if the host fn call or its response fails/is malformed,
/// `kit_shapes`/`kit_names` simply stay empty and every node gracefully falls through to
/// tree::resolve_class_name's lower tiers (primitive type, then positional) -- exactly Phase 1/2's
/// prior behavior, never a hard export failure over this. Img nodes never route through this
/// Kit-basis path at all, even when composed via a Kit -- see css::render_scss_node's own note.
///
/// The generated stylesheet is prefixed with css::BASELINE_RESET -- a tiny first-party reset
/// (not a third-party library) scoped to exactly WebCodium's own div/p tag surface, see its doc
/// comment for why a general-purpose reset library isn't used here.
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

    let children = tree::build_children_map(&output.viewport_data);
    let roots =
        tree::resolve_export_roots(&output.viewport_data, &output.node_view_ids, &req.view_ids);

    let (kit_names, kit_shapes) = fetch_kit_export_shapes(&output.node_kit_ids);
    let asset_links = fetch_asset_links(&output.viewport_data);
    let font_links = fetch_font_links(&output.viewport_data);

    let scss = css::render_scss(
        &output.viewport_data,
        &children,
        &roots,
        &output.node_view_ids,
        &output.node_kit_ids,
        &kit_names,
        &kit_shapes,
        &asset_links,
    );
    // @font-face blocks lead the stylesheet -- order doesn't affect CSS validity (a @font-face
    // rule applies document-wide regardless of position), but it reads more naturally before the
    // baseline reset and the rest of the generated rules.
    let css = format!("{}{}", css::render_font_faces(&font_links), css::with_reset(&scss));
    let html = html::render_html(
        &output.viewport_data,
        &children,
        &roots,
        &output.node_view_ids,
        &output.node_kit_ids,
        &kit_names,
        &asset_links,
        &css,
    );

    Ok(html)
}

#[derive(Debug, Clone, Deserialize, Default)]
struct AssetLinksResponse {
    #[serde(default)]
    success: bool,
    #[serde(default)]
    links: HashMap<String, String>,
}

// Every distinct asset id an Img node's `Ref` source names, in first-appearance order --
// deliberately the same dedup shape as tree::distinct_kit_ids, so kit10_get_asset_links is
// called with exactly the ids actually referenced, not every asset in the project.
fn distinct_img_asset_ids(nodes: &[UiNode]) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut result = Vec::new();
    for node in nodes {
        if let UiNode::Img(d) = node {
            if let kit10_scene::ImageSource::Ref(id) = &d.source {
                if seen.insert(id.clone()) {
                    result.push(id.clone());
                }
            }
        }
    }
    result
}

// Best-effort fetch of every distinct Img asset id's real URL. Never fails the whole export --
// any error (host-fn call, JSON parse, `success: false`) just leaves the map empty, which
// tree::resolved_img_src already treats as "no known URL for this image", falling through to
// emitting nothing for it (same as Phase 1/2's original "Img is out of scope" behavior).
fn fetch_asset_links(nodes: &[UiNode]) -> HashMap<String, String> {
    let asset_ids = distinct_img_asset_ids(nodes);
    if asset_ids.is_empty() {
        return HashMap::new();
    }

    let request = serde_json::json!({ "asset_ids": asset_ids }).to_string();
    let Ok(raw) = (unsafe { kit10_get_asset_links(request) }) else {
        return HashMap::new();
    };
    let Ok(resp) = serde_json::from_str::<AssetLinksResponse>(&raw) else {
        return HashMap::new();
    };
    if !resp.success {
        return HashMap::new();
    }
    resp.links
}

// One (family, weight, style) font request resolved to the real URL Fontavious would fetch for
// it. Deliberately not keyed by a HashMap the way asset links are -- several distinct requests
// (e.g. two different weights of a variable font) can legitimately resolve to the SAME url, and
// css.rs needs to emit one @font-face block per distinct REQUEST (each with its own
// font-weight/font-style declaration), not per distinct url.
#[derive(Debug, Clone, Deserialize, PartialEq)]
pub(crate) struct ResolvedFontLink {
    pub family: String,
    pub weight: u16,
    pub style: String,
    pub url: String,
}

#[derive(Debug, Clone, Deserialize, Default)]
struct FontLinksResponse {
    #[serde(default)]
    success: bool,
    #[serde(default)]
    links: Vec<ResolvedFontLink>,
}

// Every distinct (font_family, font_weight, font_style) triple a Text node actually carries, in
// first-appearance order -- the SAME dedup shape as distinct_img_asset_ids/tree::distinct_kit_ids.
// Reads straight off the resolved TextData fields, which already reflect Charter's own
// resolve_font_weight snapping (build_viewport calls snap_text_weights before this plugin ever
// sees the data) -- no separate "what did Charter actually decide" lookup needed, the wire value
// already IS the decision.
fn distinct_font_requests(nodes: &[UiNode]) -> Vec<(String, u16, String)> {
    let mut seen = std::collections::HashSet::new();
    let mut result = Vec::new();
    for node in nodes {
        if let UiNode::Text(d) = node {
            let style = css::font_style_css(&d.font_style).to_string();
            let key = (d.font_family.clone(), d.font_weight, style);
            if seen.insert(key.clone()) {
                result.push(key);
            }
        }
    }
    result
}

// Best-effort fetch of every distinct font request's real URL. Never fails the whole export --
// any error (host-fn call, JSON parse, `success: false`) just leaves the list empty, which
// css::render_font_faces already treats as "no @font-face rules to emit", falling through to
// exactly Phase 1/2's prior behavior (a plain `font-family: "X";` declaration with no @font-face
// backing it -- the browser substitutes a local/fallback font, same as it always did).
fn fetch_font_links(nodes: &[UiNode]) -> Vec<ResolvedFontLink> {
    let requests = distinct_font_requests(nodes);
    if requests.is_empty() {
        return Vec::new();
    }

    let request_json = serde_json::json!({
        "requests": requests
            .iter()
            .map(|(family, weight, style)| {
                serde_json::json!({ "family": family, "weight": weight, "style": style })
            })
            .collect::<Vec<_>>()
    })
    .to_string();
    let Ok(raw) = (unsafe { kit10_get_font_links(request_json) }) else {
        return Vec::new();
    };
    let Ok(resp) = serde_json::from_str::<FontLinksResponse>(&raw) else {
        return Vec::new();
    };
    if !resp.success {
        return Vec::new();
    }
    resp.links
}

// Best-effort fetch of every distinct composed Kit's unresolved export shape. Never fails the
// whole export -- any error (host-fn call, JSON parse, `success: false`) just leaves both maps
// empty, which tree::resolve_class_name and css::render_scss already treat as "no Kit-basis data
// available for this node", falling through to their lower tiers.
fn fetch_kit_export_shapes(
    node_kit_ids: &[String],
) -> (HashMap<String, String>, HashMap<String, variants::KitExportShape>) {
    let mut kit_names = HashMap::new();
    let mut kit_shapes = HashMap::new();

    let kit_ids = tree::distinct_kit_ids(node_kit_ids);
    if kit_ids.is_empty() {
        return (kit_names, kit_shapes);
    }

    let request = serde_json::json!({ "kit_ids": kit_ids }).to_string();
    let Ok(raw) = (unsafe { kit10_get_kit_export_shape(request) }) else {
        return (kit_names, kit_shapes);
    };
    let Ok(resp) = serde_json::from_str::<variants::KitExportShapeResponse>(&raw) else {
        return (kit_names, kit_shapes);
    };
    if !resp.success {
        return (kit_names, kit_shapes);
    }

    for (kit_id, shape) in resp.kits {
        kit_names.insert(kit_id.clone(), shape.kit_name.clone());
        kit_shapes.insert(kit_id, shape);
    }
    (kit_names, kit_shapes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{test_box, test_text, view_fixture};

    // Renders the whole tree unfiltered -- roots are every node with no parent, matching what
    // tree::resolve_export_roots would produce if every view were selected (see the
    // selecting_every_view_reproduces_unfiltered_output test below for that exact guarantee).
    // node_view_ids all-empty (no real view identity, no composed kit) reproduces exactly Phase
    // 1/2's positional k10-N classes via tree::resolve_class_name's tier-3 fallback -- this is
    // what keeps every prior test below unchanged.
    fn render_all(nodes: &[UiNode], node_view_ids: &[String]) -> (String, String) {
        let children = tree::build_children_map(nodes);
        let roots: Vec<usize> =
            (0..nodes.len()).filter(|&i| tree::parent_of(&nodes[i]).is_none()).collect();
        let node_kit_ids = vec![String::new(); nodes.len()];
        let kit_names = HashMap::new();
        let kit_shapes = HashMap::new();
        // No way to call the real host fn in a plain unit test -- tests that need a resolved Img
        // link build this map directly instead (see the dedicated Img tests below).
        let asset_links = HashMap::new();
        let css = css::render_scss(
            nodes,
            &children,
            &roots,
            node_view_ids,
            &node_kit_ids,
            &kit_names,
            &kit_shapes,
            &asset_links,
        );
        let html = html::render_html(
            nodes,
            &children,
            &roots,
            node_view_ids,
            &node_kit_ids,
            &kit_names,
            &asset_links,
            &css,
        );
        (html, css)
    }

    #[test]
    fn renders_a_box_with_a_nested_text_child() {
        let nodes = vec![UiNode::Box(test_box(None)), UiNode::Text(test_text(Some(0), "Hello"))];

        let (html, css) = render_all(&nodes, &vec![String::new(); nodes.len()]);
        assert!(html.contains("<div class=\"k10-0\">"));
        assert!(html.contains("<p class=\"k10-1\">Hello</p>"));
        assert!(html.contains("<style>"));
        assert!(css.contains(".k10-0 {"));
        assert!(css.contains("width: 200px;"));
        assert!(css.contains(".k10-1 {"));
        assert!(css.contains("font-family: \"Satoshi\";"));

        // Phase 2: the child's rule is nested INSIDE the parent's block (real SCSS/native-CSS
        // nesting), not a flat sibling rule the way Phase 1 emitted it.
        let parent_open = css.find(".k10-0 {").unwrap();
        let child_rule = css.find(".k10-1 {").unwrap();
        let parent_close = css.rfind('}').unwrap();
        assert!(child_rule > parent_open && child_rule < parent_close);
    }

    #[test]
    fn skips_img_nodes_in_both_outputs() {
        let nodes = vec![
            UiNode::Box(test_box(None)),
            UiNode::Img(kit10_scene::ImgData {
                parent_id: Some(0),
                width: kit10_scene::Extent::Px(100.0),
                height: kit10_scene::Extent::Px(100.0),
                source: kit10_scene::ImageSource::None,
                fit: "cover".to_string(),
                object_position: [0.5, 0.5],
                selected: 0,
                hovered: false,
            }),
        ];

        let (html, css) = render_all(&nodes, &vec![String::new(); nodes.len()]);
        assert!(!html.contains("<img"));
        assert!(!css.contains("k10-1"));
    }

    #[test]
    fn img_with_a_resolved_asset_link_renders_a_real_img_tag_and_css_rule() {
        let nodes = vec![
            UiNode::Box(test_box(None)),
            UiNode::Img(kit10_scene::ImgData {
                parent_id: Some(0),
                width: kit10_scene::Extent::Px(360.0),
                height: kit10_scene::Extent::Px(280.0),
                source: kit10_scene::ImageSource::Ref("asset-1".to_string()),
                fit: "cover".to_string(),
                object_position: [0.5, 0.5],
                selected: 0,
                hovered: false,
            }),
        ];
        let node_view_ids = vec![String::new(); nodes.len()];
        let node_kit_ids = vec![String::new(); nodes.len()];
        let kit_names = HashMap::new();
        let kit_shapes = HashMap::new();
        let mut asset_links = HashMap::new();
        asset_links.insert("asset-1".to_string(), "/1x/favicon.png".to_string());

        let children = tree::build_children_map(&nodes);
        let roots: Vec<usize> = vec![0];
        let css = css::render_scss(
            &nodes,
            &children,
            &roots,
            &node_view_ids,
            &node_kit_ids,
            &kit_names,
            &kit_shapes,
            &asset_links,
        );
        let html = html::render_html(
            &nodes,
            &children,
            &roots,
            &node_view_ids,
            &node_kit_ids,
            &kit_names,
            &asset_links,
            &css,
        );

        assert!(html.contains("<img class=\"k10-1\" src=\"/1x/favicon.png\" alt=\"\">"), "html was: {html}");
        assert!(css.contains(".k10-1 {"), "css was: {css}");
        assert!(css.contains("width: 360px;"));
        assert!(css.contains("height: 280px;"));
        assert!(css.contains("object-fit: cover;"));
    }

    #[test]
    fn a_pinned_views_world_space_position_survives_the_export() {
        // Mirrors Charter's absolute_box wrapper exactly: index 0 is the structural wrapper
        // (node_view_id "", never itself a selectable view), index 1 is the pinned view's own
        // real content, one hop down. Before this fix, the wrapper's position was silently
        // dropped -- resolve_export_roots picks the CHILD as the root (see the sanity assert
        // below), and no render function ever visited the wrapper to read its position at all.
        let mut wrapper = test_box(None);
        wrapper.extra.position = kit10_scene::NodePosition::Absolute { x: 120.0, y: 40.0 };
        let nodes = vec![UiNode::Box(wrapper), UiNode::Box(test_box(Some(0)))];
        let node_view_ids = vec![String::new(), "view-a".to_string()];
        let node_kit_ids = vec![String::new(); nodes.len()];
        let kit_names = HashMap::new();
        let kit_shapes = HashMap::new();
        let asset_links = HashMap::new();

        let children = tree::build_children_map(&nodes);
        let roots = tree::resolve_export_roots(&nodes, &node_view_ids, &["view-a".to_string()]);
        assert_eq!(roots, vec![1], "sanity: the child, not the wrapper, must be the resolved root");

        let css = css::render_scss(
            &nodes,
            &children,
            &roots,
            &node_view_ids,
            &node_kit_ids,
            &kit_names,
            &kit_shapes,
            &asset_links,
        );
        let html = html::render_html(
            &nodes,
            &children,
            &roots,
            &node_view_ids,
            &node_kit_ids,
            &kit_names,
            &asset_links,
            &css,
        );

        // A single pinned root normalizes to (0, 0) -- its own raw canvas coordinate (120, 40) IS
        // the minimum across this export's one positioned root (see
        // tree::normalized_root_positions' doc comment: raw canvas coordinates aren't meaningful
        // page pixels on their own, only the RELATIVE arrangement between multiple pinned roots
        // is preserved).
        assert!(
            css.contains(".k10-1 {\n  position: absolute;\n  left: 0px;\n  top: 0px;\n}"),
            "css was: {css}"
        );
        // The element still carries its own resolved class ("box", tier 2 -- no composed Kit)
        // ALONGSIDE the always-unique positional class, since a Kit-basis root's normal class can
        // be shared with other, unpositioned instances of the same Kit (see css.rs's doc comment).
        assert!(html.contains("<div class=\"box k10-1\">"), "html was: {html}");
    }

    #[test]
    fn two_pinned_views_preserve_their_relative_arrangement_after_normalization() {
        // Two independent pinned views, each with its own wrapper -- mirrors the doc comment's
        // "multiple pinned views each get independent wrappers" claim. Wrapper A at (100, 200),
        // wrapper B at (150, 500): after normalizing by the minimum (100, 200), A lands at
        // (0, 0) and B at (50, 300) -- the 50px/300px RELATIVE offset between them survives
        // exactly, even though neither raw canvas coordinate is meaningful on its own.
        let mut wrapper_a = test_box(None);
        wrapper_a.extra.position = kit10_scene::NodePosition::Absolute { x: 100.0, y: 200.0 };
        let mut wrapper_b = test_box(None);
        wrapper_b.extra.position = kit10_scene::NodePosition::Absolute { x: 150.0, y: 500.0 };
        let nodes = vec![
            UiNode::Box(wrapper_a),
            UiNode::Box(test_box(Some(0))),
            UiNode::Box(wrapper_b),
            UiNode::Box(test_box(Some(2))),
        ];
        let node_view_ids =
            vec![String::new(), "view-a".to_string(), String::new(), "view-b".to_string()];
        let node_kit_ids = vec![String::new(); nodes.len()];
        let kit_names = HashMap::new();
        let kit_shapes = HashMap::new();
        let asset_links = HashMap::new();

        let children = tree::build_children_map(&nodes);
        let selected = vec!["view-a".to_string(), "view-b".to_string()];
        let roots = tree::resolve_export_roots(&nodes, &node_view_ids, &selected);
        assert_eq!(roots, vec![1, 3]);

        let css = css::render_scss(
            &nodes,
            &children,
            &roots,
            &node_view_ids,
            &node_kit_ids,
            &kit_names,
            &kit_shapes,
            &asset_links,
        );

        assert!(
            css.contains(".k10-1 {\n  position: absolute;\n  left: 0px;\n  top: 0px;\n}"),
            "css was: {css}"
        );
        assert!(
            css.contains(".k10-3 {\n  position: absolute;\n  left: 50px;\n  top: 300px;\n}"),
            "css was: {css}"
        );
    }

    #[test]
    fn distinct_img_asset_ids_dedupes_and_ignores_none_and_bytes_sources() {
        let nodes = vec![
            UiNode::Img(kit10_scene::ImgData {
                parent_id: None,
                width: kit10_scene::Extent::Auto,
                height: kit10_scene::Extent::Auto,
                source: kit10_scene::ImageSource::Ref("a".to_string()),
                fit: "cover".to_string(),
                object_position: [0.5, 0.5],
                selected: 0,
                hovered: false,
            }),
            UiNode::Img(kit10_scene::ImgData {
                parent_id: None,
                width: kit10_scene::Extent::Auto,
                height: kit10_scene::Extent::Auto,
                source: kit10_scene::ImageSource::None,
                fit: "cover".to_string(),
                object_position: [0.5, 0.5],
                selected: 0,
                hovered: false,
            }),
            UiNode::Img(kit10_scene::ImgData {
                parent_id: None,
                width: kit10_scene::Extent::Auto,
                height: kit10_scene::Extent::Auto,
                source: kit10_scene::ImageSource::Ref("a".to_string()),
                fit: "cover".to_string(),
                object_position: [0.5, 0.5],
                selected: 0,
                hovered: false,
            }),
        ];
        assert_eq!(distinct_img_asset_ids(&nodes), vec!["a".to_string()]);
    }

    #[test]
    fn distinct_font_requests_dedupes_by_family_weight_and_style() {
        let mut bold = test_text(None, "Hello");
        bold.font_family = "Inter".to_string();
        bold.font_weight = 700;

        let mut duplicate_of_bold = test_text(None, "World");
        duplicate_of_bold.font_family = "Inter".to_string();
        duplicate_of_bold.font_weight = 700;

        let mut different_weight = test_text(None, "!");
        different_weight.font_family = "Inter".to_string();
        different_weight.font_weight = 400;

        let nodes =
            vec![UiNode::Text(bold), UiNode::Text(duplicate_of_bold), UiNode::Text(different_weight)];

        assert_eq!(
            distinct_font_requests(&nodes),
            vec![
                ("Inter".to_string(), 700, "normal".to_string()),
                ("Inter".to_string(), 400, "normal".to_string()),
            ]
        );
    }

    #[test]
    fn distinct_font_requests_ignores_non_text_nodes() {
        let nodes = vec![UiNode::Box(test_box(None))];
        assert!(distinct_font_requests(&nodes).is_empty());
    }

    #[test]
    fn render_font_faces_emits_one_block_per_link_with_woff2_format() {
        let links = vec![
            ResolvedFontLink {
                family: "Inter".to_string(),
                weight: 700,
                style: "normal".to_string(),
                url: "https://fonts.gstatic.com/inter-700.woff2".to_string(),
            },
            ResolvedFontLink {
                family: "Inter".to_string(),
                weight: 400,
                style: "italic".to_string(),
                url: "https://fonts.gstatic.com/inter-400i.woff2".to_string(),
            },
        ];
        let css = css::render_font_faces(&links);
        assert!(css.contains("@font-face {"));
        assert!(css.contains("font-family: \"Inter\";"));
        assert!(css.contains("font-weight: 700;"));
        assert!(css.contains("font-style: normal;"));
        assert!(css.contains(
            "src: url(\"https://fonts.gstatic.com/inter-700.woff2\") format(\"woff2\");"
        ));
        assert!(css.contains("font-style: italic;"));
        assert_eq!(css.matches("@font-face").count(), 2);
    }

    #[test]
    fn render_font_faces_is_empty_for_no_links() {
        assert_eq!(css::render_font_faces(&[]), "");
    }

    #[test]
    fn export_input_tolerates_missing_fields() {
        let input: ExportInput = serde_json::from_str("{}").unwrap();
        assert_eq!(input.project_id, "");
        assert!(input.view_ids.is_empty());
    }

    #[test]
    fn selecting_every_view_reproduces_unfiltered_output() {
        let (nodes, node_view_ids) = view_fixture();
        let selected = vec!["view-a".to_string(), "view-b".to_string(), "view-c".to_string()];
        let node_kit_ids = vec![String::new(); nodes.len()];
        let kit_names = HashMap::new();
        let kit_shapes = HashMap::new();
        let asset_links = HashMap::new();

        let children = tree::build_children_map(&nodes);
        let roots = tree::resolve_export_roots(&nodes, &node_view_ids, &selected);
        let filtered_css = css::render_scss(
            &nodes,
            &children,
            &roots,
            &node_view_ids,
            &node_kit_ids,
            &kit_names,
            &kit_shapes,
            &asset_links,
        );
        let filtered_html = html::render_html(
            &nodes,
            &children,
            &roots,
            &node_view_ids,
            &node_kit_ids,
            &kit_names,
            &asset_links,
            &filtered_css,
        );

        let (unfiltered_html, unfiltered_css) = render_all(&nodes, &node_view_ids);

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

    // End-to-end Kit-basis export (Phase 3), using the exact worked example from
    // resources/webcodium-export-plan.md: a Button kit with a static `theme` axis
    // (primary/secondary) and a dynamic `state` axis (hover), composed on one view with no
    // children. Exercises the whole pipeline (tree::resolve_class_name, css::render_scss's
    // variant-rule emission, html.rs's class attribute) with a populated kit shape map, standing
    // in for what fetch_kit_export_shapes would have returned from a real host-fn round-trip.
    #[test]
    fn kit_basis_export_worked_example_produces_semantic_class_and_variant_rules() {
        use crate::variants::{
            AxisExportMeta, AxisValueWire, ExportAxisValue, ExportLayer, ExportLayerCondition,
            ExportLayerEntry, KitExportShape,
        };

        let nodes = vec![UiNode::Box(test_box(None))];
        let node_view_ids = vec!["view-button".to_string()];
        let node_kit_ids = vec!["button-kit".to_string()];

        let literal = |v: &str| AxisValueWire { kind: "literal".to_string(), value: v.to_string() };
        let entry = |property: &str, value: &str| ExportLayerEntry {
            property: property.to_string(),
            literal_value: Some(value.to_string()),
            token_value: None,
        };
        let condition = |axis_id: &str, value: &str| ExportLayerCondition {
            axis_id: axis_id.to_string(),
            axis_value_id: String::new(),
            value: literal(value),
        };

        let shape = KitExportShape {
            kit_id: "button-kit".to_string(),
            kit_name: "Button".to_string(),
            axes: vec![
                AxisExportMeta {
                    axis_id: "theme".to_string(),
                    axis_name: Some("theme".to_string()),
                    kind: Some("categorical".to_string()),
                    variant_kind: "static".to_string(),
                    excluded_from_export: false,
                    default_value: Some(literal("primary")),
                    priority_index: 0,
                    values: vec![
                        ExportAxisValue { axis_value_id: "v1".to_string(), value: literal("primary"), priority_index: 0 },
                        ExportAxisValue { axis_value_id: "v2".to_string(), value: literal("secondary"), priority_index: 1000 },
                    ],
                },
                AxisExportMeta {
                    axis_id: "state".to_string(),
                    axis_name: Some("state".to_string()),
                    kind: Some("categorical".to_string()),
                    variant_kind: "dynamic".to_string(),
                    excluded_from_export: false,
                    default_value: None,
                    priority_index: 1000,
                    values: vec![ExportAxisValue {
                        axis_value_id: "v3".to_string(),
                        value: literal("hover"),
                        priority_index: 0,
                    }],
                },
            ],
            layers: vec![
                ExportLayer {
                    layer_id: "base".to_string(),
                    conditions: vec![],
                    entries: vec![entry("background", "oklab(60% 0.1 0.02 / 1)")],
                },
                ExportLayer {
                    layer_id: "secondary".to_string(),
                    conditions: vec![condition("theme", "secondary")],
                    entries: vec![entry("background", "oklab(40% 0.05 -0.01 / 1)")],
                },
                ExportLayer {
                    layer_id: "hover".to_string(),
                    conditions: vec![condition("state", "hover")],
                    entries: vec![entry("background", "oklab(65% 0.1 0.02 / 1)")],
                },
            ],
        };

        let mut kit_names = HashMap::new();
        kit_names.insert("button-kit".to_string(), "Button".to_string());
        let mut kit_shapes = HashMap::new();
        kit_shapes.insert("button-kit".to_string(), shape);

        let asset_links = HashMap::new();
        let children = tree::build_children_map(&nodes);
        let roots: Vec<usize> = vec![0];
        let css = css::render_scss(
            &nodes,
            &children,
            &roots,
            &node_view_ids,
            &node_kit_ids,
            &kit_names,
            &kit_shapes,
            &asset_links,
        );
        let html = html::render_html(
            &nodes,
            &children,
            &roots,
            &node_view_ids,
            &node_kit_ids,
            &kit_names,
            &asset_links,
            &css,
        );

        assert!(html.contains("<div class=\"button\">"), "html was: {html}");

        assert!(css.contains(".button {"), "css was: {css}");
        assert!(css.contains("background: oklab(60% 0.1 0.02 / 1);"));
        assert!(css.contains(".button--secondary {"));
        assert!(css.contains("background: oklab(40% 0.05 -0.01 / 1);"));
        assert!(css.contains(".button:hover {"));
        assert!(css.contains("background: oklab(65% 0.1 0.02 / 1);"));

        // The old positional class scheme must not leak through for a Kit-identified node.
        assert!(!css.contains("k10-0"));
        assert!(!html.contains("k10-0"));
    }
}
