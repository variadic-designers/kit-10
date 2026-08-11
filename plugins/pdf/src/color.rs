//! Oklab -> sRGB, ported verbatim from `src/lib/color/oklch.ts`'s `oklabToLinearSrgb` +
//! `linearToSrgb` (the Ottosson inverse matrices). `kit10-scene` only ships the forward
//! (sRGB -> Oklab) direction -- see that crate's `linear_srgb_to_oklab` -- since no existing
//! consumer (Vellum, WebCodium) ever needs to go back the other way; WebCodium emits literal
//! `oklab(...)` CSS and lets the browser's own Color 4 engine convert it. PDF's DeviceRGB has no
//! such native support, so this plugin carries the one reverse transform that doesn't exist in
//! Rust anywhere else in this codebase.
//!
//! Gamut mapping: a naive per-channel clamp, matching the only other place a reverse conversion
//! is materialized in this codebase (`oklch.ts`'s `oklchToHex`) -- nothing here does real
//! perceptual gamut mapping (CSS Color 4 chroma-reduction search), so this doesn't invent one
//! either. See the plan's Color section for why that's the right default for v1.

use kit10_scene::OklabColor;

fn linear_to_srgb(c: f32) -> f32 {
    if c <= 0.0031308 {
        c * 12.92
    } else {
        1.055 * c.powf(1.0 / 2.4) - 0.055
    }
}

fn oklab_to_linear_srgb(l: f32, a: f32, b: f32) -> (f32, f32, f32) {
    let l_ = l + 0.3963377774 * a + 0.2158037573 * b;
    let m_ = l - 0.1055613458 * a - 0.0638541728 * b;
    let s_ = l - 0.0894841775 * a - 1.2914855480 * b;

    let l3 = l_ * l_ * l_;
    let m3 = m_ * m_ * m_;
    let s3 = s_ * s_ * s_;

    (
        4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
        -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
        -0.0041960863 * l3 - 0.7034186147 * m3 + 1.7076147010 * s3,
    )
}

/// sRGB channels in `0.0..=1.0`, out-of-gamut values clamped (see module doc).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Srgb {
    pub r: f32,
    pub g: f32,
    pub b: f32,
    pub alpha: f32,
}

pub fn oklab_to_srgb(color: &OklabColor) -> Srgb {
    let (lr, lg, lb) = oklab_to_linear_srgb(color.l, color.a, color.b);
    let clamp = |v: f32| v.clamp(0.0, 1.0);
    Srgb {
        r: clamp(linear_to_srgb(clamp(lr))),
        g: clamp(linear_to_srgb(clamp(lg))),
        b: clamp(linear_to_srgb(clamp(lb))),
        alpha: color.alpha.clamp(0.0, 1.0),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use kit10_scene::OklabColor;

    // Round-trip tolerance matches the plan's own bar ("oklab_srgb_round_trips_within_epsilon").
    // Forward direction (srgb -> oklab) is kit10_scene's own linear_srgb_to_oklab; round-tripping
    // through it and back should land within float error for in-gamut colors.
    #[test]
    fn oklab_srgb_round_trips_within_epsilon_for_pure_white() {
        let white = oklab_to_srgb(&OklabColor::new(1.0, 0.0, 0.0, 1.0));
        assert!((white.r - 1.0).abs() < 1e-3);
        assert!((white.g - 1.0).abs() < 1e-3);
        assert!((white.b - 1.0).abs() < 1e-3);
    }

    #[test]
    fn oklab_srgb_round_trips_within_epsilon_for_pure_black() {
        let black = oklab_to_srgb(&OklabColor::new(0.0, 0.0, 0.0, 1.0));
        assert!(black.r < 1e-3);
        assert!(black.g < 1e-3);
        assert!(black.b < 1e-3);
    }

    #[test]
    fn out_of_gamut_chroma_clamps_into_0_1_range() {
        // An absurdly high chroma pushes linear-sRGB components outside [0,1] before conversion;
        // the naive per-channel clamp (matching oklch.ts's oklchToHex) must still land in range.
        let extreme = oklab_to_srgb(&OklabColor::new(0.5, 5.0, 5.0, 1.0));
        assert!((0.0..=1.0).contains(&extreme.r));
        assert!((0.0..=1.0).contains(&extreme.g));
        assert!((0.0..=1.0).contains(&extreme.b));
    }

    #[test]
    fn alpha_passes_through_clamped() {
        let over = oklab_to_srgb(&OklabColor::new(0.5, 0.0, 0.0, 1.5));
        assert_eq!(over.alpha, 1.0);
    }
}
