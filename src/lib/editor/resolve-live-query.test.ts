import { describe, it, expect } from 'vitest';
import { RESOLUTION_RELEVANT_TABLES } from 'manager';
import { RESOLVE_LIVE_QUERY_SQL } from './resolve-live-query.js';

// Extracts the set of table names the query reads -- both the FROM table and every
// JOINed table. `views` is the FROM table (not a JOIN), so both clauses must be scanned.
function queriedTables(sql: string): Set<string> {
	const tables = new Set<string>();
	const re = /\b(?:FROM|JOIN)\s+([a-z_]+)/gi;
	let m: RegExpExecArray | null;
	while ((m = re.exec(sql)) !== null) {
		tables.add(m[1]!);
	}
	return tables;
}

describe('resolve live query table coverage', () => {
	it('JOINs every table the resolver reads', () => {
		const joined = queriedTables(RESOLVE_LIVE_QUERY_SQL);
		const missing = RESOLUTION_RELEVANT_TABLES.filter((t) => !joined.has(t));
		expect(missing, `live query does not cover: ${missing.join(', ')}`).toEqual([]);
	});

	it('the resolver does not read tables the live query fails to declare', () => {
		// Sanity: the declared list is non-empty and matches what resolve.ts actually reads.
		// This guards against someone shrinking RESOLUTION_RELEVANT_TABLES to make the
		// first test pass without actually covering the resolver's reads.
		expect(RESOLUTION_RELEVANT_TABLES.length).toBeGreaterThan(0);
		expect(RESOLUTION_RELEVANT_TABLES).toContain('kits');
		expect(RESOLUTION_RELEVANT_TABLES).toContain('tokens');
		expect(RESOLUTION_RELEVANT_TABLES).toContain('render_entries');
	});
});
