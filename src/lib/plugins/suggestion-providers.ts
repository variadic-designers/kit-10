import type { InputType, SuggestionSource } from './types.js';

// Maps an inputType to *which* utility plugin currently serves suggestions for it. Charter (or
// any other plugin) only ever claims *what kind* of field something is (`inputType: 'font'` --
// "this holds a font family name") -- it never names a specific plugin, so it never needs to be
// recompiled to swap providers. This is the one place that decision lives, and it's editor/
// project-level config, not baked into any plugin's compiled output. See VISION.md's 1st
// Principle and the `feedback-editor-plugin-agnosticism` memory.
const defaultSuggestionProviders: Partial<Record<InputType, SuggestionSource>> = {
	font: { plugin: 'fontavious', searchFn: 'search_fonts', fetchFn: 'fetch_font' }
};

// Fontavious's fetch_font input contract, for the "font" inputType specifically -- kept here
// rather than types.ts (which stays generic across every inputType) since this is the one file
// already allowed to know inputType-specific details. Any caller that wants to specify weight/
// style explicitly (SuggestField.svelte's own picker deliberately doesn't -- it only ever sends
// `{ value }`, agnostic to what "font" even means) should build the payload through this type
// instead of an inline object literal: a field-name typo becomes a compile error instead of a
// silently-swallowed runtime rejection. That's exactly how `{ family, weight, style }` sat wrong
// (Fontavious's Rust struct expects `value`, not `family`) for a while, undetected -- the fetch
// silently rejected and the whole resolve-time scan just looked like it was doing nothing.
export interface FontFetchPayload {
	value: string;
	weight?: number;
	style?: string;
}

// A plugin's FieldDef can still pin an explicit `suggestionsFrom` itself (an escape hatch for
// when a plugin genuinely needs a specific, non-default provider) -- that always wins over the
// inputType-keyed default here.
export function resolveSuggestionSource(
	inputType: InputType | undefined,
	explicit: SuggestionSource | undefined
): SuggestionSource | undefined {
	if (explicit) return explicit;
	if (!inputType) return undefined;
	return defaultSuggestionProviders[inputType];
}
