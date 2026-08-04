// Kit-basis static/dynamic variant synthesis (resources/webcodium-export-plan.md Phase 3).
// This is the one place WebCodium reasons about the axis/kit model itself -- every prior phase
// only ever consumed Charter's already-resolved, axis-blind UiNode[] output. Consumes the
// unresolved KitExportShape (fetched via the kit10_get_kit_export_shape host fn) and produces:
//
//   - The Kit's own BASE declarations (excluded axes collapsed to their default/lowest value).
//   - One VariantRule per non-excluded, non-null LAYER: a BEM-style static modifier chain, one
//     axis-prefixed fragment per condition (`--{axis}-{value}`, e.g. a layer conditioned on
//     {plan: elite} alone gets `--plan-elite`; conditioned on {plan: elite, theme: dark} together
//     gets a compound selector chaining BOTH `--plan-elite` and `--theme-dark`), or a real dynamic
//     selector (`:hover`/`.is-{value}`) for a single-condition layer on a `variant_kind: "dynamic"`
//     axis. Holds only the DELTA against the base -- i.e. what CSS's own cascade needs the
//     modifier class(es) to override, not a full re-statement of every property (mirrors how
//     `.button.button--theme-secondary` only carries `background` in the worked example in the
//     plan doc). See VariantRule's own doc comment for the static/dynamic suffix shape.
//
// v1 scope cut (deliberate, not an oversight): properties whose CSS meaning depends on
// SIBLING/PARENT layout context this module doesn't have. `resize`'s `fill` keyword on
// width/height was originally cut alongside this for exactly that reason (compile_resize's real
// flex-grow/shrink/basis math needs to know the parent's own main axis) -- but see
// synthesize_resize below: the GROW half turned out not to need it after all, since flex-grow is
// inherently main-axis-relative in real CSS regardless of flex-direction. flex-shrink/flex-basis/
// min-width/min-height (Fill's "can shrink below content" half) remain genuinely axis-specific and
// are still deferred -- see the plan doc's Phase 3.1 entry.
//
// `arrange` (Stack/Cluster/Split/Center/Grid) is NOT in that scope-cut category, despite being
// Charter's own compiled preset -- `compile_arrange`/`resolve_flex_direction` need nothing from
// sibling/parent context, so `synthesize_arrange` below replicates them directly from a Kit's own
// raw properties (flex-direction/align-items/justify-content/flex-wrap, or a default
// grid-template-columns for Grid). This was a real, reported bug in the initial ship: `arrange`
// was originally scope-cut alongside `resize`, so a Kit authored via the high-level Split/Cluster/
// Center presets (the overwhelmingly common authoring path) exported with NONE of its actual
// layout -- "Split" silently did nothing in the export while looking correct in the editor.
//
// Also v1 scope: only "literal"/"discrete" axis values are matched (range axes are disabled
// project-wide today, resources/layer-authoring.md). Multi-axis conditions ARE now supported
// (see synthesize_variant_rules_with_tokens) -- always as a static BEM chain, regardless of any
// contributing axis's own variant_kind ("assume everything is static for now"); combining several
// axes' worth of DYNAMIC pseudo-classes into one compound selector isn't a coherent concept and
// stays out of scope. This mirrors resolve.ts's matchesArg/matchLayers cascade (manager/src/
// resolve/resolve.ts) closely enough that a change to one should prompt checking the other, but is
// NOT the same code -- this is a small, explicitly-scoped Rust port, not a shared crate, since
// resolve.ts's version also handles range intervals and priority-index tie-breaking this module
// doesn't need.
//
// A rule's own CSS selector text and the classes an HTML element needs for it to actually match
// are two separate concerns -- this module only ever decides what CSS RULES exist per Kit (see
// css.rs::variant_rule_selector for how a VariantRule becomes selector text). Which node instances
// should carry which of those rules' classes is a per-VIEW-INSTANCE decision (this Kit's shape has
// no notion of instances at all) made in lib.rs, via rule_matches_args against that instance's own
// resolved axis args (kit10_get_view_axis_args) -- see lib.rs's export_html_css.

use crate::tree::kit_class_name;
use kit10_scene::OklabColor;
use serde::Deserialize;
use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AxisValueWire {
    #[serde(rename = "type", default)]
    pub kind: String,
    #[serde(default)]
    pub value: String,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExportAxisValue {
    #[serde(default)]
    pub axis_value_id: String,
    #[serde(default)]
    pub value: AxisValueWire,
    #[serde(default)]
    pub priority_index: i64,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AxisExportMeta {
    pub axis_id: String,
    #[serde(default)]
    pub axis_name: Option<String>,
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub variant_kind: String,
    #[serde(default)]
    pub excluded_from_export: bool,
    #[serde(default)]
    pub default_value: Option<AxisValueWire>,
    #[serde(default)]
    pub priority_index: i64,
    #[serde(default)]
    pub values: Vec<ExportAxisValue>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TokenValueWire {
    #[serde(rename = "type", default)]
    pub kind: String,
    #[serde(default)]
    pub value: Option<String>,
    #[serde(default)]
    pub view_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExportLayerCondition {
    pub axis_id: String,
    #[serde(default)]
    pub axis_value_id: String,
    #[serde(default)]
    pub value: AxisValueWire,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExportLayerEntry {
    pub property: String,
    #[serde(default)]
    pub literal_value: Option<String>,
    #[serde(default)]
    pub token_value: Option<TokenValueWire>,
    // The token's own row id (distinct from token_value, which is that token's already-resolved
    // VALUE) -- this is what lets resolve_properties look the entry up in the project-tokens map
    // (see PROJECT_TOKENS.md-equivalent doc comment on css_var_name below) to decide whether this
    // property should become a CSS `var(--alias)` reference instead of a literal. Previously
    // dropped silently here even though export-shape.ts's ExportLayerEntry already sent it on the
    // wire (serde ignores unknown JSON fields by default) -- see resolve_entry_value's own history.
    #[serde(default)]
    pub token_id: Option<String>,
}

// A single PROJECT-scope token (kit_id AND view_id both null -- see manager's
// getTokensByProjectId), fetched via the kit10_get_project_tokens host fn. `format` mirrors
// TokenValueScalar.format (schema.ts) -- the token's own declared hint for how to render its raw
// string as valid CSS (a bare "16" needs "px" for a size token, "red" needs color-recognition
// validation for a color token), used once when emitting this token's :root declaration (see
// render_root_variables) since a token isn't tied to any single consuming property the way a raw
// kit entry is.
#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectToken {
    #[serde(default)]
    pub alias: String,
    #[serde(default)]
    pub value: String,
    #[serde(default)]
    pub format: Option<String>,
}

// Kit/view-scoped tokens are deliberately OUT of scope for this first cut -- only whatever the
// host's kit10_get_project_tokens call returns (project-scope only, by construction of the query
// it wraps) is ever visible here, so there is nothing to additionally filter by scope on this
// side. A future pass could extend this to kit/view-scoped tokens too; that needs its own alias
// disambiguation story (two different kits' same-named token would collide in one flat :root) this
// cut deliberately doesn't have to solve yet.
pub(crate) type ProjectTokens = HashMap<String, ProjectToken>;

// Converts a token alias (freeform, e.g. "colors.primary" or "Spacing / Medium") into a valid CSS
// custom-property identifier -- anything outside [A-Za-z0-9_-] becomes a hyphen. Shared by both
// the `:root` declaration (render_root_variables) and every `var(--...)` usage site
// (resolve_properties), which is what keeps them from ever drifting out of sync with each other.
pub(crate) fn css_var_name(alias: &str) -> String {
    let cleaned: String = alias
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
        .collect();
    if cleaned.is_empty() { "token".to_string() } else { cleaned }
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExportLayer {
    #[serde(default)]
    pub layer_id: String,
    #[serde(default)]
    pub conditions: Vec<ExportLayerCondition>,
    #[serde(default)]
    pub entries: Vec<ExportLayerEntry>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct KitExportShape {
    #[serde(default)]
    pub kit_id: String,
    #[serde(default)]
    pub kit_name: String,
    #[serde(default)]
    pub axes: Vec<AxisExportMeta>,
    #[serde(default)]
    pub layers: Vec<ExportLayer>,
}

#[derive(Debug, Clone, Deserialize, Default)]
pub(crate) struct KitExportShapeResponse {
    #[serde(default)]
    pub success: bool,
    #[serde(default)]
    pub kits: HashMap<String, KitExportShape>,
    #[serde(default)]
    pub error: Option<String>,
}

// A resolved entry's effective literal string -- mirrors resolve.ts's matchLayers exactly
// (scalar token -> its value, view token -> its view_id, anything else -> ""), so a token-backed
// raw entry resolves the same way it would through the real resolver.
fn resolve_entry_value(entry: &ExportLayerEntry) -> String {
    if let Some(tv) = &entry.token_value {
        match tv.kind.as_str() {
            "scalar" => tv.value.clone().unwrap_or_default(),
            "view" => tv.view_id.clone().unwrap_or_default(),
            _ => String::new(),
        }
    } else {
        entry.literal_value.clone().unwrap_or_default()
    }
}

fn matches_condition(cond: &ExportLayerCondition, args: &HashMap<String, String>) -> bool {
    if cond.value.kind != "literal" && cond.value.kind != "discrete" {
        return false; // range conditions are out of scope for v1 -- see module doc comment
    }
    args.get(&cond.axis_id).map(|v| *v == cond.value.value).unwrap_or(false)
}

// Properties whose stored value is a MERGED/synthesized shorthand by the time declarations_for
// ever sees it (synthesize_border folds "border"+"border-width" into one atomic value) -- a
// project-token-backed "border" color would no longer literally equal the token's own value after
// merging, so substituting a bare `var(--alias)` here would silently drop the width/style half of
// the shorthand. Excluded at the SOURCE (this map is never populated for these keys) rather than
// patched after the fact in every synthesize_* function that might touch them.
const NEVER_TOKEN_SUBSTITUTED: &[&str] = &["border", "border-width"];

// Winner-only resolve, matching resolve.ts's matchLayers: layers whose every condition matches
// `args`, applied ascending by condition count (specificity) so a more-specific layer's entries
// overwrite a less-specific one's. No priority-index tie-break (see module doc comment) -- v1's
// synthetic single-axis-at-a-time matches don't need it. `is_box` gates synthesize_arrange (a
// Text-primitive Kit never has arrange/flex-direction properties to begin with -- running it
// unconditionally would inject a spurious flex-direction onto a Text kit that never asked for one).
//
// Returns (resolved values, property -> CSS var name for properties backed by a PROJECT-scope
// token). The second map is built in lockstep with the first: a later, more specific layer
// overwriting a property with a plain literal clears any earlier token association for that same
// property key, exactly mirroring how `result.insert` already overwrites the value itself.
fn resolve_properties_with_tokens(
    shape: &KitExportShape,
    args: &HashMap<String, String>,
    is_box: bool,
    project_tokens: &ProjectTokens,
) -> (HashMap<String, String>, HashMap<String, String>) {
    let mut matching: Vec<&ExportLayer> = shape
        .layers
        .iter()
        .filter(|l| l.conditions.iter().all(|c| matches_condition(c, args)))
        .collect();
    matching.sort_by_key(|l| l.conditions.len());

    let mut result = HashMap::new();
    let mut token_vars: HashMap<String, String> = HashMap::new();
    for layer in matching {
        for entry in &layer.entries {
            result.insert(entry.property.clone(), resolve_entry_value(entry));

            let project_var = entry
                .token_id
                .as_ref()
                .filter(|_| !NEVER_TOKEN_SUBSTITUTED.contains(&entry.property.as_str()))
                .and_then(|tid| project_tokens.get(tid))
                .map(|pt| css_var_name(&pt.alias));
            match project_var {
                Some(var_name) => {
                    token_vars.insert(entry.property.clone(), var_name);
                }
                None => {
                    token_vars.remove(&entry.property);
                }
            }
        }
    }
    synthesize_border(&mut result);
    synthesize_radius(&mut result);
    synthesize_resize(&mut result);
    if is_box {
        synthesize_arrange(&mut result);
    } else {
        synthesize_line_height(&mut result);
    }
    (result, token_vars)
}

// Winner-only condition COUNT per property (not a resolved value) -- same filter+sort as
// resolve_properties_with_tokens, but tracking only the winning layer's own condition count.
// Feeds cross-kit contested-property detection (synthesize_contested_rules below), which compares
// RAW declared specificity across kits exactly the way manager's flattenKitResults/Charter's
// merge_kits do -- never WebCodium's own derived/synthesized properties (synthesize_arrange/
// synthesize_border/synthesize_resize), which are single-kit CSS-emission conveniences with no
// resolve.ts analog and no meaningful "condition count" of their own.
fn resolve_condition_counts(shape: &KitExportShape, args: &HashMap<String, String>) -> HashMap<String, usize> {
    let mut matching: Vec<&ExportLayer> = shape
        .layers
        .iter()
        .filter(|l| l.conditions.iter().all(|c| matches_condition(c, args)))
        .collect();
    matching.sort_by_key(|l| l.conditions.len());

    let mut result = HashMap::new();
    for layer in matching {
        for entry in &layer.entries {
            result.insert(entry.property.clone(), layer.conditions.len());
        }
    }
    result
}

// One disambiguating compound-selector rule for ONE property that 2+ of a view's composed kits
// both declare -- see resources/webcodium-export-plan.md's Multi-Kit Composition writeup and
// tree::composition_signature_class's own doc comment for why the extra signature class is
// needed at all (two views composing the identical kits in OPPOSITE priority order can resolve to
// different winners for the same property; a bare kit-class compound selector can't tell them
// apart, since class order in an element's class="" attribute doesn't affect CSS matching).
pub(crate) struct ContestedRule {
    pub selector_classes: Vec<String>,
    pub declaration: String,
}

// For one view's full ordered composition (kit_ids, priority_index ascending -- lowest first,
// matching resolve.ts's own convention) and that view's own resolved axis args per kit, finds
// every property 2+ of those kits declare and returns one ContestedRule per contest, picking the
// winner exactly the way flattenKitResults/merge_kits do: highest conditionCount wins outright
// regardless of kit order; a tie falls back to kit order (later/higher-priority kit, i.e. later in
// `kit_ids`, wins). A kit with no fetched shape, or a contested property that turns out
// unsupported/non-diffable, is simply skipped -- best-effort, same posture as every other
// host-fn-backed lookup in this plugin. Property iteration is sorted for deterministic output,
// mirroring declarations_for_with_tokens' own sort.
pub(crate) fn synthesize_contested_rules(
    kit_ids: &[String],
    kit_classes: &HashMap<String, String>,
    kit_shapes: &HashMap<String, KitExportShape>,
    view_axis_args: &HashMap<String, HashMap<String, String>>,
    is_box: bool,
    project_tokens: &ProjectTokens,
) -> Vec<ContestedRule> {
    if kit_ids.len() < 2 {
        return Vec::new();
    }

    let empty_args: HashMap<String, String> = HashMap::new();
    let mut condition_counts_by_kit: Vec<HashMap<String, usize>> = Vec::with_capacity(kit_ids.len());
    let mut resolved_by_kit: Vec<(HashMap<String, String>, HashMap<String, String>)> =
        Vec::with_capacity(kit_ids.len());
    for kid in kit_ids {
        let Some(shape) = kit_shapes.get(kid) else {
            condition_counts_by_kit.push(HashMap::new());
            resolved_by_kit.push((HashMap::new(), HashMap::new()));
            continue;
        };
        let args = view_axis_args.get(kid).unwrap_or(&empty_args);
        condition_counts_by_kit.push(resolve_condition_counts(shape, args));
        resolved_by_kit.push(resolve_properties_with_tokens(shape, args, is_box, project_tokens));
    }

    // property -> every kit index (into kit_ids) that declares it, with that kit's own condition
    // count for it.
    let mut candidates_by_property: HashMap<String, Vec<(usize, usize)>> = HashMap::new();
    for (kit_index, counts) in condition_counts_by_kit.iter().enumerate() {
        for (property, count) in counts {
            candidates_by_property.entry(property.clone()).or_default().push((kit_index, *count));
        }
    }

    let mut properties: Vec<&String> = candidates_by_property.keys().collect();
    properties.sort();

    let selector_classes: Vec<String> = kit_ids
        .iter()
        .filter_map(|kid| kit_classes.get(kid).cloned())
        .chain(std::iter::once(crate::tree::composition_signature_class(kit_ids)))
        .collect();

    let mut rules = Vec::new();
    for property in properties {
        let candidates = &candidates_by_property[property];
        if candidates.len() < 2 {
            continue; // only one kit declares this property -- not a contest
        }
        // Highest condition count wins; a tie breaks on kit_index (later == higher priority,
        // since kit_ids is already priority_index ascending) -- exactly flattenKitResults' rule.
        let &(winner_kit_index, _) =
            candidates.iter().max_by_key(|&&(kit_index, count)| (count, kit_index)).unwrap();

        let (values, token_vars) = &resolved_by_kit[winner_kit_index];
        let Some(value) = values.get(property) else { continue };
        let mut single = HashMap::new();
        single.insert(property.clone(), value.clone());
        let Some(declaration) = declarations_for_with_tokens(&single, token_vars, None).into_iter().next()
        else {
            continue;
        };
        if declaration.starts_with("/*") {
            continue; // unsupported dynamic-compiled property -- same skip declarations_for_with_tokens itself uses
        }

        rules.push(ContestedRule { selector_classes: selector_classes.clone(), declaration });
    }
    rules
}

// Replicates the flex-grow half of Charter's compile_resize (plugins/charter/src/lib.rs) directly
// from a Kit's own raw width/height, with NO parent/sibling axis lookup needed -- this revises the
// module's original v1 scope cut (see the top-of-file doc comment's history) for the grow half
// specifically: flex-grow is inherently MAIN-AXIS-relative in real CSS regardless of the
// container's actual flex-direction, so an unconditional `flex-grow: 1;` on the child correctly
// reproduces Fill's "equal share of the main axis" behavior whichever axis turns out to be main at
// render time -- no Charter round-trip (a hypothetical translate_properties host-fn) required
// after all. `.entry(...).or_insert(...)` mirrors synthesize_arrange's own "only fires when never
// explicitly set" rule -- an explicit raw `flex-grow` (the legacy item-level escape hatch) always
// wins. Still deliberately NOT reproduced: flex-shrink/flex-basis/min-width/min-height, and Hug's
// own flex-shrink:0 (Hug's flex-grow:0 already matches CSS's own default, so omitting it, as
// today, is already correct) -- these remain axis-specific or otherwise out of this pass's scope.
fn synthesize_resize(properties: &mut HashMap<String, String>) {
    let wants_grow =
        ["width", "height"].iter().any(|prop| properties.get(*prop).map(String::as_str) == Some("fill"));
    if wants_grow {
        properties.entry("flex-grow".to_string()).or_insert_with(|| "1".to_string());
    }
}


// Replicates Charter's compile_arrange/resolve_flex_direction (plugins/charter/src/lib.rs)
// exactly: the "arrange" raw property (Stack/Cluster/Split/Center/Grid, unrecognized/absent ->
// Stack) is Charter's own opinionated preset, and every property it implies -- flex-direction,
// align-items, justify-content, flex-wrap, or a default grid-template-columns -- is a DEFAULT
// that Charter computes at translate time and never stores as its own literal render_entries
// value, UNLESS the designer explicitly overrode it via that tab's own follow-on control or the
// Advanced/Custom-tracks escape hatch (in which case the raw property already present in
// `properties` wins, exactly matching Charter's own "only fires when never explicitly set" rule).
//
// This closed a real, reported bug: v1 originally listed "arrange" as an unsupported-compiled
// property and skipped it entirely, so a Split/Cluster/Center-arranged Kit exported with NONE of
// its actual layout (no justify-content, no align-items, sometimes no flex-direction) -- "Split"
// silently stopped working the moment a Kit relied on the high-level preset instead of manually
// setting flex-direction/justify-content/align-items itself, which is the overwhelmingly common
// authoring path. Unlike `resize`'s `fill`/`hug` (still correctly left unsupported -- see the
// module doc comment), `compile_arrange` needs nothing from sibling/parent layout context, so it
// can be replicated purely from a Kit's own raw properties.
fn synthesize_arrange(properties: &mut HashMap<String, String>) {
    let raw_arrange = properties.remove("arrange");
    let kind = match raw_arrange.as_deref().map(str::trim) {
        Some("cluster") => "cluster",
        Some("split") => "split",
        Some("center") => "center",
        Some("grid") => "grid",
        // "stack", absent, or unrecognized -- Default hard, mirrors parse_arrange exactly.
        _ => "stack",
    };
    let cell_min_raw = properties.remove("grid-cell-min");

    if kind == "grid" {
        // Grid never uses flex-direction/align-items/justify-content/flex-wrap defaults --
        // mirrors compile_arrange's own Grid branch, which only ever sets grid_template_columns.
        let has_custom_tracks =
            properties.get("grid-template-columns").map(|v| !v.is_empty()).unwrap_or(false);
        if !has_custom_tracks {
            let cell_min =
                cell_min_raw.as_deref().map(parse_px_like).filter(|&v| v > 0.0).unwrap_or(160.0);
            properties.insert(
                "grid-template-columns".to_string(),
                format!("repeat(auto-fit, minmax({cell_min}px, 1fr))"),
            );
        }
        return;
    }

    // flex_direction is always concretely resolved (never optional), matching
    // resolve_flex_direction exactly -- a fresh box with no arrange/flex-direction touched at all
    // still needs an explicit `flex-direction: column;` in the export, since Charter's own
    // default (Stack -> Column) differs from CSS's native initial value (row).
    let raw_flex_direction = properties.get("flex-direction").cloned();
    let flex_direction = match raw_flex_direction.as_deref() {
        Some("row") => "row",
        Some("row-reverse") => "row-reverse",
        Some("column-reverse") => "column-reverse",
        Some("column") => "column",
        _ => match kind {
            "cluster" | "split" => "row",
            _ => "column",
        },
    };
    properties.insert("flex-direction".to_string(), flex_direction.to_string());

    let has_align_items = properties.get("align-items").map(|v| !v.is_empty()).unwrap_or(false);
    let has_justify_content =
        properties.get("justify-content").map(|v| !v.is_empty()).unwrap_or(false);
    let has_flex_wrap = properties.get("flex-wrap").map(|v| !v.is_empty()).unwrap_or(false);

    match kind {
        "stack" => {
            if !has_align_items && flex_direction == "row" {
                properties.insert("align-items".to_string(), "center".to_string());
            }
        }
        "cluster" => {
            if !has_flex_wrap {
                properties.insert("flex-wrap".to_string(), "wrap".to_string());
            }
            if !has_align_items {
                properties.insert("align-items".to_string(), "flex-start".to_string());
            }
        }
        "split" => {
            if !has_justify_content {
                properties.insert("justify-content".to_string(), "space-between".to_string());
            }
            if !has_align_items {
                properties.insert("align-items".to_string(), "center".to_string());
            }
        }
        "center" => {
            if !has_justify_content {
                properties.insert("justify-content".to_string(), "center".to_string());
            }
            if !has_align_items {
                properties.insert("align-items".to_string(), "center".to_string());
            }
        }
        _ => {}
    }
}

fn parse_px_like(raw: &str) -> f32 {
    raw.trim().trim_end_matches("px").trim().parse::<f32>().unwrap_or(0.0)
}

// "border-radius-squircle" is a boolean-ish companion property (Charter's RadiusKeys - see
// plugins/charter/src/lib.rs, and the FieldDef declared for "border-radius") that real CSS has no
// native way to express as an actual shape. Mirrors css.rs's paint_props (Path A) exactly: scales
// the raw "border-radius" value by the SAME shared SQUIRCLE_AREA_MATCH_SCALE constant (not a
// second hand-typed copy of the literal - see that constant's own doc comment in css.rs for the
// full area-matching derivation and the SQUIRCLE_N coupling warning) so Path A and Path B never
// silently disagree on what a squircle box exports as. Mutates `properties` in place: consumes
// (removes) the boolean companion key so it never reaches format_value as a spurious non-numeric
// property, and replaces "border-radius" with its scaled value so the normal diffable-property
// pipeline (DIFFABLE_PROPERTIES/format_value's as_px_if_bare_number) formats it exactly like any
// other length. A no-op if squircle isn't set, or if no border-radius was declared at all.
fn synthesize_radius(properties: &mut HashMap<String, String>) {
    let is_squircle = properties.remove("border-radius-squircle").as_deref() == Some("1");
    if !is_squircle {
        return;
    }
    if let Some(raw) = properties.get("border-radius") {
        let px = parse_px_like(raw);
        let scaled = (px as f64 * crate::css::SQUIRCLE_AREA_MATCH_SCALE).round();
        properties.insert("border-radius".to_string(), format!("{scaled}"));
    }
}

// Combines the raw "border" (a COLOR ONLY value -- box_categories()'s FieldDef is
// `.with_input_type("color")`) and "border-width" (a separate raw px property) into Charter's own
// border shorthand convention, exactly mirroring extract_paint_props' has_border/border_width
// rules (plugins/charter/src/lib.rs): a border is present iff "border" is set and isn't "none";
// its width defaults to 1px when a color is set but no explicit width is. This can't be left as
// two independently-diffed raw properties -- "border: <color>;" alone is syntactically valid CSS
// but leaves border-style at its "none" initial value, so the border never actually renders (a
// real bug caught on a live export: 2026-07-27). Mutates `properties` in place, replacing the two
// raw keys with one atomic "border" value ("{width}px solid {color}") the normal diffable-property
// pipeline can treat like any other property -- or removing "border" entirely when no color is set.
fn synthesize_border(properties: &mut HashMap<String, String>) {
    let border_color = properties.get("border").cloned().unwrap_or_default();
    let width_raw = properties.remove("border-width");
    let has_border = !border_color.is_empty() && border_color != "none";
    if !has_border {
        properties.remove("border");
        return;
    }
    let width = width_raw.as_deref().map(parse_px_like).filter(|w| *w > 0.0).unwrap_or(1.0);
    let color =
        if is_recognized_color(&border_color) { border_color } else { unparseable_color_marker() };
    properties.insert("border".to_string(), format!("{width}px solid {color}"));
}

// Mirrors Charter's parse_color dispatch (plugins/charter/src/lib.rs) closely enough to answer
// "would Charter's parser recognize this token, or fall through to warn_unparseable's magenta
// marker" -- a minimal prefix/keyword check, NOT the full OKLCH/hex/rgb/hsl conversion math (out
// of this pass's v1 scope cut). Matches parse_color's own branch order: oklch(/oklab(/
// "transparent"/#/rgb(/rgba(/hsl(/hsla(. Deliberately does not replicate parse_color's inner
// per-branch validation (e.g. a "#12" of the wrong hex length also warns there, and a malformed
// numeric arg inside a recognized rgb()/hsl() silently defaults rather than warning) -- that's
// real but rare malformed-input territory this minimal gate doesn't chase.
fn is_recognized_color(raw: &str) -> bool {
    let s = raw.trim();
    s.starts_with("oklch(")
        || s.starts_with("oklab(")
        || s.eq_ignore_ascii_case("transparent")
        || s.starts_with('#')
        || s.starts_with("rgb(")
        || s.starts_with("rgba(")
        || s.starts_with("hsl(")
        || s.starts_with("hsla(")
}

// The exact CSS string Charter's own unparseable_marker() (visible magenta, never silent black)
// resolves to, computed via the same kit10_scene::OklabColor::from_srgb conversion and the same
// oklab() formatting css.rs already uses for Path A -- not a hand-copied literal, so it can never
// drift from what Charter/Vellum actually show for the identical unparseable input. Path A always
// reads the already-resolved (magenta-if-unparseable) color; without this, Path B's generic
// passthrough let a raw CSS named color like "red" (which parse_color doesn't recognize) render
// as real red in the export, diverging from the magenta Vellum/Path A would show for the same data
// (a real audited discrepancy, 2026-07-27).
fn unparseable_color_marker() -> String {
    crate::css::oklab_css(&OklabColor::from_srgb([1.0, 0.0, 1.0, 1.0]))
}

// Replicates Charter's compile_line_height (plugins/charter/src/lib.rs) exactly: a raw
// "line-height" is CSS-style dual-read -- a "px"-suffixed value is absolute, a bare number is a
// MULTIPLIER of the node's own resolved font-size (never a literal px, unlike every other diffable
// length) -- and an absent/unparseable raw value derives a ratio ramp: ~1.5x at body sizes (<=20px
// font-size), tightening to ~1.1x at display sizes (>=48px), linear in between. Without this,
// declarations_for's generic as_px_if_bare_number formatter reads a bare "1.5" as a literal
// 1.5px -- catastrophically cramped/overlapping lines in the export vs. Vellum's canvas (a real
// bug caught on a live audit: 2026-07-27). Mutates `properties` in place, replacing the raw
// (possibly-multiplier) value with the resolved absolute px number -- the existing "line-height"
// entry in DIFFABLE_PROPERTIES/format_value's as_px_if_bare_number formatting then applies "px" to
// this already-correct number, same as font-size/border-radius/gap. Text-only -- mirrors
// build_text_node, which is the only caller of compile_line_height in Charter; a Box never has
// this synthesized (see resolve_properties' is_box gate).
fn synthesize_line_height(properties: &mut HashMap<String, String>) {
    let font_size = properties
        .get("font-size")
        .map(|s| parse_px_like(s))
        .filter(|&v| v > 0.0)
        .unwrap_or(16.0);

    let raw_line_height = properties.get("line-height").cloned();
    let resolved = match raw_line_height.as_deref().map(str::trim) {
        Some(s) => match s.strip_suffix("px") {
            Some(px) => match px.trim().parse::<f32>() {
                Ok(v) => v,
                Err(_) => default_line_height(font_size),
            },
            None => match s.parse::<f32>() {
                Ok(mult) => font_size * mult,
                Err(_) => default_line_height(font_size),
            },
        },
        None => default_line_height(font_size),
    };

    properties.insert("line-height".to_string(), resolved.to_string());
}

fn default_line_height(font_size: f32) -> f32 {
    let t = ((font_size - 20.0) / (48.0 - 20.0)).clamp(0.0, 1.0);
    let ratio = 1.5 - t * (1.5 - 1.1);
    font_size * ratio
}

// The value an excluded axis collapses to: its own default_value if set to a real literal,
// otherwise its lowest-priority_index value. None if neither exists (an excluded axis with no
// values at all -- nothing to collapse to, so it's simply absent from the args map).
fn excluded_axis_value(axis: &AxisExportMeta) -> Option<String> {
    if let Some(dv) = &axis.default_value {
        if dv.kind == "literal" && !dv.value.is_empty() {
            return Some(dv.value.clone());
        }
    }
    axis.values.iter().min_by_key(|v| v.priority_index).map(|v| v.value.value.clone())
}

fn excluded_axis_args(shape: &KitExportShape) -> HashMap<String, String> {
    let mut args = HashMap::new();
    for axis in &shape.axes {
        if !axis.excluded_from_export {
            continue;
        }
        if let Some(value) = excluded_axis_value(axis) {
            args.insert(axis.axis_id.clone(), value);
        }
    }
    args
}

// Properties WebCodium can safely re-derive as a direct CSS declaration from a raw kit property
// string, with no Charter-side compilation -- see the module doc comment's v1 scope cut.
// Deliberately excludes "display" (see synthesize_base_declarations' doc comment) and
// "border-width" (synthesize_border merges it into "border" before this list is ever consulted --
// it never survives as its own key).
//
// grid-auto-rows/-columns and grid-column/-row (Grid's "Custom tracks" escape hatch) and
// flex-grow/flex-shrink/align-self (the item-level flex trio, no longer panel-exposed but still
// parsed by Charter as a literal raw-property escape hatch for legacy/imported data -- see
// build_box_node) were missing from this list entirely: a Kit-basis Grid item using them, or
// legacy raw flex data, got an inert "unsupported dynamic-compiled property" comment instead of
// the real declaration, even though css.rs's Path A already emits all of them unconditionally for
// non-Kit nodes (a real audited discrepancy, 2026-07-27). Their raw stored values are already
// valid CSS syntax as-is (parse_track_list/parse_grid_line/parse_px all consume plain CSS-like
// tokens), so the default format_value passthrough is correct -- no new formatter needed, same
// treatment grid-template-columns/rows above already get. "flex-basis" is deliberately NOT
// included -- unlike the other three, Charter never reads a raw "flex-basis" kit property at all
// (see build_box_node: it's hardcoded `None` until compile_resize's Fill mode sets it to
// `Px(0.0)` afterward); there is no raw property for Path B to diff, so whitelisting it would let
// a stray literal "flex-basis" leak into the export as a declaration Charter itself never honors
// -- the exact opposite of parity.
const DIFFABLE_PROPERTIES: &[&str] = &[
    "background",
    "color",
    "font-family",
    "font-size",
    "font-weight",
    "padding",
    "border",
    "border-radius",
    "opacity",
    "gap",
    "width",
    "height",
    "flex-direction",
    "align-items",
    "justify-content",
    "flex-wrap",
    "text-align",
    "text-decoration",
    "line-height",
    "grid-template-columns",
    "grid-template-rows",
    "grid-auto-rows",
    "grid-auto-columns",
    "grid-column",
    "grid-row",
    "flex-grow",
    "flex-shrink",
    "align-self",
    // Same "raw stored value is already valid CSS syntax as-is" reasoning as the grid-* keys
    // above, extended to the Grid-mastery expansion's 5 new BoxExtra fields: their raw property
    // strings (e.g. "\"a a\" \"b b\"", "column dense", "center", "space-between") are exactly what
    // real CSS expects verbatim, so the default format_value passthrough is correct here too.
    "grid-template-areas",
    "grid-auto-flow",
    "justify-items",
    "align-content",
    "justify-self",
];

// Charter's own raw-property parsers (parse_px et al.) treat a bare number as an implicit px
// value -- mirrored here so "16" formats as "16px", not the CSS-invalid bare "16".
fn as_px_if_bare_number(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.parse::<f64>().is_ok() {
        format!("{trimmed}px")
    } else {
        trimmed.to_string()
    }
}

// Formats one property's raw kit-authored value as a CSS value string. None for `width`/`height`
// set to Charter's own compiled `fill`/`hug` keywords -- those are compiled vocabulary, not a
// literal size, and must never reach here as a plain value (the caller checks DIFFABLE_PROPERTIES
// first, but fill/hug pass that check since "width"/"height" are themselves diffable -- only the
// keyword VALUE is compiled, so this is where that specific case is caught).
fn format_value(property: &str, raw: &str) -> Option<String> {
    match property {
        "width" | "height" => {
            if raw == "fill" || raw == "hug" {
                None
            } else {
                Some(as_px_if_bare_number(raw))
            }
        }
        "font-family" => Some(format!("\"{raw}\"")),
        "padding" => Some(raw.split_whitespace().map(as_px_if_bare_number).collect::<Vec<_>>().join(" ")),
        "font-size" | "border-radius" | "gap" | "line-height" => Some(as_px_if_bare_number(raw)),
        "font-weight" => Some(format_font_weight(raw)),
        // "border"'s own color is already gated inside synthesize_border before this is ever
        // reached (its raw value there is the full "{width}px solid {color}" shorthand, not a bare
        // color string) -- background/color are the two properties that still hold a bare,
        // possibly-unrecognized color string at this point.
        "background" | "color" => {
            Some(if is_recognized_color(raw) { raw.to_string() } else { unparseable_color_marker() })
        }
        _ => Some(raw.to_string()),
    }
}

// Charter's build_text_node parses font-weight via parse_px (numeric-or-px-suffixed only, same as
// every other length property) and falls back to 400 (CSS "normal") whenever that yields 0 -- a
// keyword like "bold" never parses as a number, so it silently reads as 400 on Vellum's canvas.
// Without this, WebCodium's generic passthrough formatted a raw "bold" verbatim, which the browser
// renders as real bold (700) -- diverging from what Vellum/Path A show for the identical data.
// Charter's further resolve_font_weight (snapping to the nearest weight the family's Fontavious
// facts actually have, e.g. 600 -> 700 on Lato) is deliberately NOT replicated here -- WebCodium's
// export pipeline has no family-facts input, same v1 scope cut as font suggestions elsewhere.
fn format_font_weight(raw: &str) -> String {
    let parsed = parse_px_like(raw);
    let weight = if parsed > 0.0 { parsed as u16 } else { 400 };
    weight.to_string()
}

// `token_vars` is consulted only for a property that ALSO passed format_value -- a fill/hug
// width/height (formats to None) has no declaration to emit at all regardless of token backing.
// background/color get an extra is_recognized_color(value) gate on top: if the token's own
// resolved value is genuinely unparseable, the marker-substitution safety net (format_value's own
// job) must still win -- silently hiding a broken color behind `var(--alias)` would mean the
// export renders it fine while Vellum shows the magenta warning for the identical bad data.
fn declarations_for_with_tokens(
    properties: &HashMap<String, String>,
    token_vars: &HashMap<String, String>,
    exclude: Option<&HashMap<String, String>>,
) -> Vec<String> {
    let mut declarations: Vec<String> = Vec::new();
    let mut entries: Vec<(&String, &String)> = properties.iter().collect();
    entries.sort_by_key(|(k, _)| k.as_str());

    for (property, value) in entries {
        if let Some(base) = exclude {
            if base.get(property) == Some(value) {
                continue; // unchanged from the base -- CSS cascade already covers it
            }
        }
        if !DIFFABLE_PROPERTIES.contains(&property.as_str()) {
            declarations.push(format!(
                "/* unsupported dynamic-compiled property: {property} (see webcodium-export-plan.md) */"
            ));
            continue;
        }
        let Some(formatted) = format_value(property, value) else { continue };

        let var_name = token_vars.get(property).filter(|_| match property.as_str() {
            "background" | "color" => is_recognized_color(value),
            _ => true,
        });
        match var_name {
            Some(name) => declarations.push(format!("{property}: var(--{name});")),
            None => declarations.push(format!("{property}: {formatted};")),
        }
    }
    declarations
}

// `display` is deliberately NEVER read as a literal raw property here, even though Charter does
// expose one via the arrangeKeys "Advanced flex" escape hatch (box_categories()) -- the
// overwhelmingly common case (a Kit authored through Stack/Cluster/Split/Center/Grid, never
// touching Advanced) never writes a raw "display" entry at all: Charter computes it purely from
// whether a grid-template is present (see css.rs::node_props' own `is_grid` check, which this
// mirrors). A raw kit property set that has a real `flex-direction`/`gap`/other flex-only
// property but no `display` at all is Charter's NORMAL, expected shape, not a data gap -- so
// `display` has to be computed here from the same grid-template-presence rule, or a Kit-basis
// box would render with `flex-direction` and no `display: flex` at all (a real, silently-broken
// bug this fixes: flex-direction is a no-op without a flex display mode).
fn box_display_declaration(properties: &HashMap<String, String>) -> String {
    let is_grid = properties.get("grid-template-columns").map(|v| !v.is_empty()).unwrap_or(false)
        || properties.get("grid-template-rows").map(|v| !v.is_empty()).unwrap_or(false);
    if is_grid { "display: grid;".to_string() } else { "display: flex;".to_string() }
}

// The Kit's own base declarations -- excluded axes collapsed to their default/lowest value,
// everything else at its unconditioned (null-layer) state. `is_box` is whether the node this
// Kit's rule is being synthesized for is a Box (a Text/Img-primitive Kit never needs a `display`
// declaration at all) -- see box_display_declaration's doc comment for why this can't just be
// diffed off the raw properties like everything else. `project_tokens` is the project-scope
// token table (see ProjectTokens' doc comment) -- a property backed by one of these tokens emits
// `var(--alias)` instead of the token's own resolved literal.
pub(crate) fn synthesize_base_declarations_with_tokens(
    shape: &KitExportShape,
    is_box: bool,
    project_tokens: &ProjectTokens,
) -> Vec<String> {
    let base_args = excluded_axis_args(shape);
    let (base, token_vars) = resolve_properties_with_tokens(shape, &base_args, is_box, project_tokens);
    let mut declarations = declarations_for_with_tokens(&base, &token_vars, None);
    if is_box {
        declarations.insert(0, box_display_declaration(&base));
    }
    declarations
}

pub(crate) struct VariantRule {
    // STATIC (dynamic == false): one axis-prefixed BEM fragment per contributing condition, e.g.
    // ["--theme-secondary"] (single condition) or ["--plan-elite", "--theme-dark"] (a layer
    // conditioned on two axes together, chained). Rendered by css.rs as `.{class}` repeated once
    // per fragment (a compound selector), never as one fused/concatenated string -- see
    // css.rs::variant_rule_selector.
    //
    // DYNAMIC (dynamic == true): always exactly one entry -- a real pseudo-class (":hover") or a
    // ".is-{value}" JS-toggle fallback. Rendered as a direct `.{class}{suffix}` concatenation, no
    // repeated base token. A multi-condition layer never produces dynamic == true in this pass
    // (see synthesize_variant_rules_with_tokens's doc comment) -- dynamic is only ever reachable
    // via a single-condition layer, unchanged from before multi-condition support existed.
    pub suffixes: Vec<String>,
    pub dynamic: bool,
    pub declarations: Vec<String>,
    // The exact conditions these suffixes were derived from (post excluded-axis filtering), same
    // order as `suffixes`. Not consumed by anything in this file -- exists so a caller can test
    // "does this rule apply to some node instance's own resolved axis args" (see
    // rule_matches_args) without re-deriving anything from the shape.
    pub conditions: Vec<ExportLayerCondition>,
}

fn dynamic_selector_suffix(value: &str) -> String {
    match value.to_lowercase().as_str() {
        "hover" => ":hover".to_string(),
        "focus" => ":focus".to_string(),
        "focus-within" | "focuswithin" => ":focus-within".to_string(),
        "focus-visible" | "focusvisible" => ":focus-visible".to_string(),
        "active" => ":active".to_string(),
        "visited" => ":visited".to_string(),
        "checked" => ":checked".to_string(),
        "disabled" => ":disabled".to_string(),
        _ => format!(".is-{}", kit_class_name(value)),
    }
}

// Axis-name-prefixed static BEM fragment for ONE layer condition: "--{axis-slug}-{value-slug}".
// Axis-prefixed (not the bare "--{value}" this used to be) so two different axes with same-named
// values (a "plan" axis's "elite" and an unrelated "tier" axis's "elite") never collide on the
// same modifier class. Falls back to the axis's own id when axis_name is unset/empty -- axis_id is
// always present even when a human-readable name isn't. Reuses kit_class_name for both halves so
// this can never drift from how the Kit's own class name / the dynamic .is-{value} fallback are
// slugified.
fn static_condition_fragment(axis: &AxisExportMeta, value: &str) -> String {
    let axis_slug = axis
        .axis_name
        .as_deref()
        .map(kit_class_name)
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| kit_class_name(&axis.axis_id));
    format!("--{axis_slug}-{}", kit_class_name(value))
}

// Does this rule's own conditions ALL hold against a node instance's resolved axis args? Reuses
// the exact same equality-match semantics as matches_condition, just against a plain
// String->String args map instead of the full ExportLayerCondition machinery, since VariantRule
// already carries its own resolved condition list.
pub(crate) fn rule_matches_args(rule: &VariantRule, args: &HashMap<String, String>) -> bool {
    !rule.conditions.is_empty()
        && rule.conditions.iter().all(|c| args.get(&c.axis_id) == Some(&c.value.value))
}

// One VariantRule per LAYER with at least one non-excluded, literal/discrete condition, holding
// only the delta against the Kit's own base declarations. A layer conditioned on more than one
// axis together (e.g. {plan: elite, theme: dark}) gets its own combined rule -- a compound
// selector chaining one static BEM fragment per condition (see VariantRule's doc comment) -- this
// used to be invisible entirely (v1 originally only ever walked one axis value at a time, never a
// layer's actual condition set). "Assume everything is static for now": a multi-condition layer
// ALWAYS produces a static chain regardless of any contributing axis's own variant_kind -- mixing
// several dynamic pseudo-classes into one compound selector isn't a coherent concept and is out of
// scope here. Only a layer with exactly one (post-filter) condition on a `variant_kind: "dynamic"`
// axis still takes the pseudo-class/`.is-` path, exactly as before.
//
// Empty declarations (the variant matches the base exactly) are skipped entirely -- no reason to
// emit an empty ruleset. `is_box` -- see synthesize_base_declarations/synthesize_arrange's doc
// comments. `project_tokens` -- see synthesize_base_declarations_with_tokens.
pub(crate) fn synthesize_variant_rules_with_tokens(
    shape: &KitExportShape,
    is_box: bool,
    project_tokens: &ProjectTokens,
) -> Vec<VariantRule> {
    let base_args = excluded_axis_args(shape);
    let (base, _) = resolve_properties_with_tokens(shape, &base_args, is_box, project_tokens);
    let axes_by_id: HashMap<&str, &AxisExportMeta> =
        shape.axes.iter().map(|a| (a.axis_id.as_str(), a)).collect();

    let mut rules = Vec::new();
    let mut seen_condition_sets: HashSet<Vec<(String, String)>> = HashSet::new();

    for layer in &shape.layers {
        if layer.conditions.is_empty() {
            continue; // the null/base layer -- already folded into `base` above
        }
        if layer.conditions.iter().any(|c| c.value.kind != "literal" && c.value.kind != "discrete") {
            continue; // range condition -- v1 scope cut, see module doc comment
        }

        // Drop no-op conditions on excluded axes (already baked into base_args); bail on the
        // whole layer if an excluded axis's condition value isn't that axis's own collapsed
        // default -- it can never fire for this export's pinned excluded-axis state.
        let mut relevant: Vec<&ExportLayerCondition> = Vec::new();
        let mut skip_layer = false;
        for cond in &layer.conditions {
            let Some(axis) = axes_by_id.get(cond.axis_id.as_str()) else {
                skip_layer = true; // defensive: condition on an axis this Kit doesn't consume
                break;
            };
            if axis.excluded_from_export {
                if excluded_axis_value(axis).as_deref() != Some(cond.value.value.as_str()) {
                    skip_layer = true;
                    break;
                }
                continue; // no-op, drop from the fragment list
            }
            relevant.push(cond);
        }
        if skip_layer || relevant.is_empty() {
            continue;
        }

        // Determinism: a layer's condition row order isn't guaranteed by the DB query that builds
        // it, so sort by axis_id -- the same underlying data must always render the same selector
        // text, mirroring resolve.ts's matchLayers doing exactly this for exactly this reason.
        relevant.sort_by(|a, b| a.axis_id.cmp(&b.axis_id));

        let mut key: Vec<(String, String)> =
            relevant.iter().map(|c| (c.axis_id.clone(), c.value.value.clone())).collect();
        key.sort();
        if !seen_condition_sets.insert(key) {
            continue; // defensive: two distinct layers sharing one condition set would otherwise
                       // emit two textually-identical rules
        }

        let mut variant_args = base_args.clone();
        for cond in &relevant {
            variant_args.insert(cond.axis_id.clone(), cond.value.value.clone());
        }
        let (variant, variant_token_vars) =
            resolve_properties_with_tokens(shape, &variant_args, is_box, project_tokens);
        let declarations = declarations_for_with_tokens(&variant, &variant_token_vars, Some(&base));
        if declarations.is_empty() {
            continue;
        }

        let (suffixes, dynamic) = if relevant.len() == 1 {
            let cond = relevant[0];
            let axis = axes_by_id[cond.axis_id.as_str()];
            if axis.variant_kind == "dynamic" {
                (vec![dynamic_selector_suffix(&cond.value.value)], true)
            } else {
                (vec![static_condition_fragment(axis, &cond.value.value)], false)
            }
        } else {
            let frags = relevant
                .iter()
                .map(|c| static_condition_fragment(axes_by_id[c.axis_id.as_str()], &c.value.value))
                .collect();
            (frags, false)
        };

        rules.push(VariantRule {
            suffixes,
            dynamic,
            declarations,
            conditions: relevant.into_iter().cloned().collect(),
        });
    }
    rules
}

// Emits a `:root { --alias: value; }` block for every fetched PROJECT-scope scalar token,
// regardless of whether anything in this export actually references it -- the same "declare the
// whole design-token surface, not just what happens to be used on this page" posture a real
// design system's generated custom-property sheet would have. A token with no alias is skipped
// (nothing for a var() reference to name it by); a name collision after css_var_name's
// sanitization (two different aliases sanitizing to the same string) gets a numeric suffix so
// every declared variable stays addressable.
pub(crate) fn render_root_variables(tokens: &ProjectTokens) -> String {
    let mut entries: Vec<&ProjectToken> = tokens.values().filter(|t| !t.alias.is_empty()).collect();
    if entries.is_empty() {
        return String::new();
    }
    entries.sort_by(|a, b| a.alias.cmp(&b.alias));

    let mut seen_names: HashSet<String> = HashSet::new();
    let mut lines = Vec::new();
    for token in entries {
        let base_name = css_var_name(&token.alias);
        let mut name = base_name.clone();
        let mut suffix = 2;
        while !seen_names.insert(name.clone()) {
            name = format!("{base_name}-{suffix}");
            suffix += 1;
        }
        let value = format_token_root_value(token.format.as_deref(), &token.value);
        lines.push(format!("  --{name}: {value};"));
    }
    format!(":root {{\n{}\n}}\n\n", lines.join("\n"))
}

// Mirrors format_value's own per-kind formatting, but dispatched off the TOKEN's declared
// `format` hint (TokenValueScalar.format, schema.ts) rather than a consuming property's name --
// a project token isn't tied to any single property, so there's no "{property}" to key off here.
// Unknown/absent format passes the raw value through unchanged (matches format_value's own `_ =>`
// fallback).
fn format_token_root_value(format: Option<&str>, raw: &str) -> String {
    match format {
        Some("color") => {
            if is_recognized_color(raw) { raw.to_string() } else { unparseable_color_marker() }
        }
        Some("size") | Some("font-size") => as_px_if_bare_number(raw),
        Some("font-weight") => format_font_weight(raw),
        _ => raw.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn literal(value: &str) -> AxisValueWire {
        AxisValueWire { kind: "literal".to_string(), value: value.to_string() }
    }

    fn literal_entry(property: &str, value: &str) -> ExportLayerEntry {
        ExportLayerEntry {
            property: property.to_string(),
            literal_value: Some(value.to_string()),
            token_value: None,
            token_id: None,
        }
    }

    fn condition(axis_id: &str, value: &str) -> ExportLayerCondition {
        ExportLayerCondition { axis_id: axis_id.to_string(), axis_value_id: String::new(), value: literal(value) }
    }

    // The worked example from resources/webcodium-export-plan.md: Button with a static `theme`
    // axis (primary/secondary, default primary) and a dynamic `state` axis (hover).
    fn button_shape() -> KitExportShape {
        KitExportShape {
            kit_id: "button".to_string(),
            kit_name: "Button".to_string(),
            axes: vec![
                AxisExportMeta {
                    axis_id: "theme".to_string(),
                    axis_name: Some("theme".to_string()),
                    kind: Some("categorical".to_string()),
                    variant_kind: "static".to_string(),
                    excluded_from_export: false,
                    default_value: Some(literal("primary")),
                    priority_index: 0,
                    values: vec![
                        ExportAxisValue { axis_value_id: "v1".to_string(), value: literal("primary"), priority_index: 0 },
                        ExportAxisValue { axis_value_id: "v2".to_string(), value: literal("secondary"), priority_index: 1000 },
                    ],
                },
                AxisExportMeta {
                    axis_id: "state".to_string(),
                    axis_name: Some("state".to_string()),
                    kind: Some("categorical".to_string()),
                    variant_kind: "dynamic".to_string(),
                    excluded_from_export: false,
                    default_value: None,
                    priority_index: 1000,
                    values: vec![ExportAxisValue {
                        axis_value_id: "v3".to_string(),
                        value: literal("hover"),
                        priority_index: 0,
                    }],
                },
            ],
            layers: vec![
                ExportLayer {
                    layer_id: "base".to_string(),
                    conditions: vec![],
                    entries: vec![literal_entry("background", "oklab(60% 0.1 0.02 / 1)")],
                },
                ExportLayer {
                    layer_id: "secondary".to_string(),
                    conditions: vec![condition("theme", "secondary")],
                    entries: vec![literal_entry("background", "oklab(40% 0.05 -0.01 / 1)")],
                },
                ExportLayer {
                    layer_id: "hover".to_string(),
                    conditions: vec![condition("state", "hover")],
                    entries: vec![literal_entry("background", "oklab(65% 0.1 0.02 / 1)")],
                },
            ],
        }
    }

    #[test]
    fn base_declarations_come_from_the_null_layer() {
        let shape = button_shape();
        let base = synthesize_base_declarations_with_tokens(&shape, true, &ProjectTokens::new());
        assert_eq!(
            base,
            vec![
                "display: flex;".to_string(),
                "background: oklab(60% 0.1 0.02 / 1);".to_string(),
                "flex-direction: column;".to_string()
            ]
        );
    }

    #[test]
    fn static_axis_value_produces_a_bem_modifier_with_only_the_delta() {
        let shape = button_shape();
        let rules = synthesize_variant_rules_with_tokens(&shape, true, &ProjectTokens::new());
        let secondary = rules.iter().find(|r| r.suffixes == vec!["--theme-secondary"]).unwrap();
        assert!(!secondary.dynamic);
        assert_eq!(secondary.declarations, vec!["background: oklab(40% 0.05 -0.01 / 1);".to_string()]);
    }

    #[test]
    fn dynamic_axis_value_with_a_recognized_name_produces_a_real_pseudo_class() {
        let shape = button_shape();
        let rules = synthesize_variant_rules_with_tokens(&shape, true, &ProjectTokens::new());
        let hover = rules.iter().find(|r| r.dynamic).unwrap();
        assert_eq!(hover.suffixes, vec![":hover".to_string()]);
        assert_eq!(hover.declarations, vec!["background: oklab(65% 0.1 0.02 / 1);".to_string()]);
    }

    #[test]
    fn dynamic_axis_value_with_an_unrecognized_name_falls_back_to_an_is_class() {
        assert_eq!(dynamic_selector_suffix("loading"), ".is-loading");
        assert_eq!(dynamic_selector_suffix("Hover"), ":hover", "recognized names match case-insensitively");
    }

    #[test]
    fn excluded_axis_produces_no_variant_rule_and_its_default_value_wins_the_base() {
        let mut shape = button_shape();
        shape.axes[1].excluded_from_export = true; // exclude `state`
        // A layer conditioned on the excluded axis's own default (none set -- falls back to its
        // lowest-priority value, "hover", the only value it has) should still fold into the base.
        let rules = synthesize_variant_rules_with_tokens(&shape, true, &ProjectTokens::new());
        assert!(
            rules.iter().all(|r| !r.dynamic),
            "an excluded axis must not produce a variant rule for any of its values"
        );
        let base = synthesize_base_declarations_with_tokens(&shape, true, &ProjectTokens::new());
        assert_eq!(
            base,
            vec![
                "display: flex;".to_string(),
                "background: oklab(65% 0.1 0.02 / 1);".to_string(),
                "flex-direction: column;".to_string()
            ],
            "excluded axis collapses into the base using its lowest-priority value (no default_value set)"
        );
    }

    fn two_axis_shape() -> KitExportShape {
        KitExportShape {
            kit_id: "button".to_string(),
            kit_name: "Button".to_string(),
            axes: vec![
                AxisExportMeta {
                    axis_id: "theme".to_string(),
                    axis_name: Some("theme".to_string()),
                    kind: Some("categorical".to_string()),
                    variant_kind: "static".to_string(),
                    excluded_from_export: false,
                    default_value: Some(literal("primary")),
                    priority_index: 0,
                    values: vec![
                        ExportAxisValue { axis_value_id: "v1".to_string(), value: literal("primary"), priority_index: 0 },
                        ExportAxisValue { axis_value_id: "v2".to_string(), value: literal("secondary"), priority_index: 1000 },
                    ],
                },
                AxisExportMeta {
                    axis_id: "plan".to_string(),
                    axis_name: Some("plan".to_string()),
                    kind: Some("categorical".to_string()),
                    variant_kind: "static".to_string(),
                    excluded_from_export: false,
                    default_value: Some(literal("basic")),
                    priority_index: 1000,
                    values: vec![
                        ExportAxisValue { axis_value_id: "v3".to_string(), value: literal("basic"), priority_index: 0 },
                        ExportAxisValue { axis_value_id: "v4".to_string(), value: literal("elite"), priority_index: 1000 },
                    ],
                },
            ],
            layers: vec![
                ExportLayer {
                    layer_id: "base".to_string(),
                    conditions: vec![],
                    entries: vec![literal_entry("background", "oklab(60% 0.1 0.02 / 1)")],
                },
                ExportLayer {
                    layer_id: "secondary-elite".to_string(),
                    conditions: vec![condition("theme", "secondary"), condition("plan", "elite")],
                    entries: vec![literal_entry("background", "oklab(20% 0.1 0.02 / 1)")],
                },
            ],
        }
    }

    #[test]
    fn multi_condition_layer_produces_a_chained_compound_selector_of_axis_prefixed_fragments() {
        let shape = two_axis_shape();
        let rules = synthesize_variant_rules_with_tokens(&shape, true, &ProjectTokens::new());
        let combo = rules.iter().find(|r| r.suffixes.len() == 2).unwrap();
        assert!(!combo.dynamic);
        // Sorted by axis_id ("plan" < "theme") for deterministic selector text regardless of DB
        // condition row order.
        assert_eq!(combo.suffixes, vec!["--plan-elite".to_string(), "--theme-secondary".to_string()]);
        assert_eq!(combo.conditions.len(), 2);
        assert_eq!(combo.declarations, vec!["background: oklab(20% 0.1 0.02 / 1);".to_string()]);
    }

    #[test]
    fn single_condition_dynamic_layer_still_produces_a_bare_pseudo_class_suffix_not_a_chain() {
        let shape = button_shape();
        let rules = synthesize_variant_rules_with_tokens(&shape, true, &ProjectTokens::new());
        let hover = rules.iter().find(|r| r.dynamic).unwrap();
        assert_eq!(hover.suffixes.len(), 1);
        assert_eq!(hover.suffixes, vec![":hover".to_string()]);
    }

    #[test]
    fn a_layer_mixing_an_excluded_axis_no_op_condition_with_a_real_condition_still_gets_single_condition_treatment() {
        let mut shape = button_shape();
        shape.axes[1].excluded_from_export = true; // exclude `state`, default-collapses to "hover"
        shape.layers.push(ExportLayer {
            layer_id: "secondary-hover".to_string(),
            // "state: hover" is a no-op here (matches the excluded axis's own collapsed default),
            // so this must behave exactly like a plain single-condition {theme: secondary} layer.
            conditions: vec![condition("theme", "secondary"), condition("state", "hover")],
            entries: vec![literal_entry("background", "oklab(10% 0.1 0.02 / 1)")],
        });
        let rules = synthesize_variant_rules_with_tokens(&shape, true, &ProjectTokens::new());
        let matched = rules
            .iter()
            .find(|r| r.declarations == vec!["background: oklab(10% 0.1 0.02 / 1);".to_string()])
            .unwrap();
        assert_eq!(matched.conditions.len(), 1, "the no-op excluded-axis condition must be dropped");
        assert!(!matched.dynamic);
        assert_eq!(matched.suffixes, vec!["--theme-secondary".to_string()]);
    }

    #[test]
    fn a_layer_conditioned_on_an_excluded_axiss_non_default_value_is_never_matched() {
        let mut shape = button_shape();
        shape.axes[1].excluded_from_export = true; // exclude `state`, collapses to "hover"
        shape.layers.push(ExportLayer {
            layer_id: "secondary-focus".to_string(),
            // "state: focus" is NOT the excluded axis's collapsed default ("hover") -- can never
            // fire for this export's pinned excluded-axis state, so the WHOLE layer is dropped.
            conditions: vec![condition("theme", "secondary"), condition("state", "focus")],
            entries: vec![literal_entry("background", "oklab(5% 0.1 0.02 / 1)")],
        });
        let rules = synthesize_variant_rules_with_tokens(&shape, true, &ProjectTokens::new());
        assert!(
            rules.iter().all(|r| r.declarations != vec!["background: oklab(5% 0.1 0.02 / 1);".to_string()]),
            "a layer pinned to an excluded axis's non-default value must never produce a rule"
        );
    }

    #[test]
    fn rule_matches_args_true_when_every_condition_holds_false_otherwise() {
        let rule = VariantRule {
            suffixes: vec!["--plan-elite".to_string(), "--theme-secondary".to_string()],
            dynamic: false,
            declarations: vec![],
            conditions: vec![condition("plan", "elite"), condition("theme", "secondary")],
        };
        let matching =
            HashMap::from([("plan".to_string(), "elite".to_string()), ("theme".to_string(), "secondary".to_string())]);
        assert!(rule_matches_args(&rule, &matching));

        let partial = HashMap::from([("plan".to_string(), "elite".to_string())]);
        assert!(!rule_matches_args(&rule, &partial), "must require EVERY condition, not just one");

        let wrong_value = HashMap::from([
            ("plan".to_string(), "basic".to_string()),
            ("theme".to_string(), "secondary".to_string()),
        ]);
        assert!(!rule_matches_args(&rule, &wrong_value));

        let empty_rule = VariantRule { suffixes: vec![], dynamic: false, declarations: vec![], conditions: vec![] };
        assert!(
            !rule_matches_args(&empty_rule, &matching),
            "a rule with no conditions must never claim to match"
        );
    }

    #[test]
    fn box_gets_display_flex_by_default_and_display_grid_when_a_grid_template_is_set() {
        let shape = KitExportShape {
            kit_id: "card".to_string(),
            kit_name: "Card".to_string(),
            axes: vec![],
            layers: vec![ExportLayer {
                layer_id: "base".to_string(),
                conditions: vec![],
                entries: vec![literal_entry("flex-direction", "row")],
            }],
        };
        let base = synthesize_base_declarations_with_tokens(&shape, true, &ProjectTokens::new());
        assert!(base.contains(&"display: flex;".to_string()), "base was: {:?}", base);
        assert!(base.contains(&"flex-direction: row;".to_string()));

        let mut grid_shape = shape.clone();
        grid_shape.layers[0].entries.push(literal_entry("grid-template-columns", "200px 1fr"));
        let grid_base = synthesize_base_declarations_with_tokens(&grid_shape, true, &ProjectTokens::new());
        assert!(grid_base.contains(&"display: grid;".to_string()), "base was: {:?}", grid_base);
        assert!(!grid_base.contains(&"display: flex;".to_string()));
    }

    #[test]
    fn a_non_box_kit_never_gets_a_display_declaration() {
        let shape = KitExportShape {
            kit_id: "label".to_string(),
            kit_name: "Label".to_string(),
            axes: vec![],
            layers: vec![ExportLayer {
                layer_id: "base".to_string(),
                conditions: vec![],
                entries: vec![literal_entry("color", "#111111")],
            }],
        };
        let base = synthesize_base_declarations_with_tokens(&shape, false, &ProjectTokens::new());
        assert!(!base.iter().any(|d| d.starts_with("display:")));
    }

    #[test]
    fn border_color_alone_gets_an_implicit_1px_solid_width_and_style() {
        // "border: <color>;" alone is syntactically valid CSS but leaves border-style at its
        // "none" initial value -- no border ever actually renders. Charter's own default (used
        // whenever a border color is set with no explicit width) is 1px, mirrored here.
        let shape = KitExportShape {
            kit_id: "card".to_string(),
            kit_name: "Card".to_string(),
            axes: vec![],
            layers: vec![ExportLayer {
                layer_id: "base".to_string(),
                conditions: vec![],
                entries: vec![literal_entry("border", "#000000")],
            }],
        };
        let base = synthesize_base_declarations_with_tokens(&shape, false, &ProjectTokens::new());
        // is_box=false also synthesizes the default ratio-ramp line-height (no font-size set -> 16px
        // default -> 24px) -- see synthesize_line_height's own tests for that logic in isolation.
        assert_eq!(
            base,
            vec!["border: 1px solid #000000;".to_string(), "line-height: 24px;".to_string()]
        );
    }

    #[test]
    fn squircle_radius_property_scales_border_radius_and_is_consumed() {
        let shape = KitExportShape {
            kit_id: "card".to_string(),
            kit_name: "Card".to_string(),
            axes: vec![],
            layers: vec![ExportLayer {
                layer_id: "base".to_string(),
                conditions: vec![],
                entries: vec![
                    literal_entry("border-radius", "20px"),
                    literal_entry("border-radius-squircle", "1"),
                ],
            }],
        };
        let base = synthesize_base_declarations_with_tokens(&shape, true, &ProjectTokens::new());
        // Same worked example as css.rs's Path A test: 20 * 0.58306 = 11.6612 -> rounds to 12,
        // and the boolean companion key must never surface as its own declaration.
        assert!(base.contains(&"border-radius: 12px;".to_string()), "declarations were: {:?}", base);
        assert!(!base.iter().any(|d| d.starts_with("border-radius-squircle")));
    }

    #[test]
    fn non_squircle_border_radius_passes_through_literally() {
        let shape = KitExportShape {
            kit_id: "card".to_string(),
            kit_name: "Card".to_string(),
            axes: vec![],
            layers: vec![ExportLayer {
                layer_id: "base".to_string(),
                conditions: vec![],
                entries: vec![literal_entry("border-radius", "20px")],
            }],
        };
        let base = synthesize_base_declarations_with_tokens(&shape, true, &ProjectTokens::new());
        assert!(base.contains(&"border-radius: 20px;".to_string()), "declarations were: {:?}", base);
    }

    #[test]
    fn border_with_an_explicit_width_uses_it_instead_of_the_1px_default() {
        let shape = KitExportShape {
            kit_id: "card".to_string(),
            kit_name: "Card".to_string(),
            axes: vec![],
            layers: vec![ExportLayer {
                layer_id: "base".to_string(),
                conditions: vec![],
                entries: vec![literal_entry("border", "#000000"), literal_entry("border-width", "3")],
            }],
        };
        let base = synthesize_base_declarations_with_tokens(&shape, false, &ProjectTokens::new());
        assert_eq!(
            base,
            vec!["border: 3px solid #000000;".to_string(), "line-height: 24px;".to_string()]
        );
    }

    #[test]
    fn no_border_color_produces_no_border_declaration_even_with_an_explicit_width() {
        let shape = KitExportShape {
            kit_id: "card".to_string(),
            kit_name: "Card".to_string(),
            axes: vec![],
            layers: vec![ExportLayer {
                layer_id: "base".to_string(),
                conditions: vec![],
                entries: vec![literal_entry("border-width", "3")],
            }],
        };
        let base = synthesize_base_declarations_with_tokens(&shape, false, &ProjectTokens::new());
        assert_eq!(
            base,
            vec!["line-height: 24px;".to_string()],
            "no border color set -- border-width alone must produce nothing: {:?}",
            base
        );
    }

    #[test]
    fn border_none_produces_no_border_declaration() {
        let shape = KitExportShape {
            kit_id: "card".to_string(),
            kit_name: "Card".to_string(),
            axes: vec![],
            layers: vec![ExportLayer {
                layer_id: "base".to_string(),
                conditions: vec![],
                entries: vec![literal_entry("border", "none")],
            }],
        };
        let base = synthesize_base_declarations_with_tokens(&shape, false, &ProjectTokens::new());
        assert_eq!(base, vec!["line-height: 24px;".to_string()]);
    }

    #[test]
    fn bare_number_line_height_is_a_multiplier_of_font_size_not_a_literal_px() {
        // The reported bug: "1.5" used to format as "line-height: 1.5px;" (catastrophically
        // cramped), when Charter treats a bare number as font_size * 1.5.
        let shape = KitExportShape {
            kit_id: "label".to_string(),
            kit_name: "Label".to_string(),
            axes: vec![],
            layers: vec![ExportLayer {
                layer_id: "base".to_string(),
                conditions: vec![],
                entries: vec![
                    literal_entry("font-size", "20"),
                    literal_entry("line-height", "1.5"),
                ],
            }],
        };
        let base = synthesize_base_declarations_with_tokens(&shape, false, &ProjectTokens::new());
        assert!(
            base.contains(&"line-height: 30px;".to_string()),
            "expected font_size(20) * 1.5 = 30px, got {:?}",
            base
        );
    }

    #[test]
    fn px_suffixed_line_height_is_absolute_regardless_of_font_size() {
        let shape = KitExportShape {
            kit_id: "label".to_string(),
            kit_name: "Label".to_string(),
            axes: vec![],
            layers: vec![ExportLayer {
                layer_id: "base".to_string(),
                conditions: vec![],
                entries: vec![
                    literal_entry("font-size", "20"),
                    literal_entry("line-height", "40px"),
                ],
            }],
        };
        let base = synthesize_base_declarations_with_tokens(&shape, false, &ProjectTokens::new());
        assert!(base.contains(&"line-height: 40px;".to_string()), "{:?}", base);
    }

    #[test]
    fn unset_line_height_derives_the_ratio_ramp_default_at_body_size() {
        // font-size <= 20px -> the ramp is pinned at its 1.5x ceiling.
        let shape = KitExportShape {
            kit_id: "label".to_string(),
            kit_name: "Label".to_string(),
            axes: vec![],
            layers: vec![ExportLayer {
                layer_id: "base".to_string(),
                conditions: vec![],
                entries: vec![literal_entry("font-size", "16")],
            }],
        };
        let base = synthesize_base_declarations_with_tokens(&shape, false, &ProjectTokens::new());
        assert!(base.contains(&"line-height: 24px;".to_string()), "16 * 1.5 = 24: {:?}", base);
    }

    #[test]
    fn unset_line_height_derives_the_ratio_ramp_default_at_display_size() {
        // font-size >= 48px -> the ramp is pinned at its 1.1x floor.
        let shape = KitExportShape {
            kit_id: "heading".to_string(),
            kit_name: "Heading".to_string(),
            axes: vec![],
            layers: vec![ExportLayer {
                layer_id: "base".to_string(),
                conditions: vec![],
                entries: vec![literal_entry("font-size", "48")],
            }],
        };
        let base = synthesize_base_declarations_with_tokens(&shape, false, &ProjectTokens::new());
        let line_height = base
            .iter()
            .find_map(|d| d.strip_prefix("line-height: ").and_then(|v| v.strip_suffix("px;")))
            .and_then(|v| v.parse::<f32>().ok())
            .unwrap_or_else(|| panic!("no line-height declaration found: {:?}", base));
        // 48 * 1.1, computed in f32 -- not exactly 52.8 (1.1 isn't exactly representable).
        assert!((line_height - 52.8).abs() < 0.01, "48 * 1.1 ~= 52.8, got {line_height}: {:?}", base);
    }

    #[test]
    fn box_kits_never_get_a_synthesized_line_height() {
        // is_box=true -- mirrors build_text_node being the only caller of compile_line_height.
        let shape = KitExportShape {
            kit_id: "card".to_string(),
            kit_name: "Card".to_string(),
            axes: vec![],
            layers: vec![ExportLayer {
                layer_id: "base".to_string(),
                conditions: vec![],
                entries: vec![literal_entry("font-size", "16")],
            }],
        };
        let base = synthesize_base_declarations_with_tokens(&shape, true, &ProjectTokens::new());
        assert!(base.iter().all(|d| !d.contains("line-height")), "{:?}", base);
    }

    #[test]
    fn recognized_background_color_passes_through_unchanged() {
        let shape = KitExportShape {
            kit_id: "card".to_string(),
            kit_name: "Card".to_string(),
            axes: vec![],
            layers: vec![ExportLayer {
                layer_id: "base".to_string(),
                conditions: vec![],
                entries: vec![literal_entry("background", "oklch(50% 0.1 200)")],
            }],
        };
        let base = synthesize_base_declarations_with_tokens(&shape, false, &ProjectTokens::new());
        assert!(base.contains(&"background: oklch(50% 0.1 200);".to_string()), "{:?}", base);
    }

    #[test]
    fn unrecognized_named_color_becomes_the_same_magenta_marker_charter_would_show() {
        // "red" is a real CSS named color the browser understands, but Charter's parse_color does
        // NOT recognize named colors at all -- it warns and substitutes a visible magenta marker.
        // Passing "red" straight through would render real red in the export while Vellum/Path A
        // show magenta for the identical unparseable data.
        let shape = KitExportShape {
            kit_id: "card".to_string(),
            kit_name: "Card".to_string(),
            axes: vec![],
            layers: vec![ExportLayer {
                layer_id: "base".to_string(),
                conditions: vec![],
                entries: vec![literal_entry("color", "red")],
            }],
        };
        let base = synthesize_base_declarations_with_tokens(&shape, false, &ProjectTokens::new());
        let expected = format!("color: {};", unparseable_color_marker());
        assert!(base.contains(&expected), "expected {:?}, got {:?}", expected, base);
        assert!(!base.iter().any(|d| d.contains("red")), "{:?}", base);
    }

    #[test]
    fn unrecognized_border_color_substitutes_the_marker_inside_the_shorthand() {
        let shape = KitExportShape {
            kit_id: "card".to_string(),
            kit_name: "Card".to_string(),
            axes: vec![],
            layers: vec![ExportLayer {
                layer_id: "base".to_string(),
                conditions: vec![],
                entries: vec![literal_entry("border", "cornflowerblue")],
            }],
        };
        let base = synthesize_base_declarations_with_tokens(&shape, false, &ProjectTokens::new());
        let expected = format!("border: 1px solid {};", unparseable_color_marker());
        assert!(base.contains(&expected), "expected {:?}, got {:?}", expected, base);
        assert!(!base.iter().any(|d| d.contains("cornflowerblue")), "{:?}", base);
    }

    #[test]
    fn a_variant_that_only_changes_border_color_recomputes_the_whole_shorthand() {
        let shape = KitExportShape {
            kit_id: "card".to_string(),
            kit_name: "Card".to_string(),
            axes: vec![AxisExportMeta {
                axis_id: "theme".to_string(),
                axis_name: Some("theme".to_string()),
                kind: Some("categorical".to_string()),
                variant_kind: "static".to_string(),
                excluded_from_export: false,
                default_value: None,
                priority_index: 0,
                values: vec![ExportAxisValue {
                    axis_value_id: "v1".to_string(),
                    value: literal("danger"),
                    priority_index: 0,
                }],
            }],
            layers: vec![
                ExportLayer {
                    layer_id: "base".to_string(),
                    conditions: vec![],
                    entries: vec![literal_entry("border", "#000000"), literal_entry("border-width", "2")],
                },
                ExportLayer {
                    layer_id: "danger".to_string(),
                    conditions: vec![condition("theme", "danger")],
                    entries: vec![literal_entry("border", "#ff0000")],
                },
            ],
        };
        let rules = synthesize_variant_rules_with_tokens(&shape, true, &ProjectTokens::new());
        let danger = rules.iter().find(|r| r.suffixes == vec!["--theme-danger"]).unwrap();
        // The variant only overrode "border" (color), not "border-width" -- but since border is
        // one atomic shorthand, the recomputed value still carries the base's 2px width, not the
        // 1px-if-unset default.
        assert_eq!(danger.declarations, vec!["border: 2px solid #ff0000;".to_string()]);
    }

    #[test]
    fn compiled_property_is_skipped_with_an_explicit_comment_not_silently_wrong() {
        // "arrange" itself is now fully synthesized (see synthesize_arrange), and align-self is
        // now a real diffable property too (see DIFFABLE_PROPERTIES' doc comment) -- flex-basis is
        // the genuine still-unsupported item-level flex property (Charter never reads it as a raw
        // kit property at all; it's exclusively a compile_resize output) to exercise the "skip
        // with a comment, don't guess" path.
        let mut shape = button_shape();
        shape.layers.push(ExportLayer {
            layer_id: "flex-basis-layer".to_string(),
            conditions: vec![condition("theme", "secondary")],
            entries: vec![literal_entry("flex-basis", "0")],
        });
        let rules = synthesize_variant_rules_with_tokens(&shape, true, &ProjectTokens::new());
        let secondary = rules.iter().find(|r| r.suffixes == vec!["--theme-secondary"]).unwrap();
        assert!(
            secondary
                .declarations
                .iter()
                .any(|d| d.contains("unsupported dynamic-compiled property: flex-basis")),
            "declarations were: {:?}",
            secondary.declarations
        );
        assert!(!secondary.declarations.iter().any(|d| d.starts_with("flex-basis:")));
    }

    #[test]
    fn grid_auto_and_line_placement_properties_pass_through_as_real_declarations() {
        let shape = KitExportShape {
            kit_id: "cell".to_string(),
            kit_name: "Cell".to_string(),
            axes: vec![],
            layers: vec![ExportLayer {
                layer_id: "base".to_string(),
                conditions: vec![],
                entries: vec![
                    literal_entry("grid-auto-rows", "100px"),
                    literal_entry("grid-auto-columns", "minmax(100px, 1fr)"),
                    literal_entry("grid-column", "span 2"),
                    literal_entry("grid-row", "1 / 3"),
                ],
            }],
        };
        let base = synthesize_base_declarations_with_tokens(&shape, true, &ProjectTokens::new());
        assert!(base.contains(&"grid-auto-rows: 100px;".to_string()), "{:?}", base);
        assert!(base.contains(&"grid-auto-columns: minmax(100px, 1fr);".to_string()), "{:?}", base);
        assert!(base.contains(&"grid-column: span 2;".to_string()), "{:?}", base);
        assert!(base.contains(&"grid-row: 1 / 3;".to_string()), "{:?}", base);
    }

    #[test]
    fn the_five_new_grid_mastery_properties_pass_through_as_real_declarations() {
        // Same diffable-passthrough treatment as the grid-auto/line-placement test above --
        // closes the same class of gap (a Kit-basis property missing from DIFFABLE_PROPERTIES)
        // for grid-template-areas/grid-auto-flow/justify-items/align-content/justify-self.
        let shape = KitExportShape {
            kit_id: "dashboard".to_string(),
            kit_name: "Dashboard".to_string(),
            axes: vec![],
            layers: vec![ExportLayer {
                layer_id: "base".to_string(),
                conditions: vec![],
                entries: vec![
                    literal_entry("grid-template-areas", "\"header header\" \"sidebar main\""),
                    literal_entry("grid-auto-flow", "column dense"),
                    literal_entry("justify-items", "center"),
                    literal_entry("align-content", "space-between"),
                    literal_entry("justify-self", "end"),
                ],
            }],
        };
        let base = synthesize_base_declarations_with_tokens(&shape, true, &ProjectTokens::new());
        assert!(
            base.contains(&"grid-template-areas: \"header header\" \"sidebar main\";".to_string()),
            "{:?}",
            base
        );
        assert!(base.contains(&"grid-auto-flow: column dense;".to_string()), "{:?}", base);
        assert!(base.contains(&"justify-items: center;".to_string()), "{:?}", base);
        assert!(base.contains(&"align-content: space-between;".to_string()), "{:?}", base);
        assert!(base.contains(&"justify-self: end;".to_string()), "{:?}", base);
    }

    #[test]
    fn item_level_flex_properties_pass_through_as_real_declarations() {
        let shape = KitExportShape {
            kit_id: "cell".to_string(),
            kit_name: "Cell".to_string(),
            axes: vec![],
            layers: vec![ExportLayer {
                layer_id: "base".to_string(),
                conditions: vec![],
                entries: vec![
                    literal_entry("flex-grow", "2"),
                    literal_entry("flex-shrink", "0"),
                    literal_entry("align-self", "flex-end"),
                ],
            }],
        };
        let base = synthesize_base_declarations_with_tokens(&shape, true, &ProjectTokens::new());
        assert!(base.contains(&"flex-grow: 2;".to_string()), "{:?}", base);
        assert!(base.contains(&"flex-shrink: 0;".to_string()), "{:?}", base);
        assert!(base.contains(&"align-self: flex-end;".to_string()), "{:?}", base);
    }

    #[test]
    fn split_arrangement_produces_justify_content_align_items_and_row_direction() {
        // Regression test for the reported bug: a Kit authored via the high-level "Split" preset
        // (the common case -- only the "arrange" raw property is stored, none of its implied
        // flex-direction/justify-content/align-items) must still export real layout, not nothing.
        let shape = KitExportShape {
            kit_id: "header".to_string(),
            kit_name: "Header".to_string(),
            axes: vec![],
            layers: vec![ExportLayer {
                layer_id: "base".to_string(),
                conditions: vec![],
                entries: vec![literal_entry("arrange", "split")],
            }],
        };
        let base = synthesize_base_declarations_with_tokens(&shape, true, &ProjectTokens::new());
        assert!(base.contains(&"display: flex;".to_string()), "base was: {:?}", base);
        assert!(base.contains(&"flex-direction: row;".to_string()), "base was: {:?}", base);
        assert!(base.contains(&"justify-content: space-between;".to_string()), "base was: {:?}", base);
        assert!(base.contains(&"align-items: center;".to_string()), "base was: {:?}", base);
        // "arrange" itself is Charter's own preset name, never a real CSS property.
        assert!(!base.iter().any(|d| d.starts_with("arrange")));
    }

    #[test]
    fn cluster_arrangement_defaults_to_row_wrap_and_flex_start() {
        let shape = KitExportShape {
            kit_id: "tags".to_string(),
            kit_name: "Tags".to_string(),
            axes: vec![],
            layers: vec![ExportLayer {
                layer_id: "base".to_string(),
                conditions: vec![],
                entries: vec![literal_entry("arrange", "cluster")],
            }],
        };
        let base = synthesize_base_declarations_with_tokens(&shape, true, &ProjectTokens::new());
        assert!(base.contains(&"flex-direction: row;".to_string()));
        assert!(base.contains(&"flex-wrap: wrap;".to_string()));
        assert!(base.contains(&"align-items: flex-start;".to_string()));
    }

    #[test]
    fn an_explicit_raw_override_wins_over_the_arrange_default() {
        // Mirrors Charter's own "only fires when never explicitly set" rule: a raw align-items
        // set directly (via the Advanced escape hatch) must NOT be clobbered by Split's own
        // align-items: center default.
        let shape = KitExportShape {
            kit_id: "header".to_string(),
            kit_name: "Header".to_string(),
            axes: vec![],
            layers: vec![ExportLayer {
                layer_id: "base".to_string(),
                conditions: vec![],
                entries: vec![
                    literal_entry("arrange", "split"),
                    literal_entry("align-items", "flex-end"),
                ],
            }],
        };
        let base = synthesize_base_declarations_with_tokens(&shape, true, &ProjectTokens::new());
        assert!(base.contains(&"align-items: flex-end;".to_string()), "base was: {:?}", base);
        assert!(!base.iter().any(|d| d == "align-items: center;"));
    }

    #[test]
    fn grid_arrangement_computes_display_grid_and_an_autofit_template_from_cell_min() {
        let shape = KitExportShape {
            kit_id: "gallery".to_string(),
            kit_name: "Gallery".to_string(),
            axes: vec![],
            layers: vec![ExportLayer {
                layer_id: "base".to_string(),
                conditions: vec![],
                entries: vec![literal_entry("arrange", "grid"), literal_entry("grid-cell-min", "200")],
            }],
        };
        let base = synthesize_base_declarations_with_tokens(&shape, true, &ProjectTokens::new());
        assert!(base.contains(&"display: grid;".to_string()), "base was: {:?}", base);
        assert!(
            base.contains(&"grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));".to_string()),
            "base was: {:?}",
            base
        );
        assert!(!base.iter().any(|d| d.starts_with("flex-direction")));
    }

    #[test]
    fn a_text_kit_never_gets_arrange_properties_even_with_a_stray_flex_direction() {
        // is_box: false -- a Text-primitive Kit should never have flex-direction synthesized onto
        // it, even in the unusual case its raw properties included one.
        let shape = KitExportShape {
            kit_id: "label".to_string(),
            kit_name: "Label".to_string(),
            axes: vec![],
            layers: vec![ExportLayer {
                layer_id: "base".to_string(),
                conditions: vec![],
                entries: vec![literal_entry("color", "#111111")],
            }],
        };
        let base = synthesize_base_declarations_with_tokens(&shape, false, &ProjectTokens::new());
        assert!(!base.iter().any(|d| d.starts_with("flex-direction") || d.starts_with("display")));
    }

    #[test]
    fn bare_numeric_values_get_an_implicit_px_unit() {
        let shape = KitExportShape {
            kit_id: "card".to_string(),
            kit_name: "Card".to_string(),
            axes: vec![],
            layers: vec![ExportLayer {
                layer_id: "base".to_string(),
                conditions: vec![],
                entries: vec![literal_entry("gap", "16"), literal_entry("padding", "8 16")],
            }],
        };
        let base = synthesize_base_declarations_with_tokens(&shape, false, &ProjectTokens::new());
        assert!(base.contains(&"gap: 16px;".to_string()));
        assert!(base.contains(&"padding: 8px 16px;".to_string()));
    }

    #[test]
    fn numeric_font_weight_passes_through_as_a_bare_number() {
        let shape = KitExportShape {
            kit_id: "label".to_string(),
            kit_name: "Label".to_string(),
            axes: vec![],
            layers: vec![ExportLayer {
                layer_id: "base".to_string(),
                conditions: vec![],
                entries: vec![literal_entry("font-weight", "600")],
            }],
        };
        let base = synthesize_base_declarations_with_tokens(&shape, false, &ProjectTokens::new());
        assert!(base.contains(&"font-weight: 600;".to_string()), "{:?}", base);
    }

    #[test]
    fn keyword_font_weight_falls_back_to_400_never_passes_through_as_a_real_keyword() {
        // Charter's build_text_node parses font-weight via parse_px -- "bold" doesn't parse as a
        // number, so Vellum renders/exports it as 400 (normal). WebCodium must agree, not let the
        // browser interpret "bold" literally as 700.
        let shape = KitExportShape {
            kit_id: "label".to_string(),
            kit_name: "Label".to_string(),
            axes: vec![],
            layers: vec![ExportLayer {
                layer_id: "base".to_string(),
                conditions: vec![],
                entries: vec![literal_entry("font-weight", "bold")],
            }],
        };
        let base = synthesize_base_declarations_with_tokens(&shape, false, &ProjectTokens::new());
        assert!(base.contains(&"font-weight: 400;".to_string()), "{:?}", base);
        assert!(!base.iter().any(|d| d.contains("bold")), "{:?}", base);
    }

    #[test]
    fn hug_width_keyword_is_compiled_and_produces_no_declaration() {
        let shape = KitExportShape {
            kit_id: "card".to_string(),
            kit_name: "Card".to_string(),
            axes: vec![],
            layers: vec![ExportLayer {
                layer_id: "base".to_string(),
                conditions: vec![],
                entries: vec![literal_entry("width", "hug")],
            }],
        };
        let base = synthesize_base_declarations_with_tokens(&shape, false, &ProjectTokens::new());
        assert_eq!(
            base,
            vec!["line-height: 24px;".to_string()],
            "hug is Charter's compiled keyword, not a literal size, and its flex-grow:0 already \
             matches CSS's own default so omitting it is correct: {:?}",
            base
        );
    }

    #[test]
    fn fill_width_keyword_produces_no_width_declaration_but_does_produce_flex_grow() {
        // The revised scope: Fill's GROW half no longer needs the parent's own axis (flex-grow is
        // inherently main-axis-relative), so it's a real, emitted declaration now -- see
        // synthesize_resize's doc comment. The literal "width: fill;" itself must still never leak
        // through (fill isn't a real CSS size value).
        let shape = KitExportShape {
            kit_id: "card".to_string(),
            kit_name: "Card".to_string(),
            axes: vec![],
            layers: vec![ExportLayer {
                layer_id: "base".to_string(),
                conditions: vec![],
                entries: vec![literal_entry("width", "fill")],
            }],
        };
        let base = synthesize_base_declarations_with_tokens(&shape, false, &ProjectTokens::new());
        assert_eq!(
            base,
            vec!["flex-grow: 1;".to_string(), "line-height: 24px;".to_string()],
            "{:?}",
            base
        );
    }

    #[test]
    fn fill_height_keyword_also_produces_flex_grow() {
        let shape = KitExportShape {
            kit_id: "card".to_string(),
            kit_name: "Card".to_string(),
            axes: vec![],
            layers: vec![ExportLayer {
                layer_id: "base".to_string(),
                conditions: vec![],
                entries: vec![literal_entry("height", "fill")],
            }],
        };
        let base = synthesize_base_declarations_with_tokens(&shape, false, &ProjectTokens::new());
        assert!(base.contains(&"flex-grow: 1;".to_string()), "{:?}", base);
    }

    #[test]
    fn an_explicit_raw_flex_grow_wins_over_fills_own_default() {
        // Mirrors synthesize_arrange's "only fires when never explicitly set" rule -- the legacy
        // item-level flex-grow escape hatch must not be clobbered by Fill's own default.
        let shape = KitExportShape {
            kit_id: "card".to_string(),
            kit_name: "Card".to_string(),
            axes: vec![],
            layers: vec![ExportLayer {
                layer_id: "base".to_string(),
                conditions: vec![],
                entries: vec![literal_entry("width", "fill"), literal_entry("flex-grow", "2")],
            }],
        };
        let base = synthesize_base_declarations_with_tokens(&shape, false, &ProjectTokens::new());
        assert!(base.contains(&"flex-grow: 2;".to_string()), "{:?}", base);
        assert!(!base.iter().any(|d| d == "flex-grow: 1;"), "{:?}", base);
    }

    #[test]
    fn token_backed_scalar_entry_resolves_to_the_tokens_value() {
        let shape = KitExportShape {
            kit_id: "card".to_string(),
            kit_name: "Card".to_string(),
            axes: vec![],
            layers: vec![ExportLayer {
                layer_id: "base".to_string(),
                conditions: vec![],
                entries: vec![ExportLayerEntry {
                    property: "color".to_string(),
                    literal_value: None,
                    token_value: Some(TokenValueWire {
                        kind: "scalar".to_string(),
                        value: Some("#3b82f6".to_string()),
                        view_id: None,
                    }),
                    token_id: None,
                }],
            }],
        };
        let base = synthesize_base_declarations_with_tokens(&shape, false, &ProjectTokens::new());
        assert_eq!(
            base,
            vec!["color: #3b82f6;".to_string(), "line-height: 24px;".to_string()]
        );
    }

    fn project_token_entry(property: &str, token_id: &str) -> ExportLayerEntry {
        ExportLayerEntry {
            property: property.to_string(),
            literal_value: None,
            token_value: Some(TokenValueWire {
                kind: "scalar".to_string(),
                value: Some("oklch(62% 0.18 260)".to_string()),
                view_id: None,
            }),
            token_id: Some(token_id.to_string()),
        }
    }

    fn project_tokens_fixture() -> ProjectTokens {
        let mut tokens = ProjectTokens::new();
        tokens.insert(
            "tok-1".to_string(),
            ProjectToken {
                alias: "colors.primary".to_string(),
                value: "oklch(62% 0.18 260)".to_string(),
                format: Some("color".to_string()),
            },
        );
        tokens
    }

    #[test]
    fn a_property_backed_by_a_project_scope_token_emits_a_css_variable_reference() {
        let shape = KitExportShape {
            kit_id: "card".to_string(),
            kit_name: "Card".to_string(),
            axes: vec![],
            layers: vec![ExportLayer {
                layer_id: "base".to_string(),
                conditions: vec![],
                entries: vec![project_token_entry("background", "tok-1")],
            }],
        };
        let base = synthesize_base_declarations_with_tokens(&shape, false, &project_tokens_fixture());
        assert_eq!(
            base,
            vec!["background: var(--colors-primary);".to_string(), "line-height: 24px;".to_string()]
        );
    }

    #[test]
    fn a_token_id_not_present_in_the_project_tokens_map_falls_back_to_the_literal() {
        // The token backing this entry is kit/view-scoped (or the fetch failed) -- either way it's
        // simply absent from the project-tokens map, and the resolved literal must still render.
        let shape = KitExportShape {
            kit_id: "card".to_string(),
            kit_name: "Card".to_string(),
            axes: vec![],
            layers: vec![ExportLayer {
                layer_id: "base".to_string(),
                conditions: vec![],
                entries: vec![project_token_entry("background", "some-other-token")],
            }],
        };
        let base = synthesize_base_declarations_with_tokens(&shape, false, &project_tokens_fixture());
        assert!(base.contains(&"background: oklch(62% 0.18 260);".to_string()), "{:?}", base);
        assert!(!base.iter().any(|d| d.contains("var(--")), "{:?}", base);
    }

    #[test]
    fn border_never_substitutes_a_variable_even_when_token_backed() {
        // synthesize_border merges "border" into a "{width}px solid {color}" shorthand -- a bare
        // var(--alias) here would silently drop the width/style half.
        let shape = KitExportShape {
            kit_id: "card".to_string(),
            kit_name: "Card".to_string(),
            axes: vec![],
            layers: vec![ExportLayer {
                layer_id: "base".to_string(),
                conditions: vec![],
                entries: vec![project_token_entry("border", "tok-1")],
            }],
        };
        let base = synthesize_base_declarations_with_tokens(&shape, false, &project_tokens_fixture());
        assert!(
            base.contains(&"border: 1px solid oklch(62% 0.18 260);".to_string()),
            "{:?}",
            base
        );
        assert!(!base.iter().any(|d| d.contains("var(--")), "{:?}", base);
    }

    #[test]
    fn an_unparseable_token_backed_color_still_gets_the_magenta_marker_not_a_variable() {
        let mut tokens = ProjectTokens::new();
        tokens.insert(
            "tok-bad".to_string(),
            ProjectToken {
                alias: "colors.oops".to_string(),
                value: "cornflowerblue".to_string(),
                format: Some("color".to_string()),
            },
        );
        let shape = KitExportShape {
            kit_id: "card".to_string(),
            kit_name: "Card".to_string(),
            axes: vec![],
            layers: vec![ExportLayer {
                layer_id: "base".to_string(),
                conditions: vec![],
                entries: vec![ExportLayerEntry {
                    property: "color".to_string(),
                    literal_value: None,
                    token_value: Some(TokenValueWire {
                        kind: "scalar".to_string(),
                        value: Some("cornflowerblue".to_string()),
                        view_id: None,
                    }),
                    token_id: Some("tok-bad".to_string()),
                }],
            }],
        };
        let base = synthesize_base_declarations_with_tokens(&shape, false, &tokens);
        let expected = format!("color: {};", unparseable_color_marker());
        assert!(base.contains(&expected), "expected {:?}, got {:?}", expected, base);
        assert!(!base.iter().any(|d| d.contains("var(--")), "{:?}", base);
    }

    #[test]
    fn a_variant_can_override_a_base_project_token_with_a_plain_literal() {
        // A more-specific layer overwriting the same property with a literal must clear the
        // earlier layer's token association, not just its value.
        let shape = KitExportShape {
            kit_id: "card".to_string(),
            kit_name: "Card".to_string(),
            axes: vec![AxisExportMeta {
                axis_id: "theme".to_string(),
                axis_name: Some("theme".to_string()),
                kind: Some("categorical".to_string()),
                variant_kind: "static".to_string(),
                excluded_from_export: false,
                default_value: None,
                priority_index: 0,
                values: vec![ExportAxisValue {
                    axis_value_id: "v1".to_string(),
                    value: literal("dark"),
                    priority_index: 0,
                }],
            }],
            layers: vec![
                ExportLayer {
                    layer_id: "base".to_string(),
                    conditions: vec![],
                    entries: vec![project_token_entry("background", "tok-1")],
                },
                ExportLayer {
                    layer_id: "dark".to_string(),
                    conditions: vec![condition("theme", "dark")],
                    entries: vec![literal_entry("background", "oklch(20% 0.02 260)")],
                },
            ],
        };
        let rules = synthesize_variant_rules_with_tokens(&shape, true, &project_tokens_fixture());
        let dark = rules.iter().find(|r| r.suffixes == vec!["--theme-dark"]).unwrap();
        assert_eq!(dark.declarations, vec!["background: oklch(20% 0.02 260);".to_string()]);
    }

    #[test]
    fn render_root_variables_emits_one_declaration_per_aliased_token_sorted_by_alias() {
        let mut tokens = ProjectTokens::new();
        tokens.insert(
            "tok-b".to_string(),
            ProjectToken {
                alias: "colors.bg".to_string(),
                value: "oklch(100% 0 0)".to_string(),
                format: Some("color".to_string()),
            },
        );
        tokens.insert(
            "tok-a".to_string(),
            ProjectToken {
                alias: "colors.primary".to_string(),
                value: "oklch(62% 0.18 260)".to_string(),
                format: Some("color".to_string()),
            },
        );
        tokens.insert(
            "tok-noalias".to_string(),
            ProjectToken { alias: String::new(), value: "16".to_string(), format: None },
        );
        let out = render_root_variables(&tokens);
        assert_eq!(
            out,
            ":root {\n  --colors-bg: oklch(100% 0 0);\n  --colors-primary: oklch(62% 0.18 260);\n}\n\n"
        );
    }

    #[test]
    fn render_root_variables_applies_the_size_format_hint() {
        let mut tokens = ProjectTokens::new();
        tokens.insert(
            "tok-1".to_string(),
            ProjectToken {
                alias: "spacing.md".to_string(),
                value: "16".to_string(),
                format: Some("size".to_string()),
            },
        );
        let out = render_root_variables(&tokens);
        assert_eq!(out, ":root {\n  --spacing-md: 16px;\n}\n\n");
    }

    #[test]
    fn render_root_variables_sanitizes_dots_and_spaces_in_the_alias() {
        let mut tokens = ProjectTokens::new();
        tokens.insert(
            "tok-1".to_string(),
            ProjectToken {
                alias: "Spacing / Medium".to_string(),
                value: "8px".to_string(),
                format: None,
            },
        );
        let out = render_root_variables(&tokens);
        assert_eq!(out, ":root {\n  --Spacing---Medium: 8px;\n}\n\n");
    }

    #[test]
    fn render_root_variables_disambiguates_colliding_sanitized_names() {
        let mut tokens = ProjectTokens::new();
        tokens.insert(
            "tok-1".to_string(),
            ProjectToken { alias: "a.b".to_string(), value: "1px".to_string(), format: Some("size".to_string()) },
        );
        tokens.insert(
            "tok-2".to_string(),
            ProjectToken { alias: "a-b".to_string(), value: "2px".to_string(), format: Some("size".to_string()) },
        );
        let out = render_root_variables(&tokens);
        // Sort order is by RAW alias ("a-b" < "a.b" lexicographically), so "a-b" claims the
        // unsuffixed name first and "a.b" (sanitizing to the same string) gets "-2".
        assert_eq!(out, ":root {\n  --a-b: 2px;\n  --a-b-2: 1px;\n}\n\n");
    }

    // A Density kit (lower priority, conditioned on theme=dark) and a Priority kit (higher
    // priority, unconditioned) both declare `background` -- the exact reported bug scenario.
    // Density's own 1-condition layer must outrank Priority's 0-condition null layer regardless
    // of kit order, mirroring flattenKitResults/merge_kits exactly.
    fn density_shape() -> KitExportShape {
        KitExportShape {
            kit_id: "density".to_string(),
            kit_name: "Density".to_string(),
            axes: vec![],
            layers: vec![ExportLayer {
                layer_id: "density-dark".to_string(),
                conditions: vec![condition("theme", "dark")],
                entries: vec![literal_entry("background", "oklab(10% 0 0 / 1)")],
            }],
        }
    }

    fn priority_shape() -> KitExportShape {
        KitExportShape {
            kit_id: "priority".to_string(),
            kit_name: "Priority".to_string(),
            axes: vec![],
            layers: vec![ExportLayer {
                layer_id: "priority-base".to_string(),
                conditions: vec![],
                entries: vec![literal_entry("background", "oklab(90% 0 0 / 1)")],
            }],
        }
    }

    #[test]
    fn a_conditioned_lower_priority_kit_beats_an_unconditioned_higher_priority_kit() {
        let mut kit_shapes = HashMap::new();
        kit_shapes.insert("density".to_string(), density_shape());
        kit_shapes.insert("priority".to_string(), priority_shape());
        let mut kit_classes = HashMap::new();
        kit_classes.insert("density".to_string(), "density".to_string());
        kit_classes.insert("priority".to_string(), "priority".to_string());

        let mut args_by_kit = HashMap::new();
        args_by_kit.insert("density".to_string(), HashMap::from([("theme".to_string(), "dark".to_string())]));

        // Density composed FIRST (lower priority), Priority SECOND (higher) -- Density still wins
        // because its layer is more specific (1 condition vs Priority's 0), regardless of order.
        let kit_ids = vec!["density".to_string(), "priority".to_string()];
        let rules = synthesize_contested_rules(
            &kit_ids,
            &kit_classes,
            &kit_shapes,
            &args_by_kit,
            true,
            &ProjectTokens::new(),
        );

        assert_eq!(rules.len(), 1, "expected exactly one contested property (background)");
        assert_eq!(rules[0].declaration, "background: oklab(10% 0 0 / 1);");
        assert_eq!(rules[0].selector_classes[0], "density");
        assert_eq!(rules[0].selector_classes[1], "priority");
        assert!(rules[0].selector_classes[2].starts_with("comp-"));
    }

    #[test]
    fn kit_order_only_breaks_a_genuine_tie_between_equally_specific_layers() {
        // Both kits declare `background` unconditionally (condition count 0, a true tie) --
        // Priority, composed SECOND (higher priority), must win, exactly matching the pre-existing
        // plain-order behavior for the common uncontested-specificity case.
        let mut priority_unconditioned = priority_shape();
        priority_unconditioned.kit_name = "Priority".to_string();
        let mut density_unconditioned = density_shape();
        density_unconditioned.layers = vec![ExportLayer {
            layer_id: "density-base".to_string(),
            conditions: vec![],
            entries: vec![literal_entry("background", "oklab(10% 0 0 / 1)")],
        }];

        let mut kit_shapes = HashMap::new();
        kit_shapes.insert("density".to_string(), density_unconditioned);
        kit_shapes.insert("priority".to_string(), priority_unconditioned);
        let mut kit_classes = HashMap::new();
        kit_classes.insert("density".to_string(), "density".to_string());
        kit_classes.insert("priority".to_string(), "priority".to_string());
        let args_by_kit = HashMap::new();

        let kit_ids = vec!["density".to_string(), "priority".to_string()];
        let rules = synthesize_contested_rules(
            &kit_ids,
            &kit_classes,
            &kit_shapes,
            &args_by_kit,
            true,
            &ProjectTokens::new(),
        );

        assert_eq!(rules.len(), 1);
        assert_eq!(rules[0].declaration, "background: oklab(90% 0 0 / 1);");
    }

    #[test]
    fn reversing_composition_order_flips_the_tie_winner_and_the_signature_class() {
        let mut kit_shapes = HashMap::new();
        kit_shapes.insert(
            "density".to_string(),
            KitExportShape {
                kit_id: "density".to_string(),
                kit_name: "Density".to_string(),
                axes: vec![],
                layers: vec![ExportLayer {
                    layer_id: "density-base".to_string(),
                    conditions: vec![],
                    entries: vec![literal_entry("background", "oklab(10% 0 0 / 1)")],
                }],
            },
        );
        kit_shapes.insert("priority".to_string(), priority_shape());
        let mut kit_classes = HashMap::new();
        kit_classes.insert("density".to_string(), "density".to_string());
        kit_classes.insert("priority".to_string(), "priority".to_string());
        let args_by_kit = HashMap::new();

        // View A: Density first (loses the tie). View B: Priority first (loses the tie instead).
        let forward = vec!["density".to_string(), "priority".to_string()];
        let reversed = vec!["priority".to_string(), "density".to_string()];

        let forward_rules = synthesize_contested_rules(
            &forward,
            &kit_classes,
            &kit_shapes,
            &args_by_kit,
            true,
            &ProjectTokens::new(),
        );
        let reversed_rules = synthesize_contested_rules(
            &reversed,
            &kit_classes,
            &kit_shapes,
            &args_by_kit,
            true,
            &ProjectTokens::new(),
        );

        assert_eq!(forward_rules[0].declaration, "background: oklab(90% 0 0 / 1);"); // Priority wins
        assert_eq!(reversed_rules[0].declaration, "background: oklab(10% 0 0 / 1);"); // Density wins
        // Different composition order -> different signature class, so the two views' rules can
        // never collide over one shared selector.
        assert_ne!(
            forward_rules[0].selector_classes.last(),
            reversed_rules[0].selector_classes.last()
        );
    }

    #[test]
    fn an_uncontested_property_produces_no_rule() {
        // Density only declares `gap`, Priority only declares `justify-content` -- no overlap, so
        // there's nothing to disambiguate.
        let mut kit_shapes = HashMap::new();
        kit_shapes.insert(
            "density".to_string(),
            KitExportShape {
                kit_id: "density".to_string(),
                kit_name: "Density".to_string(),
                axes: vec![],
                layers: vec![ExportLayer {
                    layer_id: "density-base".to_string(),
                    conditions: vec![],
                    entries: vec![literal_entry("gap", "4px")],
                }],
            },
        );
        kit_shapes.insert(
            "priority".to_string(),
            KitExportShape {
                kit_id: "priority".to_string(),
                kit_name: "Priority".to_string(),
                axes: vec![],
                layers: vec![ExportLayer {
                    layer_id: "priority-base".to_string(),
                    conditions: vec![],
                    entries: vec![literal_entry("justify-content", "space-between")],
                }],
            },
        );
        let mut kit_classes = HashMap::new();
        kit_classes.insert("density".to_string(), "density".to_string());
        kit_classes.insert("priority".to_string(), "priority".to_string());
        let args_by_kit = HashMap::new();

        let kit_ids = vec!["density".to_string(), "priority".to_string()];
        let rules = synthesize_contested_rules(
            &kit_ids,
            &kit_classes,
            &kit_shapes,
            &args_by_kit,
            true,
            &ProjectTokens::new(),
        );
        assert!(rules.is_empty());
    }

    #[test]
    fn a_single_kit_view_never_produces_contested_rules() {
        let kit_shapes = HashMap::new();
        let kit_classes = HashMap::new();
        let args_by_kit = HashMap::new();
        let kit_ids = vec!["density".to_string()];
        let rules = synthesize_contested_rules(
            &kit_ids,
            &kit_classes,
            &kit_shapes,
            &args_by_kit,
            true,
            &ProjectTokens::new(),
        );
        assert!(rules.is_empty());
    }
}
