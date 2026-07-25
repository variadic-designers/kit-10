import { describe, it, expect } from 'vitest';
import { resolveExportProviders } from './project-export-providers.js';
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

describe('resolveExportProviders', () => {
	it('produces no entries for a plugin with no provides at all', () => {
		const charter = plugin({ name: 'charter', kind: 'interpreter', manifest: { wasm: [] } });
		expect(resolveExportProviders([charter])).toEqual([]);
	});

	it('produces no entries for a plugin whose provides has no exports', () => {
		const importOnly = plugin({
			name: 'importer',
			manifest: { wasm: [], provides: { imports: [{ label: 'X', fn: 'x', accept: '.x' }] } }
		});
		expect(resolveExportProviders([importOnly])).toEqual([]);
	});

	it('flattens each plugin\'s declared export capabilities, attaching that plugin\'s own name as id', () => {
		const tenner = plugin({
			name: 'tenner',
			manifest: {
				wasm: [],
				provides: {
					exports: [
						{ label: 'Export Raw with Tenner', fn: 'export_project', fileExtension: 'yaml', mimeType: 'text/yaml' }
					]
				}
			}
		});
		const webcodium = plugin({
			name: 'webcodium',
			manifest: {
				wasm: [],
				provides: {
					exports: [{ label: 'Export HTML', fn: 'export_html', fileExtension: 'html', mimeType: 'text/html' }]
				}
			}
		});

		expect(resolveExportProviders([tenner, webcodium])).toEqual([
			{
				id: 'tenner',
				label: 'Export Raw with Tenner',
				fn: 'export_project',
				fileExtension: 'yaml',
				mimeType: 'text/yaml'
			},
			{ id: 'webcodium', label: 'Export HTML', fn: 'export_html', fileExtension: 'html', mimeType: 'text/html' }
		]);
	});
});
