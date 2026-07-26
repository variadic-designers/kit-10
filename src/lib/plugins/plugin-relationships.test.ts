import { describe, it, expect } from 'vitest';
import { resolvePluginRelationships } from './plugin-relationships.js';
import type { PluginRow } from 'manager';

const plugin = (overrides: Partial<PluginRow>): PluginRow => ({
	id: 'id',
	name: 'name',
	kind: 'utility',
	activation: null,
	manifest: { wasm: [] },
	options: null,
	content_hash: null,
	...overrides
});

describe('resolvePluginRelationships', () => {
	it('produces empty supports/dependencyOf for a plugin that declares no relationships', () => {
		const charter = plugin({ name: 'charter', kind: 'interpreter' });
		const [rel] = resolvePluginRelationships([charter]);
		expect(rel).toEqual({ name: 'charter', supports: [], dependencyOf: [] });
	});

	it('marks a supported plugin as installed when it is actually in the registry', () => {
		const charter = plugin({ name: 'charter', kind: 'interpreter' });
		const webcodium = plugin({ name: 'webcodium', manifest: { wasm: [], supports: ['charter'] } });

		const relationships = resolvePluginRelationships([charter, webcodium]);
		const webcodiumRel = relationships.find((r) => r.name === 'webcodium');

		expect(webcodiumRel!.supports).toEqual([{ name: 'charter', installed: true }]);
	});

	it('keeps a declared support entry even when the named plugin is not installed', () => {
		const webcodium = plugin({ name: 'webcodium', manifest: { wasm: [], supports: ['charter'] } });

		const [rel] = resolvePluginRelationships([webcodium]);

		expect(rel.supports).toEqual([{ name: 'charter', installed: false }]);
	});

	it('lists every installed plugin that declares support for this one as a dependent', () => {
		const charter = plugin({ name: 'charter', kind: 'interpreter' });
		const webcodium = plugin({ name: 'webcodium', manifest: { wasm: [], supports: ['charter'] } });
		const loomweave = plugin({
			name: 'loomweave',
			kind: 'interpreter',
			manifest: { wasm: [], supports: ['charter'] }
		});

		const relationships = resolvePluginRelationships([charter, webcodium, loomweave]);
		const charterRel = relationships.find((r) => r.name === 'charter');

		expect(charterRel!.dependencyOf.sort()).toEqual(['loomweave', 'webcodium']);
	});

	it('never lists a plugin as its own dependent, even if it names itself in supports', () => {
		const odd = plugin({ name: 'odd', manifest: { wasm: [], supports: ['odd'] } });

		const [rel] = resolvePluginRelationships([odd]);

		expect(rel.dependencyOf).toEqual([]);
	});
});
