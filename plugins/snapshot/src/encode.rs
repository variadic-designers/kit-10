//! Pixel encoders for the image export. Every function here takes STRAIGHT-alpha RGBA (the
//! host's capture pipeline unpremultiplies before the plugin ever sees the bytes -- see
//! manager.svelte.ts's kit10_capture_view_image / view-capture.ts) plus pixel dimensions, and
//! returns a complete encoded file as bytes. One function per format family; the lossy-WebP
//! branch lives in lib.rs because it routes through a host fn (the browser), not through
//! anything this crate can do itself.

use std::io::Write;

#[derive(Debug)]
pub enum EncodeError {
	/// A dimension exceeds what the encoder format itself can address (JPEG's u16 fields) --
	/// unreachable through the normal capture pipeline (Vellum clamps captures to the device's
	/// max texture dimension, 8192-16384 on every real adapter), but a hard error beats a
	/// wrapping panic if that ever changes.
	TooLarge,
	Io(std::io::Error),
	Format(String),
}

impl std::fmt::Display for EncodeError {
	fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
		match self {
			EncodeError::TooLarge => write!(f, "image dimensions exceed the encoder's limits"),
			EncodeError::Io(e) => write!(f, "encode I/O error: {e}"),
			EncodeError::Format(msg) => write!(f, "encode error: {msg}"),
		}
	}
}

/// PNG: always lossless (the `lossless` option is a no-op for this format, by format law).
pub fn encode_png(rgba: &[u8], width: u32, height: u32) -> Result<Vec<u8>, EncodeError> {
	let mut out = Vec::new();
	let mut encoder = png::Encoder::new(&mut out, width, height);
	encoder.set_color(png::ColorType::Rgba);
	encoder.set_depth(png::BitDepth::Eight);
	let mut writer = encoder
		.write_header()
		.map_err(|e| EncodeError::Format(format!("png header: {e}")))?;
	writer
		.write_image_data(rgba)
		.map_err(|e| EncodeError::Format(format!("png data: {e}")))?;
	writer
		.finish()
		.map_err(|e| EncodeError::Io(std::io::Error::other(e.to_string())))?;
	Ok(out)
}

/// JPEG: always lossy (the `lossless` option is a no-op for this format, by format law);
/// `quality` is the 1-100 knob.
pub fn encode_jpeg(rgba: &[u8], width: u32, height: u32, quality: u8) -> Result<Vec<u8>, EncodeError> {
	// jpeg-encoder addresses pixels with u16 fields -- anything the capture pipeline can
	// produce fits, but a cast would silently truncate past 65535 rather than error.
	let (w, h) = (
		u16::try_from(width).map_err(|_| EncodeError::TooLarge)?,
		u16::try_from(height).map_err(|_| EncodeError::TooLarge)?,
	);
	let mut out = Vec::new();
	let encoder = jpeg_encoder::Encoder::new(&mut out, quality.clamp(1, 100));
	encoder
		.encode(rgba, w, h, jpeg_encoder::ColorType::Rgba)
		.map_err(|e| EncodeError::Format(format!("jpeg: {e}")))?;
	Ok(out)
}

/// WebP, lossless (VP8L) via image-webp's pure-Rust encoder. This is the DEFAULT encoding --
/// lossless is the export default and WebP the default format.
pub fn encode_webp_lossless(rgba: &[u8], width: u32, height: u32) -> Result<Vec<u8>, EncodeError> {
	if width == 0 || height == 0 || width > 16384 || height > 16384 {
		return Err(EncodeError::TooLarge);
	}
	let mut out = Vec::new();
	let encoder = image_webp::WebPEncoder::new(&mut out);
	encoder
		.encode(rgba, width, height, image_webp::ColorType::Rgba8)
		.map_err(|e| EncodeError::Format(format!("webp: {e}")))?;
	Ok(out)
}

/// Utility the unit tests (and any future lossless-aware caller) use to round-trip-check an
/// encode: writes the bytes out, returns them unchanged. Kept trivial on purpose -- the real
/// decode-side verification lives in the test module below, which shells out to nothing.
#[allow(dead_code)]
pub fn write_all(out: &mut Vec<u8>, bytes: &[u8]) -> Result<(), EncodeError> {
	out.write_all(bytes).map_err(EncodeError::Io)
}

#[cfg(test)]
mod encode_tests {
	use super::*;

	// 2x2 opaque red + transparent green checkered pixels, straight alpha (what the capture
	// pipeline hands over after unpremultiplyRgba).
	const W: u32 = 2;
	const H: u32 = 2;
	fn sample_rgba() -> Vec<u8> {
		vec![
			255, 0, 0, 255, // opaque red
			0, 255, 0, 128, // half-alpha green
			0, 0, 0, 0, // fully transparent
			0, 0, 255, 255, // opaque blue
		]
	}

	#[test]
	fn png_starts_with_the_png_signature() {
		let bytes = encode_png(&sample_rgba(), W, H).unwrap();
		assert_eq!(&bytes[..8], b"\x89PNG\r\n\x1a\n");
	}

	#[test]
	fn jpeg_starts_with_the_jpeg_signature() {
		let bytes = encode_jpeg(&sample_rgba(), W, H, 90).unwrap();
		assert_eq!(&bytes[..2], b"\xff\xd8");
	}

	#[test]
	fn webp_lossless_starts_with_the_riff_webp_header() {
		let bytes = encode_webp_lossless(&sample_rgba(), W, H).unwrap();
		assert_eq!(&bytes[..4], b"RIFF");
		assert_eq!(&bytes[8..12], b"WEBP");
		// Lossless WebP is VP8L-coded: the first chunk must be VP8L, never a lossy VP8 chunk.
		assert_eq!(&bytes[12..16], b"VP8L");
	}

	#[test]
	fn jpeg_quality_is_clamped_into_the_valid_range() {
		// 0 and 101 would otherwise be rejected or wrap; both must encode cleanly.
		assert!(encode_jpeg(&sample_rgba(), W, H, 0).is_ok());
		assert!(encode_jpeg(&sample_rgba(), W, H, 101).is_ok());
	}

	#[test]
	fn jpeg_rejects_dimensions_past_the_u16_limit_rather_than_truncating() {
		assert!(matches!(
			encode_jpeg(&sample_rgba(), 70_000, 1, 90),
			Err(EncodeError::TooLarge)
		));
	}

	#[test]
	fn webp_rejects_zero_and_oversized_dimensions() {
		assert!(matches!(
			encode_webp_lossless(&sample_rgba(), 0, 2),
			Err(EncodeError::TooLarge)
		));
		assert!(matches!(
			encode_webp_lossless(&sample_rgba(), 16_385, 2),
			Err(EncodeError::TooLarge)
		));
	}

	#[test]
	fn webp_lossless_round_trips_through_the_decoder() {
		// Encode the sample, decode it back with image-webp's own decoder, and require the
		// exact straight-alpha pixels. This is the real contract (lossless = bit-exact round
		// trip) rather than a size heuristic -- at micro scale VP8L's fixed header overhead
		// actually loses to PNG, so bytes-smaller would be the WRONG canary.
		let bytes = encode_webp_lossless(&sample_rgba(), W, H).unwrap();
		let mut decoder = image_webp::WebPDecoder::new(std::io::Cursor::new(&bytes)).unwrap();
		let (w, h) = decoder.dimensions();
		assert_eq!((w, h), (W, H));
		assert!(decoder.has_alpha());
		let mut decoded = vec![0u8; (w * h * 4) as usize];
		decoder.read_image(&mut decoded).unwrap();
		assert_eq!(decoded, sample_rgba());
	}
}
