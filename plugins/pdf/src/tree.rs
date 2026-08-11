use kit10_scene::UiNode;
use std::collections::{HashMap, HashSet};

// Ported verbatim from plugins/webcodium/src/tree.rs -- same UiNode tree-walk contract, no
// PDF-specific behavior here. See that crate's copy for the fuller doc comments on WHY each of
// these shapes is correct; kept terse here to avoid duplicating that reasoning.

pub(crate) fn parent_of(node: &UiNode) -> Option<usize> {
    match node {
        UiNode::Box(d) => d.parent_id,
        UiNode::Text(d) => d.parent_id,
        UiNode::Img(d) => d.parent_id,
        UiNode::Shape(d) => d.parent_id,
        UiNode::SpriteBatch(d) => d.parent_id,
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

// Every selected view becomes an independent export root unless an ancestor is ALSO selected
// (in which case it already renders as part of that ancestor's subtree). See
// webcodium::tree::resolve_export_roots's doc comment for the full reasoning -- identical here.
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
pub(crate) mod test_support {
    use kit10_scene::{BoxData, BoxExtra, Extent, FlexDir, OklabColor, UiNode};

    // BoxData doesn't derive Default (kit10-scene's `wire!` macro only auto-derives
    // Debug/Clone/PartialEq/Serialize/Deserialize; Default is opt-in per struct and BoxData
    // doesn't opt in), so every field is named explicitly here.
    pub(crate) fn test_box(parent_id: Option<usize>) -> BoxData {
        BoxData {
            parent_id,
            overflow_hidden: false,
            width: Extent::Auto,
            height: Extent::Auto,
            min_width: Extent::Auto,
            min_height: Extent::Auto,
            max_width: Extent::Auto,
            max_height: Extent::Auto,
            padding: [0.0; 4],
            bg_color: OklabColor::default(),
            flex_direction: FlexDir::Row,
            show_border: false,
            border_color: OklabColor::default(),
            border_width: 0.0,
            corner_radius: 0.0,
            squircle: false,
            opacity: 1.0,
            shadow: None,
            extra: BoxExtra::default(),
            selected: 0,
            hovered: false,
        }
    }

    // A minimal two-view tree: view-a (root box) has one child box; view-b is a sibling root.
    // Mirrors webcodium::test_support's view_fixture shape closely enough to test resolve_export_roots.
    pub(crate) fn view_fixture() -> (Vec<UiNode>, Vec<String>) {
        let nodes = vec![
            UiNode::Box(test_box(None)),
            UiNode::Box(test_box(Some(0))),
            UiNode::Box(test_box(None)),
        ];
        let node_view_ids = vec!["view-a".to_string(), "view-a".to_string(), "view-b".to_string()];
        (nodes, node_view_ids)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use test_support::view_fixture;

    #[test]
    fn resolve_export_roots_selects_only_the_chosen_top_level_view() {
        let (nodes, node_view_ids) = view_fixture();
        let roots = resolve_export_roots(&nodes, &node_view_ids, &["view-a".to_string()]);
        assert_eq!(roots, vec![0]);
    }

    #[test]
    fn resolve_export_roots_is_empty_for_no_selection() {
        let (nodes, node_view_ids) = view_fixture();
        let roots = resolve_export_roots(&nodes, &node_view_ids, &[]);
        assert!(roots.is_empty());
    }

    #[test]
    fn build_children_map_groups_by_parent_id() {
        let (nodes, _) = view_fixture();
        let children = build_children_map(&nodes);
        assert_eq!(children.get(&0), Some(&vec![1]));
        assert_eq!(children.get(&2), None);
    }
}
