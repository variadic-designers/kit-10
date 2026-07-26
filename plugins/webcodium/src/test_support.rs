// Shared test fixtures for css/html/tree/lib -- kept in one place so BoxData/TextData's full
// field lists (which change whenever kit10-scene's UiNode contract grows) aren't duplicated per
// module. Only compiled under #[cfg(test)] (see lib.rs's module declaration).

use kit10_scene::{
    BoxData, BoxExtra, Extent, FlexDir, FontStyle, OklabColor, TextAlign, TextData,
    TextDecorationKind, UiNode,
};

pub(crate) fn test_box(parent_id: Option<usize>) -> BoxData {
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

pub(crate) fn test_text(parent_id: Option<usize>, content: &str) -> TextData {
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

// Two sibling top-level views ("view-a", "view-b"), and "view-c" nested inside "view-a"
// (parent_id: Some(0)) -- mirrors exactly how Charter tags a nested child view's node (parent_id
// points at the containing view's own node, per render_view_nodes). Shared by tree.rs's
// resolve_export_roots tests and lib.rs's selecting_every_view_reproduces_unfiltered_output.
pub(crate) fn view_fixture() -> (Vec<UiNode>, Vec<String>) {
    let nodes = vec![
        UiNode::Box(test_box(None)),
        UiNode::Box(test_box(None)),
        UiNode::Box(test_box(Some(0))),
    ];
    let node_view_ids = vec!["view-a".to_string(), "view-b".to_string(), "view-c".to_string()];
    (nodes, node_view_ids)
}
