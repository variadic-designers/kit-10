import { describe, it, expect } from 'vitest';
import { resolveImportProviders } from './project-import-providers.js';
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

describe('resolveImportProviders', () => {
	it('produces no entries for a plugin with no provides at all', () => {
		const charter = plugin({ name: 'charter', kind: 'interpreter', manifest: { wasm: [] } });
		expect(resolveImportProviders([charter])).toEqual([]);
	});

	it('produces no entries for a plugin whose provides has no imports', () => {
		const exportOnly = plugin({
			name: 'exporter',
			manifest: {
				wasm: [],
				provides: { exports: [{ label: 'X', fn: 'x', fileExtension: 'x', mimeType: 'text/x' }] }
			}
		});
		expect(resolveImportProviders([exportOnly])).toEqual([]);
	});

	it('flattens each plugin\'s declared import capabilities, attaching that plugin\'s own name as id', () => {
		const tenner = plugin({
			name: 'tenner',
			manifest: {
				wasm: [],
				provides: {
					imports: [{ label: 'Import Raw with Tenner', fn: 'import_project', accept: '.yaml,.yml' }]
				}
			}
		});
		const webcodium = plugin({
			name: 'webcodium',
			manifest: {
				wasm: [],
				provides: { imports: [{ label: 'Import HTML', fn: 'import_html', accept: '.html' }] }
			}
		});

		expect(resolveImportProviders([tenner, webcodium])).toEqual([
			{ id: 'tenner', label: 'Import Raw with Tenner', fn: 'import_project', accept: '.yaml,.yml' },
			{ id: 'webcodium', label: 'Import HTML', fn: 'import_html', accept: '.html' }
		]);
	});
});
