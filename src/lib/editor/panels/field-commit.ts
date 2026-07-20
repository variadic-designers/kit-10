// Shared, token-aware write path for every Render-panel field widget (StyleField + the composite
// ColorField/WeightField/ArrangeField/ResizeField). Before this existed, each widget committed a
// value by calling `onFieldUpdate({ layerId, property, value })` with no `tokenId` — which routes
// through `kit10_write_render_entry_to_layer` → `updateRenderEntryValue(..., token_id ?? null)` and
// so SILENTLY cleared the token link, converting a token-backed property to a one-off literal the
// moment a designer nudged a stepper or dragged a slider. Centralizing the write here makes the
// token/literal decision explicit and identical across every widget.
//
// Semantics (per the approved plan):
//   - token-backed (isToken && tokenId): edit the *shared token's* value via `updateTokenValue`, so
//     the change propagates to every property/view referencing that alias — the whole point of a
//     token. NEVER incidentally detached.
//   - literal: write the render entry's literal value, exactly as before.
//   - detaching a token to a literal is a separate, explicit action (`detachToken`), never a side
//     effect of editing.
//
// This is an editor-only data-integrity concern — no Charter/plugin involvement (the plugin-agnostic
// boundary is unaffected; the editor is just deciding how its own widgets persist writes).

import type { Api } from 'manager';
import type { FieldUpdate } from '$lib/plugins/types.js';

// The minimal token/layer facts a commit needs. Both StyleField's flat props and the composite
// fields' `track(key)` result (TrackInfo) structurally satisfy this.
export interface CommitTarget {
	sourceLayerId: string | null;
	isToken: boolean;
	tokenId: string | null;
}

export interface CommitCtx {
	onFieldUpdate?: (u: FieldUpdate) => void;
	api?: Api;
}

/**
 * Commit a new scalar value for a property, respecting token backing. Token-backed properties edit
 * the shared token; literals write the render entry as before. Returns true if a write was issued.
 */
export function commitFieldValue(
	target: CommitTarget,
	property: string,
	newValue: string,
	ctx: CommitCtx
): boolean {
	if (target.isToken && target.tokenId) {
		if (!ctx.api) {
			console.warn(`Cannot update token for ${property}: no api in context`);
			return false;
		}
		ctx.api.updateTokenValue(target.tokenId, { type: 'scalar', value: newValue });
		return true;
	}
	if (!ctx.onFieldUpdate) return false;
	if (!target.sourceLayerId) {
		console.warn(`Cannot update ${property}: no source layer`);
		return false;
	}
	ctx.onFieldUpdate({ layerId: target.sourceLayerId, property, value: newValue });
	return true;
}

/**
 * Point a property's render entry at an existing token (drag-drop attach, pipette, etc.).
 */
export function attachToken(
	target: CommitTarget,
	property: string,
	tokenId: string,
	onFieldUpdate?: (u: FieldUpdate) => void
): void {
	if (!onFieldUpdate || !target.sourceLayerId) return;
	onFieldUpdate({ layerId: target.sourceLayerId, property, tokenId });
}

/**
 * Explicitly detach a token-backed property back to a literal, seeded with the token's current
 * resolved value. The token itself is untouched — other references keep it. This is the ONLY path
 * that severs the token link; editing never does.
 */
export function detachToken(
	target: CommitTarget,
	property: string,
	currentValue: string,
	onFieldUpdate?: (u: FieldUpdate) => void
): void {
	if (!onFieldUpdate || !target.sourceLayerId) return;
	onFieldUpdate({ layerId: target.sourceLayerId, property, value: currentValue });
}
