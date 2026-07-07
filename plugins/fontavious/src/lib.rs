use extism_pdk::*;
use serde::{Deserialize, Serialize};

// Bare catalogue of known fonts + which vendor serves them. Static and bundled -- Fontavious
// never bundles/redistributes the font FILES themselves, only fetches them at runtime from the
// vendor's own CDN (see fetch_font). That's what lets it sidestep the "redistribution" clauses
// many web font licenses carry.
const CATALOGUE_JSON: &str = include_str!("../catalogue.json");

// `weightMin`/`weightMax` cover both cases with one shape: a variable-font URL genuinely
// supports any weight in a real range (e.g. 400-700, confirmed by requesting Google Fonts'
// CSS2 API with a `wght@min..max` range and getting back a single `font-weight: min max;`
// @font-face rule instead of discrete ones) -- min == max is just the static-font case, one URL
// good for exactly one weight, for families that don't ship a variable version at all
// (confirmed per-family against the live API rather than assumed; a few of these, e.g. Lato and
// Poppins, only have discrete static weights available).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FontVariant {
    weight_min: u16,
    weight_max: u16,
    style: String,
    url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CatalogueEntry {
    family: String,
    vendor: String,
    variants: Vec<FontVariant>,
}

fn catalogue() -> Vec<CatalogueEntry> {
    serde_json::from_str(CATALOGUE_JSON).unwrap_or_default()
}

// Generic contract every utility plugin's search function returns for the editor's suggestion
// dropdown (SuggestField.svelte) -- `label` for display, `value` echoed back as the fetch
// payload on pick. The editor never needs to know these came from a font catalogue specifically.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct SuggestionEntry {
    value: String,
    label: String,
}

#[plugin_fn]
pub fn on_init(_input: String) -> FnResult<String> {
    let mem = Memory::from_bytes("Fontavious plugin initialized")?;
    mem.log(LogLevel::Info);
    Ok("ok".to_string())
}

/// Substring match against the catalogue's family names, for the font picker's search box.
/// Empty query returns the full catalogue.
#[plugin_fn]
pub fn search_fonts(query: String) -> FnResult<String> {
    let q = query.trim().to_lowercase();
    let results: Vec<SuggestionEntry> = catalogue()
        .into_iter()
        .filter(|e| q.is_empty() || e.family.to_lowercase().contains(&q))
        .map(|e| SuggestionEntry { value: e.family.clone(), label: e.family })
        .collect();
    Ok(serde_json::to_string(&results)?)
}

// The generic contract only ever sends `{ value }` (SuggestField.svelte doesn't know about
// weight/style -- those are font-specific). Kept as separate optional fields, defaulted here,
// so a caller who *does* know about them (or a future non-generic caller) can still ask for a
// specific variant directly.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FetchFontInput {
    value: String,
    #[serde(default = "default_weight")]
    weight: u16,
    #[serde(default = "default_style")]
    style: String,
}

fn default_weight() -> u16 {
    400
}

fn default_style() -> String {
    "normal".to_string()
}

/// Shared by `fetch_font` and `variant_url` -- finds the catalogue entry (by family, case
/// insensitive) and the specific variant within it whose weight range covers the requested
/// weight (a variable-font entry's range genuinely covers many weights from one URL; a static
/// entry's `weightMin == weightMax` only ever covers its own exact weight).
fn find_matching_variant(input: &FetchFontInput) -> Result<FontVariant, Error> {
    let entry = catalogue()
        .into_iter()
        .find(|e| e.family.eq_ignore_ascii_case(&input.value))
        .ok_or_else(|| Error::msg(format!("font family not in catalogue: {}", input.value)))?;

    entry
        .variants
        .into_iter()
        .find(|v| {
            input.weight >= v.weight_min && input.weight <= v.weight_max && v.style == input.style
        })
        .ok_or_else(|| {
            Error::msg(format!(
                "no variant for {} weight={} style={}",
                input.value, input.weight, input.style
            ))
        })
}

/// Looks up the matching variant's URL in the catalogue and fetches it via Extism's built-in
/// HTTP capability (allowed only for hosts the manifest's `allowedHosts` permits). Returns the
/// raw WOFF2 bytes as the call's output -- no JSON wrapping -- so the caller reads them
/// straight off via the JS SDK's `.bytes()` and hands them to `vellum.load_font()` unmodified.
#[plugin_fn]
pub fn fetch_font(input: String) -> FnResult<Vec<u8>> {
    let input: FetchFontInput = serde_json::from_str(&input)?;
    let variant = find_matching_variant(&input)?;

    let req = HttpRequest::new(&variant.url);
    let res: HttpResponse = http::request::<()>(&req, None)?;
    if res.status_code() != 200 {
        return Err(Error::msg(format!(
            "fetch failed for {} ({}): HTTP {}",
            input.value,
            variant.url,
            res.status_code()
        ))
        .into());
    }
    Ok(res.body())
}

#[derive(Debug, Clone, Serialize)]
struct VariantUrlOutput {
    url: String,
}

/// Answers "which URL would `fetch_font` use for this (family, weight, style)" without any
/// network I/O -- pure catalogue lookup, reusing the exact same range-matching logic. This is
/// what lets the editor's resolve-time scan (Editor.svelte) decide "have I already fetched the
/// file that covers this weight" using nothing but a plain set of already-loaded URLs, instead
/// of Vellum having to learn to introspect a loaded font's actual variable-axis range. Fontavious
/// already knows this fact (it's right there in the catalogue, decided at curation time); no
/// other layer needs to rediscover it at runtime.
#[plugin_fn]
pub fn variant_url(input: String) -> FnResult<String> {
    let input: FetchFontInput = serde_json::from_str(&input)?;
    let variant = find_matching_variant(&input)?;
    Ok(serde_json::to_string(&VariantUrlOutput { url: variant.url })?)
}

#[cfg(test)]
mod catalogue_tests {
    use super::*;

    #[test]
    fn catalogue_json_parses() {
        let entries = catalogue();
        assert!(!entries.is_empty(), "bundled catalogue should not be empty");
        assert!(entries.iter().any(|e| e.family == "Inter"));
    }

    #[test]
    fn every_variant_has_a_gstatic_url() {
        for entry in catalogue() {
            for variant in entry.variants {
                assert!(
                    variant.url.starts_with("https://fonts.gstatic.com/"),
                    "unexpected URL for {}: {}",
                    entry.family,
                    variant.url
                );
            }
        }
    }

    // Same predicate fetch_font uses, exercised directly against the real bundled catalogue
    // data (not a synthetic fixture) -- this is what actually matters: does a real variable
    // entry serve ANY weight in its range from ONE url, and does a real static-only family
    // (confirmed against Google's live API to have no variable version) still require an exact
    // weight match, one url per weight.
    fn find_variant<'a>(entry: &'a CatalogueEntry, weight: u16, style: &str) -> Option<&'a FontVariant> {
        entry
            .variants
            .iter()
            .find(|v| weight >= v.weight_min && weight <= v.weight_max && v.style == style)
    }

    #[test]
    fn variable_entry_serves_any_weight_in_range_from_one_url() {
        let entries = catalogue();
        let inter = entries.iter().find(|e| e.family == "Inter").expect("Inter should be catalogued");
        assert_eq!(inter.variants.len(), 1, "a variable font needs only one entry to cover 400-700");

        let at_400 = find_variant(inter, 400, "normal").expect("400 should match the variable range");
        let at_550 = find_variant(inter, 550, "normal").expect("550 (not a discrete point) should still match a real variable range");
        let at_700 = find_variant(inter, 700, "normal").expect("700 should match the variable range");
        assert_eq!(at_400.url, at_550.url, "same file serves every weight in range");
        assert_eq!(at_550.url, at_700.url, "same file serves every weight in range");
    }

    #[test]
    fn static_only_family_still_requires_an_exact_weight_match() {
        let entries = catalogue();
        let lato = entries.iter().find(|e| e.family == "Lato").expect("Lato should be catalogued");
        assert_eq!(lato.variants.len(), 2, "static-only: one file per weight, confirmed against the live API");

        assert!(find_variant(lato, 400, "normal").is_some());
        assert!(find_variant(lato, 700, "normal").is_some());
        assert!(
            find_variant(lato, 550, "normal").is_none(),
            "no variable axis for Lato -- an in-between weight has no file to serve it"
        );
    }

    // Exercises the actual production function `variant_url` calls (family lookup + range
    // match together), not just the range match in isolation -- this is what proves the "ask
    // for the URL, compare against what's already loaded" scheme in Editor.svelte will actually
    // work: two different weights of a variable font must resolve to the identical URL.
    #[test]
    fn find_matching_variant_resolves_variable_weights_to_the_same_url() {
        let input_400 = FetchFontInput { value: "Inter".to_string(), weight: 400, style: "normal".to_string() };
        let input_700 = FetchFontInput { value: "Inter".to_string(), weight: 700, style: "normal".to_string() };
        let v400 = find_matching_variant(&input_400).expect("Inter@400 should resolve");
        let v700 = find_matching_variant(&input_700).expect("Inter@700 should resolve");
        assert_eq!(v400.url, v700.url, "same variable file should serve both weights");
    }

    #[test]
    fn find_matching_variant_resolves_static_weights_to_different_urls() {
        let input_400 = FetchFontInput { value: "Lato".to_string(), weight: 400, style: "normal".to_string() };
        let input_700 = FetchFontInput { value: "Lato".to_string(), weight: 700, style: "normal".to_string() };
        let v400 = find_matching_variant(&input_400).expect("Lato@400 should resolve");
        let v700 = find_matching_variant(&input_700).expect("Lato@700 should resolve");
        assert_ne!(v400.url, v700.url, "static family: each weight is a genuinely different file");
    }

    #[test]
    fn find_matching_variant_errors_on_uncatalogued_weight() {
        let input = FetchFontInput { value: "Lato".to_string(), weight: 600, style: "normal".to_string() };
        assert!(find_matching_variant(&input).is_err());
    }
}
