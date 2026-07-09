import { describe, it, expect } from 'vitest';
import { rowsKey, resolveViewsFromRows, type ResolutionRows } from './resolve.js';

// Minimal rows fixture -- empty is enough to test key sensitivity (every field change
// must flip the key) and resolveViewsFromRows purity (same rows → same output).
function emptyRows(): ResolutionRows {
	return {
		viewRows: [],
		compositions: [],
		axisArgsRows: [],
		projectTokens: [],
		viewTokenRows: [],
		kitTokenRows: [],
		layers: [],
		conditions: [],
		entries: []
	};
}

function clone(rows: ResolutionRows): ResolutionRows {
	return {
		viewRows: [...rows.viewRows],
		compositions: [...rows.compositions],
		axisArgsRows: [...rows.axisArgsRows],
		projectTokens: [...rows.projectTokens],
		viewTokenRows: [...rows.viewTokenRows],
		kitTokenRows: [...rows.kitTokenRows],
		layers: [...rows.layers],
		conditions: [...rows.conditions],
		entries: [...rows.entries]
	};
}

describe('rowsKey (input-level dedup)', () => {
	it('identical rows produce identical keys', () => {
		const a = emptyRows();
		const b = clone(a);
		expect(rowsKey(a)).toBe(rowsKey(b));
	});

	it('changing any single rowset flips the key', () => {
		const base = emptyRows();
		const baseKey = rowsKey(base);

		// Mutate each rowset one at a time and confirm the key differs.
		const mutations: [string, (rows: ResolutionRows) => void][] = [
			['viewRows', (r) => r.viewRows.push({ id: 'v1', name: 'V', hints: null })],
			[
				'compositions',
				(r) =>
					r.compositions.push({ view_id: 'v1', kit_id: 'k1', priority_index: 0, kit_name: 'K' })
			],
			[
				'axisArgsRows',
				(r) => r.axisArgsRows.push({ view_id: 'v1', kit_id: 'k1', axis_id: 'a1', value: null })
			],
			['projectTokens', (r) => r.projectTokens.push({ alias: 'p', value: null })],
			['viewTokenRows', (r) => r.viewTokenRows.push({ view_id: 'v1', alias: 'p', value: null })],
			['kitTokenRows', (r) => r.kitTokenRows.push({ alias: 'p', value: null, kit_id: 'k1' })],
			['layers', (r) => r.layers.push({ id: 'l1', kit_id: 'k1' })],
			[
				'conditions',
				(r) => r.conditions.push({ layer_id: 'l1', value: null, axis_id: 'a1', priority_index: 0 })
			],
			[
				'entries',
				(r) =>
					r.entries.push({
						layer_id: 'l1',
						property: 'color',
						literal_value: '#fff',
						token_id: null,
						token_alias: null,
						token_value: null
					})
			]
		];

		for (const [name, mutate] of mutations) {
			const rows = clone(base);
			mutate(rows);
			expect(rowsKey(rows), `${name} change should flip the key`).not.toBe(baseKey);
		}
	});

	it('changing a column value (not just adding a row) flips the key', () => {
		const rows = emptyRows();
		rows.viewRows.push({ id: 'v1', name: 'Before', hints: null });
		const beforeKey = rowsKey(rows);

		rows.viewRows[0]!.name = 'After';
		expect(rowsKey(rows)).not.toBe(beforeKey);
	});
});

describe('resolveViewsFromRows (purity)', () => {
	it('same rows always produce same output (dedup safety)', () => {
		const rows = emptyRows();
		rows.viewRows.push({ id: 'v1', name: 'V', hints: null });

		const out1 = resolveViewsFromRows(clone(rows));
		const out2 = resolveViewsFromRows(clone(rows));
		expect(JSON.stringify(out1)).toBe(JSON.stringify(out2));
	});

	it('empty rows produce empty output', () => {
		expect(resolveViewsFromRows(emptyRows())).toEqual([]);
	});
});
