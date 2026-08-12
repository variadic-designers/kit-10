import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestDb, type TestContext } from './test-helpers.js';
import { registerBuiltinPlugins } from './plugins-bootstrap.js';

describe('registerBuiltinPlugins', () => {
	let ctx: TestContext;

	beforeEach(async () => {
		ctx = await createTestDb();
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({ arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }))
		);
	});

	afterEach(async () => {
		await ctx.pg.close();
		vi.unstubAllGlobals();
	});

	it('registers charter as an interpreter and fontavious/tenner/webcodium/pdf as utilities, all hashed', async () => {
		const { charter, fontavious, tenner, webcodium, pdf } = await registerBuiltinPlugins(ctx.db);

		expect(charter.name).toBe('charter');
		expect(charter.kind).toBe('interpreter');
		expect(charter.manifest).toEqual({
			wasm: [{ url: '/charter.wasm' }],
			capabilities: { hostFns: ['kit10_write_render_entry_to_layer', 'kit10_panel_publish'] }
		});
		expect(charter.content_hash).toMatch(/^[0-9a-f]{64}$/);

		expect(fontavious.name).toBe('fontavious');
		expect(fontavious.kind).toBe('utility');
		expect(fontavious.manifest).toEqual({
			wasm: [{ url: '/fontavious.wasm' }],
			capabilities: {
				hostFns: ['kit10_font_cache_get', 'kit10_font_cache_put', 'kit10_kv_get'],
				hosts: ['fonts.gstatic.com', 'cdn.fontshare.com', 'cdn.jsdelivr.net']
			}
		});
		expect(fontavious.options).toEqual({
			allowedHosts: ['fonts.gstatic.com', 'cdn.fontshare.com', 'cdn.jsdelivr.net']
		});
		expect(fontavious.content_hash).toMatch(/^[0-9a-f]{64}$/);

		expect(tenner.name).toBe('tenner');
		expect(tenner.kind).toBe('utility');
		expect(tenner.manifest).toEqual({
			wasm: [{ url: '/tenner.wasm' }],
			provides: {
				exports: [
					{
						label: 'Export Raw with Tenner',
						fn: 'export_project',
						fileExtension: 'yaml',
						mimeType: 'text/yaml',
						target: 'yaml',
						compressedVariant: {
							fn: 'export_project_gz',
							fileExtension: 'yaml.gz',
							mimeType: 'application/gzip'
						}
					}
				],
				imports: [
					{ label: 'Import Raw with Tenner', fn: 'import_project', accept: '.yaml,.yml' },
					{
						label: 'Import Raw with Tenner (Compressed)',
						fn: 'import_project_gz',
						accept: '.gz',
						binary: true
					}
				]
			},
			capabilities: { hostFns: ['kit10_get_project_export', 'kit10_import_project_data'] }
		});
		expect(tenner.content_hash).toMatch(/^[0-9a-f]{64}$/);

		expect(webcodium.name).toBe('webcodium');
		expect(webcodium.kind).toBe('utility');
		expect(webcodium.manifest).toEqual({
			wasm: [{ url: '/webcodium.wasm' }],
			provides: {
				exports: [
					{
						label: 'Export HTML + CSS with WebCodium',
						fn: 'export_html_css',
						fileExtension: 'html',
						mimeType: 'text/html',
						target: 'html',
						viewScoped: true
					}
				]
			},
			capabilities: {
				hostFns: [
					'kit10_get_interpreter_output',
					'kit10_get_kit_export_shape',
					'kit10_get_asset_links',
					'kit10_get_font_links',
					'kit10_get_project_tokens',
					'kit10_get_view_axis_args',
					'kit10_get_view_compositions'
				]
			}
		});
		expect(webcodium.content_hash).toMatch(/^[0-9a-f]{64}$/);

		expect(pdf.name).toBe('pdf');
		expect(pdf.kind).toBe('utility');
		expect(pdf.manifest).toEqual({
			wasm: [{ url: '/pdf.wasm' }],
			provides: {
				exports: [
					{
						label: 'Export PDF',
						fn: 'export_pdf',
						fileExtension: 'pdf',
						mimeType: 'application/pdf',
						target: 'pdf',
						viewScoped: true,
						binary: true,
						options: [
							{
								id: 'page_size',
								label: 'Page size',
								kind: 'select',
								default: 'fit',
								options: [
									{ value: 'fit', label: 'Fit to artwork' },
									{ value: 'letter', label: 'US Letter (8.5 × 11 in)' },
									{ value: 'legal', label: 'US Legal (8.5 × 14 in)' },
									{ value: 'tabloid', label: 'Tabloid (11 × 17 in)' },
									{ value: 'a3', label: 'A3' },
									{ value: 'a4', label: 'A4' },
									{ value: 'a5', label: 'A5' }
								]
							},
							{
								id: 'orientation',
								label: 'Orientation',
								kind: 'select',
								default: 'auto',
								options: [
									{ value: 'auto', label: 'Match artwork' },
									{ value: 'portrait', label: 'Portrait' },
									{ value: 'landscape', label: 'Landscape' }
								]
							},
							{
								id: 'fit_mode',
								label: 'Artwork fit',
								kind: 'select',
								default: 'fit_to_page',
								options: [
									{ value: 'fit_to_page', label: 'Fit to page (scaled, centered)' },
									{ value: 'actual_size', label: 'Actual size (may overflow the page)' },
									{ value: 'fill_and_crop', label: 'Fill page and crop overflow' }
								]
							},
							{ id: 'dpi', label: 'DPI', kind: 'number', default: '150', min: 72, max: 600 },
							{ id: 'reflow', label: 'Reflow to page size', kind: 'toggle', default: 'true' }
						]
					}
				]
			},
			capabilities: {
				hostFns: ['kit10_get_interpreter_output', 'kit10_get_asset_bytes', 'kit10_get_font_bytes']
			}
		});
		expect(pdf.content_hash).toMatch(/^[0-9a-f]{64}$/);
	});

	it('is idempotent -- re-running upserts the same rows instead of duplicating', async () => {
		await registerBuiltinPlugins(ctx.db);
		await registerBuiltinPlugins(ctx.db);

		const all = await ctx.db.selectFrom('plugins').selectAll().execute();
		expect(all).toHaveLength(5);
	});

	it('falls back to a null content_hash if the fetch fails, without throwing', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new Error('network down');
			})
		);

		const { charter } = await registerBuiltinPlugins(ctx.db);
		expect(charter.content_hash).toBeNull();
	});
});
