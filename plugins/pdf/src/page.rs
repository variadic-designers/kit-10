//! Paper size / orientation / fit-mode / DPI resolution -- turns "this View's own artwork is
//! W x H design px" plus the user's chosen export options into a concrete PDF page size (in
//! points, PDF's native unit) and a single affine transform mapping artwork-local coordinates
//! (top-left origin, Y-down, same convention `kit10-scene`/Vellum use) into `krilla::Surface`'s
//! OWN coordinate space.
//!
//! No Y-flip is applied here. This module originally flipped Y itself (to convert into what was
//! assumed to be PDF's native bottom-left/Y-up page space), and `paint.rs` pushed a SECOND, local
//! counter-flip for text/images specifically to undo that flip's effect on glyph/pixel
//! orientation. Both were wrong: `krilla::surface`'s own module doc comment states plainly "The
//! origin of the coordinate axis is in the top-left corner" -- krilla already applies the real
//! PDF-space flip internally (`page_root_transform`, `Transform::from_row(1,0,0,-1,0,height)`,
//! composed into every `Surface` before any caller code runs) and presents a top-left/Y-down
//! space to every `Surface` method uniformly, matching this crate's own `kit10-scene` convention
//! exactly. Pushing a second flip on top of krilla's own, then a THIRD counter-flip for
//! orientation-sensitive content, composed inconsistently across node kinds -- explaining the
//! full range of symptoms reported live in one shot: page content appearing vertically mirrored
//! ("children reversed everywhere"), and images rendering upside down (text had its own,
//! separately-added counter-flip that happened to look closer to correct, but was still built on
//! the same wrong premise). Trusting krilla's documented contract directly removes an entire
//! layer of hand-rolled coordinate math this crate never needed.

use serde::{Deserialize, Serialize};

pub const POINTS_PER_INCH: f32 = 72.0;

#[derive(Debug, Clone, Copy, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PageSize {
    /// Page = artwork's own physical size at the chosen DPI. No further fit/centering needed.
    Fit,
    Letter,
    Legal,
    Tabloid,
    A3,
    A4,
    A5,
}

impl Default for PageSize {
    fn default() -> Self {
        PageSize::Fit
    }
}

impl PageSize {
    /// Fixed portrait-orientation (width, height) in points for the real paper presets. Standard
    /// ISO 216 / ANSI point sizes at 72pt/in. `Fit` has no static size -- callers must compute it
    /// from the artwork instead (see `resolve_page`).
    fn preset_portrait_pt(self) -> Option<(f32, f32)> {
        match self {
            PageSize::Fit => None,
            PageSize::Letter => Some((612.0, 792.0)),
            PageSize::Legal => Some((612.0, 1008.0)),
            PageSize::Tabloid => Some((792.0, 1224.0)),
            PageSize::A3 => Some((841.89, 1190.55)),
            PageSize::A4 => Some((595.28, 841.89)),
            PageSize::A5 => Some((419.53, 595.28)),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Orientation {
    /// Portrait if the artwork is taller than wide, landscape otherwise; irrelevant for `PageSize::Fit`.
    Auto,
    Portrait,
    Landscape,
}

impl Default for Orientation {
    fn default() -> Self {
        Orientation::Auto
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FitMode {
    /// Uniformly scale + center the artwork to fit entirely within the page.
    FitToPage,
    /// Place the artwork at its true DPI-derived size, centered; may extend past the page edge.
    ActualSize,
    /// Uniformly scale + center the artwork to cover the page; overflow must be clipped by the
    /// caller (this module only computes the transform, not the clip path).
    FillAndCrop,
}

impl Default for FitMode {
    fn default() -> Self {
        FitMode::FitToPage
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Deserialize, Serialize)]
pub struct PdfOptions {
    #[serde(default)]
    pub page_size: PageSize,
    #[serde(default)]
    pub orientation: Orientation,
    #[serde(default)]
    pub fit_mode: FitMode,
    /// Design-px-per-inch. Clamped to the `[72, 600]` range the export UI itself exposes.
    #[serde(default = "default_dpi")]
    pub dpi: f32,
    /// When true (the default) and a real paper preset is chosen (anything but `PageSize::Fit`),
    /// the artwork's own root is reflowed -- its width pinned to the preset's own content width,
    /// letting `Percent` widths/flex-wrap/flex-basis content resolve against the NEW width the
    /// same way a browser reflows a page on viewport resize -- rather than laid out once at its
    /// own natural width and then uniformly scaled/cropped to fit (`fit_mode`'s job, which only
    /// applies when this is off). See `layout::resolve_layout_reflowed` and `lib.rs::build_pdf`
    /// for where this actually gets used; irrelevant for `PageSize::Fit` (nothing to reflow to).
    #[serde(default = "default_reflow")]
    pub reflow: bool,
}

fn default_dpi() -> f32 {
    150.0
}

fn default_reflow() -> bool {
    true
}

impl Default for PdfOptions {
    fn default() -> Self {
        PdfOptions {
            page_size: PageSize::default(),
            orientation: Orientation::default(),
            fit_mode: FitMode::default(),
            dpi: default_dpi(),
            reflow: default_reflow(),
        }
    }
}

/// A row-major affine `(sx, ky, kx, sy, tx, ty)`, PDF/tiny-skia convention
/// (`x' = sx*x + kx*y + tx`, `y' = ky*x + sy*y + ty`). No skew/rotation term is ever produced by
/// `resolve_page` (every fit mode is a uniform scale + translate), so `kx`/`ky` are always `0.0`
/// -- kept as named fields anyway so this is a drop-in match for `krilla::Transform::from_row`'s
/// argument order without a wrapper type this crate would otherwise need to define.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RowTransform {
    pub sx: f32,
    pub ky: f32,
    pub kx: f32,
    pub sy: f32,
    pub tx: f32,
    pub ty: f32,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PageLayout {
    pub size_pt: (f32, f32),
    /// Maps artwork-local (design-px, top-left origin, Y-down) -> `krilla::Surface`'s own
    /// top-left-origin/Y-down space. A plain scale+translate, no flip (see module doc comment).
    pub artwork_transform: RowTransform,
}

// Resolves a chosen paper preset + orientation option against the artwork's own aspect ratio
// (only consulted for `Orientation::Auto`) to a concrete (width_pt, height_pt) -- `None` for
// `PageSize::Fit`, which has no fixed preset to resolve. Shared by `resolve_page` (the
// scale-to-fit path) and `reflow_target_width_px` (the reflow path), so the two can never
// disagree about which orientation a given artwork resolves to.
fn resolve_preset_pt(artwork_w_px: f32, artwork_h_px: f32, opts: &PdfOptions) -> Option<(f32, f32)> {
    let (portrait_w, portrait_h) = opts.page_size.preset_portrait_pt()?;
    let landscape_by_artwork_aspect = artwork_w_px > artwork_h_px;
    Some(match opts.orientation {
        Orientation::Portrait => (portrait_w, portrait_h),
        Orientation::Landscape => (portrait_h, portrait_w),
        Orientation::Auto => {
            if landscape_by_artwork_aspect {
                (portrait_h, portrait_w)
            } else {
                (portrait_w, portrait_h)
            }
        }
    })
}

/// `artwork_px` is the exported View's own resolved root size in design pixels (from the taffy
/// layout pass, `layout::resolve_layout`). Scale-to-fit path: used when `opts.reflow` is off, or
/// `page_size` is `Fit` (nothing to reflow to either way).
pub fn resolve_page(artwork_px: (f32, f32), opts: &PdfOptions) -> PageLayout {
    let (artwork_w_px, artwork_h_px) = artwork_px;
    let dpi = opts.dpi.max(1.0);
    let px_to_pt = POINTS_PER_INCH / dpi;

    match resolve_preset_pt(artwork_w_px, artwork_h_px, opts) {
        None => {
            // Fit: page == artwork's own DPI-scaled size exactly, no centering needed.
            let size_pt = (artwork_w_px * px_to_pt, artwork_h_px * px_to_pt);
            PageLayout {
                size_pt,
                artwork_transform: scale_transform(px_to_pt, px_to_pt, 0.0, 0.0),
            }
        }
        Some((page_w, page_h)) => {
            let artwork_w_pt = artwork_w_px * px_to_pt;
            let artwork_h_pt = artwork_h_px * px_to_pt;

            let scale = match opts.fit_mode {
                FitMode::ActualSize => 1.0,
                FitMode::FitToPage => {
                    (page_w / artwork_w_pt).min(page_h / artwork_h_pt)
                }
                FitMode::FillAndCrop => {
                    (page_w / artwork_w_pt).max(page_h / artwork_h_pt)
                }
            };

            let scaled_w = artwork_w_pt * scale;
            let scaled_h = artwork_h_pt * scale;
            let offset_x = (page_w - scaled_w) / 2.0;
            let offset_y = (page_h - scaled_h) / 2.0;

            let effective_scale = px_to_pt * scale;
            PageLayout {
                size_pt: (page_w, page_h),
                artwork_transform: scale_transform(effective_scale, effective_scale, offset_x, offset_y),
            }
        }
    }
}

/// Design-px width to reflow the artwork's root to, for the chosen preset/orientation --
/// `page_w_pt / px_to_pt` (both already DPI-consistent). `None` for `PageSize::Fit` (nothing to
/// reflow to) or when `opts.reflow` is off. Callers pass this to
/// `layout::resolve_layout_reflowed`'s `target_width_px`.
pub fn reflow_target_width_px(artwork_w_px: f32, artwork_h_px: f32, opts: &PdfOptions) -> Option<f32> {
    if !opts.reflow {
        return None;
    }
    let dpi = opts.dpi.max(1.0);
    let px_to_pt = POINTS_PER_INCH / dpi;
    let (page_w_pt, _) = resolve_preset_pt(artwork_w_px, artwork_h_px, opts)?;
    Some(page_w_pt / px_to_pt)
}

/// Page setup for an ALREADY-reflowed artwork (its own root width already pinned to the target
/// preset's content width via `layout::resolve_layout_reflowed`) -- the page is sized to exactly
/// match the reflowed artwork's own resulting size (same math as `resolve_page`'s `Fit` branch),
/// since there's nothing left to scale/center/crop: reflow already did the real work of making
/// the content the right shape for this page, the way `fit_mode` does for the non-reflow path.
pub fn resolve_page_for_reflowed_artwork(reflowed_artwork_px: (f32, f32), opts: &PdfOptions) -> PageLayout {
    let (w_px, h_px) = reflowed_artwork_px;
    let dpi = opts.dpi.max(1.0);
    let px_to_pt = POINTS_PER_INCH / dpi;
    PageLayout {
        size_pt: (w_px * px_to_pt, h_px * px_to_pt),
        artwork_transform: scale_transform(px_to_pt, px_to_pt, 0.0, 0.0),
    }
}

// x' = kx_scale*x + ox ; y' = ky_scale*y + oy -- plain scale+translate, top-left-origin/Y-down
// throughout (both this crate's artwork space AND krilla::Surface's own space), no flip.
fn scale_transform(kx_scale: f32, ky_scale: f32, ox: f32, oy: f32) -> RowTransform {
    RowTransform { sx: kx_scale, ky: 0.0, kx: 0.0, sy: ky_scale, tx: ox, ty: oy }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fit_page_size_matches_artwork_at_default_dpi() {
        // At 150dpi, 1500x2100px -> 720x1008pt (10x14in) -- the exact example cited in the plan.
        let layout = resolve_page((1500.0, 2100.0), &PdfOptions::default());
        assert!((layout.size_pt.0 - 720.0).abs() < 1e-3);
        assert!((layout.size_pt.1 - 1008.0).abs() < 1e-3);
    }

    #[test]
    fn fit_page_at_72dpi_is_1to1_px_to_pt() {
        let opts = PdfOptions { dpi: 72.0, ..Default::default() };
        let layout = resolve_page((800.0, 600.0), &opts);
        assert_eq!(layout.size_pt, (800.0, 600.0));
    }

    #[test]
    fn fit_page_transform_is_a_plain_1to1_scale_with_no_flip() {
        // krilla::Surface already presents a top-left-origin/Y-down space (its own module doc
        // comment, backed by page_root_transform's internal PDF-space flip) -- this transform
        // must NOT flip Y a second time. Artwork top-left (0,0) stays at (0,0); bottom-right
        // stays at (800,600), matching krilla's own coordinate convention directly.
        let opts = PdfOptions { dpi: 72.0, ..Default::default() };
        let layout = resolve_page((800.0, 600.0), &opts);
        let t = layout.artwork_transform;
        let (x, y) = (t.sx * 0.0 + t.kx * 0.0 + t.tx, t.ky * 0.0 + t.sy * 0.0 + t.ty);
        assert_eq!((x, y), (0.0, 0.0));
        let (x2, y2) = (t.sx * 800.0 + t.kx * 600.0 + t.tx, t.ky * 800.0 + t.sy * 600.0 + t.ty);
        assert_eq!((x2, y2), (800.0, 600.0));
    }

    #[test]
    fn letter_preset_portrait_is_612x792() {
        let opts = PdfOptions { page_size: PageSize::Letter, orientation: Orientation::Portrait, ..Default::default() };
        let layout = resolve_page((100.0, 100.0), &opts);
        assert_eq!(layout.size_pt, (612.0, 792.0));
    }

    #[test]
    fn auto_orientation_picks_landscape_for_wide_artwork() {
        let opts = PdfOptions { page_size: PageSize::Letter, orientation: Orientation::Auto, ..Default::default() };
        let layout = resolve_page((2000.0, 1000.0), &opts);
        assert_eq!(layout.size_pt, (792.0, 612.0));
    }

    #[test]
    fn fit_to_page_scales_down_and_centers_oversized_artwork() {
        // A 612x792pt-equivalent-or-larger artwork at 72dpi on a Letter page must shrink to fit
        // and stay centered on whichever axis has slack.
        let opts = PdfOptions {
            page_size: PageSize::Letter,
            orientation: Orientation::Portrait,
            fit_mode: FitMode::FitToPage,
            dpi: 72.0,
            reflow: false,
        };
        // Artwork is exactly Letter-width but twice Letter-height -- must shrink by 0.5x to fit
        // height, leaving horizontal slack to center.
        let layout = resolve_page((612.0, 1584.0), &opts);
        let t = layout.artwork_transform;
        assert!((t.sx - 0.5).abs() < 1e-3);
        // Centered horizontally: scaled width = 306pt, page width 612pt -> 153pt margin each side.
        assert!((t.tx - 153.0).abs() < 1e-3);
    }

    #[test]
    fn actual_size_does_not_rescale() {
        let opts = PdfOptions {
            page_size: PageSize::A4,
            orientation: Orientation::Portrait,
            fit_mode: FitMode::ActualSize,
            dpi: 72.0,
            reflow: false,
        };
        let layout = resolve_page((100.0, 100.0), &opts);
        let t = layout.artwork_transform;
        assert!((t.sx - 1.0).abs() < 1e-3);
    }

    #[test]
    fn fill_and_crop_scales_up_to_cover() {
        let opts = PdfOptions {
            page_size: PageSize::Letter,
            orientation: Orientation::Portrait,
            fit_mode: FitMode::FillAndCrop,
            dpi: 72.0,
            reflow: false,
        };
        // Artwork smaller than the page on both axes -- FillAndCrop must scale UP to cover, using
        // the larger of the two required ratios (unlike FitToPage's smaller-of).
        let layout = resolve_page((306.0, 396.0), &opts); // exactly half Letter on both axes
        let t = layout.artwork_transform;
        assert!((t.sx - 2.0).abs() < 1e-3);
    }

    #[test]
    fn reflow_target_width_px_matches_the_preset_at_72dpi() {
        let opts = PdfOptions {
            page_size: PageSize::Letter,
            orientation: Orientation::Portrait,
            dpi: 72.0,
            reflow: true,
            ..Default::default()
        };
        // At 72dpi, 1px == 1pt, so the reflow target width should be exactly Letter's own 612pt.
        let target = reflow_target_width_px(100.0, 100.0, &opts);
        assert_eq!(target, Some(612.0));
    }

    #[test]
    fn reflow_target_width_px_is_none_for_fit_or_when_reflow_is_off() {
        let fit_opts = PdfOptions { page_size: PageSize::Fit, reflow: true, ..Default::default() };
        assert_eq!(reflow_target_width_px(100.0, 100.0, &fit_opts), None);

        let reflow_off = PdfOptions { page_size: PageSize::Letter, reflow: false, ..Default::default() };
        assert_eq!(reflow_target_width_px(100.0, 100.0, &reflow_off), None);
    }

    #[test]
    fn resolve_page_for_reflowed_artwork_sizes_the_page_to_the_reflowed_result_exactly() {
        // Once reflow has already happened (the caller pinned the root's width to the preset),
        // the page should just wrap that result 1:1 (DPI-scaled) -- no additional fit_mode
        // scaling, since there's nothing left to fit.
        let opts = PdfOptions { dpi: 72.0, ..Default::default() };
        let layout = resolve_page_for_reflowed_artwork((612.0, 900.0), &opts);
        assert_eq!(layout.size_pt, (612.0, 900.0));
        assert_eq!((layout.artwork_transform.sx, layout.artwork_transform.sy), (1.0, 1.0));
    }
}
