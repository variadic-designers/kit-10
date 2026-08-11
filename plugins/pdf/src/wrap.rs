//! Greedy word-wrap shared between `layout.rs` (sizing a Text node's auto-height box) and
//! `paint.rs` (drawing each resulting line) -- both call `wrap_lines` with the SAME
//! already-`shaped_face`'d font and the SAME resolved content width, so a line break decided
//! during layout is guaranteed to be the same line break drawn later; there is no separate
//! "layout's opinion of where text wraps" vs "paint's opinion" to drift apart.
//!
//! v1 scope, matching this crate's other "cheap and defensible" calls (see paint.rs's squircle
//! doc comment for the same posture elsewhere): breaks only at whitespace (`split_whitespace`,
//! which also collapses runs of whitespace to one space -- acceptable for the short
//! label/paragraph content this editor's Kits realistically author), no hyphenation, and a
//! single word wider than the available width is left on its own line to overflow rather than
//! broken mid-word (matches a browser's own default `overflow-wrap: normal`).

/// Shaped advance width of `s` at `font_size`, in the same px/pt unit `font_size` itself is in.
/// Pure text-metrics query -- shapes `s` in isolation, so a caller measuring many candidate
/// substrings (word-by-word, as `wrap_lines` does) pays shaping cost proportional to word count,
/// not to however many times a growing line gets re-measured.
pub(crate) fn measure_advance(face: &rustybuzz::Face, s: &str, font_size: f32) -> f32 {
    let units_per_em = face.units_per_em() as f32;
    if units_per_em <= 0.0 || s.is_empty() {
        return 0.0;
    }
    let mut buffer = rustybuzz::UnicodeBuffer::new();
    buffer.push_str(s);
    let glyph_buffer = rustybuzz::shape(face, &[], buffer);
    let total: i32 = glyph_buffer.glyph_positions().iter().map(|p| p.x_advance).sum();
    total as f32 / units_per_em * font_size
}

/// Greedily wraps `content` into lines that each fit within `max_width` (`None` = unconstrained,
/// i.e. taffy's `AvailableSpace::MaxContent` query -- returns the whole content as one line,
/// matching the old always-single-line behavior for that case). Empty content still returns one
/// (empty) line, so callers always have at least one line to size/draw rather than needing an
/// extra empty-vec check.
pub fn wrap_lines(face: &rustybuzz::Face, content: &str, font_size: f32, max_width: Option<f32>) -> Vec<String> {
    if content.is_empty() {
        return vec![String::new()];
    }
    let Some(max_width) = max_width else {
        return vec![content.to_string()];
    };

    let space_width = measure_advance(face, " ", font_size);
    let mut lines = Vec::new();
    let mut current_line = String::new();
    let mut current_width = 0.0_f32;

    for word in content.split_whitespace() {
        let word_width = measure_advance(face, word, font_size);
        if current_line.is_empty() {
            current_line.push_str(word);
            current_width = word_width;
            continue;
        }
        let candidate_width = current_width + space_width + word_width;
        if candidate_width > max_width {
            lines.push(std::mem::take(&mut current_line));
            current_line.push_str(word);
            current_width = word_width;
        } else {
            current_line.push(' ');
            current_line.push_str(word);
            current_width = candidate_width;
        }
    }
    if !current_line.is_empty() || lines.is_empty() {
        lines.push(current_line);
    }
    lines
}

/// The CSS `min-content` sizing convention for text: the width of its single widest unbreakable
/// word (0.0 for empty/all-whitespace content) -- what taffy asks for when it needs to know how
/// narrow this node could shrink to without a word itself overflowing (e.g. a flex-shrink pass).
pub fn min_content_width(face: &rustybuzz::Face, content: &str, font_size: f32) -> f32 {
    content
        .split_whitespace()
        .map(|word| measure_advance(face, word, font_size))
        .fold(0.0_f32, f32::max)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn face(sfnt_bytes: &[u8]) -> rustybuzz::Face<'_> {
        rustybuzz::Face::from_slice(sfnt_bytes, 0).expect("fixture should parse")
    }

    fn fixture_ttf() -> Vec<u8> {
        let woff2_bytes = std::fs::read(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/Satoshi-Variable.woff2"))
            .expect("test fixture should exist");
        let mut cursor = std::io::Cursor::new(woff2_bytes);
        woff2::convert_woff2_to_ttf(&mut cursor).expect("fixture should decompress")
    }

    #[test]
    fn unconstrained_width_returns_the_whole_content_as_one_line() {
        let sfnt = fixture_ttf();
        let lines = wrap_lines(&face(&sfnt), "one two three", 16.0, None);
        assert_eq!(lines, vec!["one two three".to_string()]);
    }

    #[test]
    fn empty_content_returns_one_empty_line() {
        let sfnt = fixture_ttf();
        let lines = wrap_lines(&face(&sfnt), "", 16.0, Some(100.0));
        assert_eq!(lines, vec!["".to_string()]);
    }

    #[test]
    fn a_narrow_width_wraps_onto_multiple_lines() {
        let sfnt = fixture_ttf();
        let f = face(&sfnt);
        // Full-width single line as the "too narrow to fit" reference point.
        let full_width = measure_advance(&f, "one two three four five", 16.0);
        let lines = wrap_lines(&f, "one two three four five", 16.0, Some(full_width / 2.0));
        assert!(lines.len() > 1, "expected multiple lines, got {lines:?}");
        // Every line the wrapper produced must actually fit (a single overlong word aside, not
        // the case in this fixture text).
        for line in &lines {
            assert!(
                measure_advance(&f, line, 16.0) <= full_width / 2.0 + 0.01,
                "line {line:?} overflowed the available width"
            );
        }
        // Rejoining every line's words must reconstruct the original word sequence -- wrapping
        // must never drop or reorder content.
        let rejoined: Vec<&str> = lines.iter().flat_map(|l| l.split_whitespace()).collect();
        assert_eq!(rejoined, vec!["one", "two", "three", "four", "five"]);
    }

    #[test]
    fn an_unbreakably_wide_single_word_overflows_its_own_line_instead_of_being_split() {
        let sfnt = fixture_ttf();
        let f = face(&sfnt);
        let lines = wrap_lines(&f, "supercalifragilisticexpialidocious", 16.0, Some(1.0));
        assert_eq!(lines, vec!["supercalifragilisticexpialidocious".to_string()]);
    }

    #[test]
    fn min_content_width_is_the_widest_single_word_not_the_whole_string() {
        let sfnt = fixture_ttf();
        let f = face(&sfnt);
        let whole = measure_advance(&f, "a bb ccc", 16.0);
        let widest_word = measure_advance(&f, "ccc", 16.0);
        let min_content = min_content_width(&f, "a bb ccc", 16.0);
        assert!((min_content - widest_word).abs() < 0.01);
        assert!(min_content < whole);
    }
}
