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

// A cross-family substitution's nature, badged in the picker. "metric" = a layout-safe
// metric-compatible clone (Arial -> Arimo); "visual" = an approximate look-alike that may
// reflow (SF Pro -> Inter). See resources/fontavious-catalogue-plan.md §2.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Substitute {
    reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CatalogueEntry {
    family: String,
    // The pre-existing ~13 Google entries carry only family/vendor/variants; `default`s below
    // keep them valid without editing each one (they're all OFL, normal-only). New roots and
    // alias entries set the rest explicitly.
    #[serde(default)]
    vendor: String,
    #[serde(default = "default_tier")]
    license_tier: String,
    #[serde(default)]
    category: Option<String>,
    #[serde(default)]
    variants: Vec<FontVariant>,
    // Present on alias / proprietary-name entries: "render me via this root family". Such an
    // entry carries no `variants` of its own -- `resolve_root` follows this to the real file.
    #[serde(default)]
    alias_of: Option<String>,
    #[serde(default)]
    substitute: Option<Substitute>,
}

fn default_tier() -> String {
    "ofl".to_string()
}

fn catalogue() -> Vec<CatalogueEntry> {
    serde_json::from_str(CATALOGUE_JSON).unwrap_or_default()
}

// Generic contract every utility plugin's search function returns for the editor's suggestion
// dropdown (SuggestField.svelte) -- `label` for display, `value` echoed back as the fetch
// payload on pick. The editor never needs to know these came from a font catalogue specifically.
// The editor-owned, plugin-agnostic suggestion contract (mirrors SuggestField.svelte's own
// type). `value`/`label` are the base; `badge`/`tone`/`note` are GENERIC display slots the
// editor renders without knowing what a font or a license is. Fontavious PROJECTS its own
// font-specific facts (licenseTier, substitute) into them here -- the words "licenseTier"/
// "proprietary"/"font" never cross into the editor's type. A future Font Awesome plugin fills
// the same slots from its own concepts. See resources/fontavious-catalogue-plan.md §5.1.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct SuggestionEntry {
    value: String,
    label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    badge: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    tone: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    note: Option<String>,
}

/// Project a catalogue entry's font-specific facts into the generic badge/tone/note slots.
fn suggestion_for(e: &CatalogueEntry) -> SuggestionEntry {
    // "rendering <root>" whenever this name is served by a different family's file.
    let rendered_via = e
        .alias_of
        .as_ref()
        .filter(|root| !root.eq_ignore_ascii_case(&e.family))
        .map(|root| format!("rendering {root}"));
    let visual = matches!(e.substitute.as_ref().map(|s| s.reason.as_str()), Some("visual"));

    let (badge, tone) = match e.license_tier.as_str() {
        "proprietary" => (Some("proprietary".to_string()), Some("warn".to_string())),
        "free-proprietary" => (Some("free".to_string()), Some("info".to_string())),
        _ => (None, None), // ofl / default: no badge
    };
    // A visual (non-metric) substitution can reflow, so flag it approximate.
    let note = match (visual, rendered_via) {
        (true, Some(via)) => Some(format!("≈ {via}")),
        (true, None) => Some("≈ approximate".to_string()),
        (false, via) => via,
    };

    SuggestionEntry { value: e.family.clone(), label: e.family.clone(), badge, tone, note }
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
        .iter()
        .filter(|e| q.is_empty() || e.family.to_lowercase().contains(&q))
        .map(suggestion_for)
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
fn find_entry(family: &str) -> Option<CatalogueEntry> {
    catalogue()
        .into_iter()
        .find(|e| e.family.eq_ignore_ascii_case(family))
}

/// Resolve a family name to the catalogue entry that actually owns the font file, following
/// `alias_of` (Arial -> Arimo, Liberation Sans -> Arimo). Substitution is entirely a catalogue
/// concern: callers ask for "Arial" and get Arimo's variants, never learning a swap happened.
/// Bounded hop count guards against an accidental alias cycle in the data.
fn resolve_root(family: &str) -> Option<CatalogueEntry> {
    let mut current = find_entry(family)?;
    for _ in 0..8 {
        match &current.alias_of {
            Some(target) if !target.eq_ignore_ascii_case(&current.family) => {
                current = find_entry(target)?;
            }
            _ => return Some(current),
        }
    }
    Some(current)
}

fn find_matching_variant(input: &FetchFontInput) -> Result<FontVariant, Error> {
    let entry = resolve_root(&input.value)
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

// The catalogue's variant ranges, minus the vendor URL -- the fact Charter's weight snapping
// needs ("what weights does this family actually have"), shaped for the host to forward into
// on_resolve's fontFacts map. camelCase because the consumer is JS-side first.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FactsVariant {
    weight_min: u16,
    weight_max: u16,
    style: String,
}

#[derive(Debug, Clone, Serialize)]
struct FamilyFactsOutput {
    variants: Vec<FactsVariant>,
}

/// The full variant set of a catalogued family -- weight ranges + styles, no URLs, no I/O.
/// This is the "what is fetchable" oracle (see resources/text-affordances.md): the host
/// assembles these into the fontFacts map Charter's resolve_font_weight decides against.
/// Errors for an uncatalogued family, same contract as variant_url -- the caller treats
/// that as "no facts, pass weights through untouched".
#[plugin_fn]
pub fn family_facts(input: String) -> FnResult<String> {
    let input: FetchFontInput = serde_json::from_str(&input)?;
    // Report the ROOT's real weights (Arial's facts are Arimo's), so Charter's weight snapping
    // decides against what actually renders.
    let entry = resolve_root(&input.value)
        .ok_or_else(|| Error::msg(format!("font family not in catalogue: {}", input.value)))?;
    let variants = entry
        .variants
        .into_iter()
        .map(|v| FactsVariant { weight_min: v.weight_min, weight_max: v.weight_max, style: v.style })
        .collect();
    Ok(serde_json::to_string(&FamilyFactsOutput { variants })?)
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

    // --- alias / substitution (catalogue-expansion Phase 0) ---

    // The whole point of the two-layer model: a proprietary name we ship NO bytes for still
    // resolves, by following alias_of to the OFL clone's real file.
    #[test]
    fn proprietary_alias_resolves_to_root_file() {
        let arial = FetchFontInput { value: "Arial".to_string(), weight: 400, style: "normal".to_string() };
        let arimo = FetchFontInput { value: "Arimo".to_string(), weight: 400, style: "normal".to_string() };
        let via_alias = find_matching_variant(&arial).expect("Arial should resolve via Arimo");
        let direct = find_matching_variant(&arimo).expect("Arimo should resolve directly");
        assert_eq!(via_alias.url, direct.url, "Arial must render Arimo's actual file");
        assert!(via_alias.url.starts_with("https://fonts.gstatic.com/s/arimo/"));
    }

    // A static-clone alias (Times New Roman -> Tinos) must match per discrete weight, and the
    // proprietary entry itself carries zero variants (it's name-only, no bytes).
    #[test]
    fn static_clone_alias_matches_per_weight_and_has_no_own_variants() {
        let entry = find_entry("Times New Roman").expect("Times New Roman catalogued");
        assert!(entry.variants.is_empty(), "a proprietary alias must ship no font files of its own");
        assert_eq!(entry.license_tier, "proprietary");

        let at_700 = FetchFontInput { value: "Times New Roman".to_string(), weight: 700, style: "normal".to_string() };
        let v = find_matching_variant(&at_700).expect("TNR@700 should resolve via Tinos");
        assert!(v.url.contains("/tinos/"));
    }

    // Aliases never introduce a cycle in practice, but resolve_root must terminate regardless.
    #[test]
    fn resolve_root_terminates() {
        assert!(resolve_root("Arial").is_some());
        assert!(resolve_root("Not A Real Font").is_none());
    }

    // The generic badge/tone/note projection -- the "marked as such" surface. A proprietary
    // metric clone badges "proprietary" (warn) and discloses "rendering <root>"; an OFL root
    // gets no badge at all.
    #[test]
    fn proprietary_alias_is_badged_and_discloses_substitution() {
        let arial = find_entry("Arial").expect("Arial catalogued");
        let s = suggestion_for(&arial);
        assert_eq!(s.badge.as_deref(), Some("proprietary"));
        assert_eq!(s.tone.as_deref(), Some("warn"));
        assert_eq!(s.note.as_deref(), Some("rendering Arimo"));
    }

    #[test]
    fn ofl_root_has_no_badge() {
        let arimo = find_entry("Arimo").expect("Arimo catalogued");
        let s = suggestion_for(&arimo);
        assert!(s.badge.is_none(), "an OFL root is the default free case -- no badge");
        assert!(s.note.is_none());
    }

    // An OFL metric sibling (Liberation Sans -> Arimo) is free, so no badge, but still honestly
    // discloses that it renders via Arimo.
    #[test]
    fn ofl_sibling_alias_discloses_without_badging() {
        let lib = find_entry("Liberation Sans").expect("Liberation Sans catalogued");
        let s = suggestion_for(&lib);
        assert!(s.badge.is_none());
        assert_eq!(s.note.as_deref(), Some("rendering Arimo"));
    }

    // The generic slots must serialize as their exact camelCase-neutral key names (value/label/
    // badge/tone/note) -- the editor's SuggestionEntry reads these verbatim -- and must be
    // OMITTED when absent so a plain OFL root stays `{value,label}` as before.
    #[test]
    fn suggestion_serializes_generic_slots_and_omits_empty() {
        let arial = suggestion_for(&find_entry("Arial").unwrap());
        let json = serde_json::to_string(&arial).unwrap();
        assert!(json.contains("\"badge\":\"proprietary\""));
        assert!(json.contains("\"note\":\"rendering Arimo\""));
        assert!(json.contains("\"tone\":\"warn\""));

        let arimo = suggestion_for(&find_entry("Arimo").unwrap());
        let json = serde_json::to_string(&arimo).unwrap();
        assert!(!json.contains("badge"), "empty slots must be omitted: {json}");
        assert!(!json.contains("note"), "empty slots must be omitted: {json}");
    }

    // family_facts feeds Charter's weight snapping via the host-assembled fontFacts map --
    // assert on the serialized KEY NAMES, not just the values, per the camelCase wire pitfall
    // (a snake_case key here silently reads as undefined on the JS side).
    #[test]
    fn family_facts_serializes_camel_case_variant_ranges() {
        let entries = catalogue();
        let lato = entries.iter().find(|e| e.family == "Lato").expect("Lato should be catalogued");
        let variants: Vec<FactsVariant> = lato
            .variants
            .iter()
            .map(|v| FactsVariant { weight_min: v.weight_min, weight_max: v.weight_max, style: v.style.clone() })
            .collect();
        let json = serde_json::to_string(&FamilyFactsOutput { variants }).expect("serialize");
        assert!(json.contains("\"variants\""));
        assert!(json.contains("\"weightMin\":400"));
        assert!(json.contains("\"weightMax\":700"));
        assert!(!json.contains("weight_min"), "must be camelCase on the wire: {json}");
        assert!(!json.contains("\"url\""), "facts must not leak vendor URLs: {json}");
    }
}
