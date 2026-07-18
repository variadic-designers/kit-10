import { describe, it, expect } from 'vitest';
import { parsePreferenceDefsExport } from './preferences.js';

describe('parsePreferenceDefsExport', () => {
	const defs = [{ id: 'a', label: 'A', kind: 'toggle', default: 'true' }];

	it('decodes an Extism PluginOutput (object with .text())', () => {
		// This is the shape plugin.call actually returns -- the regression that made every plugin
		// report "no settings" was NOT calling .text() here.
		const output = { text: () => JSON.stringify(defs) };
		expect(parsePreferenceDefsExport(output)).toEqual(defs);
	});

	it('accepts a raw JSON string', () => {
		expect(parsePreferenceDefsExport(JSON.stringify(defs))).toEqual(defs);
	});

	it('accepts an already-parsed array', () => {
		expect(parsePreferenceDefsExport(defs)).toEqual(defs);
	});

	it('drops malformed entries and non-arrays', () => {
		expect(parsePreferenceDefsExport('not json')).toEqual([]);
		expect(parsePreferenceDefsExport({ text: () => '{"not":"array"}' })).toEqual([]);
		expect(parsePreferenceDefsExport([{ id: 'x' }])).toEqual([]); // missing label/kind
	});
});
