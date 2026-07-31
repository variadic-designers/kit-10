// Public interpreter-output payload -- the concrete plumbing PluginManifest.supports was built
// toward. A plugin declaring `supports: ['charter']` documents that it understands Charter's
// specific translation opinions; this is what actually lets it READ that output, via the
// kit10_get_interpreter_output host function (manager.svelte.ts), gated the same way every other
// host fn is (capabilities.hostFns), not special-cased to any one plugin.
//
// Kept as a pure function, separate from the Extism glue, so it's testable without mocking
// cp/createPlugin -- same reasoning as resolveExportProviders/resolveExportProfile/
// resolvePluginRelationships.

import type { FieldCategory, FontRequest, UiNode } from './types.js';

// The `available: false` shape used to exist for a "binary-cached-only" case that never actually
// happens: Charter's viewport_data is a required field on both OnResolveResult and
// OnSelectionChangeResult, always sent alongside the optional viewport_data_binary, never instead
// of it (see the shared crate's structs) -- manager.svelte.ts now keeps its own viewportData
// state in sync with viewport_data independently of whichever binary path Vellum takes, so JSON
// is always current whenever a resolve has happened at all. Kept as a plain type (not a union)
// rather than a permanently-dead `available: false` branch nothing can construct.
export interface InterpreterOutputPayload {
	available: true;
	viewport_data: UiNode[];
	node_view_ids: string[];
	// Parallel to viewport_data/node_view_ids (same length/order) -- the highest-priority composed
	// Kit's id for each node, "" for structural scaffolding or a kit-less view. See Charter's
	// node_kit_ids doc comment (plugins/charter/src/lib.rs) and resources/webcodium-export-plan.md.
	node_kit_ids: string[];
	// Parallel to viewport_data/node_view_ids (same length/order) -- this node's OCCURRENCE key
	// (the referencing `view`-typed token's own id for a nested child, or the view's own id for a
	// root). See Charter's node_occurrence_ids doc comment (plugins/charter/src/lib.rs) and
	// view-tree.ts's ViewOccurrence.
	node_occurrence_ids: string[];
	categories: FieldCategory[];
	font_requests: FontRequest[];
}

// viewportData/nodeViewIds/nodeKitIds/nodeOccurrenceIds/categories/fontRequests are exactly the
// module-level $state PluginManager already maintains in manager.svelte.ts (populated by
// runResolve / makeSelectionChangeRunner) -- this function just decides what to hand a REQUESTING
// plugin, never mutates or refetches anything itself.
export function buildInterpreterOutputPayload(
	viewportData: string,
	nodeViewIds: string[],
	nodeKitIds: string[],
	nodeOccurrenceIds: string[],
	categories: FieldCategory[],
	fontRequests: FontRequest[]
): InterpreterOutputPayload {
	return {
		available: true,
		viewport_data: JSON.parse(viewportData),
		node_view_ids: nodeViewIds,
		node_kit_ids: nodeKitIds,
		node_occurrence_ids: nodeOccurrenceIds,
		categories,
		font_requests: fontRequests
	};
}
