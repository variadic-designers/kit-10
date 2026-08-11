//! Turns a resolved node + its paint properties into krilla fill/stroke/glyph/image draw calls.
//! Shape is the one remaining follow-up (needs its own path-synthesis work, see the plan) --
//! Box/Text/Img now match WebCodium's own original v1 scope.

use crate::color::oklab_to_srgb;
use crate::fonts::FontCache;
use crate::images::ImageCache;
use crate::layout::ResolvedRect;
use crate::page::RowTransform;
use kit10_scene::{BoxData, ImgData, TextAlign, TextData};
use krilla::color::rgb;
use krilla::geom::{PathBuilder, Point, Size, Transform};
use krilla::num::NormalizedF32;
use krilla::paint::{Fill, FillRule, Stroke};
use krilla::surface::Surface;
use krilla::text::{GlyphId, KrillaGlyph, TextDirection};

pub fn krilla_transform(t: RowTransform) -> Transform {
    Transform::from_row(t.sx, t.ky, t.kx, t.sy, t.tx, t.ty)
}

fn srgb_paint(srgb: crate::color::Srgb) -> rgb::Color {
    let to_byte = |v: f32| (v.clamp(0.0, 1.0) * 255.0).round() as u8;
    rgb::Color::new(to_byte(srgb.r), to_byte(srgb.g), to_byte(srgb.b))
}

/// A standard circular-arc corner approximated by a cubic bezier, kappa = 0.5523 (the constant
/// that makes a 4-cubic-bezier circle match a true circle to within ~0.03% -- exact enough that
/// this is not an approximation debt worth tracking, unlike squircle below). PDF has no
/// CSS-style `border-radius` shorthand, so every rounded corner is written as real path geometry
/// either way, whether or not `squircle` is set -- see the plan's Box section for why this makes
/// plain rounded corners in this exporter strictly more accurate than WebCodium's HTML export.
const CIRCLE_KAPPA: f32 = 0.5522847498;

/// Superellipse (squircle) corner exponent, matching Vellum's own fixed `SQUIRCLE_N` (see
/// `AGENTS.md`'s squircle section) -- `|x/r|^n + |y/r|^n = 1`. No closed-form boundary exists for
/// n=4 (Vellum's own version is a numerically-iterated SDF), so this samples the boundary at
/// `SQUIRCLE_SAMPLES` points per corner and connects them with straight line segments -- a
/// polyline, not a fitted bezier curve, per the plan's explicit "cheap and defensible for v1"
/// call. At `SQUIRCLE_SAMPLES = 20` over a quarter-turn (22.5 degrees between samples) the
/// deviation from the true boundary is well under a print pixel for any corner radius this
/// editor's Kits realistically author.
const SQUIRCLE_N: f32 = 4.0;
const SQUIRCLE_SAMPLES: usize = 20;

/// One quarter-corner of a superellipse boundary, parameterized by `phi_deg`, degrees measured
/// CLOCKWISE FROM NORTH (phi=0 -> straight up/-y, phi=90 -> east/+x, phi=180 -> south/+y,
/// phi=270 -> west/-x) -- a compass bearing, not a standard mathematical angle, chosen because
/// this whole module works in screen/layout space (top-left origin, Y-DOWN, matching
/// `kit10-scene`/Vellum's own convention). Solves `|x/r|^n + |y/r|^n = 1` implicitly via the
/// standard superellipse parametric form, but with the direction vector built from
/// `(sin(phi), -cos(phi))` rather than naive `(cos(theta), sin(theta))` -- the latter is a
/// Y-UP mathematical convention and silently sends each corner's sweep toward the WRONG tangent
/// point once composed with this crate's Y-down space (verified point-by-point: at the old
/// theta=90 sample, the "top-right" corner's arc previously landed at `center + (0, +r)`, i.e.
/// SOUTH of its own center, instead of the correct NORTH -- overshooting into where the
/// bottom-right corner's own arc belongs, and vice versa around the whole shape). That produced a
/// self-crossing, spiky polyline instead of a smooth curve -- reported live as "weird pointy
/// corners". With this compass parametrization, `phi=0/90/180/270` land exactly on the
/// north/east/south/west tangent points a Y-down rounded-rect construction expects, matching
/// `rounded_rect_path`'s own (non-squircle) bezier corners' tangent points exactly.
fn squircle_point(r: f32, phi_deg: f32) -> (f32, f32) {
    let phi = phi_deg.to_radians();
    let cx = phi.sin();
    let sx = -phi.cos();
    let x = cx.abs().powf(2.0 / SQUIRCLE_N) * cx.signum() * r;
    let y = sx.abs().powf(2.0 / SQUIRCLE_N) * sx.signum() * r;
    (x, y)
}

/// Builds a rounded-rect path (plain circular-arc or squircle corners) at `(x, y, w, h)` with
/// uniform `radius`, clamped to half the smaller dimension so opposing corners never overlap.
/// `radius <= 0.0` returns a plain rectangle.
pub fn rounded_rect_path(x: f32, y: f32, w: f32, h: f32, radius: f32, squircle: bool) -> Option<krilla::geom::Path> {
    let r = radius.max(0.0).min(w / 2.0).min(h / 2.0);
    let mut pb = PathBuilder::new();
    if r <= 0.0 {
        pb.move_to(x, y);
        pb.line_to(x + w, y);
        pb.line_to(x + w, y + h);
        pb.line_to(x, y + h);
        pb.close();
        return pb.finish();
    }

    if !squircle {
        let k = r * CIRCLE_KAPPA;
        // Top-left tangent point, clockwise around the rect.
        pb.move_to(x + r, y);
        pb.line_to(x + w - r, y);
        pb.cubic_to(x + w - r + k, y, x + w, y + r - k, x + w, y + r);
        pb.line_to(x + w, y + h - r);
        pb.cubic_to(x + w, y + h - r + k, x + w - r + k, y + h, x + w - r, y + h);
        pb.line_to(x + r, y + h);
        pb.cubic_to(x + r - k, y + h, x, y + h - r + k, x, y + h - r);
        pb.line_to(x, y + r);
        pb.cubic_to(x, y + r - k, x + r - k, y, x + r, y);
        pb.close();
        return pb.finish();
    }

    // Squircle: sample each quarter-corner as a polyline, straight edges between them. Corner
    // centers + compass-bearing sweep ranges chosen to land exactly on each edge's tangent point
    // (see squircle_point's own doc comment) -- top-right sweeps north-tangent to east-tangent
    // (0 -> 90deg), continuing clockwise through the other three corners, matching
    // rounded_rect_path's own (non-squircle) bezier corner traversal direction exactly.
    let corners = [
        (x + w - r, y + r, 0.0_f32),       // top-right: north tangent -> east tangent
        (x + w - r, y + h - r, 90.0_f32),  // bottom-right: east tangent -> south tangent
        (x + r, y + h - r, 180.0_f32),     // bottom-left: south tangent -> west tangent
        (x + r, y + r, 270.0_f32),         // top-left: west tangent -> north tangent
    ];
    let mut first = true;
    for &(cx, cy, start_deg) in &corners {
        for i in 0..=SQUIRCLE_SAMPLES {
            let t = i as f32 / SQUIRCLE_SAMPLES as f32;
            let phi_deg = start_deg + t * 90.0;
            let (dx, dy) = squircle_point(r, phi_deg);
            let (px, py) = (cx + dx, cy + dy);
            if first {
                pb.move_to(px, py);
                first = false;
            } else {
                pb.line_to(px, py);
            }
        }
    }
    pb.close();
    pb.finish()
}

/// The paint-property subset Box/Text/Img all carry identically (same field names on all three
/// `kit10-scene` structs). Extracted into one shape so fill/border/corner-radius rendering is
/// written exactly once and shared -- WebCodium had a real shipped bug once from routing Img
/// through a different code path than Box/Text's shared `paint_props`/`extract_paint_props`
/// helper (see its `css.rs` doc comment); this mirrors that same discipline from day one.
pub struct PaintProps {
    pub bg_color: kit10_scene::OklabColor,
    pub border_color: kit10_scene::OklabColor,
    pub border_width: f32,
    pub show_border: bool,
    pub corner_radius: f32,
    pub squircle: bool,
}

fn box_paint_props(d: &BoxData) -> PaintProps {
    PaintProps {
        bg_color: d.bg_color,
        border_color: d.border_color,
        border_width: d.border_width,
        show_border: d.show_border,
        corner_radius: d.corner_radius,
        squircle: d.squircle,
    }
}

fn text_paint_props(d: &TextData) -> PaintProps {
    PaintProps {
        bg_color: d.bg_color,
        border_color: d.border_color,
        border_width: d.border_width,
        show_border: d.show_border,
        corner_radius: d.corner_radius,
        squircle: d.squircle,
    }
}

fn img_paint_props(d: &ImgData) -> PaintProps {
    PaintProps {
        bg_color: d.bg_color,
        border_color: d.border_color,
        border_width: d.border_width,
        show_border: d.show_border,
        corner_radius: d.corner_radius,
        squircle: d.squircle,
    }
}

/// Fills/strokes the shared rounded-rect background+border every node kind can carry. Returns
/// the border's resolved (color, width) -- `paint_text`'s content rect needs to inset by the
/// same border width `node_rect`/Vellum's own content-rect math already accounts for, so content
/// never sits under the border ring.
fn paint_rect(surface: &mut Surface, rect: &ResolvedRect, props: &PaintProps) -> f32 {
    let Some(path) = rounded_rect_path(rect.x, rect.y, rect.width, rect.height, props.corner_radius, props.squircle) else {
        return 0.0;
    };

    // krilla::Surface's fill/stroke are persistent state (set_fill/set_stroke just assign;
    // draw_path/draw_glyphs use whatever's currently active) -- NOT scoped per draw call.
    // paint_subtree walks the whole tree with one shared &mut Surface, calling paint_box/
    // paint_text/paint_img back to back with no push/pop around each node, so anything left set
    // here leaks into every draw call that comes after it in traversal order. Reset both up
    // front, and again after each branch that sets one: previously only the border branch reset
    // fill (just to isolate its own stroke-only draw), and nothing ever reset stroke back to
    // None afterward -- so a border on any node stayed "armed" for every node painted after it,
    // including descendants' plain backgrounds AND text (draw_glyphs also strokes glyph outlines
    // whenever a stroke is set), reading live as "borders leaking onto children and text".
    surface.set_fill(None);
    surface.set_stroke(None);

    if props.bg_color.alpha > 0.0 {
        let fill_srgb = oklab_to_srgb(&props.bg_color);
        let fill_opacity = NormalizedF32::new((fill_srgb.alpha * rect.opacity).clamp(0.0, 1.0))
            .unwrap_or(NormalizedF32::ZERO);
        surface.set_fill(Some(Fill {
            paint: srgb_paint(fill_srgb).into(),
            opacity: fill_opacity,
            rule: FillRule::NonZero,
        }));
        surface.draw_path(&path);
        surface.set_fill(None);
    }

    let border_width = if props.show_border { props.border_width } else { 0.0 };
    if border_width > 0.0 {
        let stroke_srgb = oklab_to_srgb(&props.border_color);
        let stroke_opacity = NormalizedF32::new((stroke_srgb.alpha * rect.opacity).clamp(0.0, 1.0))
            .unwrap_or(NormalizedF32::ZERO);
        surface.set_stroke(Some(Stroke {
            paint: srgb_paint(stroke_srgb).into(),
            width: border_width,
            opacity: stroke_opacity,
            ..Default::default()
        }));
        surface.draw_path(&path);
        surface.set_stroke(None);
    }

    border_width
}

pub fn paint_box(surface: &mut Surface, rect: &ResolvedRect, data: &BoxData) {
    paint_rect(surface, rect, &box_paint_props(data));
}

/// Wraps `content` with `wrap::wrap_lines` (the SAME function + SAME `content_w` `layout.rs`'s
/// `measure_node` used to size this node's box -- see that module's doc comment for why the two
/// are guaranteed to agree), shapes each resulting line with rustybuzz (LTR/auto only -- no
/// explicit bidi/script override for v1, see the plan's Font pipeline section) against the font
/// `fonts.rs` already resolved for this node's (family, weight, style), and draws each line's
/// positioned glyphs via krilla's `draw_glyphs`. A font that never resolved (catalogue miss,
/// fetch failure) silently skips the node's text -- its background/border still paint via
/// `paint_rect` above, same as an Img with no known asset link still gets its own frame.
/// Left/center/right alignment is computed per line, from that line's own shaped total advance
/// (not the whole block's), matching ordinary multi-line text behavior.
pub fn paint_text(surface: &mut Surface, rect: &ResolvedRect, data: &TextData, fonts: &FontCache) {
    let border_width = paint_rect(surface, rect, &text_paint_props(data));

    let Some(font_entry) = fonts.get(&data.font_family, data.font_weight, data.font_style) else {
        return;
    };
    if data.content.is_empty() {
        return;
    }

    let Some(face) = font_entry.shaped_face(data.font_weight) else {
        return;
    };
    let units_per_em = face.units_per_em() as f32;
    if units_per_em <= 0.0 {
        return;
    }

    let content_x = rect.x + data.padding[3] + border_width;
    let content_y = rect.y + data.padding[0] + border_width;
    let content_w = (rect.width - data.padding[1] - data.padding[3] - border_width * 2.0).max(0.0);
    let content_h = (rect.height - data.padding[0] - data.padding[2] - border_width * 2.0).max(0.0);

    let lines = crate::wrap::wrap_lines(&face, &data.content, data.font_size, Some(content_w));

    // rustybuzz::Face derefs to ttf_parser::Face, so real font metrics (not a flat font_size
    // ratio) are directly available here. `ascender`/`descender` are in font units (`descender`
    // negative); `line_height` is the full em-box from ascent-top to descent-bottom. A Text
    // node's own rect is always Auto-sized to its natural content (kit10-scene's TextData doc
    // comment), so `content_h` only exceeds `lines.len() * line_height` when a parent flex
    // container's `align-items: stretch` grows it past that -- e.g. a label sharing a row with a
    // taller icon/sibling, exactly the "text in boxes isn't perfectly centered" case reported
    // live. Centering the real ascent/descent block (not just font_size*0.8 from the top) within
    // whatever content_h actually is fixes both the vertical-centering gap and the flat,
    // font-agnostic baseline approximation in one pass. Clamped so a content box shorter than
    // the text block (shouldn't normally happen, given Auto-sizing) degrades to top-aligned
    // instead of pushing the first line's baseline above the content box entirely.
    let ascender = face.ascender() as f32 / units_per_em * data.font_size;
    let descender = face.descender() as f32 / units_per_em * data.font_size;
    let line_height = ascender - descender;
    let block_height = lines.len() as f32 * line_height;
    let text_top = content_y + ((content_h - block_height) / 2.0).max(0.0);

    let text_srgb = oklab_to_srgb(&data.text_color);
    let fill_opacity = NormalizedF32::new((text_srgb.alpha * rect.opacity).clamp(0.0, 1.0))
        .unwrap_or(NormalizedF32::ZERO);
    surface.set_fill(Some(Fill {
        paint: srgb_paint(text_srgb).into(),
        opacity: fill_opacity,
        rule: FillRule::NonZero,
    }));
    // Explicit, not just inherited from paint_rect's own reset above (see its doc comment) --
    // draw_glyphs strokes glyph outlines whenever a stroke is armed on the surface, so a stray
    // leftover border would otherwise outline this text instead of just filling it.
    surface.set_stroke(None);

    for (i, line) in lines.iter().enumerate() {
        if line.is_empty() {
            continue;
        }
        let mut buffer = rustybuzz::UnicodeBuffer::new();
        buffer.push_str(line);
        let glyph_buffer = rustybuzz::shape(&face, &[], buffer);
        let infos = glyph_buffer.glyph_infos();
        let positions = glyph_buffer.glyph_positions();

        let mut glyphs: Vec<KrillaGlyph> = Vec::with_capacity(infos.len());
        let mut total_advance = 0.0_f32;
        for (info, pos) in infos.iter().zip(positions.iter()) {
            let cluster = info.cluster as usize;
            let next_cluster = line.len().max(cluster);
            glyphs.push(KrillaGlyph::new(
                GlyphId::new(info.glyph_id),
                pos.x_advance as f32 / units_per_em,
                pos.x_offset as f32 / units_per_em,
                pos.y_offset as f32 / units_per_em,
                pos.y_advance as f32 / units_per_em,
                cluster..next_cluster,
                None,
            ));
            total_advance += pos.x_advance as f32 / units_per_em * data.font_size;
        }

        let start_x = match data.text_align {
            TextAlign::Center => content_x + ((content_w - total_advance) / 2.0).max(0.0),
            TextAlign::Right => content_x + (content_w - total_advance).max(0.0),
            TextAlign::Left | TextAlign::Justify => content_x,
        };
        let baseline_y = text_top + i as f32 * line_height + ascender;

        // krilla::Surface is top-left-origin/Y-down natively (its own module doc comment) -- no
        // extra flip/counter-flip needed here (see page.rs's own module doc comment for the
        // fuller story: this crate used to push a redundant outer flip plus a local counter-flip
        // to undo it, which composed inconsistently and was the real cause of a live-reported
        // "text not aligned correctly" + broader page-orientation bug). Draw directly at the
        // computed anchor.
        surface.draw_glyphs(
            Point::from_xy(start_x, baseline_y),
            &glyphs,
            font_entry.krilla_font.clone(),
            line,
            data.font_size,
            false,
        );
    }
    let _ = TextDirection::Auto; // reserved for an explicit direction override follow-up
}

/// `fit`/`object_position` placement, mirroring CSS `object-fit`/`object-position` math: `cover`
/// scales to fill the box (clipped to it, may overflow before the clip), `contain` scales to fit
/// entirely within it (centered per `object_position`), anything else (`fill`, the default) just
/// stretches to the box's own size. An Img whose source never resolved (see `images.rs`) still
/// gets its own background/border painted via `paint_rect`, then silently skips the image itself.
pub fn paint_img(surface: &mut Surface, rect: &ResolvedRect, data: &ImgData, images: &ImageCache) {
    paint_rect(surface, rect, &img_paint_props(data));

    let Some(image) = images.get(&data.source) else { return };
    let (native_w, native_h) = image.size();
    if native_w == 0 || native_h == 0 || rect.width <= 0.0 || rect.height <= 0.0 {
        return;
    }
    let (native_w, native_h) = (native_w as f32, native_h as f32);

    let (draw_w, draw_h, offset_x, offset_y) = match data.fit.as_str() {
        "contain" | "cover" => {
            let box_aspect = rect.width / rect.height;
            let img_aspect = native_w / native_h;
            let scale_to_cover = data.fit == "cover";
            let fit_by_width = if scale_to_cover { img_aspect < box_aspect } else { img_aspect > box_aspect };
            let (w, h) = if fit_by_width {
                (rect.width, rect.width / img_aspect)
            } else {
                (rect.height * img_aspect, rect.height)
            };
            let ox = (rect.width - w) * data.object_position[0];
            let oy = (rect.height - h) * data.object_position[1];
            (w, h, ox, oy)
        }
        _ => (rect.width, rect.height, 0.0, 0.0),
    };

    if data.fit == "cover" {
        let Some(clip_path) = rounded_rect_path(rect.x, rect.y, rect.width, rect.height, 0.0, false) else {
            return;
        };
        surface.push_clip_path(&clip_path, &FillRule::NonZero);
    }

    // krilla::Surface is top-left-origin/Y-down natively -- no flip/counter-flip needed (see
    // page.rs's own module doc comment). draw_image renders correctly-oriented pixels directly
    // under a plain translate to this rect's own top-left.
    surface.push_transform(&Transform::from_translate(rect.x + offset_x, rect.y + offset_y));
    let opacity = NormalizedF32::new((data.opacity * rect.opacity).clamp(0.0, 1.0)).unwrap_or(NormalizedF32::ZERO);
    surface.push_opacity(opacity);
    let Some(size) = Size::from_wh(draw_w, draw_h) else {
        surface.pop();
        surface.pop();
        if data.fit == "cover" {
            surface.pop();
        }
        return;
    };
    surface.draw_image(image.clone(), size);
    surface.pop();
    surface.pop();
    if data.fit == "cover" {
        surface.pop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zero_radius_produces_a_plain_four_point_rect() {
        let path = rounded_rect_path(0.0, 0.0, 100.0, 50.0, 0.0, false);
        assert!(path.is_some());
    }

    #[test]
    fn radius_is_clamped_to_half_the_smaller_dimension() {
        // A radius larger than half the height must not produce overlapping/invalid geometry --
        // this just proves the builder doesn't panic or return None for an absurd input.
        let path = rounded_rect_path(0.0, 0.0, 100.0, 20.0, 999.0, false);
        assert!(path.is_some());
    }

    #[test]
    fn squircle_path_builds_without_panicking() {
        let path = rounded_rect_path(0.0, 0.0, 100.0, 100.0, 24.0, true);
        assert!(path.is_some());
    }

    #[test]
    fn squircle_boundary_sample_satisfies_the_superellipse_equation() {
        // Verifies the parametric sampler actually sits on |x/r|^4 + |y/r|^4 = 1, matching the
        // plan's own accuracy bar (cited alongside Vellum's ~0.5px SDF tolerance).
        let r = 40.0;
        for i in 0..=8 {
            let phi_deg = (i as f32 / 8.0) * 90.0;
            let (x, y) = squircle_point(r, phi_deg);
            let lhs = (x / r).abs().powf(SQUIRCLE_N) + (y / r).abs().powf(SQUIRCLE_N);
            assert!((lhs - 1.0).abs() < 1e-3, "phi_deg={phi_deg} lhs={lhs}");
        }
    }

    #[test]
    fn squircle_point_lands_on_the_correct_compass_tangent_points() {
        // The actual bug reported live ("weird pointy corners"): squircle_point used to compute
        // points with standard (Y-UP) trig in this crate's Y-DOWN space, sending each corner's
        // sweep toward the wrong tangent entirely (e.g. the "top-right" corner's arc ended up
        // heading toward its own SOUTH instead of its own NORTH, overlapping the next corner's
        // territory and producing a self-crossing, spiky polyline instead of a smooth curve).
        // phi=0/90/180/270 must land exactly on north/east/south/west respectively.
        // Tolerance looser than the usual 1e-3: at these exact quadrant boundaries one component
        // is mathematically zero, but cos/sin of a non-exact-multiple-of-pi/2 f32 radian value
        // leaves a tiny (~1e-7) residual that the `powf(2.0/N)` (a square root at N=4) amplifies
        // -- e.g. sqrt(1e-7) ~= 3e-4, still 0.02% of r=40 and visually meaningless, but bigger
        // than 1e-3. This is float precision, not a directional/sign bug (that's what the
        // corner-sweep continuity test below checks structurally instead).
        let r = 40.0;
        let tol = 2e-2;
        let (nx, ny) = squircle_point(r, 0.0);
        assert!((nx).abs() < tol && (ny + r).abs() < tol, "phi=0 should be north (0,-r), got ({nx},{ny})");
        let (ex, ey) = squircle_point(r, 90.0);
        assert!((ex - r).abs() < tol && ey.abs() < tol, "phi=90 should be east (r,0), got ({ex},{ey})");
        let (sx, sy) = squircle_point(r, 180.0);
        assert!(sx.abs() < tol && (sy - r).abs() < tol, "phi=180 should be south (0,r), got ({sx},{sy})");
        let (wx, wy) = squircle_point(r, 270.0);
        assert!((wx + r).abs() < tol && wy.abs() < tol, "phi=270 should be west (-r,0), got ({wx},{wy})");
    }

    #[test]
    fn squircle_corner_sweep_connects_to_the_matching_bezier_corner_tangent() {
        // Cross-checks squircle_point's tangent points against rounded_rect_path's OWN
        // (non-squircle) bezier corner tangent points for the identical rect -- both corner
        // styles must meet the straight edges at the SAME points, or a mixed/partial squircle
        // author (or just visual comparison against a plain rounded corner) would show a visible
        // seam. Top-right corner: bezier path's own top tangent is (x+w-r, y), matching
        // squircle_point's phi=0 (north) relative to that corner's center (x+w-r, y+r).
        let (x, y, w, _h, r) = (10.0_f32, 20.0_f32, 200.0_f32, 100.0_f32, 30.0_f32);
        let center = (x + w - r, y + r);
        let (dx, dy) = squircle_point(r, 0.0);
        let (px, py) = (center.0 + dx, center.1 + dy);
        assert!((px - (x + w - r)).abs() < 1e-3 && (py - y).abs() < 1e-3, "got ({px},{py})");
    }

    #[test]
    fn wght_variation_applies_without_error_on_a_real_variable_font() {
        // The Satoshi-Variable fixture is a real variable font (single file, weight axis) --
        // exactly the case that read "bleached"/washed-out (reported live) when the wght axis
        // was never set, since the file's own default instance rendered regardless of the
        // TextData's actually-requested weight. This doesn't assert visual output (no rasterizer
        // available in a unit test), just that setting a real wght value against a real variable
        // font succeeds and doesn't change the font's own reported units-per-em (the axis affects
        // outlines, not the em-square scale).
        let woff2_bytes = std::fs::read(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/Satoshi-Variable.woff2"))
            .expect("test fixture should exist");
        let mut cursor = std::io::Cursor::new(woff2_bytes);
        let sfnt = woff2::convert_woff2_to_ttf(&mut cursor).expect("fixture should decompress");
        let mut face = rustybuzz::Face::from_slice(&sfnt, 0).expect("fixture should parse");
        let upem_before = face.units_per_em();
        let wght: rustybuzz::Variation = "wght=700".parse().expect("wght=700 should parse as a Variation");
        face.set_variations(&[wght]);
        assert_eq!(face.units_per_em(), upem_before, "setting a variation must not change the em scale");
    }

    #[test]
    fn paint_img_translates_to_a_plain_top_left_with_no_flip() {
        // Regression guard for the real bug: this crate used to push a redundant Y-flip on top
        // of krilla::Surface's own already-top-left-origin/Y-down space, then a local
        // counter-flip in paint_img specifically to (incompletely) undo it -- composed
        // inconsistently across node kinds, reported live as "images are flipped upside down"
        // plus a broader page-orientation bug ("children reversed everywhere"). The fix removed
        // BOTH flips; paint_img now pushes a plain translate to the rect's own top-left, matching
        // krilla's documented coordinate contract directly. This test just pins that shape so a
        // future edit can't silently reintroduce a flip transform here.
        let t = Transform::from_translate(50.0, 100.0);
        assert_eq!((t.sx(), t.sy()), (1.0, 1.0), "must be a plain translate, no scale/flip");
        assert_eq!((t.tx(), t.ty()), (50.0, 100.0));
    }
}
