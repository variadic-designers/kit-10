// Pure UiNode-graph utilities -- node identity, parent/child structure, and view-selection logic.
// No CSS/HTML formatting concerns live here (see css.rs/html.rs).

use kit10_scene::{ImageSource, NodePosition, UiNode};
use std::collections::{HashMap, HashSet};
use std::hash::{Hash, Hasher};

// The real URL an Img node's asset id resolves to, if any -- shared by css.rs (gates whether an
// Img rule is emitted at all) and html.rs (the literal `src` attribute), so the two can never
// disagree on which Img nodes actually render. None for a non-Img node, a `None`/`Bytes` source
// (no asset id to look up -- see the module's own v1 scope note in lib.rs), or a `Ref(id)` with
// no entry in `asset_links` (kit10_get_asset_links didn't return a link for it -- best-effort,
// never a hard failure).
pub(crate) fn resolved_img_src<'a>(
    node: &UiNode,
    asset_links: &'a HashMap<String, String>,
) -> Option<&'a str> {
    let UiNode::Img(d) = node else { return None };
    let ImageSource::Ref(id) = &d.source else { return None };
    asset_links.get(id).map(|s| s.as_str())
}

// Tier-3 fallback only now (Kit-basis export, resources/webcodium-export-plan.md Phase 3) --
// positional, used only for pure structural grid scaffolding a design has no authored identity
// for. See resolve_class_name for the full 3-tier scheme.
pub(crate) fn class_name(index: usize) -> String {
    format!("k10-{index}")
}

// Slugifies a Kit's own name into a CSS class name: lowercase, runs of non-alphanumeric
// characters collapse to a single '-', leading/trailing '-' trimmed. "Button" -> "button", "My
// Kit!!" -> "my-kit". Can produce an empty string for a name with no alphanumeric characters at
// all -- callers must treat that as "no usable name" and fall through to a lower tier, never
// emit a bare ".{}" selector.
pub(crate) fn kit_class_name(name: &str) -> String {
    let mut result = String::new();
    let mut last_was_dash = true; // suppresses a leading dash
    for ch in name.to_lowercase().chars() {
        if ch.is_ascii_alphanumeric() {
            result.push(ch);
            last_was_dash = false;
        } else if !last_was_dash {
            result.push('-');
            last_was_dash = true;
        }
    }
    while result.ends_with('-') {
        result.pop();
    }
    result
}

// Tier-2 fallback: a bare structural view with no composed Kit still gets a stable, semantic
// class ("box"/"text"/"img") rather than a positional one.
pub(crate) fn primitive_class_name(node: &UiNode) -> &'static str {
    match node {
        UiNode::Box(_) => "box",
        UiNode::Text(_) => "text",
        UiNode::Img(_) => "img",
        UiNode::Shape(_) => "shape",
    }
}

// The 3-tier class-name resolution Kit-basis export uses for every node (see
// resources/webcodium-export-plan.md Phase 3):
//   1. This node names a composed Kit (node_kit_ids[i] non-empty) that resolves to a known name
//      -> the Kit's own slugified name (kit_class_name), e.g. ".button".
//   2. Else, this node belongs to a real view (node_view_ids[i] non-empty) with no composed Kit
//      -> its primitive type, e.g. ".box"/".text".
//   3. Else (pure grid/structural scaffolding -- node_view_ids[i] == "") -> the positional
//      fallback (class_name), e.g. ".k10-3". This is layout mechanics with no authored identity,
//      never "Kit-basis" at all.
pub(crate) fn resolve_class_name(
    i: usize,
    nodes: &[UiNode],
    node_view_ids: &[String],
    node_kit_ids: &[String],
    kit_names: &HashMap<String, String>,
) -> String {
    if let Some(kit_id) = node_kit_ids.get(i).filter(|id| !id.is_empty()) {
        if let Some(name) = kit_names.get(kit_id.as_str()) {
            let slug = kit_class_name(name);
            if !slug.is_empty() {
                return slug;
            }
        }
    }

    let has_view = node_view_ids.get(i).map(|v| !v.is_empty()).unwrap_or(false);
    if has_view {
        if let Some(node) = nodes.get(i) {
            return primitive_class_name(node).to_string();
        }
    }

    class_name(i)
}

// The distinct Kit ids a resolved viewport actually uses, in first-appearance order ("" excluded)
// -- feeds the kit10_get_kit_export_shape request body, scoping the fetch to only the Kits
// actually present in this export instead of the whole project.
pub(crate) fn distinct_kit_ids(node_kit_ids: &[String]) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut result = Vec::new();
    for id in node_kit_ids {
        if id.is_empty() {
            continue;
        }
        if seen.insert(id.clone()) {
            result.push(id.clone());
        }
    }
    result
}

// Every kit id actually needed to represent a view's FULL composition, not just each node's own
// single Charter-picked "winning" kit (node_kit_ids) -- the union of distinct_kit_ids(node_kit_ids)
// and every kit named in view_compositions, first-appearance order. Feeds the
// kit10_get_kit_export_shape request body so a kit that's never any node's own primary (always
// outranked by a higher-priority composed kit) still gets its shape fetched and can still emit its
// own class/base rule (see resolve_class_names / render_scss's secondary-kit loop).
pub(crate) fn all_composed_kit_ids(
    node_kit_ids: &[String],
    view_compositions: &HashMap<String, Vec<String>>,
) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut result = Vec::new();
    for id in distinct_kit_ids(node_kit_ids) {
        if seen.insert(id.clone()) {
            result.push(id);
        }
    }
    for kit_ids in view_compositions.values() {
        for id in kit_ids {
            if !id.is_empty() && seen.insert(id.clone()) {
                result.push(id.clone());
            }
        }
    }
    result
}

// view_id -> true (Box) / false (Text), for every real view a node in this export belongs to.
// Deliberately absent for an Img view -- Img never routes through the Kit-basis variants.rs path
// (see render_scss_node's own note), so a kit composed ONLY on Img views has no is_box signal to
// synthesize secondary base/variant rules from and is simply skipped there, same posture as the
// existing per-node Img exclusion. First-occurrence-wins per view id, mirroring
// synthesize_all_variant_rules's own "a Kit is consistently composed as only Box or only Text in
// practice" assumption.
pub(crate) fn view_primitive_is_box(nodes: &[UiNode], node_view_ids: &[String]) -> HashMap<String, bool> {
    let mut map = HashMap::new();
    for (i, node) in nodes.iter().enumerate() {
        let Some(view_id) = node_view_ids.get(i).filter(|v| !v.is_empty()) else { continue };
        if map.contains_key(view_id) {
            continue;
        }
        match node {
            UiNode::Box(_) => {
                map.insert(view_id.clone(), true);
            }
            UiNode::Text(_) => {
                map.insert(view_id.clone(), false);
            }
            // Shape doesn't route through the Kit-basis variants.rs path either -- same posture
            // as the existing Img exclusion above (see this function's own doc comment).
            UiNode::Img(_) | UiNode::Shape(_) => {}
        }
    }
    map
}

// A short, deterministic, ORDER-SENSITIVE signature class for one view's own composed-kit-id
// list (priority_index ascending, exactly the order view_compositions already carries) -- backs
// cross-kit contested-property disambiguation (variants::synthesize_contested_rules). Two views
// composing the identical two kits in the SAME order hash identically (safe to share one
// disambiguating rule, same dedup discipline as kit_names/asset_links being computed once per
// distinct value); two views composing them in OPPOSITE order hash differently, so their rules
// can never collide or fight over stylesheet position -- they select genuinely different node
// subsets instead of contesting one shared selector. Not cryptographic -- DefaultHasher is a
// plain, fast, non-adversarial hash, which is all a same-process disambiguation label needs.
pub(crate) fn composition_signature_class(kit_ids: &[String]) -> String {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    kit_ids.hash(&mut hasher);
    format!("comp-{:x}", hasher.finish())
}

// Every class this node's element should carry from Kit composition -- the existing 3-tier
// resolve_class_name (unchanged, still first in the list), one additional class per OTHER kit
// this node's own view composes (from view_compositions), in composition-priority order, skipping
// the primary (already represented) and any kit whose name doesn't resolve, and finally (only when
// the view composes 2+ kits) the composition-signature class every disambiguating contested-
// property rule's selector is scoped to. For a view composing only one kit (the common case, and
// every case before multi-kit composition export existed) this returns exactly
// `[resolve_class_name(...)]` -- byte-identical to the old single-class output.
pub(crate) fn resolve_class_names(
    i: usize,
    nodes: &[UiNode],
    node_view_ids: &[String],
    node_kit_ids: &[String],
    kit_names: &HashMap<String, String>,
    view_compositions: &HashMap<String, Vec<String>>,
) -> Vec<String> {
    let primary = resolve_class_name(i, nodes, node_view_ids, node_kit_ids, kit_names);
    let mut classes = vec![primary];

    let Some(view_id) = node_view_ids.get(i).filter(|v| !v.is_empty()) else { return classes };
    let Some(kit_ids) = view_compositions.get(view_id) else { return classes };
    let primary_kit_id = node_kit_ids.get(i).map(String::as_str).unwrap_or("");

    for kid in kit_ids {
        if kid.as_str() == primary_kit_id {
            continue;
        }
        let Some(name) = kit_names.get(kid) else { continue };
        let slug = kit_class_name(name);
        if !slug.is_empty() && !classes.contains(&slug) {
            classes.push(slug);
        }
    }

    if kit_ids.len() >= 2 {
        classes.push(composition_signature_class(kit_ids));
    }
    classes
}

// Same dedup shape as distinct_kit_ids, applied to node_view_ids instead -- feeds the
// kit10_get_view_axis_args request body, scoping the fetch to only the views actually present in
// this export instead of the whole project.
pub(crate) fn distinct_view_ids(node_view_ids: &[String]) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut result = Vec::new();
    for id in node_view_ids {
        if id.is_empty() {
            continue;
        }
        if seen.insert(id.clone()) {
            result.push(id.clone());
        }
    }
    result
}

pub(crate) fn parent_of(node: &UiNode) -> Option<usize> {
    match node {
        UiNode::Box(d) => d.parent_id,
        UiNode::Text(d) => d.parent_id,
        UiNode::Img(d) => d.parent_id,
        UiNode::Shape(d) => d.parent_id,
    }
}

// A view pinned to a canvas position (hints.vellum.position) is wrapped by Charter in a
// structural absolute_box node (kit_id/view_id both "", never a real Kit or view) carrying
// `BoxExtra.position: NodePosition::Absolute{x,y}`, whose ONLY child is the view's own real
// content node -- exactly one hop, always (plugins/charter/src/lib.rs's absolute_box). Since
// resolve_export_roots selects roots by node_view_ids (the wrapper's is always ""), the wrapper
// itself is never visited by any render function and its position is silently dropped -- a
// pinned view exported as a plain, arbitrarily-ordered flow element (a real audited discrepancy,
// 2026-07-27). This looks up whether `root`'s own parent is exactly that wrapper shape, so the
// caller can re-attach the position directly onto the root's own rule. `NodePosition::Absolute`
// is only ever constructed for this one wrapper case in the whole pipeline, so matching on it is
// an unambiguous signal, not a heuristic.
pub(crate) fn root_position(nodes: &[UiNode], root: usize) -> Option<(f32, f32)> {
    let parent_idx = parent_of(nodes.get(root)?)?;
    let UiNode::Box(d) = nodes.get(parent_idx)? else { return None };
    match d.extra.position {
        NodePosition::Absolute { x, y } => Some((x, y)),
        NodePosition::Relative => None,
    }
}

// root_position's raw (x, y) is a coordinate in the EDITOR CANVAS's own world space -- wherever a
// designer happened to drag that view on Vellum's effectively infinite pannable canvas, which has
// no relationship to what a sane pixel position on an actual exported webpage should be. Emitting
// it verbatim as `left`/`top` against the page's initial containing block would strand content
// however far from the origin the canvas coordinates happen to sprawl (a real, reported miss,
// caught immediately after root_position shipped: 2026-07-27) -- a view pinned at canvas (3000,
// 1400) would export to a page with a `<body>` sized to fit that, not a normal document.
//
// Normalizing by the minimum x/y across every pinned root in THIS export keeps their RELATIVE
// arrangement to each other intact (what a design that deliberately overlaps/staggers multiple
// pinned views actually wants preserved) while starting the page near (0, 0) like a real
// document, regardless of where on the canvas they happened to be dragged. A single pinned root
// normalizes to exactly (0, 0) -- its own value is the minimum.
pub(crate) fn normalized_root_positions(
    nodes: &[UiNode],
    roots: &[usize],
) -> HashMap<usize, (f32, f32)> {
    let raw: Vec<(usize, f32, f32)> =
        roots.iter().filter_map(|&i| root_position(nodes, i).map(|(x, y)| (i, x, y))).collect();
    if raw.is_empty() {
        return HashMap::new();
    }
    let min_x = raw.iter().map(|&(_, x, _)| x).fold(f32::INFINITY, f32::min);
    let min_y = raw.iter().map(|&(_, _, y)| y).fold(f32::INFINITY, f32::min);
    raw.into_iter().map(|(i, x, y)| (i, (x - min_x, y - min_y))).collect()
}

// children[i] = indices whose parent_id == Some(i).
pub(crate) fn build_children_map(nodes: &[UiNode]) -> HashMap<usize, Vec<usize>> {
    let mut children: HashMap<usize, Vec<usize>> = HashMap::new();
    for (i, node) in nodes.iter().enumerate() {
        if let Some(p) = parent_of(node) {
            children.entry(p).or_default().push(i);
        }
    }
    children
}

// Every view (top-level or nested as a child via composition) gets exactly one entry in
// node_view_ids tagged with its own view id (verified against Charter's render_view_nodes,
// plugins/charter/src/lib.rs) -- a nested view's parent_id points directly at its containing
// view's own node, while a top-level view's parent_id chain only ever passes through structural
// grid scaffolding (tagged ""), never another view. So: a selected view only becomes an
// independent export root if no ancestor (walking parent_id) is ALSO a selected view's node --
// otherwise it's already going to render as part of that ancestor's subtree, and treating it as
// a second root would duplicate it. Selecting every view (the Export panel's default) therefore
// reproduces exactly the same output as an unfiltered export: every nested view's parent is also
// selected, so nested views are correctly excluded as independent roots.
pub(crate) fn resolve_export_roots(
    nodes: &[UiNode],
    node_view_ids: &[String],
    selected_view_ids: &[String],
) -> Vec<usize> {
    let is_selected = |i: usize| -> bool {
        node_view_ids
            .get(i)
            .map(|v| !v.is_empty() && selected_view_ids.contains(v))
            .unwrap_or(false)
    };

    let candidates: HashSet<usize> = (0..nodes.len()).filter(|&i| is_selected(i)).collect();

    // Collected in ascending index order (not HashSet iteration order, which is unspecified) so
    // the exported HTML/CSS has a stable, deterministic node ordering run to run -- and so
    // selecting every view reproduces bit-for-bit the same output as an unfiltered export.
    let mut roots: Vec<usize> = candidates
        .iter()
        .copied()
        .filter(|&c| {
            let mut cur = parent_of(&nodes[c]);
            while let Some(p) = cur {
                if candidates.contains(&p) {
                    return false;
                }
                cur = parent_of(&nodes[p]);
            }
            true
        })
        .collect();
    roots.sort_unstable();
    roots
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::view_fixture;

    #[test]
    fn resolve_export_roots_selects_only_the_chosen_top_level_view() {
        let (nodes, node_view_ids) = view_fixture();
        let roots = resolve_export_roots(&nodes, &node_view_ids, &["view-a".to_string()]);
        assert_eq!(roots, vec![0]);
    }

    #[test]
    fn resolve_export_roots_excludes_a_nested_view_whose_parent_is_also_selected() {
        let (nodes, node_view_ids) = view_fixture();
        let selected = vec!["view-a".to_string(), "view-c".to_string()];
        let roots = resolve_export_roots(&nodes, &node_view_ids, &selected);
        // view-c (index 2) is nested inside view-a (index 0), which is also selected -- it must
        // NOT be treated as a second independent root (it already renders as part of view-a's
        // subtree; including it again would duplicate it).
        assert_eq!(roots, vec![0]);
    }

    #[test]
    fn resolve_export_roots_is_empty_for_no_selection() {
        let (nodes, node_view_ids) = view_fixture();
        let roots = resolve_export_roots(&nodes, &node_view_ids, &[]);
        assert!(roots.is_empty());
    }

    #[test]
    fn resolve_export_roots_ignores_an_unknown_view_id() {
        let (nodes, node_view_ids) = view_fixture();
        let roots = resolve_export_roots(&nodes, &node_view_ids, &["view-zzz".to_string()]);
        assert!(roots.is_empty());
    }

    #[test]
    fn root_position_reads_the_wrapper_boxs_absolute_position() {
        use crate::test_support::test_box;
        let mut wrapper = test_box(None);
        wrapper.extra.position = NodePosition::Absolute { x: 120.0, y: 40.0 };
        let nodes = vec![UiNode::Box(wrapper), UiNode::Box(test_box(Some(0)))];
        assert_eq!(root_position(&nodes, 1), Some((120.0, 40.0)));
    }

    #[test]
    fn root_position_is_none_when_the_parent_is_plain_relative_flow() {
        use crate::test_support::test_box;
        let nodes = vec![UiNode::Box(test_box(None)), UiNode::Box(test_box(Some(0)))];
        assert_eq!(root_position(&nodes, 1), None);
    }

    #[test]
    fn root_position_is_none_for_a_top_level_node_with_no_parent_at_all() {
        use crate::test_support::test_box;
        let nodes = vec![UiNode::Box(test_box(None))];
        assert_eq!(root_position(&nodes, 0), None);
    }

    #[test]
    fn normalized_root_positions_offsets_by_the_minimum_preserving_relative_arrangement() {
        use crate::test_support::test_box;
        let mut wrapper_a = test_box(None);
        wrapper_a.extra.position = NodePosition::Absolute { x: 100.0, y: 200.0 };
        let mut wrapper_b = test_box(None);
        wrapper_b.extra.position = NodePosition::Absolute { x: 150.0, y: 500.0 };
        let nodes = vec![
            UiNode::Box(wrapper_a),
            UiNode::Box(test_box(Some(0))),
            UiNode::Box(wrapper_b),
            UiNode::Box(test_box(Some(2))),
        ];
        let positions = normalized_root_positions(&nodes, &[1, 3]);
        assert_eq!(positions.get(&1), Some(&(0.0, 0.0)));
        assert_eq!(positions.get(&3), Some(&(50.0, 300.0)));
    }

    #[test]
    fn normalized_root_positions_is_empty_when_no_root_is_pinned() {
        use crate::test_support::test_box;
        let nodes = vec![UiNode::Box(test_box(None)), UiNode::Box(test_box(Some(0)))];
        assert!(normalized_root_positions(&nodes, &[1]).is_empty());
    }

    #[test]
    fn normalized_root_positions_only_includes_roots_that_are_actually_pinned() {
        use crate::test_support::test_box;
        let mut wrapper = test_box(None);
        wrapper.extra.position = NodePosition::Absolute { x: 10.0, y: 20.0 };
        let nodes = vec![
            UiNode::Box(wrapper),
            UiNode::Box(test_box(Some(0))),
            UiNode::Box(test_box(None)),
        ];
        // Root 2 is a plain top-level view with no pinned wrapper -- not part of the arrangement.
        let positions = normalized_root_positions(&nodes, &[1, 2]);
        assert_eq!(positions.get(&1), Some(&(0.0, 0.0)));
        assert_eq!(positions.get(&2), None);
    }

    #[test]
    fn kit_class_name_slugifies() {
        assert_eq!(kit_class_name("Button"), "button");
        assert_eq!(kit_class_name("My Kit!!"), "my-kit");
        assert_eq!(kit_class_name("  leading and trailing  "), "leading-and-trailing");
        assert_eq!(kit_class_name("---"), "");
    }

    #[test]
    fn distinct_kit_ids_dedupes_and_excludes_empty_in_first_appearance_order() {
        let ids = vec![
            "".to_string(),
            "kit-b".to_string(),
            "kit-a".to_string(),
            "kit-b".to_string(),
            "".to_string(),
        ];
        assert_eq!(distinct_kit_ids(&ids), vec!["kit-b".to_string(), "kit-a".to_string()]);
    }

    #[test]
    fn distinct_view_ids_dedupes_and_excludes_empty_in_first_appearance_order() {
        let ids = vec![
            "".to_string(),
            "view-b".to_string(),
            "view-a".to_string(),
            "view-b".to_string(),
            "".to_string(),
        ];
        assert_eq!(distinct_view_ids(&ids), vec!["view-b".to_string(), "view-a".to_string()]);
    }

    #[test]
    fn resolve_class_name_tier1_uses_the_composed_kits_own_slugified_name() {
        let (nodes, node_view_ids) = view_fixture();
        let node_kit_ids = vec!["kit-1".to_string(), "".to_string(), "".to_string()];
        let mut kit_names = HashMap::new();
        kit_names.insert("kit-1".to_string(), "Button".to_string());

        assert_eq!(
            resolve_class_name(0, &nodes, &node_view_ids, &node_kit_ids, &kit_names),
            "button"
        );
    }

    #[test]
    fn resolve_class_name_tier2_falls_back_to_primitive_type_for_a_kit_less_view() {
        let (nodes, node_view_ids) = view_fixture();
        let node_kit_ids = vec!["".to_string(), "".to_string(), "".to_string()];
        let kit_names = HashMap::new();

        assert_eq!(
            resolve_class_name(0, &nodes, &node_view_ids, &node_kit_ids, &kit_names),
            "box"
        );
    }

    #[test]
    fn resolve_class_name_tier3_falls_back_to_positional_for_structural_scaffolding() {
        let nodes = vec![UiNode::Box(crate::test_support::test_box(None))];
        let node_view_ids = vec![String::new()];
        let node_kit_ids = vec![String::new()];
        let kit_names = HashMap::new();

        assert_eq!(
            resolve_class_name(0, &nodes, &node_view_ids, &node_kit_ids, &kit_names),
            "k10-0"
        );
    }

    #[test]
    fn all_composed_kit_ids_unions_node_kit_ids_and_view_compositions_first_appearance() {
        let node_kit_ids = vec!["kit-a".to_string(), "".to_string()];
        let mut view_compositions = HashMap::new();
        view_compositions.insert(
            "view-a".to_string(),
            vec!["kit-b".to_string(), "kit-a".to_string()],
        );
        let ids = all_composed_kit_ids(&node_kit_ids, &view_compositions);
        assert_eq!(ids, vec!["kit-a".to_string(), "kit-b".to_string()]);
    }

    #[test]
    fn view_primitive_is_box_maps_box_and_text_views_excludes_img() {
        let nodes = vec![
            UiNode::Box(crate::test_support::test_box(None)),
            UiNode::Img(kit10_scene::ImgData {
                parent_id: None,
                width: kit10_scene::Extent::Px(1.0),
                height: kit10_scene::Extent::Px(1.0),
                source: kit10_scene::ImageSource::None,
                fit: "cover".to_string(),
                object_position: [0.5, 0.5],
                selected: 0,
                hovered: false,
            }),
        ];
        let node_view_ids = vec!["view-box".to_string(), "view-img".to_string()];
        let map = view_primitive_is_box(&nodes, &node_view_ids);
        assert_eq!(map.get("view-box"), Some(&true));
        assert_eq!(map.get("view-img"), None);
    }

    #[test]
    fn resolve_class_names_returns_only_the_primary_when_the_view_composes_one_kit() {
        let (nodes, node_view_ids) = view_fixture();
        let node_kit_ids = vec!["kit-1".to_string(), "".to_string(), "".to_string()];
        let mut kit_names = HashMap::new();
        kit_names.insert("kit-1".to_string(), "Button".to_string());
        let mut view_compositions = HashMap::new();
        view_compositions.insert("view-a".to_string(), vec!["kit-1".to_string()]);

        assert_eq!(
            resolve_class_names(0, &nodes, &node_view_ids, &node_kit_ids, &kit_names, &view_compositions),
            vec!["button".to_string()]
        );
    }

    #[test]
    fn resolve_class_names_appends_every_other_composed_kit_in_composition_order() {
        let (nodes, node_view_ids) = view_fixture();
        // node_kit_ids names Priority as the single Charter-picked "winning" kit for node 0.
        let node_kit_ids = vec!["kit-priority".to_string(), "".to_string(), "".to_string()];
        let mut kit_names = HashMap::new();
        kit_names.insert("kit-priority".to_string(), "Priority".to_string());
        kit_names.insert("kit-density".to_string(), "Density".to_string());
        let mut view_compositions = HashMap::new();
        view_compositions.insert(
            "view-a".to_string(),
            vec!["kit-density".to_string(), "kit-priority".to_string()],
        );

        let classes =
            resolve_class_names(0, &nodes, &node_view_ids, &node_kit_ids, &kit_names, &view_compositions);
        // Primary first, then the other composed kit, then a 2+-kit view's composition-signature
        // class (see composition_signature_class's own doc comment for why it's needed at all).
        assert_eq!(classes[0], "priority");
        assert_eq!(classes[1], "density");
        assert_eq!(classes.len(), 3);
        assert!(classes[2].starts_with("comp-"));
    }

    #[test]
    fn composition_signature_class_is_order_sensitive() {
        let forward = vec!["kit-density".to_string(), "kit-priority".to_string()];
        let reversed = vec!["kit-priority".to_string(), "kit-density".to_string()];
        assert_ne!(composition_signature_class(&forward), composition_signature_class(&reversed));
        // Same order, same signature -- lets two views with identical composition safely share
        // one disambiguating rule.
        assert_eq!(composition_signature_class(&forward), composition_signature_class(&forward.clone()));
    }

    #[test]
    fn resolve_class_name_falls_through_to_tier2_when_the_kit_name_is_unresolvable() {
        let (nodes, node_view_ids) = view_fixture();
        // node_kit_ids names a kit id kit_names has no entry for (e.g. the export shape fetch
        // never returned it) -- must fall through to tier 2, not silently emit "".
        let node_kit_ids = vec!["kit-unknown".to_string(), "".to_string(), "".to_string()];
        let kit_names = HashMap::new();

        assert_eq!(
            resolve_class_name(0, &nodes, &node_view_ids, &node_kit_ids, &kit_names),
            "box"
        );
    }

    fn test_img(source: kit10_scene::ImageSource) -> UiNode {
        UiNode::Img(kit10_scene::ImgData {
            parent_id: None,
            width: kit10_scene::Extent::Px(100.0),
            height: kit10_scene::Extent::Px(100.0),
            source,
            fit: "cover".to_string(),
            object_position: [0.5, 0.5],
            selected: 0,
            hovered: false,
        })
    }

    #[test]
    fn resolved_img_src_returns_the_link_for_a_ref_source_present_in_the_map() {
        let node = test_img(kit10_scene::ImageSource::Ref("asset-1".to_string()));
        let mut links = HashMap::new();
        links.insert("asset-1".to_string(), "/1x/favicon.png".to_string());
        assert_eq!(resolved_img_src(&node, &links), Some("/1x/favicon.png"));
    }

    #[test]
    fn resolved_img_src_is_none_for_a_ref_source_with_no_known_link() {
        let node = test_img(kit10_scene::ImageSource::Ref("asset-1".to_string()));
        let links = HashMap::new();
        assert_eq!(resolved_img_src(&node, &links), None);
    }

    #[test]
    fn resolved_img_src_is_none_for_none_and_bytes_sources() {
        let links = HashMap::new();
        assert_eq!(resolved_img_src(&test_img(kit10_scene::ImageSource::None), &links), None);
        assert_eq!(
            resolved_img_src(&test_img(kit10_scene::ImageSource::Bytes(vec![1, 2, 3])), &links),
            None
        );
    }

    #[test]
    fn resolved_img_src_is_none_for_a_non_img_node() {
        let node = UiNode::Box(crate::test_support::test_box(None));
        let mut links = HashMap::new();
        links.insert("asset-1".to_string(), "/x.png".to_string());
        assert_eq!(resolved_img_src(&node, &links), None);
    }
}
