// Markup rendering only -- css.rs owns stylesheet generation, tree.rs owns node-graph structure.

use crate::tree::class_name;
use kit10_scene::UiNode;
use std::collections::HashMap;

pub(crate) fn escape_html(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

pub(crate) fn render_html(
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escapes_text_content() {
        assert_eq!(escape_html("<script>&\""), "&lt;script&gt;&amp;&quot;");
    }
}
