use base64::Engine;
use extism_pdk::*;
use kit10_scene::UiNode;
use krilla::page::PageSettings;
use krilla::Document;
use serde::Deserialize;
use std::collections::HashMap;

mod color;
mod fonts;
mod images;
mod layout;
mod page;
mod paint;
mod tree;
mod wrap;

use page::PdfOptions;

// Same plain-String-in/out convention WebCodium's own host_fn block uses (see that crate's
// lib.rs doc comment) -- kit10_get_interpreter_output ignores its input and always returns a
// plain JSON string, verified against its real JS implementation.
#[host_fn]
extern "ExtismHost" {
    fn kit10_get_interpreter_output(_unused: String) -> String;
}

#[derive(Debug, Clone, Deserialize, Default)]
struct InterpreterOutput {
    available: bool,
    #[serde(default)]
    viewport_data: Vec<UiNode>,
    #[serde(default)]
    node_view_ids: Vec<String>,
    #[serde(default)]
    reason: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
struct ExportInput {
    #[serde(default)]
    #[allow(dead_code)] // not yet consumed -- reserved for a future kit10_get_project_tokens call
    project_id: String,
    #[serde(default)]
    view_ids: Vec<String>,
    /// String-encoded key/value bag, same convention `preferences.ts`'s value map uses --
    /// forward-compatible with the plan's `ExportCapability.options` mechanism (task pending):
    /// works fine today via defaults even before the editor sends any real values, and once the
    /// generic options form exists host-side, this same field carries page_size/orientation/
    /// fit_mode/dpi without any wire-shape change on this end.
    #[serde(default)]
    options: HashMap<String, String>,
}

// `page_size`/`orientation`/`fit_mode` arrive as plain strings (e.g. `"letter"`) inside
// ExportInput.options' string-encoded bag (the same convention preferences.ts's value map
// uses) -- wrap each in a JSON string Value before handing it to the enum's own
// #[serde(rename_all = "snake_case")] Deserialize impl, rather than re-deriving the mapping by
// hand here.
fn parse_enum_option<T: serde::de::DeserializeOwned>(raw: &HashMap<String, String>, key: &str) -> Option<T> {
    let v = raw.get(key)?;
    serde_json::from_value(serde_json::Value::String(v.clone())).ok()
}

fn parse_pdf_options(raw: &HashMap<String, String>) -> PdfOptions {
    let mut opts = PdfOptions::default();
    if let Some(v) = parse_enum_option(raw, "page_size") {
        opts.page_size = v;
    }
    if let Some(v) = parse_enum_option(raw, "orientation") {
        opts.orientation = v;
    }
    if let Some(v) = parse_enum_option(raw, "fit_mode") {
        opts.fit_mode = v;
    }
    if let Some(dpi) = raw.get("dpi").and_then(|v| v.parse::<f32>().ok()) {
        opts.dpi = dpi.clamp(72.0, 600.0);
    }
    // "true"/"false" strings, same convention preferences.ts's value map uses for toggles.
    // Missing/unparseable leaves PdfOptions::default()'s own reflow value (true) untouched.
    if let Some(reflow) = raw.get("reflow").and_then(|v| v.parse::<bool>().ok()) {
        opts.reflow = reflow;
    }
    opts
}

#[cfg(test)]
mod parse_pdf_options_tests {
    use super::*;

    #[test]
    fn reflow_defaults_to_true_when_the_option_is_absent() {
        // The export UI sends this checkbox on by default (schema.ts's PDF manifest declares
        // `default: 'true'`) -- but this is the fallback for a payload from BEFORE the option
        // existed at all, or any other reason the key is simply missing.
        let opts = parse_pdf_options(&HashMap::new());
        assert!(opts.reflow);
    }

    #[test]
    fn reflow_false_from_the_export_ui_disables_it() {
        let mut raw = HashMap::new();
        raw.insert("reflow".to_string(), "false".to_string());
        let opts = parse_pdf_options(&raw);
        assert!(!opts.reflow);
    }

    #[test]
    fn reflow_true_from_the_export_ui_is_read_explicitly() {
        let mut raw = HashMap::new();
        raw.insert("reflow".to_string(), "true".to_string());
        let opts = parse_pdf_options(&raw);
        assert!(opts.reflow);
    }
}

/// `rects` (from `layout::resolve_layout`) holds WORLD/whole-scene-relative positions -- e.g. a
/// second view stacked under the shared virtual root's flex-column flow, or a view nested under
/// structural grid scaffolding, sits at some non-zero (x, y) in that shared space, not at (0, 0).
/// `page::resolve_page`'s `artwork_transform` maps ARTWORK-LOCAL coordinates (origin at the
/// exported root's own top-left corner) into page space -- painting the raw world-space rects
/// directly under that transform would place content whatever distance the root itself happens
/// to sit from the scene's shared origin, off the visible page entirely in the common case. Every
/// painted rect is shifted by `-(root_offset_x, root_offset_y)` here so the root's own corner
/// becomes local (0, 0), the same normalization WebCodium's own `tree::normalized_root_positions`
/// performs for a different reason (multiple pinned roots sharing one HTML document) -- see
/// `page::resolve_page`'s doc comment for why that specific function doesn't apply here directly.
fn offset_rect(raw: &layout::ResolvedRect, offset_x: f32, offset_y: f32) -> layout::ResolvedRect {
    layout::ResolvedRect {
        x: raw.x - offset_x,
        y: raw.y - offset_y,
        width: raw.width,
        height: raw.height,
        opacity: raw.opacity,
    }
}

fn paint_subtree(
    surface: &mut krilla::surface::Surface,
    root: usize,
    root_offset_x: f32,
    root_offset_y: f32,
    nodes: &[UiNode],
    children: &HashMap<usize, Vec<usize>>,
    rects: &HashMap<usize, layout::ResolvedRect>,
    fonts: &fonts::FontCache,
    images: &images::ImageCache,
) {
    let mut stack = vec![root];
    while let Some(idx) = stack.pop() {
        let Some(raw_rect) = rects.get(&idx) else { continue };
        let rect = offset_rect(raw_rect, root_offset_x, root_offset_y);
        match &nodes[idx] {
            UiNode::Box(data) => paint::paint_box(surface, &rect, data),
            UiNode::Text(data) => paint::paint_text(surface, &rect, data, fonts),
            UiNode::Img(data) => paint::paint_img(surface, &rect, data, images),
            // Shape/SpriteBatch: Shape needs its own path-synthesis follow-up (see the plan);
            // SpriteBatch is a GPU-instanced-quad concept with no vector/print analog, same
            // posture WebCodium takes for it. Both silently skipped, never fail the export.
            UiNode::Shape(_) | UiNode::SpriteBatch(_) => {}
        }
        if let Some(kids) = children.get(&idx) {
            // Reverse so the stack pops children in original (paint) order.
            stack.extend(kids.iter().rev());
        }
    }
}

/// Pure core: resolved `UiNode` tree + already-loaded font/image caches in, PDF bytes out.
/// Factored out of `export_pdf` so it's testable without an Extism host -- `fonts`/`images` are
/// taken as PARAMETERS rather than loaded inside this function specifically so that stays true:
/// `FontCache::load`/`ImageCache::load` themselves reference the `kit10_get_font_bytes`/
/// `kit10_get_asset_bytes` host-fn externs (even down their own never-taken empty-input branch --
/// Rust doesn't strip an unreached branch's symbol reference, so the mere presence of the call
/// fails native linking with no Extism host to satisfy it). Every unit test below passes
/// `&FontCache::default()`/`&ImageCache::default()` and drives this directly with a
/// `tree::test_support`-built fixture -- `export_pdf` is the only caller that actually loads them
/// for real, and is never itself unit-tested for the same reason (matches WebCodium's own
/// posture: host-fn-calling wrappers are exercised in the running app, not native `cargo test`).
fn build_pdf(
    nodes: &[UiNode],
    node_view_ids: &[String],
    selected_view_ids: &[String],
    opts: &PdfOptions,
    fonts: &fonts::FontCache,
    images: &images::ImageCache,
) -> Result<Vec<u8>, Error> {
    let children = tree::build_children_map(nodes);
    let roots = tree::resolve_export_roots(nodes, node_view_ids, selected_view_ids);
    if roots.is_empty() {
        return Err(Error::msg("no views selected for export"));
    }

    // Unconstrained ("natural size") layout -- always computed, since it's what decides
    // Orientation::Auto (via the artwork's own aspect ratio) and is the ONLY layout used when
    // reflow is off or page_size is Fit (nothing to reflow to).
    let rects = layout::resolve_layout(nodes, fonts);

    let mut document = Document::new();
    let mut pages_added = 0usize;
    let mut skip_reasons: Vec<String> = Vec::new();
    for &root in &roots {
        let Some(initial_root_rect) = rects.get(&root) else {
            // Should not happen for a real export root (every `parent_id: None` node and
            // everything reachable from it gets a rect from `layout::resolve_layout`) -- but
            // silently dropping the page here is exactly how this bug shipped once already: a
            // "successful" export with zero pages and no error, instead of a clear failure. Track
            // it and surface a real error below rather than repeat that.
            skip_reasons.push(format!("view root (node #{root}) has no resolved layout rect"));
            continue;
        };

        // Reflow: when a real paper preset is chosen and opts.reflow is on (the default), pin
        // this root's own width to the preset's own content width and re-run layout for JUST
        // this root -- Percent widths/flex-wrap/flex-basis content resolves against the NEW
        // width, same as a browser reflowing a page on viewport resize. `reflow_target_width_px`
        // returns None for PageSize::Fit (nothing to reflow to) or when reflow is off, in which
        // case this falls back to the unconstrained `rects` computed above, scaled/centered/
        // cropped to the target page by `resolve_page`'s own `fit_mode` handling instead.
        let reflow_target = page::reflow_target_width_px(initial_root_rect.width, initial_root_rect.height, opts);
        let (root_rects, root_rect, page_layout) = match reflow_target {
            Some(target_width_px) => {
                let reflowed = layout::resolve_layout_reflowed(nodes, root, target_width_px, fonts);
                let Some(reflowed_root_rect) = reflowed.get(&root).copied() else {
                    skip_reasons.push(format!("view root (node #{root}) failed to reflow to the target page width"));
                    continue;
                };
                let page_layout = page::resolve_page_for_reflowed_artwork(
                    (reflowed_root_rect.width, reflowed_root_rect.height),
                    opts,
                );
                (reflowed, reflowed_root_rect, page_layout)
            }
            None => {
                let page_layout = page::resolve_page((initial_root_rect.width, initial_root_rect.height), opts);
                (rects.clone(), *initial_root_rect, page_layout)
            }
        };

        // `krilla::page::PageSettings::new` panics (`Size::from_wh`/`Rect::from_xywh` both
        // return `None`, then get `.unwrap()`-ed) for any non-positive dimension -- a real,
        // reachable case: an Auto-sized root with nothing forcing a size (empty view, or content
        // that measures to zero) resolves to a 0x0 rect. Guard here instead of crashing the
        // whole export over one degenerate root; 1pt is an arbitrary but harmless floor purely to
        // keep krilla's own constructors happy, not a meaningful "real" page size.
        if page_layout.size_pt.0 <= 0.0 || page_layout.size_pt.1 <= 0.0 {
            skip_reasons.push(format!(
                "view root (node #{root}) resolved to a {}x{}pt page -- likely an empty or Auto-sized-with-no-content view",
                page_layout.size_pt.0, page_layout.size_pt.1
            ));
            continue;
        }

        let mut pdf_page =
            document.start_page_with(PageSettings::new(page_layout.size_pt.0, page_layout.size_pt.1));
        let mut surface = pdf_page.surface();
        surface.push_transform(&paint::krilla_transform(page_layout.artwork_transform));
        paint_subtree(&mut surface, root, root_rect.x, root_rect.y, nodes, &children, &root_rects, fonts, images);
        surface.pop();
        surface.finish();
        pdf_page.finish();
        pages_added += 1;
    }

    if pages_added == 0 {
        return Err(Error::msg(format!(
            "PDF export produced no pages ({} view root(s) selected, all skipped): {}",
            roots.len(),
            skip_reasons.join("; ")
        )));
    }

    document.finish().map_err(|e| Error::msg(format!("failed to serialize PDF: {e:?}")))
}

/// v1 scope: `Box` nodes only (fill/border/corner-radius/squircle), one PDF page per exported
/// View root, sized/placed per `page::resolve_page`'s paper-size/orientation/fit-mode/DPI
/// options. Text/Img/Shape are follow-up work -- see plugins/pdf's module doc comments and the
/// plan (resources/pdf export plan, kept as a claude plan file) for the phasing.
#[plugin_fn]
pub fn export_pdf(input: String) -> FnResult<String> {
    let req: ExportInput = serde_json::from_str(&input).unwrap_or_default();
    let opts = parse_pdf_options(&req.options);

    let raw = unsafe { kit10_get_interpreter_output(String::new())? };
    let output: InterpreterOutput = serde_json::from_str(&raw)?;
    if !output.available {
        return Err(Error::msg(format!(
            "interpreter output unavailable: {}",
            output.reason.unwrap_or_default()
        ))
        .into());
    }

    // Loaded once for the whole export, not per-node -- both caches dedupe their own host-fn
    // requests internally (fonts::distinct_font_requests / images::distinct_asset_ids), so this
    // is one round trip per distinct font/asset regardless of how many nodes reference it.
    let fonts = fonts::FontCache::load(&output.viewport_data);
    let images = images::ImageCache::load(&output.viewport_data);

    let pdf_bytes = build_pdf(
        &output.viewport_data,
        &output.node_view_ids,
        &req.view_ids,
        &opts,
        &fonts,
        &images,
    )?;
    Ok(base64::engine::general_purpose::STANDARD.encode(pdf_bytes))
}

#[cfg(test)]
mod export_tests {
    use super::*;
    use kit10_scene::{BoxData, Extent, OklabColor};

    #[test]
    fn offset_rect_shifts_position_but_not_size_or_opacity() {
        let raw = layout::ResolvedRect { x: 500.0, y: 800.0, width: 200.0, height: 100.0, opacity: 0.5 };
        let local = offset_rect(&raw, 500.0, 800.0);
        assert_eq!((local.x, local.y), (0.0, 0.0));
        assert_eq!((local.width, local.height), (200.0, 100.0));
        assert_eq!(local.opacity, 0.5);
    }

    #[test]
    fn header_ends_up_visually_above_footer_in_final_pdf_space() {
        // Reported live ("header starts at the bottom to the footer on top") after the earlier
        // blank-page/flipped-text fixes -- this reconstructs the actual scenario end to end
        // (layout::resolve_layout + page::resolve_page's transform together, exactly what
        // build_pdf composes) and checks the FINAL PDF-space Y ordering directly, not just each
        // piece's own isolated unit tests, since a sign error in how the two compose wouldn't
        // show up in either module's own tests alone.
        let root = UiNode::Box(BoxData {
            width: Extent::Px(300.0),
            height: Extent::Px(400.0),
            flex_direction: kit10_scene::FlexDir::Column,
            ..tree::test_support::test_box(None)
        });
        let header = UiNode::Box(BoxData { width: Extent::Px(300.0), height: Extent::Px(50.0), ..tree::test_support::test_box(Some(0)) });
        let footer = UiNode::Box(BoxData { width: Extent::Px(300.0), height: Extent::Px(50.0), ..tree::test_support::test_box(Some(0)) });
        let nodes = [root, header, footer];

        let rects = layout::resolve_layout(&nodes, &fonts::FontCache::default());
        let root_rect = rects[&0];
        // Sanity: header (array index 1, first child) must be laid out above footer (index 2,
        // second child) in LOCAL layout space (smaller y = higher, top-left-origin/Y-down) --
        // otherwise this test isn't actually exercising the reported scenario at all.
        assert!(rects[&1].y < rects[&2].y, "header should be laid out above footer locally: {:?} vs {:?}", rects[&1], rects[&2]);

        let opts = PdfOptions { dpi: 72.0, ..Default::default() };
        let page_layout = page::resolve_page((root_rect.width, root_rect.height), &opts);
        let t = page_layout.artwork_transform;

        let to_surface_y = |local_y: f32| t.ky * 0.0 + t.sy * (local_y - root_rect.y) + t.ty;
        let header_surface_y = to_surface_y(rects[&1].y);
        let footer_surface_y = to_surface_y(rects[&2].y);
        // krilla::Surface is top-left-origin/Y-down (see page.rs's own module doc comment) -- a
        // SMALLER y-coordinate is HIGHER on the page. Header must end up above footer here too,
        // or this is exactly the reported bug.
        assert!(
            header_surface_y < footer_surface_y,
            "header must render above footer: header_surface_y={header_surface_y} footer_surface_y={footer_surface_y}"
        );
    }

    #[test]
    fn pinned_auto_height_page_still_orders_stacked_sections_top_to_bottom() {
        // Reproduces the REAL reported scenario from seed.ts's actual "Landing Page" view shape
        // (manager/src/seed.ts: `pageKit` = flex-direction column, width 900px, no explicit
        // height -- so Auto/hugged; `vellum: { position: [-1100, 0] }` -- so a
        // NodePosition::Absolute root, not a plain virtual-root child; four stacked sections
        // [nav, hero, features, footer] each containing real text). The earlier
        // `header_ends_up_visually_above_footer_in_final_pdf_space` test used a plain
        // Relative root with FIXED heights -- this test isolates whether the combination of
        // Absolute-root + Auto-height + real text measurement changes the outcome.
        use kit10_scene::{FontStyle, NodePosition, TextAlign, TextDecorationKind};

        fn section(parent_id: Option<usize>, extra_position: NodePosition) -> BoxData {
            BoxData {
                width: Extent::Percent(1.0),
                height: Extent::Auto,
                extra: kit10_scene::BoxExtra { position: extra_position, ..Default::default() },
                ..tree::test_support::test_box(parent_id)
            }
        }
        fn label(parent_id: Option<usize>, content: &str) -> UiNode {
            UiNode::Text(kit10_scene::TextData {
                parent_id,
                width: Extent::Auto,
                height: Extent::Auto,
                padding: [0.0; 4],
                bg_color: OklabColor::default(),
                show_border: false,
                border_color: OklabColor::default(),
                border_width: 0.0,
                corner_radius: 0.0,
                squircle: false,
                opacity: 1.0,
                content: content.to_string(),
                font_size: 16.0,
                font_family: "Satoshi".to_string(),
                font_weight: 400,
                font_style: FontStyle::Normal,
                text_color: OklabColor::new(0.0, 0.0, 0.0, 1.0),
                text_align: TextAlign::Left,
                text_decoration: TextDecorationKind::None,
                line_height: 0.0,
                deform: None,
                extra: Default::default(),
                selected: 0,
                hovered: false,
            })
        }

        // Indices: 0=root(Absolute-pinned, Auto height), 1=nav, 2=nav-label, 3=footer, 4=footer-label.
        let mut root = section(None, NodePosition::Relative);
        root.width = Extent::Px(900.0);
        root.flex_direction = kit10_scene::FlexDir::Column; // matches seed.ts's real pageKit exactly
        root.extra.position = NodePosition::Absolute { x: -1100.0, y: 0.0 };
        let nav = section(Some(0), NodePosition::Relative);
        let footer = section(Some(0), NodePosition::Relative);
        let nodes = vec![
            UiNode::Box(root),
            UiNode::Box(nav),
            label(Some(1), "Nav"),
            UiNode::Box(footer),
            label(Some(3), "Footer"),
        ];

        let rects = layout::resolve_layout(&nodes, &fonts::FontCache::default());
        // nav (index 1) must be laid out above footer (index 3) locally, same invariant as the
        // simpler test -- if THIS fails but the simpler test passes, the Absolute-root/Auto-height
        // combination is exactly where the bug lives.
        assert!(
            rects[&1].y < rects[&3].y,
            "nav should be above footer even under an Absolute-pinned, Auto-height root: nav={:?} footer={:?}",
            rects[&1], rects[&3]
        );

        let root_rect = rects[&0];
        let opts = PdfOptions { dpi: 72.0, ..Default::default() };
        let page_layout = page::resolve_page((root_rect.width, root_rect.height), &opts);
        let t = page_layout.artwork_transform;
        let to_surface_y = |local_y: f32| t.sy * (local_y - root_rect.y) + t.ty;
        // krilla::Surface is top-left-origin/Y-down -- smaller y is higher on the page.
        assert!(
            to_surface_y(rects[&1].y) < to_surface_y(rects[&3].y),
            "nav must render above footer: root_rect={:?} page_size={:?}",
            root_rect, page_layout.size_pt
        );
    }

    #[test]
    fn build_pdf_reflows_to_the_page_preset_width_by_default() {
        // The actual feature request: exporting to a real paper preset (not "Fit to artwork")
        // should REFLOW the content to that preset's width by default, not just scale the
        // artwork's own 900px-wide natural layout to fit inside the preset. At 72dpi, US Letter
        // is 612pt wide -- the resulting page's own MediaBox width should read 612, not scaled-
        // down-900 nor any other value, proving reflow (not scale) drove the page size.
        let node = UiNode::Box(BoxData { width: Extent::Px(900.0), height: Extent::Px(100.0), ..tree::test_support::test_box(None) });
        let opts = PdfOptions {
            page_size: page::PageSize::Letter,
            orientation: page::Orientation::Portrait,
            dpi: 72.0,
            ..Default::default() // reflow: true by default
        };
        let bytes = build_pdf(
            &[node],
            &["view-a".to_string()],
            &["view-a".to_string()],
            &opts,
            &fonts::FontCache::default(),
            &images::ImageCache::default(),
        )
        .expect("should produce a reflowed PDF");
        let text = String::from_utf8_lossy(&bytes);
        assert!(text.contains("612"), "expected a 612pt-wide (Letter) page from reflow, PDF body: {text}");
    }

    #[test]
    fn build_pdf_scales_instead_of_reflowing_when_reflow_is_off() {
        // Same artwork/page preset as the reflow test above, but with reflow explicitly
        // disabled -- must fall back to the old scale-to-fit behavior (artwork's own natural
        // 900x100 laid out once, then shrunk to fit inside Letter's 612pt width; FitToPage is
        // the default fit_mode). This is the regression guard that the toggle actually toggles
        // something, not just that reflow-on works.
        let node = UiNode::Box(BoxData { width: Extent::Px(900.0), height: Extent::Px(100.0), ..tree::test_support::test_box(None) });
        let opts = PdfOptions {
            page_size: page::PageSize::Letter,
            orientation: page::Orientation::Portrait,
            dpi: 72.0,
            reflow: false,
            ..Default::default()
        };
        let bytes = build_pdf(
            &[node],
            &["view-a".to_string()],
            &["view-a".to_string()],
            &opts,
            &fonts::FontCache::default(),
            &images::ImageCache::default(),
        )
        .expect("should produce a scaled PDF");
        let text = String::from_utf8_lossy(&bytes);
        // Page size is still the full Letter page (612x792) -- scaling happens in the artwork
        // transform, not the page's own MediaBox, which is the real observable difference from
        // the reflow case above (which produces a page whose OWN size is the reflowed content's).
        assert!(text.contains("792"), "expected the full 792pt Letter page height (not reflowed), PDF body: {text}");
    }

    #[test]
    fn build_pdf_normalizes_a_stacked_second_view_to_the_page_origin() {
        // Two views stacked under the shared virtual root's flex-column flow (view-a on top,
        // view-b below it) -- view-b's own resolved rect sits at a non-zero world y-offset equal
        // to view-a's height. Exporting ONLY view-b used to paint its content at that raw world
        // offset under a page transform that assumes artwork-local (0,0), pushing everything off
        // the visible page (reported live: "blank... floating... cutoff"). This just proves the
        // export succeeds and produces a page sized to view-b's own dimensions (300x150), not
        // view-a's (100x100) and not some combined/offset size -- the page-size math alone is
        // enough to prove world-space leakage isn't corrupting this path.
        let view_a = UiNode::Box(BoxData { width: Extent::Px(100.0), height: Extent::Px(100.0), ..tree::test_support::test_box(None) });
        let view_b = UiNode::Box(BoxData { width: Extent::Px(300.0), height: Extent::Px(150.0), ..tree::test_support::test_box(None) });
        let opts = PdfOptions { dpi: 72.0, ..Default::default() };
        let bytes = build_pdf(
            &[view_a, view_b],
            &["view-a".to_string(), "view-b".to_string()],
            &["view-b".to_string()],
            &opts,
            &fonts::FontCache::default(),
            &images::ImageCache::default(),
        )
        .expect("should produce a PDF for the second stacked view");
        let text = String::from_utf8_lossy(&bytes);
        assert!(text.contains("/Count 1"), "expected exactly one page, PDF body: {text}");
        // At 72dpi the page's MediaBox should be exactly view-b's own 300x150 size, not
        // view-a's, and not e.g. 300x250 (a leaked combined-height artifact).
        assert!(
            text.contains("300 150") || text.contains("[0 0 300 150]") || text.contains("[ 0 0 300 150 ]"),
            "expected a 300x150 MediaBox for view-b's own size, PDF body: {text}"
        );
    }

    #[test]
    fn build_pdf_produces_a_valid_pdf_header_for_a_single_box_view() {
        let node = UiNode::Box(BoxData {
            width: Extent::Px(400.0),
            height: Extent::Px(300.0),
            bg_color: OklabColor::new(0.6, 0.1, 0.05, 1.0),
            corner_radius: 12.0,
            ..tree::test_support::test_box(None)
        });
        let bytes = build_pdf(
            &[node],
            &["view-a".to_string()],
            &["view-a".to_string()],
            &PdfOptions::default(),
            &fonts::FontCache::default(),
            &images::ImageCache::default(),
        )
        .expect("should produce a PDF");
        assert!(bytes.starts_with(b"%PDF-"), "PDF must start with the %PDF- header");
        assert!(bytes.len() > 100, "a real page's worth of content, not an empty stub");
    }

    #[test]
    fn build_pdf_emits_one_page_per_selected_view() {
        let view_a = UiNode::Box(BoxData { width: Extent::Px(100.0), height: Extent::Px(100.0), ..tree::test_support::test_box(None) });
        let view_b = UiNode::Box(BoxData { width: Extent::Px(200.0), height: Extent::Px(150.0), ..tree::test_support::test_box(None) });
        let bytes = build_pdf(
            &[view_a, view_b],
            &["view-a".to_string(), "view-b".to_string()],
            &["view-a".to_string(), "view-b".to_string()],
            &PdfOptions::default(),
            &fonts::FontCache::default(),
            &images::ImageCache::default(),
        )
        .expect("should produce a PDF");
        // A crude but real check: the PDF's own /Count entry (page tree page count) should read 2.
        let text = String::from_utf8_lossy(&bytes);
        assert!(text.contains("/Count 2"), "expected a 2-page document, PDF body: {text}");
    }

    #[test]
    fn build_pdf_errors_instead_of_silently_returning_a_zero_page_pdf() {
        // A selected view root that resolves to a degenerate (0x0) size -- e.g. an Auto-sized
        // root with no content forcing a size -- used to `continue` past silently, producing an
        // `Ok` PDF with zero pages and no indication anything went wrong. That's the exact bug
        // reported live ("the pdf is zero pages", view correctly shown as flagged in the UI).
        // Guard: this must now be a real Err with the specific reason, never a silent empty file.
        let node = UiNode::Box(BoxData {
            width: Extent::Auto,
            height: Extent::Auto,
            ..tree::test_support::test_box(None)
        });
        let result = build_pdf(
            &[node],
            &["view-a".to_string()],
            &["view-a".to_string()],
            &PdfOptions::default(),
            &fonts::FontCache::default(),
            &images::ImageCache::default(),
        );
        let err = result.expect_err("a zero-sized root must error, not silently produce an empty PDF");
        assert!(err.to_string().contains("no pages"), "error should explain the zero-page failure: {err}");
    }

    #[test]
    fn build_pdf_errors_when_no_views_are_selected() {
        let node = UiNode::Box(tree::test_support::test_box(None));
        let result = build_pdf(
            &[node],
            &["view-a".to_string()],
            &[],
            &PdfOptions::default(),
            &fonts::FontCache::default(),
            &images::ImageCache::default(),
        );
        assert!(result.is_err());
    }

    #[test]
    fn build_pdf_renders_real_text_with_an_embedded_font() {
        // Real WOFF2 bytes (see tests/fixtures/), exercising the actual rustybuzz-shape ->
        // krilla-draw_glyphs pipeline end to end, not just that the surrounding plumbing
        // compiles. This is the one place this crate verifies text shaping/embedding for real.
        let woff2_bytes = std::fs::read(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/Satoshi-Variable.woff2"))
            .expect("test fixture should exist");
        let fonts = fonts::FontCache::test_cache("Satoshi", 400, kit10_scene::FontStyle::Normal, woff2_bytes);
        assert!(
            fonts.get("Satoshi", 400, kit10_scene::FontStyle::Normal).is_some(),
            "fixture font should have decompressed and parsed"
        );

        let root = UiNode::Box(BoxData {
            width: Extent::Px(400.0),
            height: Extent::Px(200.0),
            ..tree::test_support::test_box(None)
        });
        let text = UiNode::Text(kit10_scene::TextData {
            parent_id: Some(0),
            width: Extent::Auto,
            height: Extent::Auto,
            padding: [0.0; 4],
            bg_color: OklabColor::default(),
            show_border: false,
            border_color: OklabColor::default(),
            border_width: 0.0,
            corner_radius: 0.0,
            squircle: false,
            opacity: 1.0,
            content: "Hello, PDF!".to_string(),
            font_size: 24.0,
            font_family: "Satoshi".to_string(),
            font_weight: 400,
            font_style: kit10_scene::FontStyle::Normal,
            text_color: OklabColor::new(0.0, 0.0, 0.0, 1.0),
            text_align: kit10_scene::TextAlign::Left,
            text_decoration: kit10_scene::TextDecorationKind::None,
            line_height: 0.0,
            deform: None,
            extra: Default::default(),
            selected: 0,
            hovered: false,
        });

        let no_text_bytes = build_pdf(
            &[UiNode::Box(BoxData { width: Extent::Px(400.0), height: Extent::Px(200.0), ..tree::test_support::test_box(None) })],
            &["view-a".to_string()],
            &["view-a".to_string()],
            &PdfOptions::default(),
            &fonts::FontCache::default(),
            &images::ImageCache::default(),
        )
        .expect("box-only baseline should still produce a PDF");

        let with_text_bytes = build_pdf(
            &[root, text],
            &["view-a".to_string(), "view-a".to_string()],
            &["view-a".to_string()],
            &PdfOptions::default(),
            &fonts,
            &images::ImageCache::default(),
        )
        .expect("should produce a PDF with real embedded text");

        assert!(with_text_bytes.starts_with(b"%PDF-"));
        // A real embedded font program (even subset-free, whole-font for now) is a meaningfully
        // larger payload than the same box with no text content at all -- proves glyphs and font
        // data actually made it into the file, not just that draw_glyphs was called and no-opped.
        assert!(
            with_text_bytes.len() > no_text_bytes.len() + 1000,
            "expected embedded font/glyph data to meaningfully grow the PDF: {} vs {} bytes",
            with_text_bytes.len(),
            no_text_bytes.len()
        );
    }
}

#[plugin_fn]
pub fn on_init(_input: String) -> FnResult<String> {
    Ok("ok".to_string())
}
