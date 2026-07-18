import type { SchemaDialect, PluginManifest } from './schema.js';
import { queryBuilder, type Api, type PluginRow } from './api/index.js';

const CHARTER_MANIFEST: PluginManifest = { wasm: [{ url: '/charter.wasm' }] };
const FONTAVIOUS_MANIFEST: PluginManifest = { wasm: [{ url: '/fontavious.wasm' }] };
// Runtime font-file hosts fetch_font is allowed to reach. gstatic serves the OFL/Google tier;
// cdn.fontshare.com serves the free-proprietary Fontshare tier (Satoshi, Clash, etc.). The
// Fontshare *API* host (api.fontshare.com) is deliberately NOT here -- it's only used by the
// build-time catalogue generator, never by the plugin at runtime.
const FONTAVIOUS_OPTIONS = { allowedHosts: ['fonts.gstatic.com', 'cdn.fontshare.com'] };
const TENNER_MANIFEST: PluginManifest = { wasm: [{ url: '/tenner.wasm' }] };

// Self-maintaining compatibility fingerprint -- hashes whatever's actually deployed at that
// URL right now, so it never drifts the way a hand-maintained version string would (both
// plugins are still sitting at an untouched Cargo.toml "0.1.0"). Best-effort only: a fetch
// failure just leaves content_hash null rather than blocking plugin registration, same
// graceful-degradation posture as the rest of the plugin-loading path.
async function hashUrl(url: string): Promise<string | null> {
	try {
		// `no-store` so the hash reflects the file actually deployed right now, not a cached copy --
		// otherwise a rebuilt plugin could hash to its old bytes and the `?v=` cache-bust (see the
		// editor's plugin load) would keep pinning the stale wasm.
		const bytes = await fetch(url, { cache: 'no-store' }).then((r) => r.arrayBuffer());
		const digest = await crypto.subtle.digest('SHA-256', bytes);
		return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
	} catch {
		return null;
	}
}

export interface BuiltinPlugins {
	charter: PluginRow;
	fontavious: PluginRow;
	tenner: PluginRow;
}

// Registers KIT-10's built-in plugins into the DB-backed catalogue (idempotent -- upserts
// by name), so projects can reference them by id instead of the editor hardcoding their
// manifest/name/options at mount time.
export async function registerBuiltinPlugins(dialect: SchemaDialect): Promise<BuiltinPlugins> {
	const api: Api = queryBuilder(dialect);

	const [charterHash, fontaviousHash, tennerHash] = await Promise.all([
		hashUrl(CHARTER_MANIFEST.wasm[0]!.url),
		hashUrl(FONTAVIOUS_MANIFEST.wasm[0]!.url),
		hashUrl(TENNER_MANIFEST.wasm[0]!.url)
	]);

	const charter = await api.registerPlugin({
		name: 'charter',
		kind: 'interpreter',
		manifest: CHARTER_MANIFEST,
		contentHash: charterHash
	});

	// Eager: font fetching is needed the moment any project has text to render, not a per-use
	// action -- loaded once, unconditionally, at editor boot regardless of which project (if
	// any) ends up active.
	const fontavious = await api.registerPlugin({
		name: 'fontavious',
		kind: 'utility',
		activation: 'eager',
		manifest: FONTAVIOUS_MANIFEST,
		options: FONTAVIOUS_OPTIONS,
		contentHash: fontaviousHash
	});

	// Lazy: an occasional, explicit user action (Project.svelte's Export/Import submenus), not
	// core to using the editor at all -- loads itself on first actual invocation instead of at
	// boot (see manager.svelte.ts's callUtilityPlugin).
	const tenner = await api.registerPlugin({
		name: 'tenner',
		kind: 'utility',
		activation: 'lazy',
		manifest: TENNER_MANIFEST,
		contentHash: tennerHash
	});

	if (!charter || !fontavious || !tenner) throw new Error('Failed to register builtin plugins');

	return { charter, fontavious, tenner };
}
