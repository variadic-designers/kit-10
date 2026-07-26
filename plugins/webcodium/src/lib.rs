use extism_pdk::*;
use kit10_scene::UiNode;
use serde::Deserialize;

mod css;
mod html;
#[cfg(test)]
mod test_support;
mod tree;

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
    // view_ids selection actually refers to (see tree::resolve_export_roots).
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
/// v1 scope, deliberate: Box (layout/color) and Text (content/fonts) nodes only -- Img is
/// skipped entirely.
///
/// Phase 2 (resources/webcodium-export-plan.md): the inlined stylesheet is now nested SCSS
/// mirroring the DOM (css::render_scss) instead of Phase 1's flat per-node rules -- still one
/// file, still one class per rendered node instance, no axis/Kit awareness yet (that's Phase 3,
/// which needs the unresolved kit/axis shape this function still never sees).
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

    let css = css::with_reset(&css::render_scss(&output.viewport_data, &children, &roots));
    let html = html::render_html(&output.viewport_data, &children, &roots, &css);

    Ok(html)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{test_box, test_text, view_fixture};

    // Renders the whole tree unfiltered -- roots are every node with no parent, matching what
    // tree::resolve_export_roots would produce if every view were selected (see the
    // selecting_every_view_reproduces_unfiltered_output test below for that exact guarantee).
    fn render_all(nodes: &[UiNode]) -> (String, String) {
        let children = tree::build_children_map(nodes);
        let roots: Vec<usize> =
            (0..nodes.len()).filter(|&i| tree::parent_of(&nodes[i]).is_none()).collect();
        let css = css::render_scss(nodes, &children, &roots);
        let html = html::render_html(nodes, &children, &roots, &css);
        (html, css)
    }

    #[test]
    fn renders_a_box_with_a_nested_text_child() {
        let nodes = vec![UiNode::Box(test_box(None)), UiNode::Text(test_text(Some(0), "Hello"))];

        let (html, css) = render_all(&nodes);
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

    #[test]
    fn selecting_every_view_reproduces_unfiltered_output() {
        let (nodes, node_view_ids) = view_fixture();
        let selected = vec!["view-a".to_string(), "view-b".to_string(), "view-c".to_string()];

        let children = tree::build_children_map(&nodes);
        let roots = tree::resolve_export_roots(&nodes, &node_view_ids, &selected);
        let filtered_css = css::render_scss(&nodes, &children, &roots);
        let filtered_html = html::render_html(&nodes, &children, &roots, &filtered_css);

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
