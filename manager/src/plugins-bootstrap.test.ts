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

	it('registers charter as an interpreter and fontavious/tenner as utilities, all hashed', async () => {
		const { charter, fontavious, tenner } = await registerBuiltinPlugins(ctx.db);

		expect(charter.name).toBe('charter');
		expect(charter.kind).toBe('interpreter');
		expect(charter.manifest).toEqual({ wasm: [{ url: '/charter.wasm' }] });
		expect(charter.content_hash).toMatch(/^[0-9a-f]{64}$/);

		expect(fontavious.name).toBe('fontavious');
		expect(fontavious.kind).toBe('utility');
		expect(fontavious.options).toEqual({
			allowedHosts: ['fonts.gstatic.com', 'cdn.fontshare.com']
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
						mimeType: 'text/yaml'
					}
				],
				imports: [{ label: 'Import Raw with Tenner', fn: 'import_project', accept: '.yaml,.yml' }]
			}
		});
		expect(tenner.content_hash).toMatch(/^[0-9a-f]{64}$/);
	});

	it('is idempotent -- re-running upserts the same rows instead of duplicating', async () => {
		await registerBuiltinPlugins(ctx.db);
		await registerBuiltinPlugins(ctx.db);

		const all = await ctx.db.selectFrom('plugins').selectAll().execute();
		expect(all).toHaveLength(3);
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
