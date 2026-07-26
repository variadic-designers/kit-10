// Pure UiNode-graph utilities -- node identity, parent/child structure, and view-selection logic.
// No CSS/HTML formatting concerns live here (see css.rs/html.rs).

use kit10_scene::UiNode;
use std::collections::{HashMap, HashSet};

pub(crate) fn class_name(index: usize) -> String {
    format!("k10-{index}")
}

pub(crate) fn parent_of(node: &UiNode) -> Option<usize> {
    match node {
        UiNode::Box(d) => d.parent_id,
        UiNode::Text(d) => d.parent_id,
        UiNode::Img(d) => d.parent_id,
    }
}

// children[i] = indices whose parent_id == Some(i).
pub(crate) fn build_children_map(nodes: &[UiNode]) -> HashMap<usize, Vec<usize>> {
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
pub(crate) fn resolve_export_roots(
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::view_fixture;

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
}
