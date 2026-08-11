//! Resolves `ImageSource::Ref(asset_id)`/`Bytes` on `Img` nodes to a decoded `krilla::image::Image`
//! ready to embed. `kit10_get_asset_links` (WebCodium's own host fn) only ever returns a URL --
//! fine for a browser `<img src>`, useless for a plugin that has to embed the actual pixels, so
//! this uses a new host fn, `kit10_get_asset_bytes`, that actually fetches and returns them.

use extism_pdk::host_fn;
use kit10_scene::{ImageSource, ImgData, UiNode};
use krilla::image::Image;
use serde::Deserialize;
use std::collections::HashMap;

#[host_fn]
extern "ExtismHost" {
    fn kit10_get_asset_bytes(input: String) -> String;
}

#[derive(Debug, Deserialize, Default)]
struct AssetBytesResponse {
    #[serde(default)]
    bytes: HashMap<String, String>,
}

fn distinct_asset_ids(nodes: &[UiNode]) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut result = Vec::new();
    for node in nodes {
        if let UiNode::Img(ImgData { source: ImageSource::Ref(id), .. }) = node {
            if seen.insert(id.clone()) {
                result.push(id.clone());
            }
        }
    }
    result
}

/// Sniffs a raster format from magic bytes and decodes via krilla's own format-specific
/// constructor -- krilla decodes PNG/JPEG/GIF/WebP internally, no separate `image`-crate
/// dependency needed here. An unrecognized/corrupt payload returns `None`, same silent-skip
/// posture as WebCodium's own "no known link" case for Img.
fn decode_image(bytes: Vec<u8>) -> Option<Image> {
    let data: krilla::Data = bytes.clone().into();
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Image::from_png(data, true)
    } else if bytes.starts_with(b"\xFF\xD8\xFF") {
        Image::from_jpeg(data, true)
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Image::from_gif(data, true)
    } else if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Image::from_webp(data, true)
    } else {
        None
    }
}

#[derive(Default)]
pub struct ImageCache {
    entries: HashMap<String, Image>,
}

impl ImageCache {
    /// Best-effort per asset, same tolerance as every other host-fn round trip in this plugin: a
    /// missing link, failed fetch, or undecodable payload just leaves that one asset id absent
    /// (see `paint::paint_img`'s silent-skip for a cache miss), never fails the whole export.
    pub fn load(nodes: &[UiNode]) -> Self {
        let mut entries = HashMap::new();

        // Inline ImageSource::Bytes never needs a host round trip -- decode directly.
        for node in nodes {
            if let UiNode::Img(ImgData { source: ImageSource::Bytes(bytes), .. }) = node {
                if let Some(image) = decode_image(bytes.clone()) {
                    // Keyed by a content-derived id so multiple Bytes-sourced Img nodes with
                    // identical content share one decoded Image -- see paint::paint_img's lookup.
                    entries.entry(bytes_cache_key(bytes)).or_insert(image);
                }
            }
        }

        let asset_ids = distinct_asset_ids(nodes);
        if !asset_ids.is_empty() {
            let request_json = serde_json::json!({ "asset_ids": asset_ids }).to_string();
            if let Ok(raw) = unsafe { kit10_get_asset_bytes(request_json) } {
                if let Ok(resp) = serde_json::from_str::<AssetBytesResponse>(&raw) {
                    for (asset_id, base64_str) in resp.bytes {
                        let Ok(bytes) =
                            base64::Engine::decode(&base64::engine::general_purpose::STANDARD, &base64_str)
                        else {
                            continue;
                        };
                        if let Some(image) = decode_image(bytes) {
                            entries.insert(asset_id, image);
                        }
                    }
                }
            }
        }

        Self { entries }
    }

    pub fn get(&self, source: &ImageSource) -> Option<&Image> {
        match source {
            ImageSource::None => None,
            ImageSource::Ref(id) => self.entries.get(id),
            ImageSource::Bytes(bytes) => self.entries.get(&bytes_cache_key(bytes)),
        }
    }
}

// A cheap, deterministic key for inline Bytes sources -- length + first/last few bytes is enough
// to dedupe the common case (the same literal Bytes payload reused across multiple Img nodes)
// without hashing the whole payload on every lookup.
fn bytes_cache_key(bytes: &[u8]) -> String {
    let head = &bytes[..bytes.len().min(8)];
    let tail = &bytes[bytes.len().saturating_sub(8)..];
    format!("bytes:{}:{head:02x?}:{tail:02x?}", bytes.len())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn distinct_asset_ids_dedupes_ref_sources() {
        let nodes = vec![
            UiNode::Img(img_with_source(ImageSource::Ref("a".to_string()))),
            UiNode::Img(img_with_source(ImageSource::Ref("a".to_string()))),
            UiNode::Img(img_with_source(ImageSource::Ref("b".to_string()))),
            UiNode::Img(img_with_source(ImageSource::None)),
        ];
        assert_eq!(distinct_asset_ids(&nodes), vec!["a".to_string(), "b".to_string()]);
    }

    fn img_with_source(source: ImageSource) -> ImgData {
        ImgData {
            parent_id: None,
            width: Default::default(),
            height: Default::default(),
            min_width: Default::default(),
            min_height: Default::default(),
            max_width: Default::default(),
            max_height: Default::default(),
            source,
            fit: "cover".to_string(),
            object_position: [0.5, 0.5],
            padding: [0.0; 4],
            bg_color: Default::default(),
            show_border: false,
            border_color: Default::default(),
            border_width: 0.0,
            corner_radius: 0.0,
            squircle: false,
            opacity: 1.0,
            extra: Default::default(),
            selected: 0,
            hovered: false,
        }
    }

    #[test]
    fn decode_image_returns_none_for_unrecognized_bytes() {
        assert!(decode_image(vec![1, 2, 3, 4]).is_none());
    }

    // ImageCache::load is deliberately NOT unit-tested here -- see fonts.rs's own note on why
    // (a textual reference to an unresolved Extism host-fn extern fails native linking even down
    // a branch that's never actually reached at runtime).
}
