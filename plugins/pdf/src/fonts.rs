//! Resolves every distinct (family, weight, style) a View's `Text` nodes need to real, embeddable
//! font bytes: `kit10_get_font_bytes` (a new host fn -- the existing `kit10_get_font_links` only
//! ever returns a URL, fine for a browser's own `<link>`/`@font-face` fetch but useless for a
//! plugin that has to embed the actual font program) -> Fontavious's own catalogue/CDN fetch,
//! decompressed from WOFF2 (the only format Fontavious ever serves, see WebCodium's own
//! `@font-face format("woff2")` comment) into raw sfnt bytes via the `woff2` crate, then parsed
//! once into a `krilla::text::Font` for embedding/subsetting.

use extism_pdk::host_fn;
use kit10_scene::{FontStyle, TextData, UiNode};
use krilla::text::Font;
use serde::Deserialize;
use std::collections::HashMap;
use std::io::Cursor;

#[host_fn]
extern "ExtismHost" {
    fn kit10_get_font_bytes(input: String) -> String;
}

fn font_style_str(s: FontStyle) -> &'static str {
    // Matches WebCodium's own css::font_style_css exactly (same CSS-convention lowercase
    // strings), since these travel through the same kit10_get_font_bytes/kit10_get_font_links
    // host-fn contract Fontavious's FetchFontInput.style (a plain String) expects.
    match s {
        FontStyle::Normal => "normal",
        FontStyle::Italic => "italic",
        FontStyle::Oblique => "oblique",
    }
}

fn distinct_font_requests(nodes: &[UiNode]) -> Vec<(String, u16, String)> {
    let mut seen = std::collections::HashSet::new();
    let mut result = Vec::new();
    for node in nodes {
        if let UiNode::Text(TextData { font_family, font_weight, font_style, .. }) = node {
            let key = (font_family.clone(), *font_weight, font_style_str(*font_style).to_string());
            if seen.insert(key.clone()) {
                result.push(key);
            }
        }
    }
    result
}

#[derive(Debug, Deserialize)]
struct FontBytesEntry {
    family: String,
    weight: u16,
    style: String,
    base64: String,
}

#[derive(Debug, Deserialize, Default)]
struct FontBytesResponse {
    #[serde(default)]
    bytes: Vec<FontBytesEntry>,
}

pub struct FontEntry {
    pub sfnt_bytes: Vec<u8>,
    pub krilla_font: Font,
}

impl FontEntry {
    /// Builds a rustybuzz face from this entry's sfnt bytes with the requested weight's `wght`
    /// variation axis applied -- see `paint::paint_text`'s doc comment on why this matters for
    /// variable fonts (their default named instance otherwise renders regardless of the
    /// TextData's actually-requested weight). Shared by `layout.rs`'s text measurement/wrapping
    /// and `paint.rs`'s actual glyph shaping so both measure against IDENTICAL advance widths --
    /// line breaks computed during layout must never disagree with what paint later draws, or
    /// a wrapped line could overflow the very box sized to fit it.
    pub fn shaped_face(&self, weight: u16) -> Option<rustybuzz::Face<'_>> {
        let mut face = rustybuzz::Face::from_slice(&self.sfnt_bytes, 0)?;
        if let Ok(wght) = format!("wght={weight}").parse::<rustybuzz::Variation>() {
            face.set_variations(&[wght]);
        }
        Some(face)
    }
}

fn build_entry(woff2_bytes: Vec<u8>) -> Option<FontEntry> {
    let mut cursor = Cursor::new(woff2_bytes);
    let sfnt_bytes = woff2::convert_woff2_to_ttf(&mut cursor).ok()?;
    let krilla_font = Font::new(sfnt_bytes.clone().into(), 0)?;
    Some(FontEntry { sfnt_bytes, krilla_font })
}

#[derive(Default)]
pub struct FontCache {
    entries: HashMap<(String, u16, String), FontEntry>,
}

impl FontCache {
    /// Best-effort, same tolerance as WebCodium's own `fetch_font_links`: any failure (host-fn
    /// call, JSON parse, an individual WOFF2 decompress/parse error) just leaves that one
    /// (family, weight, style) absent from the cache, never fails the whole export. A Text node
    /// whose font never resolved falls back to being skipped at paint time (see paint::paint_text)
    /// rather than guessing a system font substitute -- no such concept exists in a PDF the way a
    /// browser's local-font fallback does.
    pub fn load(nodes: &[UiNode]) -> Self {
        let requests = distinct_font_requests(nodes);
        if requests.is_empty() {
            return Self::default();
        }

        let request_json = serde_json::json!({
            "requests": requests.iter().map(|(family, weight, style)| {
                serde_json::json!({ "family": family, "weight": weight, "style": style })
            }).collect::<Vec<_>>()
        })
        .to_string();

        let Ok(raw) = (unsafe { kit10_get_font_bytes(request_json) }) else {
            return Self::default();
        };
        let Ok(resp) = serde_json::from_str::<FontBytesResponse>(&raw) else {
            return Self::default();
        };

        let mut entries = HashMap::new();
        for entry in resp.bytes {
            let Ok(woff2_bytes) = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, &entry.base64) else {
                continue;
            };
            let Some(font_entry) = build_entry(woff2_bytes) else { continue };
            entries.insert((entry.family, entry.weight, entry.style), font_entry);
        }
        Self { entries }
    }

    /// Test-only constructor: builds a single-entry cache directly from real WOFF2 bytes,
    /// bypassing `load`'s host-fn round trip entirely (see the module's own test note on why
    /// `load` itself can't be called from a native unit test). Used by lib.rs's end-to-end
    /// `build_pdf` tests to exercise real text shaping/embedding against an actual font.
    #[cfg(test)]
    pub(crate) fn test_cache(family: &str, weight: u16, style: FontStyle, woff2_bytes: Vec<u8>) -> Self {
        let mut entries = HashMap::new();
        if let Some(font_entry) = build_entry(woff2_bytes) {
            entries.insert((family.to_string(), weight, font_style_str(style).to_string()), font_entry);
        }
        Self { entries }
    }

    pub fn get(&self, family: &str, weight: u16, style: FontStyle) -> Option<&FontEntry> {
        self.entries.get(&(family.to_string(), weight, font_style_str(style).to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tree::test_support::test_box;
    use kit10_scene::{BoxData, Extent, OklabColor, TextAlign, TextDecorationKind};

    fn text_node(family: &str, weight: u16, style: FontStyle) -> UiNode {
        UiNode::Text(TextData {
            parent_id: None,
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
            content: "Hello".to_string(),
            font_size: 16.0,
            font_family: family.to_string(),
            font_weight: weight,
            font_style: style,
            text_color: OklabColor::default(),
            text_align: TextAlign::default(),
            text_decoration: TextDecorationKind::default(),
            line_height: 0.0,
            deform: None,
            extra: Default::default(),
            selected: 0,
            hovered: false,
        })
    }

    #[test]
    fn distinct_font_requests_dedupes_by_family_weight_and_style() {
        let a = text_node("Inter", 700, FontStyle::Normal);
        let b = text_node("Inter", 700, FontStyle::Normal);
        let c = text_node("Inter", 400, FontStyle::Italic);
        let requests = distinct_font_requests(&[a, b, c]);
        assert_eq!(
            requests,
            vec![
                ("Inter".to_string(), 700, "normal".to_string()),
                ("Inter".to_string(), 400, "italic".to_string()),
            ]
        );
    }

    #[test]
    fn distinct_font_requests_ignores_non_text_nodes() {
        let nodes = vec![UiNode::Box(BoxData { ..test_box(None) })];
        assert!(distinct_font_requests(&nodes).is_empty());
    }

    // FontCache::load itself is deliberately NOT unit-tested here: even its zero-requests
    // short-circuit branch still textually references the kit10_get_font_bytes extern (Rust
    // doesn't strip an unreached branch's symbol reference), which fails to link natively with
    // no Extism host to satisfy it -- the same reason WebCodium's own host-fn-calling wrappers
    // (fetch_font_links, export_html_css) have no native unit tests either, only their pure
    // helpers (distinct_font_requests above) do.
}
