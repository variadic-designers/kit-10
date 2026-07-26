// CSS/SCSS value formatting and the Phase 2 nested-stylesheet renderer (see
// resources/webcodium-export-plan.md). html.rs owns markup, tree.rs owns node-graph structure --
// this module only ever turns a UiNode's own fields into declaration strings.

use crate::tree::class_name;
use kit10_scene::{
    AlignValue, Extent, FlexDir, FlexWrapValue, FontStyle, GridLine, JustifyValue, OklabColor,
    TextAlign, TextDecorationKind, TrackSize, UiNode,
};
use std::collections::HashMap;

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

// Shared by `align-items` and `align-self` -- both take the same CSS keyword set.
fn align_css(a: &AlignValue) -> &'static str {
    match a {
        AlignValue::Start => "start",
        AlignValue::End => "end",
        AlignValue::FlexStart => "flex-start",
        AlignValue::FlexEnd => "flex-end",
        AlignValue::Center => "center",
        AlignValue::Baseline => "baseline",
        AlignValue::Stretch => "stretch",
    }
}

fn justify_css(j: &JustifyValue) -> &'static str {
    match j {
        JustifyValue::Start => "start",
        JustifyValue::End => "end",
        JustifyValue::FlexStart => "flex-start",
        JustifyValue::FlexEnd => "flex-end",
        JustifyValue::Center => "center",
        JustifyValue::Stretch => "stretch",
        JustifyValue::SpaceBetween => "space-between",
        JustifyValue::SpaceEvenly => "space-evenly",
        JustifyValue::SpaceAround => "space-around",
    }
}

fn flex_wrap_css(w: &FlexWrapValue) -> Option<&'static str> {
    match w {
        FlexWrapValue::NoWrap => None,
        FlexWrapValue::Wrap => Some("wrap"),
        FlexWrapValue::WrapReverse => Some("wrap-reverse"),
    }
}

// flex-basis's own CSS default is already `auto`, but here `Auto` is a real, explicit value (the
// wire's `Option<Extent>` is what carries the "don't emit" signal, at the call site) -- unlike
// extent_css, Auto maps to the literal keyword instead of None.
fn flex_basis_css(e: &Extent) -> String {
    match e {
        Extent::Auto => "auto".to_string(),
        Extent::Px(n) => format!("{n}px"),
        Extent::Percent(n) => format!("{}%", n * 100.0),
    }
}

// grid-template-columns/rows: a track list can `repeat(auto-fit, ...)` (see kit10-scene's
// TrackSize::AutoFit doc comment). Mirrors taf_can_do's track_to_template exactly.
fn track_size_css(t: &TrackSize) -> String {
    match t {
        TrackSize::Px(n) => format!("{n}px"),
        TrackSize::Fr(n) => format!("{n}fr"),
        TrackSize::Auto => "auto".to_string(),
        TrackSize::MinContent => "min-content".to_string(),
        TrackSize::MaxContent => "max-content".to_string(),
        TrackSize::AutoFit(n) => format!("repeat(auto-fit, minmax({n}px, 1fr))"),
    }
}

// grid-auto-rows/columns: tracks here can't repeat, so AutoFit degenerates to a plain minmax()
// with no repeat() wrapper -- mirrors taf_can_do's track_to_non_repeated exactly.
fn track_size_non_repeated_css(t: &TrackSize) -> String {
    match t {
        TrackSize::AutoFit(n) => format!("minmax({n}px, 1fr)"),
        other => track_size_css(other),
    }
}

fn track_list_css(tracks: &[TrackSize]) -> String {
    tracks.iter().map(track_size_css).collect::<Vec<_>>().join(" ")
}

fn track_list_non_repeated_css(tracks: &[TrackSize]) -> String {
    tracks.iter().map(track_size_non_repeated_css).collect::<Vec<_>>().join(" ")
}

// grid-column/grid-row's line reference -- matches taffy's own line()/span() helpers, which are
// already 1:1 with real CSS grid-line numbering (confirmed against gridline_to_placement in
// taf_can_do/src/layout/mod.rs).
fn grid_line_css(g: &GridLine) -> String {
    match g {
        GridLine::Auto => "auto".to_string(),
        GridLine::Line(n) => n.to_string(),
        GridLine::Span(n) => format!("span {n}"),
    }
}

// WebCodium's baseline -- removes the two browser UA-stylesheet defaults that would otherwise
// leak into every export: the page-edge body margin, and per-paragraph spacing Charter never sets
// (TextData has no margin field at all). Deliberately first-party and this narrow, not a
// third-party reset library (normalize.css, "the-new-css-reset", etc.) -- WebCodium only ever
// emits <div>/<p> (see html::render_html_node), so a general-purpose reset's real useful surface
// for us is tiny, and one popular option's `box-sizing: border-box` would actively conflict with
// Vellum's own layout math: taf_can_do/src/layout/mod.rs deliberately overrides taffy's default
// to `box_sizing: ContentBox` ("CSS default is content-box... BorderBox would shrink content when
// padding increases"). Do NOT add a box-sizing rule here -- it would make every exported box
// render smaller than Vellum's own canvas shows it.
pub(crate) const BASELINE_RESET: &str = "body {\n  margin: 0;\n}\np {\n  margin: 0;\n}\n";

pub(crate) fn with_reset(generated: &str) -> String {
    format!("{BASELINE_RESET}\n{generated}")
}

// This node's own declarations, not including nested children -- None for Img (out of scope, see
// html::render_html_node, which never wraps or recurses into an Img either).
fn node_props(node: &UiNode) -> Option<Vec<String>> {
    let mut props: Vec<String> = Vec::new();
    match node {
        UiNode::Box(d) => {
            if let Some(w) = extent_css(&d.width) {
                props.push(format!("width: {w};"));
            }
            if let Some(h) = extent_css(&d.height) {
                props.push(format!("height: {h};"));
            }
            if let Some(w) = extent_css(&d.min_width) {
                props.push(format!("min-width: {w};"));
            }
            if let Some(h) = extent_css(&d.min_height) {
                props.push(format!("min-height: {h};"));
            }
            if let Some(w) = extent_css(&d.max_width) {
                props.push(format!("max-width: {w};"));
            }
            if let Some(h) = extent_css(&d.max_height) {
                props.push(format!("max-height: {h};"));
            }
            props.push(format!(
                "padding: {}px {}px {}px {}px;",
                d.padding[0], d.padding[1], d.padding[2], d.padding[3]
            ));
            props.push(format!("background: {};", oklab_css(&d.bg_color)));

            // display: grid vs flex -- mirrors Vellum's own rule exactly (apply_box_extra,
            // taf_can_do/src/layout/mod.rs): grid iff either template list is non-empty.
            let is_grid =
                !d.extra.grid_template_columns.is_empty() || !d.extra.grid_template_rows.is_empty();
            if is_grid {
                props.push("display: grid;".to_string());
                if !d.extra.grid_template_columns.is_empty() {
                    props.push(format!(
                        "grid-template-columns: {};",
                        track_list_css(&d.extra.grid_template_columns)
                    ));
                }
                if !d.extra.grid_template_rows.is_empty() {
                    props.push(format!(
                        "grid-template-rows: {};",
                        track_list_css(&d.extra.grid_template_rows)
                    ));
                }
                if !d.extra.grid_auto_rows.is_empty() {
                    props.push(format!(
                        "grid-auto-rows: {};",
                        track_list_non_repeated_css(&d.extra.grid_auto_rows)
                    ));
                }
                if !d.extra.grid_auto_columns.is_empty() {
                    props.push(format!(
                        "grid-auto-columns: {};",
                        track_list_non_repeated_css(&d.extra.grid_auto_columns)
                    ));
                }
            } else {
                props.push("display: flex;".to_string());
                // Irrelevant to a grid container -- only meaningful (and only emitted) for flex.
                props.push(format!("flex-direction: {};", flex_dir_css(&d.flex_direction)));
                if let Some(w) = flex_wrap_css(&d.extra.flex_wrap) {
                    props.push(format!("flex-wrap: {w};"));
                }
            }

            let default_grid_line = (GridLine::default(), GridLine::default());
            if d.extra.grid_column != default_grid_line {
                props.push(format!(
                    "grid-column: {} / {};",
                    grid_line_css(&d.extra.grid_column.0),
                    grid_line_css(&d.extra.grid_column.1)
                ));
            }
            if d.extra.grid_row != default_grid_line {
                props.push(format!(
                    "grid-row: {} / {};",
                    grid_line_css(&d.extra.grid_row.0),
                    grid_line_css(&d.extra.grid_row.1)
                ));
            }

            // Container alignment -- meaningful under both flex and grid, so emitted unconditionally
            // regardless of is_grid above (real CSS honors both properties for either display mode).
            if let Some(a) = &d.extra.align_items {
                props.push(format!("align-items: {};", align_css(a)));
            }
            if let Some(j) = &d.extra.justify_content {
                props.push(format!("justify-content: {};", justify_css(j)));
            }

            // Item sizing/alignment -- governed by the PARENT's own display mode, which this node
            // has no cheap way to know here; harmless to always emit, since a real browser (like
            // taffy) simply ignores flex-item properties when the parent isn't a flex container.
            if d.extra.flex_grow != 0.0 {
                props.push(format!("flex-grow: {};", d.extra.flex_grow));
            }
            if let Some(s) = d.extra.flex_shrink {
                props.push(format!("flex-shrink: {s};"));
            }
            if let Some(a) = &d.extra.align_self {
                props.push(format!("align-self: {};", align_css(a)));
            }
            if let Some(b) = &d.extra.flex_basis {
                props.push(format!("flex-basis: {};", flex_basis_css(b)));
            }

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
        UiNode::Img(_) => return None,
    }
    Some(props)
}

/// Nested SCSS mirroring the same parent/child structure html::render_html renders as nested
/// `<div>`s -- only Box nodes recurse into children here, matching render_html_node exactly, so a
/// selector is never emitted for a node the HTML side wouldn't actually nest under it.
///
/// This is deliberately plain descendant nesting -- no `&`, no Sass variables, no mixins -- which
/// makes it simultaneously valid real Sass (renameable straight to a `.scss` file and compiled)
/// AND valid native CSS (the CSS Nesting spec, Baseline across evergreen browsers since 2023), so
/// inlining it into the exported HTML's `<style>` block still renders correctly, same as Phase
/// 1's flat rules did -- specificity is unaffected since every class is already a unique
/// per-node name, so descendant-vs-child nesting semantics never matter here. Per
/// resources/webcodium-export-plan.md Phase 2: still one exported file, still one class per
/// rendered node instance -- a pure syntax-target swap on top of Phase 1's existing per-node
/// translation, not Phase 3's axis/Kit-aware rewrite (that needs the unresolved kit/axis shape,
/// which this still never sees).
pub(crate) fn render_scss(
    nodes: &[UiNode],
    children: &HashMap<usize, Vec<usize>>,
    roots: &[usize],
) -> String {
    let mut out = String::new();
    for &i in roots {
        render_scss_node(nodes, children, i, 0, &mut out);
    }
    out
}

fn render_scss_node(
    nodes: &[UiNode],
    children: &HashMap<usize, Vec<usize>>,
    i: usize,
    depth: usize,
    out: &mut String,
) {
    let Some(props) = node_props(&nodes[i]) else { return };
    // Box/Text always push at least one property unconditionally above, so this is never empty
    // in practice -- checked anyway so a future property-list change can't silently emit a
    // dangling empty rule wrapper.
    let has_rule = !props.is_empty();
    let indent = "  ".repeat(depth);
    if has_rule {
        out.push_str(&format!("{indent}.{} {{\n", class_name(i)));
        let inner_indent = "  ".repeat(depth + 1);
        for p in &props {
            out.push_str(&format!("{inner_indent}{p}\n"));
        }
    }
    if matches!(nodes[i], UiNode::Box(_)) {
        if let Some(kids) = children.get(&i) {
            let child_depth = if has_rule { depth + 1 } else { depth };
            for &k in kids {
                render_scss_node(nodes, children, k, child_depth, out);
            }
        }
    }
    if has_rule {
        out.push_str(&format!("{indent}}}\n"));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::test_box;
    use kit10_scene::BoxExtra;

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
    fn baseline_reset_zeroes_body_and_p_margin_only() {
        assert!(BASELINE_RESET.contains("body"));
        assert!(BASELINE_RESET.contains("p {"));
        assert!(BASELINE_RESET.contains("margin: 0;"));
        // Regression guard: never reintroduce a global box-sizing rule here -- it would conflict
        // with Vellum's own deliberate content-box layout math (see the doc comment above).
        assert!(!BASELINE_RESET.contains("box-sizing"));
    }

    #[test]
    fn with_reset_prepends_baseline_before_generated_content() {
        let out = with_reset(".k10-0 {\n  width: 200px;\n}\n");
        assert!(out.starts_with(BASELINE_RESET));
        assert!(out.contains(".k10-0 {"));
    }

    #[test]
    fn align_css_variants() {
        assert_eq!(align_css(&AlignValue::FlexStart), "flex-start");
        assert_eq!(align_css(&AlignValue::Center), "center");
        assert_eq!(align_css(&AlignValue::Stretch), "stretch");
    }

    #[test]
    fn justify_css_variants() {
        assert_eq!(justify_css(&JustifyValue::SpaceBetween), "space-between");
        assert_eq!(justify_css(&JustifyValue::SpaceEvenly), "space-evenly");
        assert_eq!(justify_css(&JustifyValue::Center), "center");
    }

    #[test]
    fn flex_wrap_css_variants() {
        assert_eq!(flex_wrap_css(&FlexWrapValue::NoWrap), None);
        assert_eq!(flex_wrap_css(&FlexWrapValue::Wrap), Some("wrap"));
        assert_eq!(flex_wrap_css(&FlexWrapValue::WrapReverse), Some("wrap-reverse"));
    }

    #[test]
    fn track_size_css_variants() {
        assert_eq!(track_size_css(&TrackSize::Px(80.0)), "80px");
        assert_eq!(track_size_css(&TrackSize::Fr(1.0)), "1fr");
        assert_eq!(track_size_css(&TrackSize::Auto), "auto");
        assert_eq!(
            track_size_css(&TrackSize::AutoFit(80.0)),
            "repeat(auto-fit, minmax(80px, 1fr))"
        );
    }

    #[test]
    fn track_size_non_repeated_css_degrades_autofit_without_repeat() {
        assert_eq!(track_size_non_repeated_css(&TrackSize::AutoFit(80.0)), "minmax(80px, 1fr)");
        assert_eq!(track_size_non_repeated_css(&TrackSize::Fr(1.0)), "1fr");
    }

    #[test]
    fn grid_line_css_variants() {
        assert_eq!(grid_line_css(&GridLine::Auto), "auto");
        assert_eq!(grid_line_css(&GridLine::Line(2)), "2");
        assert_eq!(grid_line_css(&GridLine::Span(3)), "span 3");
    }

    // Regression test for the reported bug: a Box with arrange: split (Charter's compile_arrange
    // sets justify_content: Some(SpaceBetween)) must actually emit justify-content in the export.
    #[test]
    fn split_arrangement_emits_justify_content_space_between() {
        let split = kit10_scene::BoxData {
            extra: BoxExtra { justify_content: Some(JustifyValue::SpaceBetween), ..Default::default() },
            ..test_box(None)
        };
        let props = node_props(&UiNode::Box(split)).unwrap();
        assert!(props.contains(&"justify-content: space-between;".to_string()));
    }

    // Regression test for the reported bug: a Hug-resized child (compile_resize sets
    // flex_shrink: Some(0.0)) must emit flex-shrink, and its parent's align-items (Split/Center's
    // own default) must be emitted too -- together these are what stop a real browser from
    // stretching the child to fill the row (CSS default align-items is stretch-equivalent).
    #[test]
    fn hug_child_and_split_parent_emit_the_properties_that_prevent_browser_stretch() {
        let hug_child = kit10_scene::BoxData {
            extra: BoxExtra {
                flex_grow: 0.0,
                flex_shrink: Some(0.0),
                ..Default::default()
            },
            ..test_box(None)
        };
        let child_props = node_props(&UiNode::Box(hug_child)).unwrap();
        assert!(child_props.contains(&"flex-shrink: 0;".to_string()));
        assert!(!child_props.iter().any(|p| p.starts_with("flex-grow")));

        let split_parent = kit10_scene::BoxData {
            extra: BoxExtra { align_items: Some(AlignValue::Center), ..Default::default() },
            ..test_box(None)
        };
        let parent_props = node_props(&UiNode::Box(split_parent)).unwrap();
        assert!(parent_props.contains(&"align-items: center;".to_string()));
    }

    #[test]
    fn grid_arrangement_emits_display_grid_and_template_columns_not_flex_direction() {
        let grid_box = kit10_scene::BoxData {
            extra: BoxExtra {
                grid_template_columns: vec![TrackSize::AutoFit(80.0)],
                ..Default::default()
            },
            ..test_box(None)
        };
        let props = node_props(&UiNode::Box(grid_box)).unwrap();
        assert!(props.contains(&"display: grid;".to_string()));
        assert!(props.contains(&"grid-template-columns: repeat(auto-fit, minmax(80px, 1fr));".to_string()));
        assert!(!props.iter().any(|p| p.starts_with("flex-direction")));
        assert!(!props.iter().any(|p| p == "display: flex;"));
    }
}
