import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Api } from 'manager';

// Focused coverage for the host-fn capability grant (see makeHostFunctions in
// manager.svelte.ts): a plugin whose manifest declares `capabilities.hostFns` should only
// receive exactly that subset of kit10_* functions; a plugin with no declaration at all should
// still receive the full set (additive rollout, same posture as `provides`).
//
// @extism/extism is mocked to capture whatever `functions` object createPlugin was actually
// called with, without needing a real WASM runtime.
let lastFunctions: Record<string, unknown> | undefined;

vi.mock('@extism/extism', () => ({
	default: vi.fn(async (_manifest: unknown, options: { functions?: Record<string, unknown> }) => {
		lastFunctions = options.functions?.['extism:host/user'] as Record<string, unknown>;
		return { call: vi.fn(async () => ({ text: () => '{}' })) };
	})
}));

const { createPluginManager } = await import('./manager.svelte.js');

describe('makeHostFunctions capability grants', () => {
	beforeEach(() => {
		lastFunctions = undefined;
	});

	it('restricts loadPlugin to exactly the declared hostFns', async () => {
		const manager = createPluginManager({} as Api);
		await manager.loadPlugin({} as never, 'charter', [
			'kit10_write_render_entry_to_layer',
			'kit10_panel_publish'
		]);

		expect(Object.keys(lastFunctions ?? {}).sort()).toEqual(
			['kit10_panel_publish', 'kit10_write_render_entry_to_layer'].sort()
		);
	});

	it('grants the full function set when no capabilities are declared', async () => {
		const manager = createPluginManager({} as Api);
		await manager.loadPlugin({} as never, 'legacy-plugin');

		const keys = Object.keys(lastFunctions ?? {});
		expect(keys).toContain('kit10_log');
		expect(keys).toContain('kit10_write_render_entry_to_layer');
		expect(keys).toContain('kit10_get_project_export');
		expect(keys.length).toBeGreaterThan(2);
	});

	it('restricts loadUtilityPlugin the same way, alongside its options', async () => {
		const manager = createPluginManager({} as Api);
		await manager.loadUtilityPlugin(
			{} as never,
			'fontavious',
			{ allowedHosts: ['fonts.gstatic.com'] },
			['kit10_font_cache_get', 'kit10_font_cache_put', 'kit10_kv_get']
		);

		expect(Object.keys(lastFunctions ?? {}).sort()).toEqual(
			['kit10_font_cache_get', 'kit10_font_cache_put', 'kit10_kv_get'].sort()
		);
	});
});
