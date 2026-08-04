// CSS/SCSS value formatting and the Phase 2 nested-stylesheet renderer (see
// resources/webcodium-export-plan.md). html.rs owns markup, tree.rs owns node-graph structure --
// this module only ever turns a UiNode's own fields into declaration strings.

use crate::tree;
use crate::variants::{self, KitExportShape};
use kit10_scene::{
    AlignValue, Extent, FlexDir, FlexWrapValue, FontStyle, GridAutoFlow, GridLine, GridTemplateArea,
    JustifyValue, OklabColor, TextAlign, TextDecorationKind, TrackMax, TrackMin, TrackSize, UiNode,
};
use std::collections::{HashMap, HashSet};

// OklabColor's fields map directly onto CSS Color 4's oklab() function -- L as a percentage
// (matching this codebase's own convention, e.g. manager.svelte.ts's log-color comments), a/b as
// plain numbers, no gamut conversion needed since the browser interprets oklab() natively.
pub(crate) fn oklab_css(c: &OklabColor) -> String {
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

// pub(crate) -- also called from lib.rs's distinct_font_requests to derive the same style string
// Fontavious's variant_url expects, so the (family, weight, style) key used for @font-face
// requests always matches the literal string this module's own Text node_props emits.
pub(crate) fn font_style_css(s: &FontStyle) -> &'static str {
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

fn track_min_css(m: &TrackMin) -> String {
    match m {
        TrackMin::Px(n) => format!("{n}px"),
        TrackMin::Percent(n) => format!("{n}%"),
        TrackMin::Auto => "auto".to_string(),
        TrackMin::MinContent => "min-content".to_string(),
        TrackMin::MaxContent => "max-content".to_string(),
    }
}

fn track_max_css(m: &TrackMax) -> String {
    match m {
        TrackMax::Px(n) => format!("{n}px"),
        TrackMax::Percent(n) => format!("{n}%"),
        TrackMax::Fr(n) => format!("{n}fr"),
        TrackMax::Auto => "auto".to_string(),
        TrackMax::MinContent => "min-content".to_string(),
        TrackMax::MaxContent => "max-content".to_string(),
    }
}

// grid-template-columns/rows: a track list can `repeat(auto-fit/auto-fill, ...)` (see
// kit10-scene's TrackSize doc comments). Mirrors taf_can_do's track_to_template exactly.
fn track_size_css(t: &TrackSize) -> String {
    match t {
        TrackSize::Px(n) => format!("{n}px"),
        TrackSize::Fr(n) => format!("{n}fr"),
        TrackSize::Auto => "auto".to_string(),
        TrackSize::MinContent => "min-content".to_string(),
        TrackSize::MaxContent => "max-content".to_string(),
        TrackSize::AutoFit(n) => format!("repeat(auto-fit, minmax({n}px, 1fr))"),
        TrackSize::Percent(n) => format!("{n}%"),
        TrackSize::FitContent(n) => format!("fit-content({n}px)"),
        TrackSize::AutoFill(n) => format!("repeat(auto-fill, minmax({n}px, 1fr))"),
        TrackSize::MinMax(min, max) => format!("minmax({}, {})", track_min_css(min), track_max_css(max)),
    }
}

// grid-auto-rows/columns: tracks here can't repeat, so AutoFit/AutoFill degenerate to a plain
// minmax() with no repeat() wrapper -- mirrors taf_can_do's track_to_non_repeated exactly.
fn track_size_non_repeated_css(t: &TrackSize) -> String {
    match t {
        TrackSize::AutoFit(n) | TrackSize::AutoFill(n) => format!("minmax({n}px, 1fr)"),
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
        GridLine::NamedLine(name, n) if *n == 1 => name.clone(),
        GridLine::NamedLine(name, n) => format!("{name} {n}"),
        GridLine::NamedSpan(name, n) if *n == 1 => format!("span {name}"),
        GridLine::NamedSpan(name, n) => format!("span {n} {name}"),
    }
}

fn grid_auto_flow_css(f: &GridAutoFlow) -> &'static str {
    match f {
        GridAutoFlow::Row => "row",
        GridAutoFlow::Column => "column",
        GridAutoFlow::RowDense => "row dense",
        GridAutoFlow::ColumnDense => "column dense",
    }
}

// grid-template-areas' real CSS quoted-row syntax -- the inverse of Charter's
// parse_grid_template_areas, so a round-tripped area always exports as genuine, spec-correct CSS.
// Reconstructs one quoted row per resolved row line, filling any cell not covered by a named area
// with CSS's own null-cell token (".").
fn grid_template_areas_css(areas: &[GridTemplateArea]) -> String {
    if areas.is_empty() {
        return String::new();
    }
    let row_count = areas.iter().map(|a| a.row_end - 1).max().unwrap_or(0);
    let col_count = areas.iter().map(|a| a.column_end - 1).max().unwrap_or(0);
    let mut rows = Vec::with_capacity(row_count as usize);
    for row in 1..=row_count {
        let mut cells = Vec::with_capacity(col_count as usize);
        for col in 1..=col_count {
            let name = areas
                .iter()
                .find(|a| row >= a.row_start && row < a.row_end && col >= a.column_start && col < a.column_end)
                .map(|a| a.name.as_str())
                .unwrap_or(".");
            cells.push(name.to_string());
        }
        rows.push(format!("\"{}\"", cells.join(" ")));
    }
    rows.join(" ")
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

// One `@font-face` block per distinct (family, style, URL) -- always emitted as `format("woff2")`
// since that's the only format Fontavious ever fetches (see CLAUDE.md's Fontavious section: it
// streams WOFF2 exclusively). A request with no resolved link (kit10_get_font_links found no URL
// for it -- a catalogue miss, or an uncatalogued family) is simply absent from `links`, so it's
// skipped here too: the exported `font-family: "X";` declaration elsewhere in the stylesheet still
// stands, the browser just falls back to a locally-installed or generic font for it, same as it
// always did before this feature existed.
//
// Grouped by URL, not by request: several distinct (family, weight, style) requests can legitimately
// resolve to the SAME url (CLAUDE.md's Fontavious section -- "most catalogued families are variable
// fonts where one URL covers a continuous range"). Emitting one block per REQUEST repeated the
// identical file's `src` once per weight -- four blocks for Inter 400/500/600/700 all pointing at
// the same variable woff2. Two requests can only ever share a url by construction of what
// Fontavious returns for a variable font, so collapsing them into ONE block with a font-weight
// RANGE (`font-weight: 400 700;`, real CSS variable-font syntax) is always correct, never a false
// merge of two unrelated static files -- those always have distinct urls and stay separate blocks
// (`min == max`, a plain single-value descriptor, exactly like before).
pub(crate) fn render_font_faces(links: &[crate::ResolvedFontLink]) -> String {
    let mut groups: Vec<(String, String, String)> = Vec::new(); // (family, style, url), first-seen order
    let mut weights_by_group: HashMap<(String, String, String), Vec<u16>> = HashMap::new();
    for link in links {
        let key = (link.family.clone(), link.style.clone(), link.url.clone());
        if !weights_by_group.contains_key(&key) {
            groups.push(key.clone());
        }
        weights_by_group.entry(key).or_default().push(link.weight);
    }

    let mut out = String::new();
    for key @ (family, style, url) in &groups {
        let weights = &weights_by_group[key];
        let min = *weights.iter().min().unwrap();
        let max = *weights.iter().max().unwrap();
        let weight_descriptor = if min == max { min.to_string() } else { format!("{min} {max}") };
        out.push_str(&format!(
            "@font-face {{\n  font-family: \"{family}\";\n  font-weight: {weight_descriptor};\n  font-style: {style};\n  src: url(\"{url}\") format(\"woff2\");\n}}\n"
        ));
    }
    out
}

// Real CSS has no broadly-shipped way to render a true superellipse corner (no confirmed stable
// support for `corner-shape: superellipse()`, and `clip-path: path(...)` clips the whole element
// without drawing a matching border/shadow along the new silhouette - would need extra markup per
// squircle-styled node for a fallback whose whole point is staying simple). So a squircle box
// exports as a PROPORTIONALLY SCALED circular `border-radius` instead of its own literal
// corner_radius - "same px value" is not actually the closest match: a circular corner at radius r
// removes a fixed ~21.5% of its own r×r corner-square area (1 - pi/4), while Vellum's shipped
// squircle (SQUIRCLE_N = 4, taf_can_do/src/render/shader.wgsl) removes a fixed ~7.3%
// (1 - integral of (1-x^4)^0.25 from 0 to 1) - both ratios independent of r. SQUIRCLE_AREA_MATCH_SCALE
// is the radius multiplier that makes the fallback circle remove the SAME ABSOLUTE corner area the
// squircle did, so the exported page reads as proportionally similar rather than "same number,
// rounder shape". See squircle_area_match_scale_is_self_consistent below for the derivation, and
// resources/webcodium-export-plan.md for the full writeup.
//
// COUPLING WARNING: this constant is mathematically derived FROM SQUIRCLE_N = 4. If that shader
// constant is ever retuned, this must be recomputed too - there is no automated link across the
// WGSL/Rust-Charter/Rust-WebCodium boundary for it.
pub(crate) const SQUIRCLE_AREA_MATCH_SCALE: f64 = 0.58306;

// Shared by Box and Text -- both carry padding/background/border/border-radius/opacity
// identically on the wire (mirrors Charter's own `extract_paint_props`, which is shared by
// `build_box_node`/`build_text_node` for exactly this reason: real CSS text can have a
// background, a border, and padding without stopping being text -- a highlighted/pill label --
// and Vellum's `node_rect` draws these for `Text` exactly like it does for `Box`). Previously only
// the `Box` match arm in `node_props` emitted these, so a highlighted/bordered/padded Text label
// silently lost all four in export while rendering correctly in the editor canvas -- a real,
// found-via-audit bug (2026-07-27), not a hypothetical.
#[allow(clippy::too_many_arguments)]
fn paint_props(
    padding: [f32; 4],
    bg_color: &OklabColor,
    show_border: bool,
    border_color: &OklabColor,
    border_width: f32,
    corner_radius: f32,
    squircle: bool,
    opacity: f32,
) -> Vec<String> {
    let mut props = Vec::new();
    props.push(format!(
        "padding: {}px {}px {}px {}px;",
        padding[0], padding[1], padding[2], padding[3]
    ));
    props.push(format!("background: {};", oklab_css(bg_color)));
    if show_border {
        props.push(format!("border: {border_width}px solid {};", oklab_css(border_color)));
    }
    if corner_radius > 0.0 {
        let exported_radius = if squircle {
            ((corner_radius as f64) * SQUIRCLE_AREA_MATCH_SCALE).round()
        } else {
            corner_radius as f64
        };
        props.push(format!("border-radius: {exported_radius}px;"));
    }
    if opacity < 1.0 {
        props.push(format!("opacity: {opacity};"));
    }
    props
}

// This node's own declarations, not including nested children. `has_resolved_img_src` gates the
// Img case -- None when no real URL was resolved for this node's asset id (see lib.rs's
// kit10_get_asset_links call and tree.rs's doc comment on why an unresolved image still emits no
// rule at all, matching html::render_html_node emitting no `<img>` tag either).
fn node_props(node: &UiNode, has_resolved_img_src: bool) -> Option<Vec<String>> {
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
            props.extend(paint_props(
                d.padding,
                &d.bg_color,
                d.show_border,
                &d.border_color,
                d.border_width,
                d.corner_radius,
                d.squircle,
                d.opacity,
            ));

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
                if !d.extra.grid_template_areas.is_empty() {
                    props.push(format!(
                        "grid-template-areas: {};",
                        grid_template_areas_css(&d.extra.grid_template_areas)
                    ));
                }
                if d.extra.grid_auto_flow != GridAutoFlow::default() {
                    props.push(format!("grid-auto-flow: {};", grid_auto_flow_css(&d.extra.grid_auto_flow)));
                }
                if let Some(j) = &d.extra.justify_items {
                    props.push(format!("justify-items: {};", align_css(j)));
                }
                if let Some(a) = &d.extra.align_content {
                    props.push(format!("align-content: {};", justify_css(a)));
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
            // justify-self is grid-only in real CSS (ignored under flex), same
            // harmless-to-always-emit reasoning as align-self above.
            if let Some(j) = &d.extra.justify_self {
                props.push(format!("justify-self: {};", align_css(j)));
            }
            if let Some(b) = &d.extra.flex_basis {
                props.push(format!("flex-basis: {};", flex_basis_css(b)));
            }

            if d.extra.gap > 0.0 {
                props.push(format!("gap: {}px;", d.extra.gap));
            }
        }
        UiNode::Text(d) => {
            if let Some(w) = extent_css(&d.width) {
                props.push(format!("width: {w};"));
            }
            props.extend(paint_props(
                d.padding,
                &d.bg_color,
                d.show_border,
                &d.border_color,
                d.border_width,
                d.corner_radius,
                d.squircle,
                d.opacity,
            ));
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
        UiNode::Img(d) => {
            // No known URL for this image (see lib.rs's kit10_get_asset_links) -- no rule at
            // all, matching html.rs emitting no `<img>` tag for the same node. ImageSource::None/
            // Bytes sources are also out of scope (no data-URI embedding) -- both resolve to
            // has_resolved_img_src == false at the call site.
            if !has_resolved_img_src {
                return None;
            }
            if let Some(w) = extent_css(&d.width) {
                props.push(format!("width: {w};"));
            }
            if let Some(h) = extent_css(&d.height) {
                props.push(format!("height: {h};"));
            }
            // `fit`/`object_position` are already real CSS vocabulary -- `fit` is one of
            // "cover"/"contain"/"fill" (all valid `object-fit` keywords), and object_position's
            // 0..1 fractions convert directly to CSS's percentage syntax.
            props.push(format!("object-fit: {};", d.fit));
            props.push(format!(
                "object-position: {}% {}%;",
                d.object_position[0] * 100.0,
                d.object_position[1] * 100.0
            ));
        }
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
// node_view_ids/node_kit_ids/kit_names/kit_shapes are the Kit-basis export plumbing (Phase 3):
// a node whose node_kit_ids[i] names a Kit WITH a fetched shape gets its rule(s) synthesized from
// that shape (variants::synthesize_base_declarations/synthesize_variant_rules) instead of from
// node_props -- see the module-level doc comment on node_props' continued role for everything
// else. A Kit's rule is emitted only once, on the first node instance encountered for that
// kit_id (`emitted_kits`); later instances print no wrapper at all (see render_scss_node's own
// `!props.is_empty()` guard) -- a NEW nested child Kit encountered under a later instance still
// gets the correct indentation depth even though nothing was printed for its parent, since
// `child_depth` increments independently of whether the wrapper text itself was written.
// This dedup is keyed on the Kit NAME resolving, not on the shape being fetched -- a Kit whose
// shape never resolved still shares tree::resolve_class_name's class with every other instance,
// so it must still only ever be emitted once, just falling back to node_props for that one
// occurrence instead of a shape-synthesized rule; see render_scss_node's `named_kit_id`.
#[allow(clippy::too_many_arguments)]
pub(crate) fn render_scss(
    nodes: &[UiNode],
    children: &HashMap<usize, Vec<usize>>,
    roots: &[usize],
    node_view_ids: &[String],
    node_kit_ids: &[String],
    kit_names: &HashMap<String, String>,
    kit_shapes: &HashMap<String, KitExportShape>,
    asset_links: &HashMap<String, String>,
    project_tokens: &variants::ProjectTokens,
    kit_variant_rules: &HashMap<String, Vec<variants::VariantRule>>,
    view_compositions: &HashMap<String, Vec<String>>,
) -> String {
    let mut out = String::new();
    let mut emitted_kits: HashSet<String> = HashSet::new();
    let positions = tree::normalized_root_positions(nodes, roots);
    for &i in roots {
        let position = positions.get(&i).copied();
        render_scss_node(
            nodes,
            children,
            node_view_ids,
            node_kit_ids,
            kit_names,
            kit_shapes,
            asset_links,
            project_tokens,
            kit_variant_rules,
            view_compositions,
            &mut emitted_kits,
            i,
            0,
            position,
            &mut out,
        );
    }
    out
}

// The actual compound-selector text for one VariantRule, given the Kit's own class name. STATIC
// rules repeat `.{class}` once per condition (`.button.button--plan-elite.button--theme-dark`) --
// this is what makes CSS's own specificity (one point per class token in a compound selector)
// naturally rank an N-condition rule above an (N-1)-condition rule with zero extra bookkeeping,
// mirroring resolve.ts's own condition-count-first specificity order. DYNAMIC rules keep the
// original direct-concatenation form (`.button:hover`) -- a pseudo-class isn't a class token, and
// dynamic rules never chain (see variants.rs's module doc comment).
fn variant_rule_selector(class: &str, rule: &variants::VariantRule) -> String {
    if rule.dynamic {
        let suffix = rule.suffixes.first().map(String::as_str).unwrap_or("");
        format!(".{class}{suffix}")
    } else {
        let chained: String = rule.suffixes.iter().map(|s| format!(".{class}{s}")).collect();
        format!(".{class}{chained}")
    }
}

// Img nodes never go through the Kit-basis variants.rs path, even when composed via a Kit
// (node_kit_ids[i] non-empty) -- that machinery synthesizes CSS from literal PAINT/LAYOUT
// properties (background, flex-direction, ...), and has no concept of `src`/`fit`/
// `object-position` at all. Routing an Img through it would either silently drop those three
// properties or flag them as "unsupported compiled" (neither is right -- they're perfectly
// literal, just outside that module's vocabulary). Img still gets its class name from
// resolve_class_name's normal 3-tier scheme (Kit name / "img" / positional), independent of this.
#[allow(clippy::too_many_arguments)]
#[allow(clippy::too_many_arguments)]
fn render_scss_node(
    nodes: &[UiNode],
    children: &HashMap<usize, Vec<usize>>,
    node_view_ids: &[String],
    node_kit_ids: &[String],
    kit_names: &HashMap<String, String>,
    kit_shapes: &HashMap<String, KitExportShape>,
    asset_links: &HashMap<String, String>,
    project_tokens: &variants::ProjectTokens,
    kit_variant_rules: &HashMap<String, Vec<variants::VariantRule>>,
    view_compositions: &HashMap<String, Vec<String>>,
    emitted_kits: &mut HashSet<String>,
    i: usize,
    depth: usize,
    position: Option<(f32, f32)>,
    out: &mut String,
) {
    let is_img = matches!(nodes[i], UiNode::Img(_));
    // The Kit id whose NAME resolves (tree::resolve_class_name's tier 1) -- this is what
    // determines whether this node's selector is a SHARED Kit-identity class (deduped, one
    // rule for every instance) versus a per-instance fallback (`.box`/`.text`/`.k10-N`, never
    // deduped). Deliberately independent of whether a SHAPE was fetched for it:
    // tree::resolve_class_name picks the shared name off kit_names alone, with no kit_shapes
    // check, so a Kit with a resolved name but a missing/unfetched shape still renders under
    // that same shared class -- gating dedup on kit_shapes as well used to let every instance
    // fall through to the `None` branch below and each print its own full, undeduped rule
    // under one shared selector.
    let named_kit_id: Option<&String> = if is_img {
        None
    } else {
        node_kit_ids.get(i).filter(|id| !id.is_empty() && kit_names.contains_key(id.as_str()))
    };

    let empty_rules: Vec<variants::VariantRule> = Vec::new();
    let (props, variant_rules): (Option<Vec<String>>, &[variants::VariantRule]) = if is_img {
        let has_resolved_img_src = tree::resolved_img_src(&nodes[i], asset_links).is_some();
        (node_props(&nodes[i], has_resolved_img_src), &empty_rules)
    } else {
        match named_kit_id {
            Some(kid) => {
                if emitted_kits.insert(kid.clone()) {
                    match kit_shapes.get(kid) {
                        Some(shape) => {
                            let is_box = matches!(nodes[i], UiNode::Box(_));
                            (
                                Some(variants::synthesize_base_declarations_with_tokens(
                                    shape,
                                    is_box,
                                    project_tokens,
                                )),
                                kit_variant_rules.get(kid).map(Vec::as_slice).unwrap_or(&empty_rules),
                            )
                        }
                        // Shape never fetched/resolved for this Kit -- fall back to this first
                        // instance's own literal properties (same source the no-Kit-name path
                        // below uses), but still claimed in emitted_kits above so later
                        // instances of the same shared class don't repeat it.
                        None => (node_props(&nodes[i], false), &empty_rules),
                    }
                } else {
                    // Already emitted elsewhere -- keep the wrapper (nesting depth for any new
                    // child this instance introduces) but no duplicate content.
                    (Some(Vec::new()), &empty_rules)
                }
            }
            None => (node_props(&nodes[i], false), &empty_rules),
        }
    };

    let Some(props) = props else { return };
    // Box/Text always push at least one property unconditionally above, so a kit-less node is
    // never empty in practice -- checked anyway so a future property-list change can't silently
    // emit a dangling empty rule wrapper. A Kit-identified node always opens its wrapper
    // regardless (see the doc comment above -- nesting-depth stability for later instances).
    let has_rule = named_kit_id.is_some() || !props.is_empty();
    let class = tree::resolve_class_name(i, nodes, node_view_ids, node_kit_ids, kit_names);
    let indent = "  ".repeat(depth);
    let inner_indent = "  ".repeat(depth + 1);

    // A pinned/positioned root's class may be a Kit's own SHARED selector (tree::resolve_class_name
    // tier 1) -- the same class every other, unpositioned instance of that Kit also renders under.
    // World-space (x, y) is per-VIEW-INSTANCE data, never per-Kit, so it can't be folded into that
    // shared rule's own declarations without leaking this instance's position onto every other
    // instance of the same Kit. Instead it always gets its own separate rule under
    // tree::class_name(i) -- the plain positional fallback keyed on this node's own array index,
    // which is guaranteed unique per node and therefore never collides with any other node's
    // class, Kit-shared or not (see root_position's doc comment in tree.rs for the wrapper shape
    // this reads). The rendered element carries both classes (see html.rs).
    if let Some((x, y)) = position {
        out.push_str(&format!("{indent}.{} {{\n", tree::class_name(i)));
        out.push_str(&format!("{inner_indent}position: absolute;\n"));
        out.push_str(&format!("{inner_indent}left: {x}px;\n"));
        out.push_str(&format!("{inner_indent}top: {y}px;\n"));
        out.push_str(&format!("{indent}}}\n"));
    }

    // A Kit-identified node revisited after its first occurrence has nothing left to say here --
    // its declarations/variants were already emitted at that first occurrence (`props` is empty).
    // Printing another `.class {\n}\n` block for every later instance was pure visual noise: this
    // "nesting" is cosmetic indentation only (every rule closes its own braces, right above,
    // BEFORE any child is ever recursed into -- there is no real CSS/SCSS nesting relying on the
    // block staying open). `child_depth` below still increments as if this block were printed, so
    // a child's own indentation stays identical to what a first-occurrence sibling's child gets --
    // only the empty, contentless wrapper text itself is skipped.
    if has_rule && !props.is_empty() {
        out.push_str(&format!("{indent}.{class} {{\n"));
        for p in &props {
            out.push_str(&format!("{inner_indent}{p}\n"));
        }
        out.push_str(&format!("{indent}}}\n"));

        // Static/dynamic variant rules ride at the SAME depth as the base rule, not nested
        // inside it -- they're independent selectors on the same element (a BEM modifier class
        // or a pseudo-class), not a descendant. Emitting them here, at this exact recursion
        // point, is what makes a nested child Kit's OWN modifier compile to the correct full
        // path (e.g. `.button .card--variant`) via plain SCSS/CSS nesting -- see the plan doc's
        // nesting-vs-modifier decision.
        for rule in variant_rules {
            let selector = variant_rule_selector(&class, rule);
            out.push_str(&format!("{indent}{selector} {{\n"));
            for d in &rule.declarations {
                out.push_str(&format!("{inner_indent}{d}\n"));
            }
            out.push_str(&format!("{indent}}}\n"));
        }
    }

    // Every OTHER kit this node's own view composes, beyond the single primary named_kit_id
    // above (Charter's own node_kit_ids collapses to one "winning" kit per node) -- e.g. a
    // lower-priority kit in a multi-kit composition, which would otherwise never get its own
    // shared class/base rule emitted at all. Flat sibling rules under that kit's own class,
    // deduped by emitted_kits the same way the primary block already is -- so a kit already
    // emitted as some OTHER node's primary (or another node's secondary) is never repeated. Img
    // nodes are excluded the same way the primary block is (named_kit_id is always None for
    // them).
    if !is_img {
        let view_id = node_view_ids.get(i).map(String::as_str).unwrap_or("");
        if let Some(kit_ids) = view_compositions.get(view_id) {
            let primary_kit_id = named_kit_id.map(String::as_str).unwrap_or("");
            let is_box = matches!(nodes[i], UiNode::Box(_));
            for kid in kit_ids {
                if kid.as_str() == primary_kit_id || !emitted_kits.insert(kid.clone()) {
                    continue;
                }
                let Some(name) = kit_names.get(kid) else { continue };
                let slug = tree::kit_class_name(name);
                if slug.is_empty() {
                    continue;
                }
                let Some(shape) = kit_shapes.get(kid) else { continue };
                let decls =
                    variants::synthesize_base_declarations_with_tokens(shape, is_box, project_tokens);
                if !decls.is_empty() {
                    out.push_str(&format!("{indent}.{slug} {{\n"));
                    for d in &decls {
                        out.push_str(&format!("{inner_indent}{d}\n"));
                    }
                    out.push_str(&format!("{indent}}}\n"));
                }
                for rule in kit_variant_rules.get(kid).map(Vec::as_slice).unwrap_or(&[]) {
                    let selector = variant_rule_selector(&slug, rule);
                    out.push_str(&format!("{indent}{selector} {{\n"));
                    for d in &rule.declarations {
                        out.push_str(&format!("{inner_indent}{d}\n"));
                    }
                    out.push_str(&format!("{indent}}}\n"));
                }
            }
        }
    }

    if matches!(nodes[i], UiNode::Box(_)) {
        if let Some(kids) = children.get(&i) {
            let child_depth = if has_rule { depth + 1 } else { depth };
            for &k in kids {
                render_scss_node(
                    nodes,
                    children,
                    node_view_ids,
                    node_kit_ids,
                    kit_names,
                    kit_shapes,
                    asset_links,
                    project_tokens,
                    kit_variant_rules,
                    view_compositions,
                    emitted_kits,
                    k,
                    child_depth,
                    None,
                    out,
                );
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{test_box, test_text};
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
        assert_eq!(grid_line_css(&GridLine::NamedLine("sidebar".to_string(), 1)), "sidebar");
        assert_eq!(grid_line_css(&GridLine::NamedLine("sidebar".to_string(), 2)), "sidebar 2");
        assert_eq!(grid_line_css(&GridLine::NamedSpan("content".to_string(), 1)), "span content");
        assert_eq!(grid_line_css(&GridLine::NamedSpan("content".to_string(), 2)), "span 2 content");
    }

    #[test]
    fn track_size_css_covers_the_new_grid_mastery_variants() {
        assert_eq!(track_size_css(&TrackSize::Percent(50.0)), "50%");
        assert_eq!(track_size_css(&TrackSize::FitContent(220.0)), "fit-content(220px)");
        assert_eq!(
            track_size_css(&TrackSize::AutoFill(120.0)),
            "repeat(auto-fill, minmax(120px, 1fr))"
        );
        assert_eq!(
            track_size_css(&TrackSize::MinMax(TrackMin::Px(50.0), TrackMax::Fr(2.0))),
            "minmax(50px, 2fr)"
        );
        assert_eq!(
            track_size_non_repeated_css(&TrackSize::AutoFill(120.0)),
            "minmax(120px, 1fr)"
        );
    }

    #[test]
    fn grid_auto_flow_css_variants() {
        assert_eq!(grid_auto_flow_css(&GridAutoFlow::Row), "row");
        assert_eq!(grid_auto_flow_css(&GridAutoFlow::Column), "column");
        assert_eq!(grid_auto_flow_css(&GridAutoFlow::RowDense), "row dense");
        assert_eq!(grid_auto_flow_css(&GridAutoFlow::ColumnDense), "column dense");
    }

    #[test]
    fn grid_template_areas_css_reconstructs_the_quoted_row_syntax() {
        let areas = vec![
            GridTemplateArea { name: "header".to_string(), row_start: 1, row_end: 2, column_start: 1, column_end: 3 },
            GridTemplateArea { name: "sidebar".to_string(), row_start: 2, row_end: 3, column_start: 1, column_end: 2 },
            GridTemplateArea { name: "main".to_string(), row_start: 2, row_end: 3, column_start: 2, column_end: 3 },
        ];
        assert_eq!(
            grid_template_areas_css(&areas),
            r#""header header" "sidebar main""#
        );
    }

    #[test]
    fn grid_template_areas_css_fills_uncovered_cells_with_the_null_token() {
        let areas = vec![GridTemplateArea {
            name: "a".to_string(),
            row_start: 1,
            row_end: 2,
            column_start: 1,
            column_end: 2,
        }];
        assert_eq!(grid_template_areas_css(&areas), r#""a""#);
    }

    #[test]
    fn node_props_emits_the_five_new_grid_mastery_fields() {
        let d = kit10_scene::BoxData {
            extra: BoxExtra {
                grid_template_columns: vec![TrackSize::Fr(1.0)],
                grid_template_areas: vec![GridTemplateArea {
                    name: "a".to_string(),
                    row_start: 1,
                    row_end: 2,
                    column_start: 1,
                    column_end: 2,
                }],
                grid_auto_flow: GridAutoFlow::ColumnDense,
                justify_items: Some(AlignValue::Center),
                align_content: Some(JustifyValue::SpaceBetween),
                justify_self: Some(AlignValue::End),
                ..Default::default()
            },
            ..test_box(None)
        };
        let props = node_props(&UiNode::Box(d), false).unwrap();
        assert!(props.contains(&r#"grid-template-areas: "a";"#.to_string()));
        assert!(props.contains(&"grid-auto-flow: column dense;".to_string()));
        assert!(props.contains(&"justify-items: center;".to_string()));
        assert!(props.contains(&"align-content: space-between;".to_string()));
        assert!(props.contains(&"justify-self: end;".to_string()));
    }

    // Regression test for the reported bug: a Box with arrange: split (Charter's compile_arrange
    // sets justify_content: Some(SpaceBetween)) must actually emit justify-content in the export.
    #[test]
    fn split_arrangement_emits_justify_content_space_between() {
        let split = kit10_scene::BoxData {
            extra: BoxExtra { justify_content: Some(JustifyValue::SpaceBetween), ..Default::default() },
            ..test_box(None)
        };
        let props = node_props(&UiNode::Box(split), false).unwrap();
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
        let child_props = node_props(&UiNode::Box(hug_child), false).unwrap();
        assert!(child_props.contains(&"flex-shrink: 0;".to_string()));
        assert!(!child_props.iter().any(|p| p.starts_with("flex-grow")));

        let split_parent = kit10_scene::BoxData {
            extra: BoxExtra { align_items: Some(AlignValue::Center), ..Default::default() },
            ..test_box(None)
        };
        let parent_props = node_props(&UiNode::Box(split_parent), false).unwrap();
        assert!(parent_props.contains(&"align-items: center;".to_string()));
    }

    // Regression test: a Kit whose NAME resolved but whose SHAPE was never fetched (kit_names
    // has an entry, kit_shapes doesn't) must still only be emitted once across every instance
    // that shares its class -- previously the dedup check required BOTH kit_names and kit_shapes
    // to have an entry, so a shape-fetch miss made every instance independently fall through to
    // node_props and print its own full, undeduped rule under the one shared selector.
    #[test]
    fn a_kit_with_a_name_but_no_fetched_shape_is_still_only_emitted_once() {
        let nodes = vec![
            UiNode::Box(test_box(None)),
            UiNode::Box(test_box(None)),
            UiNode::Box(test_box(None)),
        ];
        let node_view_ids =
            vec!["view-a".to_string(), "view-b".to_string(), "view-c".to_string()];
        let node_kit_ids =
            vec!["photo-kit".to_string(), "photo-kit".to_string(), "photo-kit".to_string()];
        let mut kit_names = HashMap::new();
        kit_names.insert("photo-kit".to_string(), "Product Photo".to_string());
        let kit_shapes = HashMap::new(); // deliberately empty -- simulates a fetch miss

        let children = tree::build_children_map(&nodes);
        let roots: Vec<usize> = vec![0, 1, 2];
        let asset_links = HashMap::new();
        let kit_variant_rules = HashMap::new();
        let view_compositions = HashMap::new();
        let css = render_scss(
            &nodes,
            &children,
            &roots,
            &node_view_ids,
            &node_kit_ids,
            &kit_names,
            &kit_shapes,
            &asset_links,
            &variants::ProjectTokens::new(),
            &kit_variant_rules,
            &view_compositions,
        );

        assert_eq!(css.matches(".product-photo {").count(), 1);
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
        let props = node_props(&UiNode::Box(grid_box), false).unwrap();
        assert!(props.contains(&"display: grid;".to_string()));
        assert!(props.contains(&"grid-template-columns: repeat(auto-fit, minmax(80px, 1fr));".to_string()));
        assert!(!props.iter().any(|p| p.starts_with("flex-direction")));
        assert!(!props.iter().any(|p| p == "display: flex;"));
    }

    fn test_img() -> kit10_scene::ImgData {
        kit10_scene::ImgData {
            parent_id: None,
            width: Extent::Px(360.0),
            height: Extent::Px(280.0),
            source: kit10_scene::ImageSource::Ref("asset-1".to_string()),
            fit: "contain".to_string(),
            object_position: [0.0, 1.0],
            selected: 0,
            hovered: false,
        }
    }

    #[test]
    fn img_with_no_resolved_src_produces_no_rule_at_all() {
        assert!(node_props(&UiNode::Img(test_img()), false).is_none());
    }

    #[test]
    fn img_with_a_resolved_src_emits_size_and_object_fit_position() {
        let props = node_props(&UiNode::Img(test_img()), true).unwrap();
        assert!(props.contains(&"width: 360px;".to_string()));
        assert!(props.contains(&"height: 280px;".to_string()));
        assert!(props.contains(&"object-fit: contain;".to_string()));
        assert!(props.contains(&"object-position: 0% 100%;".to_string()));
    }

    // Regression test for the reported audit finding: a highlighted/pill Text label (background +
    // border + padding + radius + opacity, exactly what a real "highlight" panel category
    // supports and Vellum's node_rect draws for Text identically to Box) must keep all five in
    // export -- they were previously silently dropped for any non-Kit-basis Text node.
    #[test]
    fn text_with_a_highlight_keeps_background_border_padding_radius_and_opacity() {
        let highlighted = kit10_scene::TextData {
            padding: [4.0, 8.0, 4.0, 8.0],
            bg_color: kit10_scene::OklabColor { l: 0.9, a: 0.02, b: -0.01, alpha: 1.0 },
            show_border: true,
            border_color: kit10_scene::OklabColor { l: 0.5, a: 0.0, b: 0.0, alpha: 1.0 },
            border_width: 2.0,
            corner_radius: 6.0,
            opacity: 0.8,
            ..test_text(None, "Pill")
        };
        let props = node_props(&UiNode::Text(highlighted), false).unwrap();
        assert!(props.contains(&"padding: 4px 8px 4px 8px;".to_string()), "props were: {:?}", props);
        assert!(props.iter().any(|p| p.starts_with("background:")));
        assert!(props.contains(&"border: 2px solid oklab(50% 0 0 / 1);".to_string()));
        assert!(props.contains(&"border-radius: 6px;".to_string()));
        assert!(props.contains(&"opacity: 0.8;".to_string()));
    }

    // The constant must be re-derivable from the same area formulas its own doc comment cites,
    // not just hand-typed and trusted - this is what actually guards against silent drift if
    // someone edits the literal without re-deriving it (or forgets to, after retuning
    // SQUIRCLE_N in taf_can_do/shader.wgsl - see the COUPLING WARNING on the constant itself).
    #[test]
    fn squircle_area_match_scale_is_self_consistent() {
        const SQUIRCLE_N: f64 = 4.0;
        let circle_area_removed = 1.0 - std::f64::consts::PI / 4.0;

        // Numeric integration (trapezoid, matches the same approach used to sanity-check this
        // convention interactively before it was implemented) of the area UNDER the superellipse
        // quadrant curve y = (1 - x^n)^(1/n) over x in [0,1], then removed = 1 - that area.
        let samples = 100_000;
        let mut area_under = 0.0;
        for i in 0..samples {
            let x0 = i as f64 / samples as f64;
            let x1 = (i + 1) as f64 / samples as f64;
            let y = |x: f64| (1.0 - x.powf(SQUIRCLE_N)).max(0.0).powf(1.0 / SQUIRCLE_N);
            area_under += (y(x0) + y(x1)) / 2.0 * (x1 - x0);
        }
        let squircle_area_removed = 1.0 - area_under;

        let derived_scale = (squircle_area_removed / circle_area_removed).sqrt();
        assert!(
            (derived_scale - SQUIRCLE_AREA_MATCH_SCALE).abs() < 1e-4,
            "SQUIRCLE_AREA_MATCH_SCALE ({SQUIRCLE_AREA_MATCH_SCALE}) has drifted from the derived \
             value ({derived_scale}) - re-derive it if SQUIRCLE_N changed"
        );
    }

    #[test]
    fn squircle_box_exports_a_proportionally_scaled_circular_radius_not_the_literal_value() {
        let mut b = test_box(None);
        b.corner_radius = 20.0;
        b.squircle = true;
        let props = node_props(&UiNode::Box(b), false).unwrap();
        // 20 * 0.58306 = 11.6612 -> rounds to 12, the worked example from this feature's design.
        assert!(
            props.contains(&"border-radius: 12px;".to_string()),
            "props were: {:?}",
            props
        );
    }

    #[test]
    fn non_squircle_box_still_exports_its_literal_corner_radius() {
        let mut b = test_box(None);
        b.corner_radius = 20.0;
        b.squircle = false;
        let props = node_props(&UiNode::Box(b), false).unwrap();
        assert!(props.contains(&"border-radius: 20px;".to_string()), "props were: {:?}", props);
    }

    #[test]
    fn text_with_no_border_and_full_opacity_emits_neither() {
        let plain = test_text(None, "Plain");
        let props = node_props(&UiNode::Text(plain), false).unwrap();
        assert!(!props.iter().any(|p| p.starts_with("border:")));
        assert!(!props.iter().any(|p| p.starts_with("border-radius:")));
        assert!(!props.iter().any(|p| p.starts_with("opacity:")));
        // padding/background are still unconditionally present, matching Box's own convention.
        assert!(props.iter().any(|p| p.starts_with("padding:")));
        assert!(props.iter().any(|p| p.starts_with("background:")));
    }
}
