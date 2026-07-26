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

export type InterpreterOutputPayload =
	| {
			available: true;
			viewport_data: UiNode[];
			node_view_ids: string[];
			categories: FieldCategory[];
			font_requests: FontRequest[];
	  }
	| { available: false; reason: 'binary-only' };

// viewportData/viewportDataBinary/nodeViewIds/categories/fontRequests are exactly the module-
// level $state PluginManager already maintains in manager.svelte.ts (populated by runResolve /
// makeSelectionChangeRunner) -- this function just decides what to hand a REQUESTING plugin,
// never mutates or refetches anything itself.
export function buildInterpreterOutputPayload(
	viewportData: string,
	viewportDataBinary: Uint8Array | null,
	nodeViewIds: string[],
	categories: FieldCategory[],
	fontRequests: FontRequest[]
): InterpreterOutputPayload {
	// The binary path exists purely so Vellum's Rust side can skip a JSON parse at scale (see
	// OnResolveResult.viewport_data_binary's doc comment) -- nothing on the JS host ever decodes
	// it back, so a third plugin asking for JSON gets an honest "not available" instead of the
	// host silently handing back stale/empty JSON.
	if (viewportDataBinary) {
		return { available: false, reason: 'binary-only' };
	}
	return {
		available: true,
		viewport_data: JSON.parse(viewportData),
		node_view_ids: nodeViewIds,
		categories,
		font_requests: fontRequests
	};
}
