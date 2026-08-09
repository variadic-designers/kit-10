import type { PluginActivation, PluginManifest } from 'manager';

// The plugin store's data, shared between /store (server-rendered, deliberately kept out of the
// manager/PGlite bundle -- only type-only imports above, erased at build) and the editor's
// install handoff (Editor.svelte's pendingInstall -> Plugins.svelte's install form). Giving an
// entry a real `manifest` here is what lets Install pre-fill the form completely instead of just
// name+kind; entries with no manifest (the illustrative "Community" cards) fall back to today's
// name+kind-only handoff, since there's nothing real to fetch for them yet.

export type StoreKind = 'interpreter' | 'utility' | 'renderer';
export type StoreStatus = 'installed' | 'available' | 'soon';
export type StoreCapability =
	| 'network'
	| 'reads-design'
	| 'writes-design'
	| 'reads-project'
	| 'creates-project'
	| 'drives-canvas'
	| 'drives-panels';

export interface StorePlugin {
	id: string;
	name: string;
	author: string;
	kind: StoreKind;
	icon: string; // Font Awesome class
	tagline: string;
	provides: string[]; // what capabilities/roles it declares (badges)
	capabilities: StoreCapability[]; // host powers it requests
	version: string;
	status: StoreStatus;
	firstParty: boolean;
	// Present only for entries with real, fetchable wasm behind them -- lets the install handoff
	// pre-fill the Plugins panel's form completely (see Editor.svelte/Plugins.svelte).
	manifest?: PluginManifest;
	activation?: PluginActivation;
}

export const STORE_CATALOGUE: StorePlugin[] = [
	{
		id: 'charter',
		name: 'Charter',
		author: 'KIT•10',
		kind: 'interpreter',
		icon: 'fa-solid fa-diagram-project',
		tagline: 'Translates resolved kits into a flat render tree - the default viewport interpreter.',
		provides: ['Viewport', 'Render fields', 'Layout opinions'],
		capabilities: ['reads-design', 'writes-design', 'drives-canvas', 'drives-panels'],
		version: '0.1.0',
		status: 'installed',
		firstParty: true
	},
	{
		id: 'fontavious',
		name: 'Fontavious',
		author: 'KIT•10',
		kind: 'utility',
		icon: 'fa-solid fa-font',
		tagline: 'Font catalogue + fetch. Serves the font picker and streams WOFF2 to the renderer.',
		provides: ['Suggestions: font'],
		capabilities: ['network'],
		version: '0.1.0',
		status: 'installed',
		firstParty: true
	},
	{
		id: 'tenner',
		name: 'Tenner',
		author: 'KIT•10',
		kind: 'utility',
		icon: 'fa-solid fa-file-arrow-down',
		tagline: 'Raw project serialization - export and import a whole project as YAML.',
		provides: ['Export: YAML', 'Import: YAML'],
		capabilities: ['reads-project', 'creates-project'],
		version: '0.1.0',
		status: 'installed',
		firstParty: true
	},
	{
		id: 'webcodium',
		name: 'WebCodium',
		author: 'KIT•10',
		kind: 'utility',
		icon: 'fa-brands fa-html5',
		tagline: 'Export a view as real HTML + CSS - Box and Text nodes today.',
		provides: ['Export: HTML/CSS'],
		capabilities: ['reads-design'],
		version: '0.1.0',
		// Bootstrapped by manager/src/plugins-bootstrap.ts (registerBuiltinPlugins) like
		// Fontavious/Tenner, so every project's HTML export resolves to it by default with no
		// manual /store install -- see AGENTS.md's plugins/webcodium/ note.
		status: 'installed',
		firstParty: true,
		activation: 'lazy',
		manifest: {
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
		}
	},
	{
		id: 'glyphet',
		name: 'Glyphet',
		author: 'Community',
		kind: 'utility',
		icon: 'fa-solid fa-icons',
		tagline: 'Icon-set catalogue. Adds an "icon" field type with search across popular open sets.',
		provides: ['Suggestions: icon'],
		capabilities: ['network'],
		version: '0.2.0',
		status: 'available',
		firstParty: false
	},
	{
		id: 'weftcss',
		name: 'Weft',
		author: 'Community',
		kind: 'utility',
		icon: 'fa-brands fa-css3-shield',
		tagline: 'Export a view as production HTML + SCSS, with a live-vite stream to a dev server.',
		provides: ['Export: HTML/SCSS', 'Export: live-vite'],
		capabilities: ['reads-project'],
		version: '0.4.1',
		status: 'available',
		firstParty: false
	},
	{
		id: 'bridgeport',
		name: 'Bridgeport',
		author: 'Community',
		kind: 'utility',
		icon: 'fa-solid fa-right-left',
		tagline: 'Import from Figma & Penpot files, mapping frames and variants onto kits and axes.',
		provides: ['Import: .fig', 'Import: .penpot'],
		capabilities: ['creates-project'],
		version: '0.3.0',
		status: 'soon',
		firstParty: false
	},
	{
		id: 'loomweave',
		name: 'Loomweave',
		author: 'Community',
		kind: 'interpreter',
		icon: 'fa-solid fa-code',
		tagline: 'Alternative interpreter that emits a DOM-shaped tree instead of Charter primitives.',
		provides: ['Viewport', 'Render fields'],
		capabilities: ['reads-design', 'writes-design', 'drives-canvas', 'drives-panels'],
		version: '0.1.0-beta',
		status: 'soon',
		firstParty: false
	},
	{
		id: 'splatter',
		name: 'Splatter',
		author: 'Community',
		kind: 'renderer',
		icon: 'fa-solid fa-cubes',
		tagline: 'Experimental Gaussian-splatting renderer surface - a peek at a replaceable core.',
		provides: ['Renderer'],
		capabilities: ['drives-canvas'],
		version: '0.0.3',
		status: 'soon',
		firstParty: false
	}
];
