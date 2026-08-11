import type { SchemaDialect, PluginManifest } from './schema.js';
import { queryBuilder, type Api, type PluginRow } from './api/index.js';

const CHARTER_MANIFEST: PluginManifest = {
	wasm: [{ url: '/charter.wasm' }],
	// Charter's own extern block (plugins/charter/src/lib.rs) only declares these two --
	// keep this list in sync with the Rust side; a call to a fn not listed here silently
	// disappears from `functions` (see makeHostFunctions' filtering) with no dedicated error.
	capabilities: { hostFns: ['kit10_write_render_entry_to_layer', 'kit10_panel_publish'] }
};

// Runtime font-file hosts fetch_font is allowed to reach. gstatic serves the OFL/Google tier;
// cdn.fontshare.com serves the free-proprietary Fontshare tier (Satoshi, Clash, etc.). The
// Fontshare *API* host (api.fontshare.com) is deliberately NOT here -- it's only used by the
// build-time catalogue generator, never by the plugin at runtime. Single source of truth for
// both the declared `capabilities.hosts` (below) and the actual Extism `allowedHosts` option
// (FONTAVIOUS_OPTIONS) -- these used to be two independent literals that could silently drift.
const FONTAVIOUS_HOSTS = ['fonts.gstatic.com', 'cdn.fontshare.com'];
const FONTAVIOUS_MANIFEST: PluginManifest = {
	wasm: [{ url: '/fontavious.wasm' }],
	capabilities: {
		hostFns: ['kit10_font_cache_get', 'kit10_font_cache_put', 'kit10_kv_get'],
		hosts: FONTAVIOUS_HOSTS
	}
};
const FONTAVIOUS_OPTIONS = { allowedHosts: FONTAVIOUS_HOSTS };
const TENNER_MANIFEST: PluginManifest = {
	wasm: [{ url: '/tenner.wasm' }],
	provides: {
		exports: [
			{
				label: 'Export Raw with Tenner',
				fn: 'export_project',
				fileExtension: 'yaml',
				mimeType: 'text/yaml',
				target: 'yaml',
				// Same underlying YAML dump, gzip-compressed then base64-encoded by export_project_gz
				// -- a normalized-DB-shaped export (small repeated enum strings/ids across many rows)
				// compresses very well with no format changes needed.
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
};

// Same manifest shape as plugin-catalogue.ts's webcodium entry (kept in sync by hand -- that
// file is app-side, this one is the manager package, so it can't be imported directly).
const WEBCODIUM_MANIFEST: PluginManifest = {
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
	// Must list every host fn WebCodium actually calls -- declaring this at all switches
	// makeHostFunctions from "full set, ungated" to "exactly this list" (see PluginCapabilities'
	// own doc comment), so omitting kit10_get_interpreter_output here would silently break the
	// existing Phase 1/2 export path the moment Phase 3's kit10_get_kit_export_shape is added.
	// kit10_get_asset_links backs Img export support (resolving an asset id to a real URL).
	// kit10_get_font_links backs @font-face export support (resolving a font request to the real
	// URL Fontavious would fetch, no hardcoded provider/URL anywhere in this plugin).
	// kit10_get_project_tokens backs the `:root` CSS custom-property export (project-scope tokens
	// only, see variants::ProjectTokens' doc comment on the Rust side).
	// kit10_get_view_axis_args backs per-instance variant modifier classes -- which of a Kit's
	// variant rules a given exported element's class="" attribute should actually carry, decided
	// from that element's own view's resolved axis args (see rule_matches_args on the Rust side).
	// kit10_get_view_compositions backs multi-kit class emission and cross-kit contested-property
	// disambiguation -- the full ordered list of kits a view composes, which Charter's own
	// node_kit_ids (a single collapsed "winning" kit per node) can't answer.
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
};

// Same manifest shape as plugin-catalogue.ts's pdf entry (kept in sync by hand, same posture as
// WebCodium's own comment above).
const PDF_MANIFEST: PluginManifest = {
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
				// export_pdf's only output IS binary (base64-encoded PDF bytes, no plain-text variant)
				// -- without this, the download path writes the base64 TEXT itself as the .pdf file's
				// contents instead of decoding it back to real bytes (see ExportCapability.binary's own
				// doc comment). A real bug this project shipped once already.
				binary: true,
				// Mirrors plugins/pdf/src/page.rs's PageSize/Orientation/FitMode/dpi exactly (see that
				// module's doc comments for what each option actually controls) -- Export.svelte
				// renders this list generically, it has no idea these are PDF-specific.
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
					// Reflows content to the chosen paper size (Percent widths/flex-wrap/flex-basis
					// re-resolve against the new width, same as a browser reflowing on viewport
					// resize) instead of laying the artwork out once at its own natural size and
					// scaling/cropping the result to fit -- see plugins/pdf/src/page.rs's own doc
					// comment on PdfOptions.reflow. On by default; irrelevant for "Fit to artwork".
					{ id: 'reflow', label: 'Reflow to page size', kind: 'toggle', default: 'true' }
				]
			}
		]
	},
	// Box/Text/Img all shipped (see plugins/pdf/src/lib.rs's own doc comment) -- Shape/SpriteBatch
	// are the remaining follow-up. kit10_get_asset_bytes backs Img embedding (the actual pixel
	// bytes, not just a URL); kit10_get_font_bytes backs Text embedding (real WOFF2 bytes via
	// Fontavious's fetch_font, decompressed + parsed in plugins/pdf/src/fonts.rs).
	capabilities: {
		hostFns: ['kit10_get_interpreter_output', 'kit10_get_asset_bytes', 'kit10_get_font_bytes']
	}
};

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
	webcodium: PluginRow;
	pdf: PluginRow;
}

// Registers KIT-10's built-in plugins into the DB-backed catalogue (idempotent -- upserts
// by name), so projects can reference them by id instead of the editor hardcoding their
// manifest/name/options at mount time.
export async function registerBuiltinPlugins(dialect: SchemaDialect): Promise<BuiltinPlugins> {
	const api: Api = queryBuilder(dialect);

	const [charterHash, fontaviousHash, tennerHash, webcodiumHash, pdfHash] = await Promise.all([
		hashUrl(CHARTER_MANIFEST.wasm[0]!.url),
		hashUrl(FONTAVIOUS_MANIFEST.wasm[0]!.url),
		hashUrl(TENNER_MANIFEST.wasm[0]!.url),
		hashUrl(WEBCODIUM_MANIFEST.wasm[0]!.url),
		hashUrl(PDF_MANIFEST.wasm[0]!.url)
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

	// Lazy, same posture as Tenner -- an occasional explicit export action, not core to using the
	// editor. Registering it here (rather than requiring a manual /store install) is what makes
	// every project's HTML export resolve to WebCodium by default: resolveExportProfile's
	// single-provider fallback picks it automatically once it's the sole `html` target provider,
	// with no per-project hints.exportProfile write needed.
	const webcodium = await api.registerPlugin({
		name: 'webcodium',
		kind: 'utility',
		activation: 'lazy',
		manifest: WEBCODIUM_MANIFEST,
		contentHash: webcodiumHash
	});

	// Lazy, same posture as WebCodium -- an occasional explicit export action, registered here
	// (rather than requiring a manual /store install) so every project's PDF export resolves to
	// it by default with no per-project hints.exportProfile write needed.
	const pdf = await api.registerPlugin({
		name: 'pdf',
		kind: 'utility',
		activation: 'lazy',
		manifest: PDF_MANIFEST,
		contentHash: pdfHash
	});

	if (!charter || !fontavious || !tenner || !webcodium || !pdf)
		throw new Error('Failed to register builtin plugins');

	return { charter, fontavious, tenner, webcodium, pdf };
}
