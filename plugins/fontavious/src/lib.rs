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
#[serde(rename_all = "camelCase")]
struct CatalogueEntry {
    family: String,
    // The pre-existing ~13 Google entries carry only family/vendor/variants; `default`s below
    // keep them valid without editing each one (they're all OFL, normal-only). Newer roots set
    // the rest explicitly.
    #[serde(default)]
    vendor: String,
    #[serde(default = "default_tier")]
    license_tier: String,
    #[serde(default)]
    category: Option<String>,
    #[serde(default)]
    variants: Vec<FontVariant>,
    // EXACT / metric-compatible alternative names that resolve to THIS entry -- including
    // proprietary/trademarked names (Arimo carries ["Arial", "Helvetica", ...]). Search/import
    // keys ONLY: typing "Arial" surfaces this OFL root (Arimo), and a design referencing
    // `font-family: Arial` renders Arimo. We never present a catalogue product NAMED with a
    // trademark -- the mark is used purely referentially ("matches Arial"), the same nominative
    // use OS font substitution and Google Fonts' "metric-compatible with Arial" rely on.
    // Copyright is handled by shipping no proprietary bytes; this handles the separate trademark
    // question. See resources/fontavious-catalogue-plan.md §2-§3.
    #[serde(default)]
    aliases: Vec<String>,
    // VISUAL / approximate look-alikes -- same referential-only role as `aliases`, but the match
    // is NOT metric-identical, so text can reflow (Montserrat looksLike ["Gotham"], Inter
    // looksLike ["SF Pro", "Helvetica Neue"]). Surfaced with an "approximates X" note + caution
    // tone rather than "matches X", so a designer knows it's a stand-in, not a drop-in. §2.2.
    #[serde(default)]
    looks_like: Vec<String>,
}

fn default_tier() -> String {
    "ofl".to_string()
}

fn catalogue() -> Vec<CatalogueEntry> {
    serde_json::from_str(CATALOGUE_JSON).unwrap_or_default()
}

// The editor-owned, plugin-agnostic suggestion contract (mirrors SuggestField.svelte's own
// type). `value`/`label` are the base; `badge`/`tone`/`note` are GENERIC display slots the
// editor renders without knowing what a font or a license is. Fontavious PROJECTS its own
// font-specific facts (licenseTier, alias matches) into them here -- the words "licenseTier"/
// "font"/"alias" never cross into the editor's type. A future Font Awesome plugin fills the
// same slots from its own concepts. See resources/fontavious-catalogue-plan.md §5.1.
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

// --- Global preferences (see PLUGINS.md `preferences` export + resources/nature-of-fonts.md §7) ---
//
// Declared as data for the editor's Settings menu. Fontavious exposes one license-tier toggle per
// tier that ACTUALLY exists in the catalogue (derived, never a hardcoded tier list -- add a tier to
// the catalogue and its toggle appears automatically), plus a toggle for the proprietary look-alike
// names (Arial, Gotham, ...) surfaced referentially on OFL roots. The host owns storage; these
// values are fed back via kit10_kv_get under `pref:<id>` and read by search_fonts.

#[derive(Debug, Clone, Serialize)]
struct PreferenceDef {
    id: String,
    label: String,
    // "toggle" for all of Fontavious's prefs. Single-word key, so no camelCase concern (the wire
    // shape the host reads -- see AGENTS.md's snake_case/camelCase pitfall).
    kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    group: Option<String>,
    // `default` is a Rust keyword; rename the field to emit the exact key the host reads.
    #[serde(rename = "default")]
    default_value: String,
}

fn tier_label(tier: &str) -> String {
    match tier {
        "ofl" => "Include OFL fonts".to_string(),
        "free-proprietary" => "Include Fontshare (free)".to_string(),
        other => format!("Include {other} fonts"),
    }
}

// Pure builder (no host calls), so it's unit-testable against the real catalogue.
fn preference_defs() -> Vec<PreferenceDef> {
    let mut tiers: Vec<String> = catalogue().into_iter().map(|e| e.license_tier).collect();
    tiers.sort();
    tiers.dedup();

    let mut defs: Vec<PreferenceDef> = tiers
        .into_iter()
        .map(|tier| PreferenceDef {
            id: format!("include-tier-{tier}"),
            label: tier_label(&tier),
            kind: "toggle".to_string(),
            group: Some("Licensing".to_string()),
            default_value: "true".to_string(),
        })
        .collect();

    // Proprietary trademark names (exact `aliases` + visual `looksLike`) are a search surface, not a
    // license tier -- their own toggle. On by default (current behavior surfaces them).
    defs.push(PreferenceDef {
        id: "show-lookalikes".to_string(),
        label: "Show proprietary look-alike names".to_string(),
        kind: "toggle".to_string(),
        group: Some("Licensing".to_string()),
        default_value: "true".to_string(),
    });

    defs
}

// Reads a `pref:<id>` toggle the host seeded into KV. Unset/empty (user never touched it) or any
// unexpected value falls back to `default`.
fn pref_bool(id: &str, default: bool) -> bool {
    let raw = unsafe { kit10_kv_get(format!("pref:{id}")) }.unwrap_or_default();
    match raw.as_str() {
        "true" => true,
        "false" => false,
        _ => default,
    }
}

/// Build a suggestion for a root, always labelled with the root's own (OFL) family name -- never
/// a trademarked alias. `note` (e.g. "matches Arial") is the referential disclosure of why this
/// root surfaced; `approximate` (a visual-alias match) tints the note as a caution.
fn suggestion_for(e: &CatalogueEntry, note: Option<String>, approximate: bool) -> SuggestionEntry {
    let (badge, tone) = match e.license_tier.as_str() {
        // Fontshare's closed tier: free to use, not to rehost/bundle.
        "free-proprietary" => (Some("free".to_string()), Some("info".to_string())),
        _ => (None, None), // ofl / default: no badge
    };
    // A visual (approximate) look-alike match cautions with a warn tone even on an OFL root.
    let tone = if approximate { Some("warn".to_string()) } else { tone };
    SuggestionEntry { value: e.family.clone(), label: e.family.clone(), badge, tone, note }
}

/// Substring-match the query against every entry's family name, exact `aliases`, AND visual
/// `looksLike` names. Any match surfaces the OFL ROOT (value/label = root family, never a
/// trademark): an exact-alias match notes "matches Arial"; a visual match notes "approximates
/// Gotham" with a caution tone; a direct family match has no note. Empty query returns the whole
/// catalogue (roots only). Precedence: family > exact alias > visual, so a real name always wins.
// Unfiltered convenience (allow every tier, show look-alikes) -- test-only; the plugin path
// (search_fonts) always goes through search_catalogue_filtered with preference-driven predicates.
#[cfg(test)]
fn search_catalogue(query: &str) -> Vec<SuggestionEntry> {
    search_catalogue_filtered(query, &|_| true, true)
}

/// Filtered search. `tier_allowed(license_tier)` gates an entry by its license tier (so a disabled
/// tier's fonts never surface at all), and `show_lookalikes` gates the proprietary alias/look-alike
/// name match paths (a direct family-name match always works regardless). Both are injected rather
/// than read from KV here so this stays pure and unit-testable; `search_fonts` supplies the real,
/// preference-driven predicates.
fn search_catalogue_filtered(
    query: &str,
    tier_allowed: &dyn Fn(&str) -> bool,
    show_lookalikes: bool,
) -> Vec<SuggestionEntry> {
    let q = query.trim().to_lowercase();
    let contains = |s: &String| s.to_lowercase().contains(&q);
    catalogue()
        .iter()
        .filter_map(|e| {
            if !tier_allowed(&e.license_tier) {
                return None;
            }
            if q.is_empty() {
                return Some(suggestion_for(e, None, false));
            }
            if e.family.to_lowercase().contains(&q) {
                return Some(suggestion_for(e, None, false));
            }
            if show_lookalikes {
                if let Some(a) = e.aliases.iter().find(|a| contains(a)) {
                    return Some(suggestion_for(e, Some(format!("matches {a}")), false));
                }
                if let Some(a) = e.looks_like.iter().find(|a| contains(a)) {
                    return Some(suggestion_for(e, Some(format!("approximates {a}")), true));
                }
            }
            None
        })
        .collect()
}

#[plugin_fn]
pub fn on_init(_input: String) -> FnResult<String> {
    let mem = Memory::from_bytes("Fontavious plugin initialized")?;
    mem.log(LogLevel::Info);
    Ok("ok".to_string())
}

/// Substring match against family names AND aliases, for the font picker's search box.
/// Empty query returns the full catalogue. See `search_catalogue`.
#[plugin_fn]
pub fn search_fonts(query: String) -> FnResult<String> {
    let show_lookalikes = pref_bool("show-lookalikes", true);
    // Tier gating reads `pref:include-tier-<tier>` per entry -- fully catalogue-derived, so a new
    // tier is honored the moment it appears in both the catalogue and the declared preferences.
    let tier_allowed = |tier: &str| pref_bool(&format!("include-tier-{tier}"), true);
    let results = search_catalogue_filtered(&query, &tier_allowed, show_lookalikes);
    Ok(serde_json::to_string(&results)?)
}

/// Declares Fontavious's global preferences for the editor's Settings menu (license-tier toggles +
/// proprietary look-alike visibility). Purely declarative -- the host stores the values and feeds
/// them back via KV (read in search_fonts). See PLUGINS.md's `preferences` export.
#[plugin_fn]
pub fn preferences(_input: String) -> FnResult<String> {
    Ok(serde_json::to_string(&preference_defs())?)
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

/// Find the catalogue entry a name refers to, matching the family name, an exact `aliases` name,
/// OR a visual `looksLike` name (case-insensitive). This is how a proprietary/imported name
/// ("Arial", "Gotham") resolves to the OFL root that owns the file -- callers ask for it and
/// transparently get the root's variants. Precedence family > exact alias > visual, so a real
/// family name always wins, and an exact clone wins over an approximate look-alike.
fn find_entry(name: &str) -> Option<CatalogueEntry> {
    let cat = catalogue();
    cat.iter()
        .find(|e| e.family.eq_ignore_ascii_case(name))
        .or_else(|| cat.iter().find(|e| e.aliases.iter().any(|a| a.eq_ignore_ascii_case(name))))
        .or_else(|| cat.iter().find(|e| e.looks_like.iter().any(|a| a.eq_ignore_ascii_case(name))))
        .cloned()
}

fn find_matching_variant(input: &FetchFontInput) -> Result<FontVariant, Error> {
    let entry = find_entry(&input.value)
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

// Host-provided persistent font cache (IndexedDB, see src/lib/plugins/font-cache.ts). GET takes a
// URL and returns the cached WOFF2 bytes (empty = miss); PUT takes a JSON metadata blob + the raw
// bytes. These let fetch_font skip the network on a reload without the host having to wrap the
// fetch itself -- the plugin owns "get me these bytes cheaply", the host owns the storage. String
// and Vec<u8> params/returns marshal as raw bytes (NOT the `u64` the pdk pitfall warns against).
#[host_fn]
extern "ExtismHost" {
    fn kit10_font_cache_get(url: String) -> Vec<u8>;
    fn kit10_font_cache_put(meta_json: String, bytes: Vec<u8>);
    // Per-plugin KV. The host seeds this plugin's stored preference values under `pref:<id>` before
    // each call (see manager.svelte.ts's seedPluginPreferences), so search_fonts reads its own
    // license-tier preferences here without any function signature carrying them. String in/out
    // marshals as raw bytes (not the `u64` the pdk pitfall warns against).
    fn kit10_kv_get(key: String) -> String;
}

// What a cached record carries alongside the bytes. `license_tier` is stored so a future export
// path can restrict itself to the `ofl` tier (resources/nature-of-fonts.md §7.3) -- cached but
// unexposed for proprietary. camelCase: the consumer is the JS host.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CacheMeta<'a> {
    url: &'a str,
    license_tier: &'a str,
    family: &'a str,
    category: Option<&'a str>,
    weight_min: u16,
    weight_max: u16,
    style: &'a str,
}

// Both cache calls swallow errors to a no-op: the cache is a best-effort accelerator, never a
// dependency of font fetching. A get fault reads as a miss (fetch from network); a put fault just
// means it won't be cached for next session.
fn cache_get(url: &str) -> Option<Vec<u8>> {
    match unsafe { kit10_font_cache_get(url.to_string()) } {
        Ok(bytes) if !bytes.is_empty() => Some(bytes),
        _ => None,
    }
}

fn cache_put(entry: &CatalogueEntry, variant: &FontVariant, bytes: &[u8]) {
    let meta = CacheMeta {
        url: &variant.url,
        license_tier: &entry.license_tier,
        family: &entry.family,
        category: entry.category.as_deref(),
        weight_min: variant.weight_min,
        weight_max: variant.weight_max,
        style: &variant.style,
    };
    if let Ok(json) = serde_json::to_string(&meta) {
        let _ = unsafe { kit10_font_cache_put(json, bytes.to_vec()) };
    }
}

/// Returns a variant's WOFF2 bytes. Checks the host's persistent cache first (instant, offline);
/// on a miss, fetches via Extism's HTTP capability (allowed only for hosts `allowedHosts`
/// permits) and stores the result for next time. Bytes are returned raw -- no JSON wrapping -- so
/// the caller reads them via the JS SDK's `.bytes()` and hands them to `vellum.load_font()`.
#[plugin_fn]
pub fn fetch_font(input: String) -> FnResult<Vec<u8>> {
    let input: FetchFontInput = serde_json::from_str(&input)?;
    // Resolve the owning entry (for cache metadata) and its matching variant together.
    let entry = find_entry(&input.value)
        .ok_or_else(|| Error::msg(format!("font family not in catalogue: {}", input.value)))?;
    let variant = entry
        .variants
        .iter()
        .find(|v| input.weight >= v.weight_min && input.weight <= v.weight_max && v.style == input.style)
        .cloned()
        .ok_or_else(|| {
            Error::msg(format!(
                "no variant for {} weight={} style={}",
                input.value, input.weight, input.style
            ))
        })?;

    if let Some(bytes) = cache_get(&variant.url) {
        return Ok(bytes);
    }

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
    let bytes = res.body();
    cache_put(&entry, &variant, &bytes);
    Ok(bytes)
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
    let entry = find_entry(&input.value)
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

    // Every variant URL must be an https font file on a KNOWN vendor host (kept in lockstep with
    // Fontavious's `allowedHosts` in manager/src/plugins-bootstrap.ts -- a URL on a host we can't
    // fetch from is a dead entry). google -> gstatic, fontshare -> cdn.fontshare.com.
    #[test]
    fn every_variant_url_is_on_an_allowed_vendor_host() {
        for entry in catalogue() {
            let allowed_host = match entry.vendor.as_str() {
                "fontshare" => "https://cdn.fontshare.com/",
                _ => "https://fonts.gstatic.com/", // google + default
            };
            for variant in &entry.variants {
                assert!(
                    variant.url.starts_with(allowed_host),
                    "{} ({}) has a URL off its vendor host: {}",
                    entry.family,
                    entry.vendor,
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
        // Per STYLE, a variable font covers its whole range from one file (Inter now also ships
        // an italic variant, so we assert the per-style invariant, not a total variant count).
        let normal: Vec<_> = inter.variants.iter().filter(|v| v.style == "normal").collect();
        assert_eq!(normal.len(), 1, "a variable font needs only one NORMAL entry to cover 400-700");

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
        // Static-only: one file per weight (Lato ships 400 + 700 normal, plus italics now). The
        // invariant is that an in-between weight has NO file, not the exact variant count.
        let normal: Vec<_> = lato.variants.iter().filter(|v| v.style == "normal").collect();
        assert_eq!(normal.len(), 2, "static-only: one NORMAL file per discrete weight (400, 700)");

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

    // --- aliases (catalogue-expansion Phase 0, trademark-safe framing) ---

    // A proprietary NAME we ship no bytes for still resolves -- find_entry matches it as an
    // alias of the OFL root and returns that root's real file. No entry is ever *named* "Arial".
    #[test]
    fn proprietary_name_resolves_to_ofl_root_file() {
        let arial = FetchFontInput { value: "Arial".to_string(), weight: 400, style: "normal".to_string() };
        let arimo = FetchFontInput { value: "Arimo".to_string(), weight: 400, style: "normal".to_string() };
        let via_alias = find_matching_variant(&arial).expect("Arial should resolve to Arimo");
        let direct = find_matching_variant(&arimo).expect("Arimo should resolve directly");
        assert_eq!(via_alias.url, direct.url, "Arial must render Arimo's actual file");
        assert!(via_alias.url.starts_with("https://fonts.gstatic.com/s/arimo/"));

        // The catalogue must never contain a product literally named with the trademark.
        assert!(
            !catalogue().iter().any(|e| e.family.eq_ignore_ascii_case("Arial")),
            "no catalogue entry may be NAMED 'Arial' -- it's an alias only"
        );
    }

    // find_entry resolves an alias to the root that owns the file; the root keeps its own name.
    #[test]
    fn find_entry_matches_alias_and_returns_named_root() {
        let e = find_entry("Times New Roman").expect("resolves via alias");
        assert_eq!(e.family, "Tinos", "returns the OFL root, keeping its real name");
        assert!(!e.variants.is_empty());

        let at_700 = FetchFontInput { value: "Times New Roman".to_string(), weight: 700, style: "normal".to_string() };
        let v = find_matching_variant(&at_700).expect("TNR@700 resolves via Tinos");
        assert!(v.url.contains("/tinos/"));

        assert!(find_entry("Not A Real Font").is_none());
    }

    // A real family name wins over another family's alias (defensive: no alias shadows a family).
    #[test]
    fn family_name_beats_alias() {
        // "Arimo" is a family; make sure it never resolves to something else via a stray alias.
        assert_eq!(find_entry("Arimo").unwrap().family, "Arimo");
    }

    // Search surfaces the OFL ROOT for a proprietary-name query, labelled with the root's own
    // name, with a referential "matches Arial" note -- never a row branded with the trademark.
    #[test]
    fn typing_a_proprietary_name_surfaces_the_ofl_root() {
        let results = search_catalogue("arial");
        let arimo = results.iter().find(|r| r.value == "Arimo").expect("Arimo surfaces for 'arial'");
        assert_eq!(arimo.label, "Arimo", "labelled with the OFL name, not the trademark");
        assert_eq!(arimo.note.as_deref(), Some("matches Arial"));
        assert!(arimo.badge.is_none(), "an OFL root carries no badge");
        // And nothing in the results is literally titled with the trademark.
        assert!(!results.iter().any(|r| r.value.eq_ignore_ascii_case("Arial")));
    }

    // CacheMeta is read by the JS host (kit10_font_cache_put) -- assert the serialized KEY NAMES
    // are camelCase, per the wire pitfall (a snake_case key reads as undefined on the JS side).
    #[test]
    fn cache_meta_serializes_camel_case() {
        let meta = CacheMeta {
            url: "https://cdn.fontshare.com/x.woff2",
            license_tier: "free-proprietary",
            family: "Satoshi",
            category: Some("sans"),
            weight_min: 400,
            weight_max: 400,
            style: "normal",
        };
        let json = serde_json::to_string(&meta).unwrap();
        assert!(json.contains("\"licenseTier\":\"free-proprietary\""), "{json}");
        assert!(json.contains("\"weightMin\":400"), "{json}");
        assert!(!json.contains("license_tier"), "must be camelCase: {json}");
    }

    // The free-proprietary (Fontshare) tier badges "free" (info) so the picker discloses it's a
    // different license lane than the OFL default -- the only tier that currently draws a badge.
    #[test]
    fn free_proprietary_root_is_badged_free() {
        let sat = find_entry("Satoshi").expect("Satoshi catalogued");
        assert_eq!(sat.vendor, "fontshare");
        assert_eq!(sat.license_tier, "free-proprietary");
        let s = suggestion_for(&sat, None, false);
        assert_eq!(s.badge.as_deref(), Some("free"));
        assert_eq!(s.tone.as_deref(), Some("info"));
    }

    // A VISUAL look-alike (Phase 5): typing a proprietary display/brand name surfaces the OFL
    // root labelled with its own name, noted "approximates X" (not "matches") with a caution
    // tone -- signalling it's an approximate stand-in that may reflow, not a metric drop-in.
    #[test]
    fn typing_a_visual_lookalike_surfaces_the_root_as_approximate() {
        let results = search_catalogue("gotham");
        let m = results.iter().find(|r| r.value == "Montserrat").expect("Gotham -> Montserrat");
        assert_eq!(m.label, "Montserrat", "labelled with the OFL name, not the trademark");
        assert_eq!(m.note.as_deref(), Some("approximates Gotham"));
        assert_eq!(m.tone.as_deref(), Some("warn"), "visual matches caution");
        assert!(!results.iter().any(|r| r.value.eq_ignore_ascii_case("Gotham")));

        // And it resolves for rendering/import, just like an exact alias.
        let e = find_entry("SF Pro").expect("SF Pro resolves via looksLike");
        assert!(!e.variants.is_empty());
    }

    // A direct family-name query has no note (it didn't match via an alias).
    #[test]
    fn typing_the_root_name_has_no_alias_note() {
        let results = search_catalogue("arimo");
        let arimo = results.iter().find(|r| r.value == "Arimo").expect("Arimo surfaces");
        assert!(arimo.note.is_none());
    }

    // The generic slots serialize under their exact key names (the editor reads them verbatim)
    // and are OMITTED when absent, so a plain family hit stays `{value,label}` as before.
    #[test]
    fn suggestion_serializes_generic_slots_and_omits_empty() {
        let hit = search_catalogue("arial").into_iter().find(|r| r.value == "Arimo").unwrap();
        let json = serde_json::to_string(&hit).unwrap();
        assert!(json.contains("\"note\":\"matches Arial\""));
        assert!(!json.contains("badge"), "no badge on an OFL root: {json}");

        let plain = search_catalogue("arimo").into_iter().find(|r| r.value == "Arimo").unwrap();
        let json = serde_json::to_string(&plain).unwrap();
        assert!(!json.contains("note"), "empty slots must be omitted: {json}");
        assert!(!json.contains("badge"), "empty slots must be omitted: {json}");
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

    // --- global preferences (Settings menu license-tier toggles) ---

    // Preferences are derived from the catalogue's real tiers (never a hardcoded tier list), plus
    // the look-alike toggle. Asserts the serialized KEY NAMES too (`default`, `kind`), the shape the
    // host reads -- per the wire pitfall.
    #[test]
    fn preferences_are_catalogue_derived_toggles() {
        let defs = preference_defs();
        let ids: Vec<&str> = defs.iter().map(|d| d.id.as_str()).collect();
        // Both real catalogue tiers surface as toggles.
        assert!(ids.contains(&"include-tier-ofl"), "{ids:?}");
        assert!(ids.contains(&"include-tier-free-proprietary"), "{ids:?}");
        assert!(ids.contains(&"show-lookalikes"), "{ids:?}");
        assert!(defs.iter().all(|d| d.kind == "toggle"));

        let json = serde_json::to_string(&defs).unwrap();
        assert!(json.contains("\"default\":\"true\""), "emits the `default` key: {json}");
        assert!(json.contains("\"kind\":\"toggle\""), "{json}");
        assert!(!json.contains("default_value"), "must serialize as `default`: {json}");
    }

    // Disabling a tier removes its fonts from search entirely (family match included).
    #[test]
    fn disabling_a_tier_hides_its_fonts() {
        // Satoshi is the free-proprietary tier; disabling ofl must NOT hide it, and disabling
        // free-proprietary must.
        let only_free = search_catalogue_filtered("", &|t| t == "free-proprietary", true);
        assert!(only_free.iter().all(|r| r.value != "Inter"), "Inter (ofl) hidden when ofl off");
        assert!(only_free.iter().any(|r| r.value == "Satoshi"), "Satoshi (free) still shown");

        let no_free = search_catalogue_filtered("satoshi", &|t| t != "free-proprietary", true);
        assert!(no_free.is_empty(), "Satoshi hidden when its tier is disabled");
    }

    // With look-alikes off, a proprietary-name query stops resolving, but real family names still do.
    #[test]
    fn hiding_lookalikes_suppresses_proprietary_name_matches() {
        let hidden = search_catalogue_filtered("arial", &|_| true, false);
        assert!(hidden.is_empty(), "'arial' matches nothing when look-alikes are hidden: {hidden:?}");

        let visible = search_catalogue_filtered("arial", &|_| true, true);
        assert!(visible.iter().any(|r| r.value == "Arimo"), "still resolves when shown");

        // A real family name is unaffected by the look-alike toggle.
        let family = search_catalogue_filtered("arimo", &|_| true, false);
        assert!(family.iter().any(|r| r.value == "Arimo"));
    }
}
