// Markup rendering only -- css.rs owns stylesheet generation, tree.rs owns node-graph structure.

use crate::tree;
use kit10_scene::UiNode;
use std::collections::HashMap;

pub(crate) fn escape_html(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

// node_view_ids/node_kit_ids/kit_names feed tree::resolve_class_name's 3-tier scheme (Kit name /
// primitive type / positional -- see its own doc comment) so the class attribute here always
// matches whatever selector css.rs actually emitted for the same node. asset_links backs Img
// support (see tree::resolved_img_src) -- an Img with no resolved link still emits nothing,
// exactly like Phase 1/2's original "Img is out of scope" behavior, just now scoped to "no known
// URL" rather than "always." instance_modifier_classes (lib.rs's compute_instance_modifier_classes)
// is node-index -> extra static variant modifier class(es) that specific node instance's own
// resolved axis args earned -- without this, css.rs's variant rules can never match anything.
#[allow(clippy::too_many_arguments)]
pub(crate) fn render_html(
    nodes: &[UiNode],
    children: &HashMap<usize, Vec<usize>>,
    roots: &[usize],
    node_view_ids: &[String],
    node_kit_ids: &[String],
    kit_names: &HashMap<String, String>,
    asset_links: &HashMap<String, String>,
    css: &str,
    instance_modifier_classes: &HashMap<usize, Vec<String>>,
    view_compositions: &HashMap<String, Vec<String>>,
) -> String {
    let mut body = String::new();
    // Only .is_some() is ever read below (whether to append the extra positional class) -- the
    // actual normalized value doesn't matter here, but computing it the same way css.rs does keeps
    // "is this root positioned" answered identically in both places, not by two separate notions.
    let positions = tree::normalized_root_positions(nodes, roots);
    for &i in roots {
        let position = positions.get(&i).copied();
        render_html_node(
            nodes,
            children,
            node_view_ids,
            node_kit_ids,
            kit_names,
            asset_links,
            instance_modifier_classes,
            view_compositions,
            i,
            position,
            &mut body,
        );
    }
    format!(
        "<!doctype html>\n<html>\n<head>\n<meta charset=\"utf-8\">\n<style>\n{css}</style>\n</head>\n<body>\n{body}</body>\n</html>\n"
    )
}

#[allow(clippy::too_many_arguments)]
fn render_html_node(
    nodes: &[UiNode],
    children: &HashMap<usize, Vec<usize>>,
    node_view_ids: &[String],
    node_kit_ids: &[String],
    kit_names: &HashMap<String, String>,
    asset_links: &HashMap<String, String>,
    instance_modifier_classes: &HashMap<usize, Vec<String>>,
    view_compositions: &HashMap<String, Vec<String>>,
    i: usize,
    position: Option<(f32, f32)>,
    out: &mut String,
) {
    // One class per composed Kit on this node's own view (in composition-priority order), plus
    // the existing 3-tier fallback as the first entry -- see tree::resolve_class_names. For a
    // single-kit view (the common case) this is exactly the old single class, unchanged.
    let mut class =
        tree::resolve_class_names(i, nodes, node_view_ids, node_kit_ids, kit_names, view_compositions)
            .join(" ");
    // Static variant modifier classes this SPECIFIC node instance's own view resolved to (see
    // lib.rs's compute_instance_modifier_classes) -- without this, css.rs's variant rules
    // (`.button.button--theme-secondary`) are unreachable dead CSS, since nothing else ever puts a
    // modifier class on any element. Applied before the positional class below -- attribute token
    // order is irrelevant to CSS matching.
    if let Some(extra) = instance_modifier_classes.get(&i) {
        for c in extra {
            class = format!("{class} {c}");
        }
    }
    // See css.rs::render_scss_node's matching doc comment -- a positioned root's own class may be
    // a Kit's shared selector, so world-space placement rides a second, always-unique class
    // (tree::class_name(i)) instead of being folded into the first.
    if position.is_some() {
        class = format!("{class} {}", tree::class_name(i));
    }
    match &nodes[i] {
        UiNode::Text(d) => {
            out.push_str(&format!("<p class=\"{class}\">{}</p>\n", escape_html(&d.content)));
        }
        UiNode::Box(_) => {
            out.push_str(&format!("<div class=\"{class}\">\n"));
            if let Some(kids) = children.get(&i) {
                for &k in kids {
                    render_html_node(
                        nodes,
                        children,
                        node_view_ids,
                        node_kit_ids,
                        kit_names,
                        asset_links,
                        instance_modifier_classes,
                        view_compositions,
                        k,
                        None,
                        out,
                    );
                }
            }
            out.push_str("</div>\n");
        }
        // An Img with no resolved URL (ImageSource::None/Bytes, or a Ref id
        // kit10_get_asset_links didn't return a link for) stays out of scope -- emitting nothing
        // rather than a broken <img> with no real src.
        UiNode::Img(_) => {
            if let Some(src) = tree::resolved_img_src(&nodes[i], asset_links) {
                out.push_str(&format!(
                    "<img class=\"{class}\" src=\"{}\" alt=\"\">\n",
                    escape_html(src)
                ));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escapes_text_content() {
        assert_eq!(escape_html("<script>&\""), "&lt;script&gt;&amp;&quot;");
    }
}
