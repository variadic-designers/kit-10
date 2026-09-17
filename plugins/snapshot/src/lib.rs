//! Snapshot -- KIT•10's image exporter. Rasterizes each flagged view through the host's own
//! Vellum instance (kit10_capture_view_image: chrome-free, transparent-background, GPU-captured
//! pixels -- the ONLY thing that can produce these, and deliberately the host's job, not this
//! plugin's) and encodes the result itself: PNG (always lossless), JPEG (always lossy, quality
//! knob), WebP lossless (VP8L, pure Rust -- the DEFAULT format+mode). Lossy WebP is the one
//! family with no pure-Rust non-copyleft encoder, so it routes through the generic
//! kit10_encode_image host fn (the browser); the returned mime is the one ACTUALLY encoded, so
//! on browsers without WebP encode support (Firefox/Safari) the file is honestly named .png
//! instead of mislabeled .webp.
//!
//! Output contract: a `multiFile` envelope ({files: [{filename, mimeType, content}]}, content
//! base64) -- one file per captured view, each named after the view (deduped with -2/-3
//! suffixes when two views share a name). A view whose capture fails (not in the scene, readback
//! timeout) is skipped, best-effort per view like kit10_get_asset_bytes; an export where EVERY
//| view failed is a hard error (Err) rather than a silent empty download.

use base64::Engine;
use extism_pdk::*;
use serde::Deserialize;
use std::collections::HashMap;

mod encode;

#[host_fn]
extern "ExtismHost" {
    fn kit10_capture_view_image(input: String) -> String;
    fn kit10_encode_image(input: String) -> String;
}

/// One file of the multiFile envelope. Field names match download.ts's DownloadableFile
/// exactly -- resolveDownloadFiles parses this envelope's `files` array into those structs.
#[derive(Debug, serde::Serialize)]
struct FileEntry {
    filename: String,
    #[serde(rename = "mimeType")]
    mime_type: String,
    content: String,
}

#[derive(Debug, Clone, Deserialize, Default)]
struct ExportInput {
    #[serde(default)]
    project_id: String,
    #[serde(default)]
    view_ids: Vec<String>,
    /// String-encoded key/value bag, same convention every exporter's options use (PDF's
    /// page_size/dpi, preferences.ts's value map): the Export panel renders the manifest's
    /// declared options generically and folds the collected values in here as strings.
    #[serde(default)]
    options: HashMap<String, String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Format {
    Webp,
    Png,
    Jpeg,
}

#[derive(Debug, Clone)]
struct ImageOptions {
    format: Format,
    /// Default ON (the export's whole default posture: WebP + lossless). Consulted by WebP
    /// only -- PNG is lossless and JPEG lossy by format law, the option can't change either.
    lossless: bool,
    /// 1-100. Applies to JPEG always and to lossy WebP only; ignored (not even clamped into
    /// the call) by PNG and lossless WebP, which have no quality axis.
    quality: u8,
    /// Margin around the framed view, in final-output pixels. Passes straight through to the
    /// host's capture (frame_node_exact's convention -- scale-invariant, it never grows with
    /// the scale factor).
    padding_px: f32,
    /// Output-resolution multiplier over the view's own design dimensions. Fractional values
    /// (1.5x) are legitimate; the host rejects anything past the GPU texture limit per-capture
    /// (that view's file is then skipped, not the whole export).
    scale: f32,
}

impl Default for ImageOptions {
    fn default() -> Self {
        ImageOptions {
            format: Format::Webp,
            lossless: true,
            quality: 90,
            padding_px: 0.0,
            scale: 1.0,
        }
    }
}

fn parse_image_options(raw: &HashMap<String, String>) -> ImageOptions {
    let mut opts = ImageOptions::default();
    if let Some(v) = raw.get("format").map(String::as_str) {
        match v {
            "png" => opts.format = Format::Png,
            "jpeg" => opts.format = Format::Jpeg,
            _ => opts.format = Format::Webp, // "webp" or anything unrecognized: the default
        }
    }
    if let Some(v) = raw.get("lossless").and_then(|v| v.parse::<bool>().ok()) {
        opts.lossless = v;
    }
    if let Some(q) = raw.get("quality").and_then(|v| v.parse::<f32>().ok()) {
        opts.quality = q.clamp(1.0, 100.0) as u8;
    }
    if let Some(p) = raw.get("padding").and_then(|v| v.parse::<f32>().ok()) {
        opts.padding_px = p.clamp(0.0, 512.0);
    }
    if let Some(s) = raw.get("scale").and_then(|v| v.parse::<f32>().ok()) {
        opts.scale = s.clamp(1.0, 8.0);
    }
    opts
}

#[cfg(test)]
mod parse_image_options_tests {
    use super::*;

    #[test]
    fn defaults_are_webp_lossless_q90_no_padding_1x() {
        let opts = parse_image_options(&HashMap::new());
        assert_eq!(opts.format, Format::Webp);
        assert!(opts.lossless);
        assert_eq!(opts.quality, 90);
        assert_eq!(opts.padding_px, 0.0);
        assert_eq!(opts.scale, 1.0);
    }

    #[test]
    fn every_option_is_read_from_the_string_bag() {
        let mut raw = HashMap::new();
        raw.insert("format".to_string(), "jpeg".to_string());
        raw.insert("lossless".to_string(), "false".to_string());
        raw.insert("quality".to_string(), "75".to_string());
        raw.insert("padding".to_string(), "16".to_string());
        raw.insert("scale".to_string(), "2".to_string());
        let opts = parse_image_options(&raw);
        assert_eq!(opts.format, Format::Jpeg);
        assert!(!opts.lossless);
        assert_eq!(opts.quality, 75);
        assert_eq!(opts.padding_px, 16.0);
        assert_eq!(opts.scale, 2.0);
    }

    #[test]
    fn fractional_scale_passes_through_for_high_dpi_exports() {
        let mut raw = HashMap::new();
        raw.insert("scale".to_string(), "1.5".to_string());
        assert_eq!(parse_image_options(&raw).scale, 1.5);
    }

    #[test]
    fn unrecognized_format_falls_back_to_the_webp_default() {
        let mut raw = HashMap::new();
        raw.insert("format".to_string(), "heif".to_string());
        assert_eq!(parse_image_options(&raw).format, Format::Webp);
    }

    #[test]
    fn out_of_range_numbers_clamp_instead_of_erroring() {
        let mut raw = HashMap::new();
        raw.insert("quality".to_string(), "500".to_string());
        raw.insert("padding".to_string(), "-20".to_string());
        raw.insert("scale".to_string(), "99".to_string());
        let opts = parse_image_options(&raw);
        assert_eq!(opts.quality, 100);
        assert_eq!(opts.padding_px, 0.0);
        assert_eq!(opts.scale, 8.0);
    }

    #[test]
    fn unparseable_numbers_leave_defaults_untouched() {
        let mut raw = HashMap::new();
        raw.insert("quality".to_string(), "high".to_string());
        raw.insert("scale".to_string(), "".to_string());
        let opts = parse_image_options(&raw);
        assert_eq!(opts.quality, 90);
        assert_eq!(opts.scale, 1.0);
    }
}

#[derive(Debug, Deserialize)]
struct CaptureResponse {
    success: bool,
    #[serde(default)]
    error: String,
    #[serde(default)]
    width: u32,
    #[serde(default)]
    height: u32,
    #[serde(default)]
    rgba_base64: String,
    #[serde(default)]
    view_name: String,
}

#[derive(Debug, Deserialize)]
struct EncodeResponse {
    success: bool,
    #[serde(default)]
    error: String,
    #[serde(default)]
    bytes_base64: String,
    #[serde(default)]
    mime: String,
}

/// Filename hygiene for a browser download attribute: path separators and the other
/// filesystem-hostile characters become underscores, control characters are dropped. Unicode
/// names pass through untouched (a view named 森林 exports 森林.png). Empty (all-invalid) names
/// fall back to the view id at the call site.
fn sanitize_filename(name: &str) -> String {
    name.chars()
        .filter(|c| !c.is_control())
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            other => other,
        })
        .collect()
}

/// Second (and later) files with the same base name get a -2/-3 suffix, so two views both
/// named "Card" export Card.webp + Card-2.webp instead of one clobbering the other.
fn unique_filename(base: &str, ext: &str, used: &mut HashMap<String, usize>) -> String {
    let stem = if base.is_empty() { "view".to_string() } else { base.to_string() };
    let count = used.entry(stem.clone()).or_insert(0);
    *count += 1;
    if *count == 1 {
        format!("{stem}.{ext}")
    } else {
        format!("{stem}-{}.{ext}", count)
    }
}

#[cfg(test)]
mod filename_tests {
    use super::*;

    #[test]
    fn replaces_filesystem_hostile_characters() {
        assert_eq!(sanitize_filename("Card: A/B?"), "Card_ A_B_");
        assert_eq!(sanitize_filename("normal name"), "normal name");
        assert_eq!(sanitize_filename("森林 Button"), "森林 Button");
        assert_eq!(sanitize_filename("line\nbreak"), "linebreak");
    }

    #[test]
    fn duplicate_names_get_increasing_suffixes() {
        let mut used = HashMap::new();
        assert_eq!(unique_filename("Card", "webp", &mut used), "Card.webp");
        assert_eq!(unique_filename("Card", "webp", &mut used), "Card-2.webp");
        assert_eq!(unique_filename("Card", "png", &mut used), "Card-3.png");
        assert_eq!(unique_filename("Other", "webp", &mut used), "Other.webp");
    }

    #[test]
    fn empty_names_fall_back_to_view() {
        let mut used = HashMap::new();
        assert_eq!(unique_filename("", "webp", &mut used), "view.webp");
    }
}

#[plugin_fn]
pub fn export_view_images(input: String) -> FnResult<String> {
    let req: ExportInput = serde_json::from_str(&input).unwrap_or_default();
    let opts = parse_image_options(&req.options);

    if req.view_ids.is_empty() {
        return Err(Error::msg("no views flagged for the image export").into());
    }

    let mut files: Vec<FileEntry> = Vec::new();
    let mut used_names: HashMap<String, usize> = HashMap::new();

    for view_id in &req.view_ids {
        let capture = capture_view(&req.project_id, view_id, opts.padding_px, opts.scale)?;
        let Some(capture) = capture else {
            continue; // this view failed, best-effort per view -- see the module doc
        };

        let (bytes, mime, ext) = encode_for_format(&opts, &capture)?;
        let name_base = sanitize_filename(if capture.view_name.is_empty() {
            view_id
        } else {
            &capture.view_name
        });
        files.push(FileEntry {
            filename: unique_filename(&name_base, ext, &mut used_names),
            mime_type: mime.to_string(),
            content: base64::engine::general_purpose::STANDARD.encode(&bytes),
        });
    }

    if files.is_empty() {
        return Err(Error::msg("every view capture failed -- is the project rendered?").into());
    }

    let envelope = serde_json::json!({ "files": files });
    Ok(envelope.to_string())
}

struct CapturedView {
    width: u32,
    height: u32,
    rgba: Vec<u8>,
    view_name: String,
}

/// Calls the host's capture and decodes its response. `Ok(None)` = a per-view failure the
/// caller skips (logged to the plugin console so it's visible in devtools, never silent).
fn capture_view(
    project_id: &str,
    view_id: &str,
    padding_px: f32,
    scale: f32,
) -> Result<Option<CapturedView>, Error> {
    let req = serde_json::json!({
        "view_id": view_id,
        "project_id": project_id,
        "padding_px": padding_px,
        "scale": scale,
    });
    let raw = unsafe { kit10_capture_view_image(req.to_string())? };
    let resp: CaptureResponse = serde_json::from_str(&raw)
        .map_err(|e| Error::msg(format!("capture response unparsable: {e}")))?;
    if !resp.success {
        log!(
            LogLevel::Warn,
            "snapshot: capture failed for view {view_id}: {}",
            resp.error
        );
        return Ok(None);
    }
    if resp.width == 0 || resp.height == 0 {
        log!(LogLevel::Warn, "snapshot: capture returned a 0-sized image for view {view_id}");
        return Ok(None);
    }
    let rgba = base64::engine::general_purpose::STANDARD
        .decode(resp.rgba_base64.as_bytes())
        .map_err(|e| Error::msg(format!("capture pixels unparsable: {e}")))?;
    let expected = resp.width as usize * resp.height as usize * 4;
    if rgba.len() < expected {
        return Err(Error::msg(format!(
            "capture returned {} bytes, expected at least {}",
            rgba.len(),
            expected
        )));
    }
    Ok(Some(CapturedView {
        width: resp.width,
        height: resp.height,
        rgba,
        view_name: resp.view_name,
    }))
}

/// Encodes one captured view per the options. Returns (bytes, mime, file extension). The
/// lossy-WebP branch is the only one that leaves this crate: see kit10_encode_image's host-fn
/// doc comment (browser-only encoder, mime-honest downgrade on non-supporting browsers).
fn encode_for_format(
    opts: &ImageOptions,
    capture: &CapturedView,
) -> Result<(Vec<u8>, &'static str, &'static str), Error> {
    match opts.format {
        Format::Png => Ok((
            encode::encode_png(&capture.rgba, capture.width, capture.height)
                .map_err(|e| Error::msg(e.to_string()))?,
            "image/png",
            "png",
        )),
        Format::Jpeg => Ok((
            encode::encode_jpeg(&capture.rgba, capture.width, capture.height, opts.quality)
                .map_err(|e| Error::msg(e.to_string()))?,
            "image/jpeg",
            "jpg",
        )),
        Format::Webp if opts.lossless => Ok((
            encode::encode_webp_lossless(&capture.rgba, capture.width, capture.height)
                .map_err(|e| Error::msg(e.to_string()))?,
            "image/webp",
            "webp",
        )),
        Format::Webp => encode_webp_lossy(capture, opts.quality),
    }
}

/// Lossy WebP via the browser (kit10_encode_image): libwebp is C (unbuildable for
/// wasm32-unknown-unknown here) and every pure-Rust VP8 encoder is copyleft-licensed, so the
/// browser's own encoder is the only honest path for this family. The response's mime is what
/// actually got encoded: on Chrome a real lossy .webp; on Firefox/Safari (no WebP encoder) an
/// honest .png instead of a mislabeled file. No fallback dance if even THAT fails -- a failed
/// view skips, same tolerance as its capture.
fn encode_webp_lossy(capture: &CapturedView, quality: u8) -> Result<(Vec<u8>, &'static str, &'static str), Error> {
    let req = serde_json::json!({
        "rgba_base64": base64::engine::general_purpose::STANDARD.encode(&capture.rgba),
        "width": capture.width,
        "height": capture.height,
        "mime": "image/webp",
        "quality": f32::from(quality) / 100.0,
    });
    let raw = unsafe { kit10_encode_image(req.to_string())? };
    let resp: EncodeResponse = serde_json::from_str(&raw)
        .map_err(|e| Error::msg(format!("encode response unparsable: {e}")))?;
    if !resp.success || resp.bytes_base64.is_empty() {
        log!(
            LogLevel::Warn,
            "snapshot: browser lossy-webp encode failed: {}",
            resp.error
        );
        return Err(Error::msg(format!(
            "browser encode failed: {}",
            resp.error
        )));
    }
    match resp.mime.as_str() {
        "image/webp" => Ok((
            base64::engine::general_purpose::STANDARD
                .decode(resp.bytes_base64.as_bytes())
                .map_err(|e| Error::msg(format!("encoded bytes unparsable: {e}")))?,
            "image/webp",
            "webp",
        )),
        // The browser downgraded (Firefox/Safari return a PNG Blob for a WebP request). Name
        // and tag the file for what it IS -- a .webp extension on PNG bytes would render as
        // broken in every strict decoder.
        "image/png" => Ok((
            base64::engine::general_purpose::STANDARD
                .decode(resp.bytes_base64.as_bytes())
                .map_err(|e| Error::msg(format!("encoded bytes unparsable: {e}")))?,
            "image/png",
            "png",
        )),
        other => Err(Error::msg(format!("browser encoded unexpected mime: {other}"))),
    }
}
