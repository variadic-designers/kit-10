//! Resolves absolute (design-px, top-left origin, Y-down) rects for every `UiNode`, by vendoring
//! `taffy` directly into this plugin -- per the plan's central finding, `kit10-scene`'s wire
//! format ships layout *intent* (`Extent`, already-compiled `BoxExtra` flex/grid primitives),
//! never resolved pixels, and no host function exposes Vellum's own resolved layout to a plugin.
//!
//! `apply_box_extra`/`build_taffy_tree`/`run_full_layout`'s shape below are a close port of
//! Vellum's own `taf_can_do/src/layout/mod.rs` + `taf_can_do/src/render/mod.rs::run_full_layout`
//! (a sibling private repo, read directly during implementation of this plugin) -- not a
//! reconstruction from prose. Using the exact same UiNode -> taffy::Style mapping Vellum itself
//! uses is what keeps this plugin's page geometry consistent with what the designer sees on
//! Vellum's own canvas, rather than an independent (and possibly subtly diverging) reimplementation.
//! Dropped from the original: all GPU paint-instance construction (`LayoutRect`'s color/border/
//! corner fields, `TextAreaData`/`ImageAreaData`/`ShapeAreaData`/`SpriteBatchAreaData`, selection/
//! hover state) -- this module only produces geometry + opacity per node index; `paint.rs` reads
//! paint properties straight off the original `&UiNode` instead of duplicating them into the
//! layout result the way Vellum's fused layout+paint walk does.
//!
//! Text auto-sizing measures + wraps with the real shaped font (`measure_node`, `wrap.rs`); the
//! character-count heuristic only remains as a fallback for a Text node whose font never
//! resolved -- see `heuristic_size`.

use crate::fonts::FontCache;
use kit10_scene::{
    AlignValue, BoxData, BoxExtra, Extent, FlexDir, GridLine, ImgData, JustifyValue, NodePosition,
    ShapeData, SpriteBatchData, TextData, TrackMax, TrackMin, TrackSize, UiNode,
};
use std::collections::HashMap;
use taffy::prelude::*;

fn extent_dim(e: Extent) -> taffy::style::Dimension {
    match e {
        Extent::Auto => auto(),
        Extent::Px(v) => length(v),
        Extent::Percent(f) => percent(f),
    }
}

fn track_min_to_taffy(m: &TrackMin) -> taffy::style::MinTrackSizingFunction {
    match m {
        TrackMin::Px(n) => length(*n),
        TrackMin::Percent(n) => percent(*n),
        TrackMin::Auto => auto(),
        TrackMin::MinContent => min_content(),
        TrackMin::MaxContent => max_content(),
    }
}

fn track_max_to_taffy(m: &TrackMax) -> taffy::style::MaxTrackSizingFunction {
    match m {
        TrackMax::Px(n) => length(*n),
        TrackMax::Percent(n) => percent(*n),
        TrackMax::Fr(n) => fr(*n),
        TrackMax::Auto => auto(),
        TrackMax::MinContent => min_content(),
        TrackMax::MaxContent => max_content(),
    }
}

fn track_to_template(t: &TrackSize) -> taffy::style::GridTemplateComponent<String> {
    if let TrackSize::AutoFit(n) = t {
        return taffy::style_helpers::repeat(
            taffy::style::RepetitionCount::AutoFit,
            vec![minmax(length(*n), fr(1.0_f32))],
        );
    }
    if let TrackSize::AutoFill(n) = t {
        return taffy::style_helpers::repeat(
            taffy::style::RepetitionCount::AutoFill,
            vec![minmax(length(*n), fr(1.0_f32))],
        );
    }
    let sized: taffy::style::TrackSizingFunction = match t {
        TrackSize::Px(n) => length(*n),
        TrackSize::Fr(n) => fr(*n),
        TrackSize::Auto => auto(),
        TrackSize::MinContent => min_content(),
        TrackSize::MaxContent => max_content(),
        TrackSize::Percent(n) => percent(*n),
        TrackSize::FitContent(n) => fit_content(length(*n)),
        TrackSize::MinMax(min, max) => minmax(track_min_to_taffy(min), track_max_to_taffy(max)),
        TrackSize::AutoFit(_) | TrackSize::AutoFill(_) => unreachable!("handled above"),
    };
    sized.into()
}

fn track_to_non_repeated(t: &TrackSize) -> taffy::style::TrackSizingFunction {
    match t {
        TrackSize::Px(n) => length(*n),
        TrackSize::Fr(n) => fr(*n),
        TrackSize::Auto => auto(),
        TrackSize::MinContent => min_content(),
        TrackSize::MaxContent => max_content(),
        TrackSize::AutoFit(n) | TrackSize::AutoFill(n) => minmax(length(*n), fr(1.0_f32)),
        TrackSize::Percent(n) => percent(*n),
        TrackSize::FitContent(n) => fit_content(length(*n)),
        TrackSize::MinMax(min, max) => minmax(track_min_to_taffy(min), track_max_to_taffy(max)),
    }
}

fn gridline_to_placement(gl: &GridLine) -> taffy::style::GridPlacement {
    match gl {
        GridLine::Auto => auto(),
        GridLine::Line(n) => line(*n),
        GridLine::Span(n) => span(*n),
        GridLine::NamedLine(name, n) => taffy::style::GridPlacement::NamedLine(name.clone(), *n),
        GridLine::NamedSpan(name, n) => taffy::style::GridPlacement::NamedSpan(name.clone(), *n),
    }
}

fn align_to_taffy(a: AlignValue) -> taffy::style::AlignItems {
    match a {
        AlignValue::Start => taffy::style::AlignItems::Start,
        AlignValue::End => taffy::style::AlignItems::End,
        AlignValue::FlexStart => taffy::style::AlignItems::FlexStart,
        AlignValue::FlexEnd => taffy::style::AlignItems::FlexEnd,
        AlignValue::Center => taffy::style::AlignItems::Center,
        AlignValue::Baseline => taffy::style::AlignItems::Baseline,
        AlignValue::Stretch => taffy::style::AlignItems::Stretch,
    }
}

fn justify_to_taffy(j: JustifyValue) -> taffy::style::JustifyContent {
    match j {
        JustifyValue::Start => taffy::style::JustifyContent::Start,
        JustifyValue::End => taffy::style::JustifyContent::End,
        JustifyValue::FlexStart => taffy::style::JustifyContent::FlexStart,
        JustifyValue::FlexEnd => taffy::style::JustifyContent::FlexEnd,
        JustifyValue::Center => taffy::style::JustifyContent::Center,
        JustifyValue::Stretch => taffy::style::JustifyContent::Stretch,
        JustifyValue::SpaceBetween => taffy::style::JustifyContent::SpaceBetween,
        JustifyValue::SpaceEvenly => taffy::style::JustifyContent::SpaceEvenly,
        JustifyValue::SpaceAround => taffy::style::JustifyContent::SpaceAround,
    }
}

fn wrap_to_taffy(w: kit10_scene::FlexWrapValue) -> taffy::style::FlexWrap {
    use kit10_scene::FlexWrapValue;
    match w {
        FlexWrapValue::NoWrap => taffy::style::FlexWrap::NoWrap,
        FlexWrapValue::Wrap => taffy::style::FlexWrap::Wrap,
        FlexWrapValue::WrapReverse => taffy::style::FlexWrap::WrapReverse,
    }
}

fn justify_to_align_content(j: JustifyValue) -> taffy::style::AlignContent {
    match j {
        JustifyValue::Start => taffy::style::AlignContent::Start,
        JustifyValue::End => taffy::style::AlignContent::End,
        JustifyValue::FlexStart => taffy::style::AlignContent::FlexStart,
        JustifyValue::FlexEnd => taffy::style::AlignContent::FlexEnd,
        JustifyValue::Center => taffy::style::AlignContent::Center,
        JustifyValue::Stretch => taffy::style::AlignContent::Stretch,
        JustifyValue::SpaceBetween => taffy::style::AlignContent::SpaceBetween,
        JustifyValue::SpaceEvenly => taffy::style::AlignContent::SpaceEvenly,
        JustifyValue::SpaceAround => taffy::style::AlignContent::SpaceAround,
    }
}

fn auto_flow_to_taffy(f: kit10_scene::GridAutoFlow) -> taffy::style::GridAutoFlow {
    use kit10_scene::GridAutoFlow;
    match f {
        GridAutoFlow::Row => taffy::style::GridAutoFlow::Row,
        GridAutoFlow::Column => taffy::style::GridAutoFlow::Column,
        GridAutoFlow::RowDense => taffy::style::GridAutoFlow::RowDense,
        GridAutoFlow::ColumnDense => taffy::style::GridAutoFlow::ColumnDense,
    }
}

// extra.position is deliberately NEVER mapped onto taffy's own Style.position/inset here -- see
// Vellum's own apply_box_extra doc comment (taf_can_do/src/layout/mod.rs): taffy's
// Position::Absolute invokes CSS shrink-to-fit intrinsic sizing (probes measure functions with
// available_space = Definite(0.0)), which has nothing to do with "does this node participate in
// flow". build_taffy_tree instead gives Absolute/Anchored nodes their own independent taffy
// subtree (sized via ordinary auto-sizing) and applies (x,y)/(dx,dy) as a pure post-layout
// translation in walk_tree, exactly mirroring Vellum's own resolution.
fn apply_box_extra(style: &mut taffy::style::Style, extra: &BoxExtra) {
    style.gap = Size { width: length(extra.gap), height: length(extra.gap) };

    if let Some(a) = extra.align_items {
        style.align_items = Some(align_to_taffy(a));
    }
    if let Some(j) = extra.justify_content {
        style.justify_content = Some(justify_to_taffy(j));
    }
    if let Some(a) = extra.justify_items {
        style.justify_items = Some(align_to_taffy(a));
    }
    if let Some(j) = extra.align_content {
        style.align_content = Some(justify_to_align_content(j));
    }
    style.flex_wrap = wrap_to_taffy(extra.flex_wrap);

    style.flex_grow = extra.flex_grow;
    if let Some(shrink) = extra.flex_shrink {
        style.flex_shrink = shrink;
    }
    if let Some(a) = extra.align_self {
        style.align_self = Some(align_to_taffy(a));
    }
    if let Some(a) = extra.justify_self {
        style.justify_self = Some(align_to_taffy(a));
    }
    if let Some(basis) = extra.flex_basis {
        style.flex_basis = extent_dim(basis);
    }

    style.margin = Rect {
        top: length(extra.margin),
        right: length(extra.margin),
        bottom: length(extra.margin),
        left: length(extra.margin),
    };

    if !extra.grid_template_columns.is_empty() || !extra.grid_template_rows.is_empty() {
        style.display = Display::Grid;
    }
    if !extra.grid_template_columns.is_empty() {
        style.grid_template_columns = extra.grid_template_columns.iter().map(track_to_template).collect();
    }
    if !extra.grid_template_rows.is_empty() {
        style.grid_template_rows = extra.grid_template_rows.iter().map(track_to_template).collect();
    }
    if !extra.grid_auto_rows.is_empty() {
        style.grid_auto_rows = extra.grid_auto_rows.iter().map(track_to_non_repeated).collect();
    }
    if !extra.grid_auto_columns.is_empty() {
        style.grid_auto_columns = extra.grid_auto_columns.iter().map(track_to_non_repeated).collect();
    }
    style.grid_auto_flow = auto_flow_to_taffy(extra.grid_auto_flow);
    if !extra.grid_template_areas.is_empty() {
        style.grid_template_areas = extra
            .grid_template_areas
            .iter()
            .map(|a| taffy::style::GridTemplateArea {
                name: a.name.clone(),
                row_start: a.row_start,
                row_end: a.row_end,
                column_start: a.column_start,
                column_end: a.column_end,
            })
            .collect();
    }
    style.grid_column = Line {
        start: gridline_to_placement(&extra.grid_column.0),
        end: gridline_to_placement(&extra.grid_column.1),
    };
    style.grid_row = Line {
        start: gridline_to_placement(&extra.grid_row.0),
        end: gridline_to_placement(&extra.grid_row.1),
    };
}

fn node_parent(node: &UiNode) -> Option<usize> {
    match node {
        UiNode::Box(BoxData { parent_id, .. })
        | UiNode::Text(TextData { parent_id, .. })
        | UiNode::Img(ImgData { parent_id, .. })
        | UiNode::Shape(ShapeData { parent_id, .. })
        | UiNode::SpriteBatch(SpriteBatchData { parent_id, .. }) => *parent_id,
    }
}

fn node_opacity(node: &UiNode) -> f32 {
    match node {
        UiNode::Box(BoxData { opacity, .. })
        | UiNode::Text(TextData { opacity, .. })
        | UiNode::Img(ImgData { opacity, .. })
        | UiNode::Shape(ShapeData { opacity, .. })
        | UiNode::SpriteBatch(SpriteBatchData { opacity, .. }) => *opacity,
    }
}

fn node_position(node: &UiNode) -> NodePosition {
    match node {
        UiNode::Box(BoxData { extra, .. })
        | UiNode::Text(TextData { extra, .. })
        | UiNode::Img(ImgData { extra, .. })
        | UiNode::Shape(ShapeData { extra, .. })
        | UiNode::SpriteBatch(SpriteBatchData { extra, .. }) => extra.position,
    }
}

struct NodeSizing {
    flex_direction: FlexDir,
    width: Extent,
    height: Extent,
    min_width: Extent,
    min_height: Extent,
    max_width: Extent,
    max_height: Extent,
    padding: [f32; 4],
    border: f32,
}

fn node_style(node: &UiNode) -> NodeSizing {
    match node {
        UiNode::Box(BoxData {
            flex_direction, width, height, min_width, min_height, max_width, max_height,
            padding, border_width, show_border, ..
        }) => NodeSizing {
            flex_direction: *flex_direction,
            width: *width, height: *height,
            min_width: *min_width, min_height: *min_height,
            max_width: *max_width, max_height: *max_height,
            padding: *padding,
            border: if *show_border { *border_width } else { 0.0 },
        },
        UiNode::Text(TextData { width, height, padding, border_width, show_border, .. }) => NodeSizing {
            flex_direction: FlexDir::Row,
            width: *width, height: *height,
            min_width: Extent::Auto, min_height: Extent::Auto,
            max_width: Extent::Auto, max_height: Extent::Auto,
            padding: *padding,
            border: if *show_border { *border_width } else { 0.0 },
        },
        UiNode::Img(ImgData {
            width, height, min_width, min_height, max_width, max_height,
            padding, border_width, show_border, ..
        }) => NodeSizing {
            flex_direction: FlexDir::Row,
            width: *width, height: *height,
            min_width: *min_width, min_height: *min_height,
            max_width: *max_width, max_height: *max_height,
            padding: *padding,
            border: if *show_border { *border_width } else { 0.0 },
        },
        UiNode::Shape(ShapeData { width, height, min_width, min_height, max_width, max_height, .. }) => NodeSizing {
            flex_direction: FlexDir::Row,
            width: *width, height: *height,
            min_width: *min_width, min_height: *min_height,
            max_width: *max_width, max_height: *max_height,
            padding: [0.0; 4], border: 0.0,
        },
        UiNode::SpriteBatch(SpriteBatchData { width, height, min_width, min_height, max_width, max_height, .. }) => NodeSizing {
            flex_direction: FlexDir::Row,
            width: *width, height: *height,
            min_width: *min_width, min_height: *min_height,
            max_width: *max_width, max_height: *max_height,
            padding: [0.0; 4], border: 0.0,
        },
    }
}

// Module-level (not nested) so both build_taffy_tree (whole-scene) and build_taffy_subtree
// (single export root, for reflow -- see resolve_layout_reflowed) can share it.
fn build_node(
    tree: &mut TaffyTree,
    nodes: &[UiNode],
    index: usize,
    children_map: &HashMap<Option<usize>, Vec<usize>>,
    index_to_node_id: &mut HashMap<usize, taffy::NodeId>,
    anchored_roots: &mut Vec<(taffy::NodeId, usize, [f32; 2])>,
) -> taffy::NodeId {
    let node = &nodes[index];
    let sizing = node_style(node);
    let padding = sizing.padding;
    let border = sizing.border;

    let flex_direction = match sizing.flex_direction {
        FlexDir::Row => FlexDirection::Row,
        FlexDir::Column => FlexDirection::Column,
        FlexDir::RowReverse => FlexDirection::RowReverse,
        FlexDir::ColumnReverse => FlexDirection::ColumnReverse,
    };

    let mut style = Style {
        box_sizing: taffy::BoxSizing::ContentBox,
        flex_direction,
        size: Size { width: extent_dim(sizing.width), height: extent_dim(sizing.height) },
        min_size: Size { width: extent_dim(sizing.min_width), height: extent_dim(sizing.min_height) },
        max_size: Size { width: extent_dim(sizing.max_width), height: extent_dim(sizing.max_height) },
        padding: Rect {
            top: length(padding[0]), right: length(padding[1]),
            bottom: length(padding[2]), left: length(padding[3]),
        },
        border: Rect {
            top: length(border), right: length(border),
            bottom: length(border), left: length(border),
        },
        ..Default::default()
    };
    match node {
        UiNode::Box(BoxData { extra, .. })
        | UiNode::Shape(ShapeData { extra, .. })
        | UiNode::SpriteBatch(SpriteBatchData { extra, .. })
        | UiNode::Text(TextData { extra, .. })
        | UiNode::Img(ImgData { extra, .. }) => apply_box_extra(&mut style, extra),
    }

    let node_id = if let Some(child_indices) = children_map.get(&Some(index)) {
        let self_is_anchored = matches!(node_position(&nodes[index]), NodePosition::Anchored { .. });
        let mut child_node_ids: Vec<taffy::NodeId> = Vec::with_capacity(child_indices.len());
        for &child_idx in child_indices {
            let anchor_offset = if self_is_anchored {
                None
            } else if let NodePosition::Anchored { dx, dy } = node_position(&nodes[child_idx]) {
                Some([dx, dy])
            } else {
                None
            };
            let child_node_id = build_node(tree, nodes, child_idx, children_map, index_to_node_id, anchored_roots);
            match anchor_offset {
                Some(offset) => anchored_roots.push((child_node_id, index, offset)),
                None => child_node_ids.push(child_node_id),
            }
        }
        tree.new_with_children(style, &child_node_ids).unwrap()
    } else {
        tree.new_leaf(style).unwrap()
    };

    index_to_node_id.insert(index, node_id);
    node_id
}

/// Builds the taffy tree(s) for a node subtree rooted wherever the caller starts from. Returns
/// `(tree, roots, positioned_roots, anchored_roots, node_id_to_index)` -- `roots` is every
/// unpositioned top-level node id (parented under an invisible virtual root the caller lays out
/// directly), mirroring `build_taffy_tree`'s virtual-root construction in Vellum, but scoped here
/// to whatever slice of `parent_id: None` nodes the caller passes in (this plugin calls it once
/// per exported View root, not once for the whole project scene).
pub fn build_taffy_tree(
    nodes: &[UiNode],
) -> (
    TaffyTree,
    taffy::NodeId,
    Vec<(taffy::NodeId, [f32; 2])>,
    Vec<(taffy::NodeId, usize, [f32; 2])>,
    HashMap<taffy::NodeId, usize>,
) {
    let mut tree = TaffyTree::with_capacity(nodes.len() + 1);
    let mut index_to_node_id: HashMap<usize, taffy::NodeId> = HashMap::with_capacity(nodes.len());

    let mut children_map: HashMap<Option<usize>, Vec<usize>> = HashMap::with_capacity(nodes.len());
    for (i, node) in nodes.iter().enumerate() {
        children_map.entry(node_parent(node)).or_default().push(i);
    }

    let root_indices = children_map.remove(&None).unwrap_or_default();

    let mut child_node_ids: Vec<taffy::NodeId> = Vec::with_capacity(root_indices.len());
    let mut positioned_roots: Vec<(taffy::NodeId, [f32; 2])> = Vec::new();
    let mut anchored_roots: Vec<(taffy::NodeId, usize, [f32; 2])> = Vec::new();
    for &root_idx in &root_indices {
        let node_id = build_node(&mut tree, nodes, root_idx, &children_map, &mut index_to_node_id, &mut anchored_roots);
        let world_pos = match node_position(&nodes[root_idx]) {
            NodePosition::Absolute { x, y } => Some([x, y]),
            NodePosition::Relative | NodePosition::Nudged { .. } | NodePosition::Anchored { .. } => None,
        };
        match world_pos {
            Some(pos) => positioned_roots.push((node_id, pos)),
            None => child_node_ids.push(node_id),
        }
    }

    let virtual_style = Style {
        flex_direction: FlexDirection::Column,
        size: Size { width: auto(), height: auto() },
        ..Default::default()
    };
    let virtual_root = tree.new_with_children(virtual_style, &child_node_ids).unwrap();

    let node_id_to_index: HashMap<taffy::NodeId, usize> =
        index_to_node_id.into_iter().map(|(k, v)| (v, k)).collect();

    (tree, virtual_root, positioned_roots, anchored_roots, node_id_to_index)
}

/// Builds a taffy tree for JUST `root_idx`'s own subtree (no virtual root, no auto-discovery of
/// other `parent_id: None` nodes) -- the reflow entry point (`resolve_layout_reflowed`) always
/// targets one specific, already-known export root. When `forced_width_px` is `Some`, the ROOT
/// node's own `size`/`min_size`/`max_size` width are all pinned to that value (overriding
/// whatever `Extent` the root's own Kit authored, including any `max-width` that would otherwise
/// clamp it) -- this is what actually makes reflow happen: taffy resolves every descendant's
/// `Percent` widths, flex-wrap breakpoints, and flex-basis math against the root's OWN computed
/// width during normal layout, regardless of what `available_space` the top-level
/// `compute_layout` call was given, so pinning the root's width is sufficient to make the whole
/// subtree "responsively" resolve against the new target width the same way a browser reflows a
/// page when you resize its viewport.
fn build_taffy_subtree(
    nodes: &[UiNode],
    root_idx: usize,
    forced_width_px: Option<f32>,
) -> (TaffyTree, taffy::NodeId, Vec<(taffy::NodeId, usize, [f32; 2])>, HashMap<taffy::NodeId, usize>) {
    let mut tree = TaffyTree::with_capacity(64);
    let mut index_to_node_id: HashMap<usize, taffy::NodeId> = HashMap::new();
    let mut children_map: HashMap<Option<usize>, Vec<usize>> = HashMap::new();
    for (i, node) in nodes.iter().enumerate() {
        children_map.entry(node_parent(node)).or_default().push(i);
    }

    let mut anchored_roots: Vec<(taffy::NodeId, usize, [f32; 2])> = Vec::new();
    let root_node_id = build_node(&mut tree, nodes, root_idx, &children_map, &mut index_to_node_id, &mut anchored_roots);

    if let Some(w) = forced_width_px {
        if let Ok(base_style) = tree.style(root_node_id) {
            let mut style = base_style.clone();
            style.size.width = length(w);
            style.min_size.width = length(w);
            style.max_size.width = length(w);
            let _ = tree.set_style(root_node_id, style);
        }
    }

    let node_id_to_index: HashMap<taffy::NodeId, usize> =
        index_to_node_id.into_iter().map(|(k, v)| (v, k)).collect();
    (tree, root_node_id, anchored_roots, node_id_to_index)
}

/// A node's resolved geometry + composed opacity, in the exported root's own local space
/// (top-left origin, Y-down -- `page.rs` handles the PDF Y-flip separately, once, at the page
/// level). Deliberately just geometry: `paint.rs` reads color/border/corner/content straight off
/// the original `&UiNode`, so this never duplicates paint state the way Vellum's `LayoutRect`
/// does (that duplication exists there to feed a GPU vertex buffer directly -- no equivalent need
/// here).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ResolvedRect {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
    pub opacity: f32,
}

/// Character-count-heuristic fallback (`content.chars().count() * font_size * 0.55` wide,
/// `font_size * 1.2` tall when `line_height <= 0.0`, single line) -- used only when a Text
/// node's font never resolved (catalogue miss, fetch failure), matching `paint_text`'s own
/// silently-skip-but-still-paint-a-background posture for the same case. The real, common path
/// is `measure_node` below, which wraps/measures with the actual shaped font.
fn heuristic_size(known_dimensions: taffy::Size<Option<f32>>, content: &str, font_size: f32, line_height: f32) -> taffy::Size<f32> {
    let width = known_dimensions.width.unwrap_or_else(|| content.chars().count() as f32 * font_size * 0.55);
    let height = known_dimensions.height.unwrap_or(if line_height > 0.0 { line_height } else { font_size * 1.2 });
    Size { width, height }
}

/// Real text auto-sizing measurement: shapes `content` with rustybuzz against the SAME font
/// `paint_text` will later draw with (`FontEntry::shaped_face`, wght variation included), and
/// wraps it with `wrap::wrap_lines` using taffy's own `available_space` query -- `Definite(w)`
/// wraps to that width and reports the widest resulting line + `lines * line_height` tall;
/// `MinContent`/`MaxContent` report the widest-single-word / whole-content-as-one-line widths
/// taffy expects for those intrinsic-sizing queries respectively. Because `paint_text` wraps the
/// SAME content against the box's own final resolved width using the SAME `wrap_lines` function,
/// the line breaks decided here are guaranteed to be exactly what gets drawn -- a wrapped line
/// can never overflow the box sized to fit it.
fn measure_node(
    known_dimensions: taffy::Size<Option<f32>>,
    available_space: taffy::Size<taffy::AvailableSpace>,
    node_id: taffy::NodeId,
    nodes: &[UiNode],
    node_id_to_index: &HashMap<taffy::NodeId, usize>,
    fonts: &FontCache,
) -> taffy::Size<f32> {
    if let Size { width: Some(w), height: Some(h) } = known_dimensions {
        return Size { width: w, height: h };
    }
    let Some(&idx) = node_id_to_index.get(&node_id) else {
        return Size::ZERO;
    };
    let UiNode::Text(TextData { content, font_size, line_height, font_family, font_weight, font_style, .. }) = &nodes[idx] else {
        return Size::ZERO;
    };

    let Some(font_entry) = fonts.get(font_family, *font_weight, *font_style) else {
        return heuristic_size(known_dimensions, content, *font_size, *line_height);
    };
    let Some(face) = font_entry.shaped_face(*font_weight) else {
        return heuristic_size(known_dimensions, content, *font_size, *line_height);
    };
    let units_per_em = face.units_per_em() as f32;
    if units_per_em <= 0.0 {
        return heuristic_size(known_dimensions, content, *font_size, *line_height);
    }

    let line_h = if *line_height > 0.0 {
        *line_height
    } else {
        (face.ascender() as f32 - face.descender() as f32) / units_per_em * *font_size
    };

    let width = known_dimensions.width.unwrap_or_else(|| match available_space.width {
        taffy::AvailableSpace::Definite(w) => crate::wrap::wrap_lines(&face, content, *font_size, Some(w))
            .iter()
            .map(|line| crate::wrap::measure_advance(&face, line, *font_size))
            .fold(0.0_f32, f32::max),
        taffy::AvailableSpace::MinContent => crate::wrap::min_content_width(&face, content, *font_size),
        taffy::AvailableSpace::MaxContent => crate::wrap::measure_advance(&face, content, *font_size),
    });
    let height = known_dimensions.height.unwrap_or_else(|| {
        let num_lines = match available_space.width {
            taffy::AvailableSpace::Definite(w) => crate::wrap::wrap_lines(&face, content, *font_size, Some(w)).len(),
            // MinContent/MaxContent are intrinsic-sizing probes (e.g. flex-shrink's own min/max
            // pass), not the final resolved width -- always single-line here, matching how a
            // real `Definite` pass at the box's true final width is what actually decides how
            // many lines this text needs; over-reporting height for an intrinsic probe would
            // make flex-shrink calculations see a taller node than the node will ever actually be.
            taffy::AvailableSpace::MinContent | taffy::AvailableSpace::MaxContent => 1,
        };
        num_lines.max(1) as f32 * line_h
    });
    Size { width, height }
}

fn run_layout_root(
    tree: &mut TaffyTree,
    root: taffy::NodeId,
    offset: [f32; 2],
    opacity: f32,
    nodes: &[UiNode],
    node_id_to_index: &HashMap<taffy::NodeId, usize>,
    fonts: &FontCache,
) -> HashMap<usize, ResolvedRect> {
    tree.compute_layout_with_measure(root, taffy::Size::MAX_CONTENT, |kd, av, nid, _, _| {
        measure_node(kd, av, nid, nodes, node_id_to_index, fonts)
    })
    .unwrap();

    let mut out = HashMap::new();
    walk_tree(tree, root, offset[0], offset[1], opacity, nodes, node_id_to_index, &mut out);
    out
}

fn walk_tree(
    tree: &TaffyTree,
    node: taffy::NodeId,
    parent_x: f32,
    parent_y: f32,
    parent_opacity: f32,
    nodes: &[UiNode],
    node_id_to_index: &HashMap<taffy::NodeId, usize>,
    out: &mut HashMap<usize, ResolvedRect>,
) {
    let layout = tree.layout(node).unwrap();
    let mut global_x = parent_x + layout.location.x;
    let mut global_y = parent_y + layout.location.y;
    let mut effective_opacity = parent_opacity;

    if let Some(&index) = node_id_to_index.get(&node) {
        if let NodePosition::Nudged { dx, dy } = node_position(&nodes[index]) {
            global_x += dx;
            global_y += dy;
        }
    }

    if let Some(&index) = node_id_to_index.get(&node) {
        effective_opacity = parent_opacity * node_opacity(&nodes[index]);
        out.insert(
            index,
            ResolvedRect {
                x: global_x,
                y: global_y,
                width: layout.size.width,
                height: layout.size.height,
                opacity: effective_opacity,
            },
        );
    }

    for child in tree.children(node).unwrap() {
        walk_tree(tree, child, global_x, global_y, effective_opacity, nodes, node_id_to_index, out);
    }
}

/// Resolves every node under `roots` (a set of `parent_id: None` node indices within `nodes`,
/// e.g. `tree::resolve_export_roots`'s output) to an absolute `ResolvedRect`, handling the same
/// three-pass Absolute/Anchored resolution `run_full_layout` does in Vellum: main flowing tree,
/// then each `Absolute` root's own independent subtree (world-space offset, always opacity 1.0 --
/// root-only by construction, no UiNode ancestor), then `Anchored` subtrees resolved against
/// their recorded parent's now-known rect (inherits that parent's real opacity, not 1.0).
pub fn resolve_layout(nodes: &[UiNode], fonts: &FontCache) -> HashMap<usize, ResolvedRect> {
    let (mut tree, virtual_root, positioned_roots, anchored_roots, node_id_to_index) = build_taffy_tree(nodes);

    let mut result = run_layout_root(&mut tree, virtual_root, [0.0, 0.0], 1.0, nodes, &node_id_to_index, fonts);

    for &(root, offset) in &positioned_roots {
        result.extend(run_layout_root(&mut tree, root, offset, 1.0, nodes, &node_id_to_index, fonts));
    }

    if !anchored_roots.is_empty() {
        let mut index_pos: HashMap<usize, [f32; 2]> =
            result.iter().map(|(&i, r)| (i, [r.x, r.y])).collect();
        let mut index_opacity: HashMap<usize, f32> =
            result.iter().map(|(&i, r)| (i, r.opacity)).collect();
        for &(anchor_node, parent_index, local_offset) in &anchored_roots {
            let Some(&parent_pos) = index_pos.get(&parent_index) else { continue };
            let parent_opacity = index_opacity.get(&parent_index).copied().unwrap_or(1.0);
            let world_offset = [parent_pos[0] + local_offset[0], parent_pos[1] + local_offset[1]];
            let sub = run_layout_root(&mut tree, anchor_node, world_offset, parent_opacity, nodes, &node_id_to_index, fonts);
            for (&i, r) in &sub {
                index_pos.entry(i).or_insert([r.x, r.y]);
                index_opacity.entry(i).or_insert(r.opacity);
            }
            result.extend(sub);
        }
    }

    result
}

/// Reflow variant of `resolve_layout`, scoped to exactly ONE export root (not the whole scene):
/// pins that root's own width to `target_width_px` (see `build_taffy_subtree`'s doc comment for
/// why that alone is enough to make descendants -- `Percent` widths, flex-wrap breakpoints,
/// flex-basis math -- responsively resolve against the new width), then resolves the resulting
/// layout the same way `resolve_layout` does for a positioned root (anchored-children third pass
/// included). Used when the export's "reflow to page size" option is on and a real paper preset
/// (not "Fit to artwork") is selected -- see `page.rs`'s own module doc comment for the
/// print-vs-responsive distinction this exists to bridge.
pub fn resolve_layout_reflowed(
    nodes: &[UiNode],
    root_idx: usize,
    target_width_px: f32,
    fonts: &FontCache,
) -> HashMap<usize, ResolvedRect> {
    let (mut tree, root_id, anchored_roots, node_id_to_index) =
        build_taffy_subtree(nodes, root_idx, Some(target_width_px));

    let mut result = run_layout_root(&mut tree, root_id, [0.0, 0.0], 1.0, nodes, &node_id_to_index, fonts);

    if !anchored_roots.is_empty() {
        let mut index_pos: HashMap<usize, [f32; 2]> =
            result.iter().map(|(&i, r)| (i, [r.x, r.y])).collect();
        let mut index_opacity: HashMap<usize, f32> =
            result.iter().map(|(&i, r)| (i, r.opacity)).collect();
        for &(anchor_node, parent_index, local_offset) in &anchored_roots {
            let Some(&parent_pos) = index_pos.get(&parent_index) else { continue };
            let parent_opacity = index_opacity.get(&parent_index).copied().unwrap_or(1.0);
            let world_offset = [parent_pos[0] + local_offset[0], parent_pos[1] + local_offset[1]];
            let sub = run_layout_root(&mut tree, anchor_node, world_offset, parent_opacity, nodes, &node_id_to_index, fonts);
            for (&i, r) in &sub {
                index_pos.entry(i).or_insert([r.x, r.y]);
                index_opacity.entry(i).or_insert(r.opacity);
            }
            result.extend(sub);
        }
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tree::test_support::test_box;
    use kit10_scene::{FlexDir, JustifyValue, OklabColor};

    fn box_with(width: Extent, height: Extent, extra: BoxExtra, parent_id: Option<usize>) -> UiNode {
        UiNode::Box(BoxData { width, height, extra, ..test_box(parent_id) })
    }

    #[test]
    fn a_stack_of_two_fixed_children_lays_out_column_by_default_flow() {
        // Row default (test_box uses FlexDir::Row) with two 100px-wide children side by side.
        let nodes = vec![
            box_with(Extent::Px(400.0), Extent::Px(100.0), BoxExtra::default(), None),
            box_with(Extent::Px(100.0), Extent::Px(100.0), BoxExtra::default(), Some(0)),
            box_with(Extent::Px(100.0), Extent::Px(100.0), BoxExtra::default(), Some(0)),
        ];
        let rects = resolve_layout(&nodes, &FontCache::default());
        assert_eq!(rects[&0].width, 400.0);
        assert_eq!(rects[&1].x, 0.0);
        assert_eq!(rects[&2].x, 100.0);
    }

    #[test]
    fn center_arranged_pair_centers_on_the_main_axis() {
        let mut root_node = box_with(
            Extent::Px(300.0),
            Extent::Px(100.0),
            BoxExtra { justify_content: Some(JustifyValue::Center), ..Default::default() },
            None,
        );
        if let UiNode::Box(b) = &mut root_node {
            b.flex_direction = FlexDir::Row;
        }
        let nodes = vec![
            root_node,
            box_with(Extent::Px(50.0), Extent::Px(50.0), BoxExtra::default(), Some(0)),
            box_with(Extent::Px(50.0), Extent::Px(50.0), BoxExtra::default(), Some(0)),
        ];
        let rects = resolve_layout(&nodes, &FontCache::default());
        // Two 50px children (100px total) centered in a 300px row -> 100px leading gap.
        assert_eq!(rects[&1].x, 100.0);
        assert_eq!(rects[&2].x, 150.0);
    }

    #[test]
    fn a_named_grid_area_places_a_child_without_panicking() {
        use kit10_scene::{GridTemplateArea, TrackSize};
        let extra = BoxExtra {
            grid_template_columns: vec![TrackSize::Fr(1.0), TrackSize::Fr(1.0)],
            grid_template_rows: vec![TrackSize::Px(100.0)],
            grid_template_areas: vec![GridTemplateArea {
                name: "a".to_string(), row_start: 1, row_end: 2, column_start: 1, column_end: 2,
            }],
            ..Default::default()
        };
        let root = box_with(Extent::Px(300.0), Extent::Px(100.0), extra, None);
        let nodes = vec![root, box_with(Extent::Auto, Extent::Auto, BoxExtra::default(), Some(0))];
        let rects = resolve_layout(&nodes, &FontCache::default());
        assert_eq!(rects.len(), 2);
    }

    #[test]
    fn absolute_root_is_a_pure_world_space_translation() {
        let mut node = box_with(Extent::Px(50.0), Extent::Px(50.0), BoxExtra::default(), None);
        if let UiNode::Box(b) = &mut node {
            b.extra.position = NodePosition::Absolute { x: 200.0, y: 300.0 };
        }
        let rects = resolve_layout(&[node], &FontCache::default());
        assert_eq!((rects[&0].x, rects[&0].y), (200.0, 300.0));
    }

    #[test]
    fn opacity_composes_multiplicatively_down_the_tree() {
        let mut root_node = box_with(Extent::Px(100.0), Extent::Px(100.0), BoxExtra::default(), None);
        if let UiNode::Box(b) = &mut root_node {
            b.opacity = 0.5;
        }
        let mut child_node = box_with(Extent::Px(50.0), Extent::Px(50.0), BoxExtra::default(), Some(0));
        if let UiNode::Box(b) = &mut child_node {
            b.opacity = 0.5;
        }
        let rects = resolve_layout(&[root_node, child_node], &FontCache::default());
        assert!((rects[&1].opacity - 0.25).abs() < 1e-6);
    }

    #[test]
    fn unused_import_guard() {
        let _ = OklabColor::default();
    }

    #[test]
    fn resolve_layout_reflowed_pins_root_width_and_reflows_percent_children() {
        // The actual feature request: picking a paper preset should REFLOW content to that
        // width (like a browser resizing a viewport), not just uniformly scale the artwork
        // laid out at its own natural size. A root authored at 900px wide with two 50%-width
        // children (450px each at the natural width) must, once reflowed to a 600px target,
        // resolve those SAME children to 300px each -- proving Percent math re-resolves against
        // the NEW width, not a scaled copy of the old one.
        let root = box_with(Extent::Px(900.0), Extent::Auto, BoxExtra::default(), None);
        let left = box_with(Extent::Percent(0.5), Extent::Px(100.0), BoxExtra::default(), Some(0));
        let right = box_with(Extent::Percent(0.5), Extent::Px(100.0), BoxExtra::default(), Some(0));
        let nodes = [root, left, right];

        let natural = resolve_layout(&nodes, &FontCache::default());
        assert_eq!(natural[&0].width, 900.0);
        assert_eq!(natural[&1].width, 450.0);

        let reflowed = resolve_layout_reflowed(&nodes, 0, 600.0, &FontCache::default());
        assert_eq!(reflowed[&0].width, 600.0, "root width must be pinned to the reflow target");
        assert_eq!(reflowed[&1].width, 300.0, "50% child must re-resolve against the NEW 600px width, not scale from 450");
        assert_eq!(reflowed[&2].width, 300.0);
    }

    #[test]
    fn resolve_layout_reflowed_ignores_the_roots_own_authored_max_width() {
        // A root's own `max-width` was authored for its NATURAL context -- reflowing to a wider
        // page shouldn't stay clamped to that old ceiling, or "reflow" would silently degrade
        // back into "scale" for any Kit that happens to set a max-width.
        let mut root = box_with(Extent::Px(900.0), Extent::Auto, BoxExtra::default(), None);
        if let UiNode::Box(b) = &mut root {
            b.max_width = Extent::Px(900.0);
        }
        let reflowed = resolve_layout_reflowed(&[root], 0, 1200.0, &FontCache::default());
        assert_eq!(reflowed[&0].width, 1200.0);
    }
}
