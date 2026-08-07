import type { SchemaDialect } from './schema.js';
import { queryBuilder, type Api } from './api/index.js';
import type { TokenValue } from './schema.js';
import type { BuiltinPlugins } from './plugins-bootstrap.js';

const s = (value: string): TokenValue => ({ type: 'scalar', value });

// Shared view/kit builders used by seedDemoProject's landing page section and every other
// seeded landing-page project below. Factored out once four call sites needed the identical
// boxKit/textKit/textView/boxView/imageKit/imageView/registerBundledAsset shapes; each closes
// over one project id so callers never have to thread it through every call.
function makeSeedHelpers(api: Api, projectId: string) {
	// A Box layout kit: all its properties baked on the null layer (unconditional).
	async function boxKit(name: string, props: Record<string, string>) {
		const kit = (await api.createKitInProject(projectId, name))!;
		const snip = (await api.createRenderSnippet((await api.createLayer(kit.id))!.id))!;
		for (const [k, v] of Object.entries(props)) await api.createRenderEntry(snip.id, k, v);
		return kit;
	}

	// A Text style kit: baked font/paint style + a token-backed `content` entry, so every view
	// composing it supplies its OWN text via a View-scope `content` token (which overrides the
	// kit default by alias). One style kit, many distinct-text views.
	async function textKit(name: string, style: Record<string, string>) {
		const kit = (await api.createKitInProject(projectId, name))!;
		const snip = (await api.createRenderSnippet((await api.createLayer(kit.id))!.id))!;
		await api.createRenderEntry(snip.id, 'font-family', 'Inter');
		for (const [k, v] of Object.entries(style)) await api.createRenderEntry(snip.id, k, v);
		const contentTok = (await api.createToken(projectId, 'content', s(''), { kitId: kit.id }))!;
		await api.createRenderEntry(snip.id, 'content', null, contentTok.id);
		return kit;
	}

	async function textView(name: string, kit: { id: string }, content: string): Promise<string> {
		const v = (await api.createViewInProject(projectId, name, {
			charter: { primitive: 'text' },
			view_icon: 'fa-solid fa-italic'
		}))!;
		await api.attachKitToComposition(kit.id, v.id);
		await api.createToken(projectId, 'content', s(content), { viewId: v.id });
		return v.id;
	}

	async function boxView(
		name: string,
		kit: { id: string },
		childIds: string[],
		hints: Record<string, unknown> = {
			charter: { primitive: 'box' },
			view_icon: 'fa-regular fa-window-maximize'
		}
	): Promise<string> {
		const v = (await api.createViewInProject(projectId, name, hints))!;
		await api.attachKitToComposition(kit.id, v.id);
		// `children` is composed of N view-scoped `view` tokens sharing the alias (order-preserving
		// via addViewRef's auto-incrementing priority_index), not one array-valued view-list token.
		for (const childId of childIds) await api.addViewRef(projectId, v.id, 'children', childId);
		return v.id;
	}

	// An Image kit: declares an `src` render entry backed by a kit-scope token, so every view
	// composing it supplies its own image source via a View-scope override. Same pattern as
	// textKit's `content` token. `props` should always set an explicit width/height: an image
	// view with no src override falls back to this kit-scope placeholder (empty string), which
	// measures to a literal 0x0 (ImageSource::None, no intrinsic size) -- so without one the
	// placeholder would occupy zero layout space instead of a visible slot.
	async function imageKit(name: string, props: Record<string, string> = {}) {
		const kit = (await api.createKitInProject(projectId, name))!;
		const snip = (await api.createRenderSnippet((await api.createLayer(kit.id))!.id))!;
		const srcTok = (await api.createToken(projectId, 'src', s(''), { kitId: kit.id }))!;
		await api.createRenderEntry(snip.id, 'src', null, srcTok.id);
		for (const [k, v] of Object.entries(props)) await api.createRenderEntry(snip.id, k, v);
		return kit;
	}

	// `src` is an asset id (see registerBundledAsset below), not a URL -- mirrors textView's
	// `content` param exactly: every view composing an image kit supplies its own source via a
	// View-scope token of the same alias, overriding the kit-scope empty-string placeholder.
	// Optional -- a view with no real asset yet just keeps the kit's placeholder (see imageKit's
	// own doc comment on why `props` must still set an explicit width/height in that case).
	async function imageView(name: string, kit: { id: string }, src?: string): Promise<string> {
		const v = (await api.createViewInProject(projectId, name, {
			charter: { primitive: 'image' },
			view_icon: 'fa-solid fa-image'
		}))!;
		await api.attachKitToComposition(kit.id, v.id);
		if (src) await api.createToken(projectId, 'src', s(src), { viewId: v.id });
		return v.id;
	}

	// Registers a bundled static file (served from `static/`, so `link` is a plain root-relative
	// path) as a real project asset row, computing its real sha256 checksum for idempotent
	// upsert-by-checksum. This is as far as manager-side seeding can go: the actual bytes only
	// ever live in the browser's IndexedDB via app-side code (`assetBytes`,
	// `src/lib/editor/asset-bytes.ts`), which this package cannot import (see CLAUDE.md's
	// manager/app boundary). The editor's image-reload scan (`Editor.svelte`, mirrors the
	// existing font-fetch scan) is what actually fetches `link` and caches the bytes into
	// IndexedDB + Vellum, the first time any view resolves a `src` pointing at this asset's id --
	// so the id returned here is real and stable, but the pixels only appear once that scan runs.
	// Best-effort: a fetch/digest failure returns null, and the caller falls back to leaving the
	// image kit's own empty-string placeholder (imageView's `src` param is optional for exactly
	// this reason) rather than failing the whole seed.
	async function registerBundledAsset(input: {
		name: string;
		link: string;
		mimeType: string;
		width: number;
		height: number;
	}): Promise<string | null> {
		try {
			const res = await fetch(input.link);
			if (!res.ok) return null;
			const bytes = new Uint8Array(await res.arrayBuffer());
			const digest = await crypto.subtle.digest('SHA-256', bytes.buffer as ArrayBuffer);
			const checksum = Array.from(new Uint8Array(digest))
				.map((b) => b.toString(16).padStart(2, '0'))
				.join('');
			const asset = await api.upsertAsset({
				projectId,
				name: input.name,
				mimeType: input.mimeType,
				checksum,
				link: input.link,
				width: input.width,
				height: input.height
			});
			return asset.id;
		} catch {
			return null;
		}
	}

	return { boxKit, textKit, textView, boxView, imageKit, imageView, registerBundledAsset };
}

export async function seedDemoProject(
	dialect: SchemaDialect,
	builtinPlugins: BuiltinPlugins
): Promise<void> {
	const api: Api = queryBuilder(dialect);

	const ws = (await api.getAllWorkspaces().execute())[0]!;
	const proj = (await api.createProjectInWorkspace(ws.workspaceId, 'KIT\u202210 Demo'))!;

	await api.setProjectInterpreter(proj.id, builtinPlugins.charter.id);
	// No utility-plugin linking -- Fontavious, Tenner, and WebCodium are install-level (see
	// PluginActivation in schema.ts), loaded globally rather than per-project.

	// Project-scoped tokens
	const tokenBg = (await api.createToken(proj.id, 'colors.bg', s('oklch(100% 0 0)')))!;
	const tokenText = (await api.createToken(proj.id, 'colors.text', s('oklch(21.8% 0 0)')))!;
	const tokenPrimary = (await api.createToken(proj.id, 'colors.primary', s('oklch(62.3% 0.188 259.8)')))!;
	const tokenSecondary = (await api.createToken(proj.id, 'colors.secondary', s('oklch(55.4% 0.0407 257.4)')))!;
	const tokenTertiary = (await api.createToken(proj.id, 'colors.tertiary', s('oklch(92.9% 0.0126 255.5)')))!;
	const tokenSuccess = (await api.createToken(proj.id, 'colors.positive', s('oklch(72.3% 0.192 149.6)')))!;
	const tokenDanger = (await api.createToken(proj.id, 'colors.danger', s('oklch(63.7% 0.2078 25.3)')))!;
	// Distinct from colors.bg - this is text-on-a-colored-surface, not the neutral page
	// background. They happen to share a value today, but changing colors.bg (a warmer
	// off-white, say) shouldn't also silently retint every button's label.
	const tokenOnColor = (await api.createToken(proj.id, 'colors.onColor', s('oklch(100% 0 0)')))!;

	// Axes
	const themeAxis = (await api.createAxis(proj.id, 'Theme', 'Light or dark mode', 'categorical'))!;
	await api.createAxisValue(themeAxis.id, { type: 'literal', value: 'light' });
	const themeDark = (await api.createAxisValue(themeAxis.id, { type: 'literal', value: 'dark' }))!;

	const densityAxis = (await api.createAxis(proj.id, 'Density', 'Spacing density', 'categorical'))!;
	const densityCompact = (await api.createAxisValue(densityAxis.id, {
		type: 'literal',
		value: 'compact'
	}))!;
	const densityDense = (await api.createAxisValue(densityAxis.id, {
		type: 'literal',
		value: 'comfort'
	}))!;

	const emphasisAxis = (await api.createAxis(
		proj.id,
		'Emphasis',
		'Visual emphasis level',
		'categorical'
	))!;
	const emphasisPrimary = (await api.createAxisValue(emphasisAxis.id, {
		type: 'literal',
		value: 'primary'
	}))!;
	const emphasisSecondary = (await api.createAxisValue(emphasisAxis.id, {
		type: 'literal',
		value: 'secondary'
	}))!;
	const emphasisTertiary = (await api.createAxisValue(emphasisAxis.id, {
		type: 'literal',
		value: 'tertiary'
	}))!;
	const emphasisGhost = (await api.createAxisValue(emphasisAxis.id, {
		type: 'literal',
		value: 'ghost'
	}))!;

	const sentimentAxis = (await api.createAxis(
		proj.id,
		'Sentiment',
		'Emotional tone',
		'categorical'
	))!;
	await api.createAxisValue(sentimentAxis.id, { type: 'literal', value: 'neutral' });
	const sentimentPositive = (await api.createAxisValue(sentimentAxis.id, {
		type: 'literal',
		value: 'positive'
	}))!;
	const sentimentDanger = (await api.createAxisValue(sentimentAxis.id, {
		type: 'literal',
		value: 'danger'
	}))!;

	const stateAxis = (await api.createAxis(proj.id, 'State', 'Interaction state', 'categorical'))!;
	await api.createAxisValue(stateAxis.id, { type: 'literal', value: 'default' });
	const stateHover = (await api.createAxisValue(stateAxis.id, {
		type: 'literal',
		value: 'hover'
	}))!;
	const stateClick = (await api.createAxisValue(stateAxis.id, {
		type: 'literal',
		value: 'click'
	}))!;
	const stateDisabled = (await api.createAxisValue(stateAxis.id, {
		type: 'literal',
		value: 'disabled'
	}))!;

	// Button kit
	const buttonKit = (await api.createKitInProject(proj.id, 'Button'))!;
	await api.consumeAxis(buttonKit.id, themeAxis.id);
	await api.consumeAxis(buttonKit.id, densityAxis.id);
	await api.consumeAxis(buttonKit.id, emphasisAxis.id);
	await api.consumeAxis(buttonKit.id, sentimentAxis.id);
	await api.consumeAxis(buttonKit.id, stateAxis.id);
	await api.reorderAxesInKit(buttonKit.id, themeAxis.id, 1000);
	await api.reorderAxesInKit(buttonKit.id, densityAxis.id, 2000);
	await api.reorderAxesInKit(buttonKit.id, emphasisAxis.id, 3000);
	await api.reorderAxesInKit(buttonKit.id, sentimentAxis.id, 4000);
	await api.reorderAxesInKit(buttonKit.id, stateAxis.id, 5000);

	// Kit-scoped token
	const tokenBtnRadius = (await api.createToken(proj.id, 'radius.button', s('8px'), {
		kitId: buttonKit.id
	}))!;

	// Null layer (0 conditions) - baseline button
	const btnNull = (await api.createLayer(buttonKit.id))!;
	const btnNullSnip = (await api.createRenderSnippet(btnNull.id))!;
	await api.createRenderEntry(btnNullSnip.id, 'background', null, tokenBg.id);
	await api.createRenderEntry(btnNullSnip.id, 'color', null, tokenText.id);
	await api.createRenderEntry(btnNullSnip.id, 'padding', '16px');
	await api.createRenderEntry(btnNullSnip.id, 'border-radius', null, tokenBtnRadius.id);

	// {theme: dark}
	const btnDark = (await api.createLayer(buttonKit.id))!;
	await api.addAxisValueToLayer(btnDark.id, themeDark.id);
	const btnDarkSnip = (await api.createRenderSnippet(btnDark.id))!;
	await api.createRenderEntry(btnDarkSnip.id, 'background', 'oklch(22.8% 0.0384 282.9)');
	await api.createRenderEntry(btnDarkSnip.id, 'color', 'oklch(90.7% 0 0)');

	// {density: compact}
	const btnCompact = (await api.createLayer(buttonKit.id))!;
	await api.addAxisValueToLayer(btnCompact.id, densityCompact.id);
	const btnCompactSnip = (await api.createRenderSnippet(btnCompact.id))!;
	await api.createRenderEntry(btnCompactSnip.id, 'padding', '8px');

	// {density: dense}
	const btnDense = (await api.createLayer(buttonKit.id))!;
	await api.addAxisValueToLayer(btnDense.id, densityDense.id);
	const btnDenseSnip = (await api.createRenderSnippet(btnDense.id))!;
	await api.createRenderEntry(btnDenseSnip.id, 'padding', '24px');

	// {emphasis: primary}
	const btnPrimary = (await api.createLayer(buttonKit.id))!;
	await api.addAxisValueToLayer(btnPrimary.id, emphasisPrimary.id);
	const btnPrimarySnip = (await api.createRenderSnippet(btnPrimary.id))!;
	await api.createRenderEntry(btnPrimarySnip.id, 'background', null, tokenPrimary.id);
	await api.createRenderEntry(btnPrimarySnip.id, 'color', null, tokenOnColor.id);
	await api.createRenderEntry(btnPrimarySnip.id, 'font-weight', '600');

	// {emphasis: secondary}
	const btnSecondary = (await api.createLayer(buttonKit.id))!;
	await api.addAxisValueToLayer(btnSecondary.id, emphasisSecondary.id);
	const btnSecondarySnip = (await api.createRenderSnippet(btnSecondary.id))!;
	await api.createRenderEntry(btnSecondarySnip.id, 'background', null, tokenSecondary.id);
	await api.createRenderEntry(btnSecondarySnip.id, 'color', null, tokenOnColor.id);

	// {emphasis: tertiary}
	const btnTertiary = (await api.createLayer(buttonKit.id))!;
	await api.addAxisValueToLayer(btnTertiary.id, emphasisTertiary.id);
	const btnTertiarySnip = (await api.createRenderSnippet(btnTertiary.id))!;
	await api.createRenderEntry(btnTertiarySnip.id, 'background', null, tokenTertiary.id);
	await api.createRenderEntry(btnTertiarySnip.id, 'color', null, tokenText.id);

	// {emphasis: ghost}
	const btnGhost = (await api.createLayer(buttonKit.id))!;
	await api.addAxisValueToLayer(btnGhost.id, emphasisGhost.id);
	const btnGhostSnip = (await api.createRenderSnippet(btnGhost.id))!;
	await api.createRenderEntry(btnGhostSnip.id, 'background', 'transparent');
	await api.createRenderEntry(btnGhostSnip.id, 'border', 'none');

	// {sentiment: positive}
	const btnPositive = (await api.createLayer(buttonKit.id))!;
	await api.addAxisValueToLayer(btnPositive.id, sentimentPositive.id);
	const btnPositiveSnip = (await api.createRenderSnippet(btnPositive.id))!;
	await api.createRenderEntry(btnPositiveSnip.id, 'background', null, tokenSuccess.id);
	await api.createRenderEntry(btnPositiveSnip.id, 'color', null, tokenOnColor.id);

	// {sentiment: danger}
	const btnDanger = (await api.createLayer(buttonKit.id))!;
	await api.addAxisValueToLayer(btnDanger.id, sentimentDanger.id);
	const btnDangerSnip = (await api.createRenderSnippet(btnDanger.id))!;
	await api.createRenderEntry(btnDangerSnip.id, 'background', null, tokenDanger.id);
	await api.createRenderEntry(btnDangerSnip.id, 'color', null, tokenOnColor.id);

	// {state: hover}
	const btnHover = (await api.createLayer(buttonKit.id))!;
	await api.addAxisValueToLayer(btnHover.id, stateHover.id);
	const btnHoverSnip = (await api.createRenderSnippet(btnHover.id))!;
	await api.createRenderEntry(btnHoverSnip.id, 'cursor', 'pointer');
	await api.createRenderEntry(btnHoverSnip.id, 'background', 'oklch(92.9% 0.0126 255.5)');

	// {state: click}
	const btnClick = (await api.createLayer(buttonKit.id))!;
	await api.addAxisValueToLayer(btnClick.id, stateClick.id);
	const btnClickSnip = (await api.createRenderSnippet(btnClick.id))!;
	await api.createRenderEntry(btnClickSnip.id, 'transform', 'scale(0.98)');

	// {state: disabled}
	const btnDisabled = (await api.createLayer(buttonKit.id))!;
	await api.addAxisValueToLayer(btnDisabled.id, stateDisabled.id);
	const btnDisabledSnip = (await api.createRenderSnippet(btnDisabled.id))!;
	await api.createRenderEntry(btnDisabledSnip.id, 'opacity', '0.5');
	await api.createRenderEntry(btnDisabledSnip.id, 'cursor', 'not-allowed');

	// 2-condition layers
	//
	// Density never gets theme-crossed: padding is a spacing decision, not a color one, and
	// theme has no reason to change it. Similarly, primary/positive/danger don't get a
	// {theme:dark, role} variant - a saturated brand color reads fine on any page background,
	// and re-tinting every solid button for dark mode is the kind of combinatorial expansion
	// that looks thorough but isn't actually a design decision anyone made on purpose. Theme's
	// job is the neutral/default look only (btnDark, above) - once a role sets its own
	// background, theme steps out of the way entirely.
	//
	// Only the three semantic/hero roles - primary (emphasis), positive and danger (sentiment)
	// - get a full base→hover→click→disabled ramp. Secondary/tertiary/ghost deliberately share
	// the universal 1-condition state layers (btnHover/btnClick/btnDisabled) instead of each
	// getting bespoke interaction colors - not every variant needs its own hover art, and a
	// shared "lower emphasis" feedback treatment is itself a legitimate, common pattern.
	//
	// The hover/click/disabled shade step is the same for every role: darken one and two
	// Tailwind steps for hover/click, and a pale/desaturated tint at 40% opacity for disabled.

	// {emphasis: primary, state: hover}
	const btnPrimaryHover = (await api.createLayer(buttonKit.id))!;
	await api.addAxisValueToLayer(btnPrimaryHover.id, emphasisPrimary.id);
	await api.addAxisValueToLayer(btnPrimaryHover.id, stateHover.id);
	const btnPrimaryHoverSnip = (await api.createRenderSnippet(btnPrimaryHover.id))!;
	await api.createRenderEntry(btnPrimaryHoverSnip.id, 'background', 'oklch(54.6% 0.2152 262.9)');

	// {emphasis: primary, state: click}
	const btnPrimaryClick = (await api.createLayer(buttonKit.id))!;
	await api.addAxisValueToLayer(btnPrimaryClick.id, emphasisPrimary.id);
	await api.addAxisValueToLayer(btnPrimaryClick.id, stateClick.id);
	const btnPrimaryClickSnip = (await api.createRenderSnippet(btnPrimaryClick.id))!;
	await api.createRenderEntry(btnPrimaryClickSnip.id, 'background', 'oklch(48.8% 0.2172 264.4)');

	// {emphasis: primary, state: disabled}
	const btnPrimaryDisabled = (await api.createLayer(buttonKit.id))!;
	await api.addAxisValueToLayer(btnPrimaryDisabled.id, emphasisPrimary.id);
	await api.addAxisValueToLayer(btnPrimaryDisabled.id, stateDisabled.id);
	const btnPrimaryDisabledSnip = (await api.createRenderSnippet(btnPrimaryDisabled.id))!;
	await api.createRenderEntry(btnPrimaryDisabledSnip.id, 'background', 'oklch(80.9% 0.0956 251.8)');
	await api.createRenderEntry(btnPrimaryDisabledSnip.id, 'opacity', '0.4');

	// {sentiment: positive, state: hover}
	const btnPositiveHover = (await api.createLayer(buttonKit.id))!;
	await api.addAxisValueToLayer(btnPositiveHover.id, sentimentPositive.id);
	await api.addAxisValueToLayer(btnPositiveHover.id, stateHover.id);
	const btnPositiveHoverSnip = (await api.createRenderSnippet(btnPositiveHover.id))!;
	await api.createRenderEntry(btnPositiveHoverSnip.id, 'background', 'oklch(62.7% 0.1699 149.2)');

	// {sentiment: positive, state: click}
	const btnPositiveClick = (await api.createLayer(buttonKit.id))!;
	await api.addAxisValueToLayer(btnPositiveClick.id, sentimentPositive.id);
	await api.addAxisValueToLayer(btnPositiveClick.id, stateClick.id);
	const btnPositiveClickSnip = (await api.createRenderSnippet(btnPositiveClick.id))!;
	await api.createRenderEntry(btnPositiveClickSnip.id, 'background', 'oklch(52.7% 0.1371 150.1)');

	// {sentiment: positive, state: disabled}
	const btnPositiveDisabled = (await api.createLayer(buttonKit.id))!;
	await api.addAxisValueToLayer(btnPositiveDisabled.id, sentimentPositive.id);
	await api.addAxisValueToLayer(btnPositiveDisabled.id, stateDisabled.id);
	const btnPositiveDisabledSnip = (await api.createRenderSnippet(btnPositiveDisabled.id))!;
	await api.createRenderEntry(btnPositiveDisabledSnip.id, 'background', 'oklch(87.1% 0.1363 154.4)');
	await api.createRenderEntry(btnPositiveDisabledSnip.id, 'opacity', '0.4');

	// {sentiment: danger, state: hover}
	const btnDangerHover = (await api.createLayer(buttonKit.id))!;
	await api.addAxisValueToLayer(btnDangerHover.id, sentimentDanger.id);
	await api.addAxisValueToLayer(btnDangerHover.id, stateHover.id);
	const btnDangerHoverSnip = (await api.createRenderSnippet(btnDangerHover.id))!;
	await api.createRenderEntry(btnDangerHoverSnip.id, 'background', 'oklch(57.7% 0.2152 27.3)');

	// {sentiment: danger, state: click} - without this, any view combining
	// sentiment:danger with emphasis:primary (or any other 2-condition emphasis/theme combo)
	// at state:click renders danger invisibly: btnDanger alone is only 1 condition, so it loses
	// to btnPrimaryClick {emphasis, state} on raw condition count, regardless of sentiment's
	// higher axis priority. Same axis pair shape as btnPrimaryClick (sentiment+state vs
	// emphasis+state) means the tie is broken by priority instead - sentiment (4000) beats
	// emphasis (3000), so danger correctly wins here.
	const btnDangerClick = (await api.createLayer(buttonKit.id))!;
	await api.addAxisValueToLayer(btnDangerClick.id, sentimentDanger.id);
	await api.addAxisValueToLayer(btnDangerClick.id, stateClick.id);
	const btnDangerClickSnip = (await api.createRenderSnippet(btnDangerClick.id))!;
	await api.createRenderEntry(btnDangerClickSnip.id, 'background', 'oklch(50.5% 0.1905 27.5)');

	// {sentiment: danger, state: disabled} - mirrors btnPrimaryDisabled's pale/washed-out
	// treatment, same reasoning as click: without it, a disabled danger button falls back to
	// whatever 2-condition emphasis/theme combo happens to be active instead of reading as
	// disabled.
	const btnDangerDisabled = (await api.createLayer(buttonKit.id))!;
	await api.addAxisValueToLayer(btnDangerDisabled.id, sentimentDanger.id);
	await api.addAxisValueToLayer(btnDangerDisabled.id, stateDisabled.id);
	const btnDangerDisabledSnip = (await api.createRenderSnippet(btnDangerDisabled.id))!;
	await api.createRenderEntry(btnDangerDisabledSnip.id, 'background', 'oklch(80.8% 0.1035 19.6)');
	await api.createRenderEntry(btnDangerDisabledSnip.id, 'opacity', '0.4');

	// Button label kit - text child rendered inside each button box
	const labelKit = (await api.createKitInProject(proj.id, 'ButtonLabel'))!;
	await api.consumeAxis(labelKit.id, themeAxis.id);
	await api.consumeAxis(labelKit.id, emphasisAxis.id);
	await api.consumeAxis(labelKit.id, sentimentAxis.id);
	await api.consumeAxis(labelKit.id, stateAxis.id);
	// auto-assigned priorities (1000/2000/3000/4000) already give the right relative order

	// Null layer - baseline label
	const lblNull = (await api.createLayer(labelKit.id))!;
	const lblNullSnip = (await api.createRenderSnippet(lblNull.id))!;
	await api.createRenderEntry(lblNullSnip.id, 'content', 'Button');
	await api.createRenderEntry(lblNullSnip.id, 'color', null, tokenText.id);
	await api.createRenderEntry(lblNullSnip.id, 'font-size', '14px');
	await api.createRenderEntry(lblNullSnip.id, 'font-weight', '400');
	// A real, catalogued font -- fetched via Fontavious on load (Editor.svelte's resolve-time
	// scan). Chargen (Vellum's bundled fallback) should only ever be seen if that fetch/load
	// genuinely fails; seeding a real family here means the demo's normal state is "Inter loaded
	// correctly", not "nothing ever asked for a real font in the first place".
	await api.createRenderEntry(lblNullSnip.id, 'font-family', 'Inter');

	// Per-emphasis content
	const lblPrimary = (await api.createLayer(labelKit.id))!;
	await api.addAxisValueToLayer(lblPrimary.id, emphasisPrimary.id);
	const lblPrimarySnip = (await api.createRenderSnippet(lblPrimary.id))!;
	await api.createRenderEntry(lblPrimarySnip.id, 'content', 'Submit');
	await api.createRenderEntry(lblPrimarySnip.id, 'color', null, tokenOnColor.id);
	await api.createRenderEntry(lblPrimarySnip.id, 'font-weight', '600');

	const lblSecondary = (await api.createLayer(labelKit.id))!;
	await api.addAxisValueToLayer(lblSecondary.id, emphasisSecondary.id);
	const lblSecondarySnip = (await api.createRenderSnippet(lblSecondary.id))!;
	await api.createRenderEntry(lblSecondarySnip.id, 'content', 'Cancel');
	await api.createRenderEntry(lblSecondarySnip.id, 'color', null, tokenOnColor.id);

	const lblTertiary = (await api.createLayer(labelKit.id))!;
	await api.addAxisValueToLayer(lblTertiary.id, emphasisTertiary.id);
	const lblTertiarySnip = (await api.createRenderSnippet(lblTertiary.id))!;
	await api.createRenderEntry(lblTertiarySnip.id, 'content', 'Learn More');
	await api.createRenderEntry(lblTertiarySnip.id, 'color', null, tokenText.id);

	const lblGhost = (await api.createLayer(labelKit.id))!;
	await api.addAxisValueToLayer(lblGhost.id, emphasisGhost.id);
	const lblGhostSnip = (await api.createRenderSnippet(lblGhost.id))!;
	await api.createRenderEntry(lblGhostSnip.id, 'content', 'Dismiss');

	// Per-sentiment content (higher priority than emphasis)
	const lblPositive = (await api.createLayer(labelKit.id))!;
	await api.addAxisValueToLayer(lblPositive.id, sentimentPositive.id);
	const lblPositiveSnip = (await api.createRenderSnippet(lblPositive.id))!;
	await api.createRenderEntry(lblPositiveSnip.id, 'content', 'Confirm');
	await api.createRenderEntry(lblPositiveSnip.id, 'color', null, tokenOnColor.id);

	const lblDanger = (await api.createLayer(labelKit.id))!;
	await api.addAxisValueToLayer(lblDanger.id, sentimentDanger.id);
	const lblDangerSnip = (await api.createRenderSnippet(lblDanger.id))!;
	await api.createRenderEntry(lblDangerSnip.id, 'content', 'Delete');
	await api.createRenderEntry(lblDangerSnip.id, 'color', null, tokenOnColor.id);

	// Disabled state label
	const lblDisabled = (await api.createLayer(labelKit.id))!;
	await api.addAxisValueToLayer(lblDisabled.id, stateDisabled.id);
	const lblDisabledSnip = (await api.createRenderSnippet(lblDisabled.id))!;
	await api.createRenderEntry(lblDisabledSnip.id, 'content', 'Unavailable');

	// No root button Views or button-label Views are seeded -- buttonKit/labelKit stay defined
	// (axes, layers, render entries) as reusable library kits with nothing composing them yet,
	// same as any kit a user creates by hand and hasn't attached to a view.

	// ==========================================================================================
	// Landing page -- a real webpage built entirely from nested Views, showcasing the composition
	// system end to end: Box containers laid out with flex, Text primitives for content, and
	// children (`view`-typed) tokens wiring the tree together. Built bottom-up (leaves first) since
	// a parent's children tokens must reference views that already exist.
	// ==========================================================================================

	const { boxKit, textKit, textView, boxView, imageKit, imageView, registerBundledAsset } =
		makeSeedHelpers(api, proj.id);

	// --- Style kits ---
	const h1Kit = await textKit('Heading', {
		'font-size': '40px',
		'font-weight': '700',
		color: 'oklch(20.8% 0.0398 265.8)'
	});
	const h2Kit = await textKit('Subheading', {
		'font-size': '19px',
		'font-weight': '700',
		color: 'oklch(20.8% 0.0398 265.8)'
	});
	const bodyKit = await textKit('Body', {
		'font-size': '15px',
		'font-weight': '400',
		color: 'oklch(55.4% 0.0407 257.4)'
	});
	const ctaLabelKit = await textKit('CTA Label', {
		'font-size': '15px',
		'font-weight': '600',
		color: 'oklch(100% 0 0)'
	});
	const footerTextKit = await textKit('Footer Text', {
		'font-size': '13px',
		'font-weight': '400',
		color: 'oklch(86.9% 0.0198 252.9)'
	});

	// --- Layout kits ---
	const pageKit = await boxKit('Page', {
		'flex-direction': 'column',
		background: 'oklch(100% 0 0)',
		width: '900px',
		gap: '0px',
		padding: '0px'
	});
	const navKit = await boxKit('Nav', {
		'flex-direction': 'row',
		'justify-content': 'space-between',
		'align-items': 'center',
		padding: '20px',
		gap: '16px',
		background: 'oklch(100% 0 0)',
		// A top-level Page section: Page's own Stack (column) has no explicit align-items, so this
		// must spell out Fill itself rather than lean on the old implicit-stretch fallback -- see
		// the compile_arrange Stack-Column pitfall in CLAUDE.md.
		width: 'fill'
	});
	const heroKit = await boxKit('Hero', {
		'flex-direction': 'row',
		'align-items': 'center',
		gap: '18px',
		padding: '64px',
		background: 'oklch(98.4% 0.0034 247.9)',
		width: 'fill'
	});
	const featuresKit = await boxKit('Features', {
		'flex-direction': 'row',
		'justify-content': 'center',
		// Explicit: Charter's Stack arrangement now defaults a row's align-items to Center when
		// unset (see compile_arrange in plugins/charter/src/lib.rs), which would otherwise flip
		// these three cards from stretch-to-equal-height to center-at-own-height -- visible here
		// since the cards' body text differs in length and wraps to different line counts.
		'align-items': 'stretch',
		gap: '24px',
		padding: '48px',
		background: 'oklch(100% 0 0)',
		width: 'fill'
	});
	const cardKit = await boxKit('Card', {
		'flex-direction': 'column',
		gap: '8px',
		padding: '24px',
		background: 'oklch(100% 0 0)',
		border: 'oklch(92.9% 0.0126 255.5)',
		'border-radius': '12px',
		width: '230px'
	});
	const footerKit = await boxKit('Footer', {
		'flex-direction': 'row',
		'justify-content': 'center',
		// Explicit for the same reason as featuresKit above -- cosmetically inert today (footer
		// has one auto-height child, so stretch vs. center is currently a no-op) but stops this
		// kit from silently depending on Charter's Stack default if it ever gains a sibling.
		'align-items': 'stretch',
		padding: '28px',
		background: 'oklch(20.8% 0.0398 265.8)',
		width: 'fill'
	});
	const ctaKit = await boxKit('CTA', {
		'flex-direction': 'row',
		'align-items': 'center',
		'justify-content': 'center',
		padding: '13px',
		background: 'oklch(62.3% 0.188 259.8)',
		'border-radius': '8px'
	});
	const heroContentKit = await boxKit('Hero Content', {
		'flex-direction': 'column',
		'align-items': 'center',
		gap: '18px'
	});
	// Explicit width/height -- see imageKit's own doc comment for why this is required, not
	// cosmetic, for a placeholder with no real src.
	const srcImageKit = await imageKit('Image Source', { width: '360px', height: '280px' });
	const heroImageAssetId = await registerBundledAsset({
		name: 'favicon.png',
		link: '/1x/favicon.png',
		mimeType: 'image/png',
		width: 623,
		height: 476
	});

	// --- Leaf text views ---
	const logo = await textView('Logo', h2Kit, 'KIT\u202210');
	const navCtaLabel = await textView('Nav CTA Label', ctaLabelKit, 'Sign in');
	const heroHeading = await textView(
		'Hero Heading',
		h1Kit,
		'Design the system, not the screenshots'
	);
	const heroSubtitle = await textView(
		'Hero Subtitle',
		bodyKit,
		'Model UI as axes, kits, and views \u2014 and resolve every variant at once.'
	);
	const heroCtaLabel = await textView('Hero CTA Label', ctaLabelKit, 'Get started');
	const c1t = await textView('Card 1 Title', h2Kit, 'Axes');
	const c1b = await textView(
		'Card 1 Body',
		bodyKit,
		'Define the dimensions your UI varies across \u2014 theme, density, state.'
	);
	const c2t = await textView('Card 2 Title', h2Kit, 'Kits');
	const c2b = await textView(
		'Card 2 Body',
		bodyKit,
		'Bundle opinionated rules per concern, then compose them into any view.'
	);
	const c3t = await textView('Card 3 Title', h2Kit, 'Views');
	const c3b = await textView(
		'Card 3 Body',
		bodyKit,
		'Nest views into views. Kits ship defaults; each instance clones its own.'
	);
	const footerText = await textView(
		'Footer Text',
		footerTextKit,
		'\u00a9 2026 KIT\u202210 \u2014 composable design, resolved.'
	);

	// --- CTAs (box + label) ---
	const navCta = await boxView('Nav CTA', ctaKit, [navCtaLabel]);
	const heroCta = await boxView('Hero CTA', ctaKit, [heroCtaLabel]);

	// --- Cards ---
	const card1 = await boxView('Card: Axes', cardKit, [c1t, c1b]);
	const card2 = await boxView('Card: Kits', cardKit, [c2t, c2b]);
	const card3 = await boxView('Card: Views', cardKit, [c3t, c3b]);

	// --- Sections ---
	const nav = await boxView('Nav Bar', navKit, [logo, navCta]);
	const heroContent = await boxView('Hero Content', heroContentKit, [
		heroHeading,
		heroSubtitle,
		heroCta
	]);
	const heroImg = await imageView('Hero Image', srcImageKit, heroImageAssetId ?? undefined);
	const hero = await boxView('Hero Section', heroKit, [heroContent, heroImg]);
	const features = await boxView('Features', featuresKit, [card1, card2, card3]);
	const footer = await boxView('Footer', footerKit, [footerText]);

	// --- Page root (positioned off to the left of the component gallery) ---
	await boxView('Landing Page', pageKit, [nav, hero, features, footer], {
		charter: { primitive: 'box' },
		view_icon: 'fa-regular fa-window-maximize',
		vellum: { position: [-1100, 0] }
	});

	// Camera pan memory (project.hints.vellum.panned, Viewport.svelte) -- seeds a first-open
	// camera position roughly centered on the Landing Page view above instead of Vellum's raw
	// (0, 0) origin (which sits well to the right of it, off the initial view entirely). Landing
	// Page is 900px wide at world x -1100..-200 (center -650) with an estimated ~900px of stacked
	// nav/hero/features/footer content (center ~450); offsetting that by half of a typical
	// viewport gets a camera that lands with the page roughly in frame. Not exact -- there's no
	// real canvas to center against at seed time (see Viewport.svelte's own runtime fallback,
	// which does this precisely once a canvas exists, for any project that has no saved pan yet).
	await api.updateProjectHints(proj.id, { vellum: { panned: [-1150, 150] } });

	// ==========================================================================================
	// Arrangement demos -- one small view per compile_arrange opinion beyond Stack (which the
	// whole landing page already exercises), so every tab of the editor's Arrangement control
	// has a live example: Cluster (wrapping tag row), Split (label pushed apart from a status
	// pill), Grid (auto-fit tiles). Positioned as a strip left of the landing page.
	// ==========================================================================================

	// --- Cluster: chips wrap inside a fixed-width card (row + wrap + start-packed) ---
	const chipKit = await textKit('Chip', {
		'font-size': '13px',
		'font-weight': '600',
		color: 'oklch(39.8% 0.1773 277.4)',
		background: 'oklch(93% 0.0334 272.8)',
		'border-radius': '999px',
		padding: '6px 12px'
	});
	const tagClusterKit = await boxKit('Tag Cluster', {
		arrange: 'cluster',
		gap: '8px',
		padding: '16px',
		background: 'oklch(100% 0 0)',
		border: 'oklch(92.9% 0.0126 255.5)',
		'border-radius': '12px',
		width: '300px'
	});
	const chips: string[] = [];
	for (const tag of ['Axes', 'Kits', 'Views', 'Layers', 'Tokens', 'Resolution', 'Charter'])
		chips.push(await textView(`Chip: ${tag}`, chipKit, tag));
	await boxView('Tag Cluster', tagClusterKit, chips, {
		charter: { primitive: 'box' },
		view_icon: 'fa-regular fa-window-maximize',
		vellum: { position: [-1500, 0] }
	});

	// --- Split: two ends pushed apart, centered on the cross axis ---
	const statusPillKit = await textKit('Status Pill', {
		'font-size': '13px',
		'font-weight': '600',
		color: 'oklch(44.8% 0.1083 151.3)',
		background: 'oklch(96.2% 0.0434 156.7)',
		'border-radius': '999px',
		padding: '6px 12px'
	});
	const splitRowKit = await boxKit('Split Row', {
		arrange: 'split',
		padding: '16px',
		background: 'oklch(100% 0 0)',
		border: 'oklch(92.9% 0.0126 255.5)',
		'border-radius': '12px',
		width: '300px'
	});
	const splitLabel = await textView('Split Label', bodyKit, 'Notifications');
	const splitStatus = await textView('Split Status', statusPillKit, 'On');
	await boxView('Split Row', splitRowKit, [splitLabel, splitStatus], {
		charter: { primitive: 'box' },
		view_icon: 'fa-regular fa-window-maximize',
		vellum: { position: [-1500, 260] }
	});

	// --- Grid: auto-fit tiles (Cell Min + Gap -> repeat(auto-fit, minmax(80px, 1fr))) ---
	// 300px card - 32px padding = 268px content -> three ~83px columns, six tiles, two rows.
	const tileKit = await boxKit('Tile', {
		background: 'oklch(92.9% 0.0126 255.5)',
		'border-radius': '8px',
		height: '64px'
	});
	const tileGridKit = await boxKit('Tile Grid', {
		arrange: 'grid',
		'grid-cell-min': '80px',
		gap: '10px',
		padding: '16px',
		background: 'oklch(100% 0 0)',
		border: 'oklch(92.9% 0.0126 255.5)',
		'border-radius': '12px',
		width: '300px'
	});
	const tiles: string[] = [];
	for (let i = 1; i <= 6; i++) tiles.push(await boxView(`Tile ${i}`, tileKit, []));
	await boxView('Tile Grid', tileGridKit, tiles, {
		charter: { primitive: 'box' },
		view_icon: 'fa-regular fa-window-maximize',
		vellum: { position: [-1500, 420] }
	});

	console.log('Demo project seeded: KIT\u202210 Demo');
}

// ==========================================================================================
// Tropika Juice Co. -- canned juice landing page (pineapple / starfruit / grape).
//
// Exercises: a real per-instance axis resolution (Flavor: pineapple/starfruit/grape) on the
// Can kit via setAxisArg -- unlike seedDemoProject's Button/ButtonLabel kits, which stay
// unattached library kits, these three Can views are real, resolved, differently-colored
// instances of one kit. Also covers Stack/Cluster/Split/Center/Grid (all five compile_arrange
// opinions), resize fill/hug, the padding shorthand ladder (1/2/3/4-value), text-decoration
// (line-through), text-align + line-height on a real stretched paragraph, and one bundled Img.
// ==========================================================================================
export async function seedJuiceLandingPage(
	dialect: SchemaDialect,
	builtinPlugins: BuiltinPlugins
): Promise<void> {
	const api: Api = queryBuilder(dialect);
	const ws = (await api.getAllWorkspaces().execute())[0]!;
	const proj = (await api.createProjectInWorkspace(ws.workspaceId, 'Tropika Juice Co.'))!;
	await api.setProjectInterpreter(proj.id, builtinPlugins.charter.id);

	const { boxKit, textKit, textView, boxView, imageKit, imageView, registerBundledAsset } =
		makeSeedHelpers(api, proj.id);

	// A polyline approximating a circle, in a text node's own local space (Deform::ArclengthPath's
	// coordinate convention - see CLAUDE.md's text-on-path note): `n` points is plenty for a badge
	// this small, since Vellum arc-length-samples the polyline rather than needing a true curve.
	function circlePoints(cx: number, cy: number, r: number, n = 48): [number, number][] {
		const pts: [number, number][] = [];
		for (let i = 0; i <= n; i++) {
			const a = (i / n) * Math.PI * 2;
			pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
		}
		return pts;
	}

	// --- Flavor axis: the Can kit's background is resolved per-instance below via setAxisArg,
	// not baked per view -- three views compose the SAME kit and each picks a different Flavor.
	const flavorAxis = (await api.createAxis(
		proj.id,
		'Flavor',
		'Which fruit this can is',
		'categorical'
	))!;
	const flavorPineapple = (await api.createAxisValue(flavorAxis.id, {
		type: 'literal',
		value: 'pineapple'
	}))!;
	const flavorStarfruit = (await api.createAxisValue(flavorAxis.id, {
		type: 'literal',
		value: 'starfruit'
	}))!;
	const flavorGrape = (await api.createAxisValue(flavorAxis.id, {
		type: 'literal',
		value: 'grape'
	}))!;

	const canKit = (await api.createKitInProject(proj.id, 'Can'))!;
	await api.consumeAxis(canKit.id, flavorAxis.id);

	const canNull = (await api.createLayer(canKit.id))!;
	const canNullSnip = (await api.createRenderSnippet(canNull.id))!;
	await api.createRenderEntry(canNullSnip.id, 'arrange', 'stack');
	await api.createRenderEntry(canNullSnip.id, 'align-items', 'center');
	await api.createRenderEntry(canNullSnip.id, 'gap', '6px');
	await api.createRenderEntry(canNullSnip.id, 'padding', '24px');
	await api.createRenderEntry(canNullSnip.id, 'border-radius', '20px');
	await api.createRenderEntry(canNullSnip.id, 'width', 'fill');
	await api.createRenderEntry(canNullSnip.id, 'background', 'oklch(90% 0.01 264)');

	const canPineapple = (await api.createLayer(canKit.id))!;
	await api.addAxisValueToLayer(canPineapple.id, flavorPineapple.id);
	const canPineappleSnip = (await api.createRenderSnippet(canPineapple.id))!;
	await api.createRenderEntry(canPineappleSnip.id, 'background', 'oklch(86% 0.15 95)');

	const canStarfruit = (await api.createLayer(canKit.id))!;
	await api.addAxisValueToLayer(canStarfruit.id, flavorStarfruit.id);
	const canStarfruitSnip = (await api.createRenderSnippet(canStarfruit.id))!;
	await api.createRenderEntry(canStarfruitSnip.id, 'background', 'oklch(87% 0.17 135)');

	const canGrape = (await api.createLayer(canKit.id))!;
	await api.addAxisValueToLayer(canGrape.id, flavorGrape.id);
	const canGrapeSnip = (await api.createRenderSnippet(canGrape.id))!;
	await api.createRenderEntry(canGrapeSnip.id, 'background', 'oklch(45% 0.19 310)');

	// --- Style kits ---
	const h1Kit = await textKit('Heading', {
		'font-size': '42px',
		'font-weight': '700',
		color: 'oklch(23% 0.03 264)'
	});
	const h2Kit = await textKit('Subheading', {
		'font-size': '19px',
		'font-weight': '700',
		color: 'oklch(23% 0.03 264)'
	});
	const bodyKit = await textKit('Body', {
		'font-size': '15px',
		'font-weight': '400',
		color: 'oklch(54% 0.03 264)'
	});
	const ctaLabelKit = await textKit('CTA Label', {
		'font-size': '15px',
		'font-weight': '600',
		color: 'oklch(100% 0 0)'
	});
	const navLinkKit = await textKit('Nav Link', {
		'font-size': '14px',
		'font-weight': '600',
		color: 'oklch(23% 0.03 264)'
	});
	const bandTextKit = await textKit('Band Text', {
		'font-size': '19px',
		'font-weight': '500',
		color: 'oklch(23% 0.03 264)',
		'line-height': '1.6',
		'text-align': 'center'
	});
	const canLabelKit = await textKit('Can Label', {
		'font-size': '20px',
		'font-weight': '700',
		color: 'oklch(30% 0.06 90)'
	});
	const canNoteKit = await textKit('Can Note', {
		'font-size': '13px',
		'font-weight': '400',
		color: 'oklch(30% 0.06 90)'
	});
	const canPriceKit = await textKit('Can Price', {
		'font-size': '16px',
		'font-weight': '700',
		color: 'oklch(30% 0.06 90)'
	});
	const canLabelLightKit = await textKit('Can Label Light', {
		'font-size': '20px',
		'font-weight': '700',
		color: 'oklch(96% 0.02 310)'
	});
	const canNoteLightKit = await textKit('Can Note Light', {
		'font-size': '13px',
		'font-weight': '400',
		color: 'oklch(90% 0.03 310)'
	});
	const canPriceLightKit = await textKit('Can Price Light', {
		'font-size': '16px',
		'font-weight': '700',
		color: 'oklch(96% 0.02 310)'
	});
	const chipKit = await textKit('Flavor Chip', {
		'font-size': '13px',
		'font-weight': '600',
		color: 'oklch(30% 0.09 190)',
		background: 'oklch(93% 0.05 190)',
		'border-radius': '999px',
		padding: '6px 14px'
	});
	const nutritionLabelKit = await textKit('Nutrition Label', {
		'font-size': '14px',
		'font-weight': '600',
		color: 'oklch(28% 0.07 190)',
		'text-align': 'center'
	});
	const priceOldKit = await textKit('Price Old', {
		'font-size': '15px',
		'font-weight': '500',
		color: 'oklch(54% 0.03 264)',
		'text-decoration': 'line-through'
	});
	const priceNewKit = await textKit('Price New', {
		'font-size': '22px',
		'font-weight': '700',
		color: 'oklch(62% 0.14 190)'
	});
	const footerTextKit = await textKit('Footer Text', {
		'font-size': '13px',
		'font-weight': '400',
		color: 'oklch(85% 0.01 264)'
	});
	// Text-on-path (Deform::ArclengthPath) badge ring: a small circle, authored in this text
	// node's own local space (circlePoints centers it on the node's own origin, not some outer
	// box, since Text always Auto-sizes to its unwrapped straight-line run - see CLAUDE.md's
	// text-on-path note on why the layout footprint and the bent glyphs diverge).
	const badgeRingKit = await textKit('Badge Ring Text', {
		'font-size': '8px',
		'font-weight': '700',
		color: 'oklch(30% 0.09 190)',
		'text-path': JSON.stringify(circlePoints(0, 0, 38)),
		'text-path-offset': '0'
	});

	// --- Layout kits ---
	const pageKit = await boxKit('Page', {
		arrange: 'stack',
		background: 'oklch(98.3% 0.0106 90)',
		width: '900px',
		gap: '0px',
		padding: '0px'
	});
	const navKit = await boxKit('Nav', {
		arrange: 'split',
		padding: '20px 40px',
		background: 'oklch(100% 0 0)',
		// A top-level Page section: Page's own Stack (column) has no explicit align-items, so this
		// must spell out Fill itself rather than lean on the old implicit-stretch fallback -- see
		// the compile_arrange Stack-Column pitfall in CLAUDE.md.
		width: 'fill'
	});
	const navLinksKit = await boxKit('Nav Links', { arrange: 'cluster', gap: '20px' });
	const ctaKit = await boxKit('CTA', {
		arrange: 'center',
		padding: '13px 26px',
		background: 'oklch(62% 0.14 190)',
		'border-radius': '999px',
		width: 'hug'
	});
	const heroKit = await boxKit('Hero', {
		arrange: 'stack',
		'flex-direction': 'row',
		'align-items': 'center',
		gap: '32px',
		padding: '56px 64px',
		background: 'oklch(96% 0.02 95)',
		width: 'fill'
	});
	const heroContentKit = await boxKit('Hero Content', {
		arrange: 'stack',
		'align-items': 'center',
		gap: '18px'
	});
	const bandKit = await boxKit('Band', {
		arrange: 'stack',
		'align-items': 'stretch',
		padding: '48px 120px',
		background: 'oklch(100% 0 0)',
		width: 'fill'
	});
	const flavorRowKit = await boxKit('Flavor Row', {
		arrange: 'stack',
		'flex-direction': 'row',
		'align-items': 'stretch',
		gap: '20px',
		padding: '48px 64px 56px 64px',
		background: 'oklch(98.3% 0.0106 90)',
		width: 'fill'
	});
	const nutritionGridKit = await boxKit('Nutrition Grid', {
		arrange: 'grid',
		'grid-cell-min': '140px',
		gap: '16px',
		padding: '48px',
		width: 'fill'
	});
	const nutritionTileKit = await boxKit('Nutrition Tile', {
		arrange: 'center',
		padding: '20px 12px',
		background: 'oklch(94% 0.03 190)',
		'border-radius': '14px',
		height: '96px'
	});
	const chipClusterKit = await boxKit('Chip Cluster', {
		arrange: 'cluster',
		gap: '10px',
		padding: '0px 64px 48px',
		width: 'fill'
	});
	const subscribeKit = await boxKit('Subscribe Row', {
		arrange: 'split',
		padding: '32px 64px',
		background: 'oklch(94% 0.02 90)',
		width: 'fill'
	});
	const priceStackKit = await boxKit('Price Stack', {
		arrange: 'stack',
		'flex-direction': 'row',
		'align-items': 'center',
		gap: '16px'
	});
	const footerKit = await boxKit('Footer', {
		arrange: 'center',
		padding: '28px 64px',
		background: 'oklch(20% 0.02 264)',
		width: 'fill'
	});

	// Explicit width/height placeholder (see imageKit's own doc comment on why this is required).
	// Real, freely-licensed photos (Wikimedia Commons, CC/public-domain), downsized to ~960px and
	// bundled under static/1x/stock/ like every other seeded asset -- NOT hotlinked live. Every
	// app boot wipes and reseeds PGlite from scratch (no seed-only-if-empty guard), which calls
	// registerBundledAsset again on every single load; a live cross-origin fetch on that path
	// once caused a real, reported multi-second stall/lag on every reload once Wikimedia's CDN
	// throttled repeated requests. Same-origin static files keep the "real photo, not an abstract
	// shape" win without paying a network round trip (let alone a rate-limited one) on every boot.
	const srcImageKit = await imageKit('Image Source', { width: '320px', height: '260px' });
	const splashAssetId = await registerBundledAsset({
		name: 'juice-hero-pineapple.jpg',
		link: '/1x/stock/juice-hero-pineapple.jpg',
		mimeType: 'image/jpeg',
		width: 319,
		height: 640
	});
	const canPhotoKit = await imageKit('Can Photo', {
		width: '100%',
		height: '130px',
		fit: 'cover'
	});
	const pineapplePhotoAssetId = await registerBundledAsset({
		name: 'juice-pineapple.jpg',
		link: '/1x/stock/juice-pineapple.jpg',
		mimeType: 'image/jpeg',
		width: 360,
		height: 480
	});
	const starfruitPhotoAssetId = await registerBundledAsset({
		name: 'juice-starfruit.jpg',
		link: '/1x/stock/juice-starfruit.jpg',
		mimeType: 'image/jpeg',
		width: 360,
		height: 480
	});
	const grapePhotoAssetId = await registerBundledAsset({
		name: 'juice-grape.jpg',
		link: '/1x/stock/juice-grape.jpg',
		mimeType: 'image/jpeg',
		width: 326,
		height: 480
	});

	// --- SpriteBatch confetti band (resources/vellum-sprite-batch-plan.md): three flat white-on-
	// transparent silhouettes, each `tint: true` so its actual color comes from the per-instance
	// `color` (Oklab, not a CSS string - SpriteInstance is parsed straight off the wire, no
	// parse_color pass) rather than the source pixels -- one PNG per sprite kind, reused at every
	// scatter point and every flavor color.
	const dropletAssetId = await registerBundledAsset({
		name: 'sprite-droplet.png',
		link: '/1x/stock/sprite-droplet.png',
		mimeType: 'image/png',
		width: 48,
		height: 64
	});
	const citrusAssetId = await registerBundledAsset({
		name: 'sprite-citrus.png',
		link: '/1x/stock/sprite-citrus.png',
		mimeType: 'image/png',
		width: 40,
		height: 40
	});
	const leafAssetId = await registerBundledAsset({
		name: 'sprite-leaf.png',
		link: '/1x/stock/sprite-leaf.png',
		mimeType: 'image/png',
		width: 56,
		height: 30
	});
	// Oklab equivalents of the Flavor axis's own oklch() colors above (SpriteInstance.color has no
	// CSS-string parsing step, so these are hand-converted: a = C*cos(H), b = C*sin(H)).
	const confettiColors = [
		{ l: 0.62, a: -0.138, b: -0.024, alpha: 1 }, // teal, matches the CTA/price accent
		{ l: 0.86, a: -0.013, b: 0.149, alpha: 1 }, // gold, matches Pineapple
		{ l: 0.45, a: 0.122, b: -0.146, alpha: 1 }, // deep purple, matches Grape
		{ l: 0.93, a: -0.049, b: -0.009, alpha: 1 } // light teal, matches the Flavor Chip bg
	];
	const confettiKinds: Array<{ id: string | null; w: number; h: number }> = [
		{ id: dropletAssetId, w: 9, h: 12 },
		{ id: citrusAssetId, w: 10, h: 10 },
		{ id: leafAssetId, w: 13, h: 7 }
	];
	const confettiSprites: Array<Record<string, unknown>> = [];
	const CONFETTI_COUNT = 22;
	for (let i = 0; i < CONFETTI_COUNT; i++) {
		const kind = confettiKinds[i % confettiKinds.length]!;
		if (!kind.id) continue;
		const color = confettiColors[i % confettiColors.length]!;
		const scale = 0.85 + ((i * 7) % 5) * 0.08;
		const x = 18 + Math.round((i * 857) / CONFETTI_COUNT) + (((i % 3) - 1) * 10);
		const y = 6 + ((i * 37) % 38);
		confettiSprites.push({
			position: [x, y],
			size: [Math.round(kind.w * scale), Math.round(kind.h * scale)],
			rotation: (((i * 53) % 360) * Math.PI) / 180,
			sprite_id: kind.id,
			color,
			opacity: 0.72 + (i % 5) * 0.06,
			tint: true
		});
	}
	// No background of its own (SpriteBatchData carries no bg_color - it's inherently a
	// transparent overlay), so it sits directly on the page's own cream background.
	const confettiBandKit = await boxKit('Confetti Band', {
		width: 'fill',
		height: '54px',
		sprites: JSON.stringify(confettiSprites)
	});

	// --- Leaf text views ---
	const logo = await textView('Logo', h2Kit, 'TROPIKA');
	const navLinkShop = await textView('Nav Link: Shop', navLinkKit, 'Shop');
	const navLinkFlavors = await textView('Nav Link: Flavors', navLinkKit, 'Flavors');
	const navCtaLabel = await textView('Nav CTA Label', ctaLabelKit, 'Subscribe');
	const heroHeading = await textView('Hero Heading', h1Kit, 'Sunshine in a can.');
	const heroSubtitle = await textView(
		'Hero Subtitle',
		bodyKit,
		'Cold-pressed pineapple, starfruit, and grape, canned at peak ripeness. No added sugar, no concentrate.'
	);
	const heroCtaLabel = await textView('Hero CTA Label', ctaLabelKit, 'Try the Variety Pack');
	const bandText = await textView(
		'Band Text',
		bandTextKit,
		'Every can is cold-pressed within 24 hours of harvest, then sealed without heat or water, so what you taste is just the fruit.'
	);

	const pineappleTitle = await textView('Pineapple Title', canLabelKit, 'Pineapple');
	const pineappleNote = await textView(
		'Pineapple Note',
		canNoteKit,
		'Bright, golden, straight off the stem.'
	);
	const pineapplePrice = await textView('Pineapple Price', canPriceKit, '$2.49');

	const starfruitTitle = await textView('Starfruit Title', canLabelKit, 'Starfruit');
	const starfruitNote = await textView(
		'Starfruit Note',
		canNoteKit,
		'Crisp, tart, quietly tropical.'
	);
	const starfruitPrice = await textView('Starfruit Price', canPriceKit, '$2.49');

	const grapeTitle = await textView('Grape Title', canLabelLightKit, 'Grape');
	const grapeNote = await textView('Grape Note', canNoteLightKit, 'Deep, jammy, Concord-dark.');
	const grapePrice = await textView('Grape Price', canPriceLightKit, '$2.49');

	const nutritionSugar = await textView('Nutrition: Sugar', nutritionLabelKit, '0g Added Sugar');
	const nutritionCold = await textView('Nutrition: Cold-Pressed', nutritionLabelKit, 'Cold-Pressed');
	const nutritionReal = await textView('Nutrition: Real Fruit', nutritionLabelKit, 'Real Fruit Only');
	const nutritionCan = await textView('Nutrition: BPA-Free', nutritionLabelKit, 'BPA-Free Can');

	const chipTropical = await textView('Chip: Tropical', chipKit, 'Tropical');
	const chipRefreshing = await textView('Chip: Refreshing', chipKit, 'Refreshing');
	const chipAntioxidant = await textView('Chip: Antioxidant-Rich', chipKit, 'Antioxidant-Rich');
	const chipNonGmo = await textView('Chip: Non-GMO', chipKit, 'Non-GMO');
	const chipVegan = await textView('Chip: Vegan', chipKit, 'Vegan');

	const subscribeLabel = await textView(
		'Subscribe Label',
		bodyKit,
		'Subscribe & save 15% on every case.'
	);
	const priceOld = await textView('Price Old', priceOldKit, '$29.99');
	const priceNew = await textView('Price New', priceNewKit, '$25.49');
	const subscribeCtaLabel = await textView('Subscribe CTA Label', ctaLabelKit, 'Subscribe');

	const footerText = await textView(
		'Footer Text',
		footerTextKit,
		'\u00a9 2026 Tropika Beverage Co. \u2014 canned fresh, shipped cold.'
	);

	// --- Composed sections ---
	const navCta = await boxView('Nav CTA', ctaKit, [navCtaLabel]);
	const navLinks = await boxView('Nav Links', navLinksKit, [navLinkShop, navLinkFlavors, navCta]);
	const nav = await boxView('Nav Bar', navKit, [logo, navLinks]);

	const heroCta = await boxView('Hero CTA', ctaKit, [heroCtaLabel]);
	// Text-on-path seal: a circular badge under the CTA, real curved copy the way a canned drink's
	// own label would actually stamp it (see badgeRingKit's own comment for the coordinate note).
	const badgeRing = await textView(
		'Badge Ring',
		badgeRingKit,
		"★ COLD-PRESSED · NO ADDED SUGAR · SINCE 2019 ★ COLD-PRESSED · "
	);
	const heroContent = await boxView('Hero Content', heroContentKit, [
		heroHeading,
		heroSubtitle,
		heroCta,
		badgeRing
	]);
	const heroImg = await imageView('Hero Image', srcImageKit, splashAssetId ?? undefined);
	const hero = await boxView('Hero Section', heroKit, [heroContent, heroImg]);

	const band = await boxView('Brand Statement', bandKit, [bandText]);
	const confettiBand = await boxView('Confetti Band', confettiBandKit, [], {
		charter: { primitive: 'sprite-batch' },
		view_icon: 'fa-solid fa-shapes'
	});

	const pineapplePhoto = await imageView(
		'Pineapple Photo',
		canPhotoKit,
		pineapplePhotoAssetId ?? undefined
	);
	const canPineappleView = await boxView('Can: Pineapple', canKit, [
		pineapplePhoto,
		pineappleTitle,
		pineappleNote,
		pineapplePrice
	]);
	await api.setAxisArg(canPineappleView, canKit.id, flavorAxis.id, {
		type: 'literal',
		value: 'pineapple'
	});
	const starfruitPhoto = await imageView(
		'Starfruit Photo',
		canPhotoKit,
		starfruitPhotoAssetId ?? undefined
	);
	const canStarfruitView = await boxView('Can: Starfruit', canKit, [
		starfruitPhoto,
		starfruitTitle,
		starfruitNote,
		starfruitPrice
	]);
	await api.setAxisArg(canStarfruitView, canKit.id, flavorAxis.id, {
		type: 'literal',
		value: 'starfruit'
	});
	const grapePhoto = await imageView('Grape Photo', canPhotoKit, grapePhotoAssetId ?? undefined);
	const canGrapeView = await boxView('Can: Grape', canKit, [
		grapePhoto,
		grapeTitle,
		grapeNote,
		grapePrice
	]);
	await api.setAxisArg(canGrapeView, canKit.id, flavorAxis.id, { type: 'literal', value: 'grape' });

	const flavorRow = await boxView('Flavor Row', flavorRowKit, [
		canPineappleView,
		canStarfruitView,
		canGrapeView
	]);

	const nutritionTileSugar = await boxView('Nutrition Tile: Sugar', nutritionTileKit, [
		nutritionSugar
	]);
	const nutritionTileCold = await boxView('Nutrition Tile: Cold', nutritionTileKit, [
		nutritionCold
	]);
	const nutritionTileReal = await boxView('Nutrition Tile: Real Fruit', nutritionTileKit, [
		nutritionReal
	]);
	const nutritionTileCan = await boxView('Nutrition Tile: Can', nutritionTileKit, [nutritionCan]);
	const nutritionGrid = await boxView('Nutrition Grid', nutritionGridKit, [
		nutritionTileSugar,
		nutritionTileCold,
		nutritionTileReal,
		nutritionTileCan
	]);

	const chipCluster = await boxView('Chip Cluster', chipClusterKit, [
		chipTropical,
		chipRefreshing,
		chipAntioxidant,
		chipNonGmo,
		chipVegan
	]);

	const priceStack = await boxView('Price Stack', priceStackKit, [priceOld, priceNew]);
	const subscribeCta = await boxView('Subscribe CTA', ctaKit, [subscribeCtaLabel]);
	const subscribeRight = await boxView('Subscribe Right', priceStackKit, [
		priceStack,
		subscribeCta
	]);
	const subscribe = await boxView('Subscribe Row', subscribeKit, [subscribeLabel, subscribeRight]);

	const footer = await boxView('Footer', footerKit, [footerText]);

	await boxView('Landing Page', pageKit, [
		nav,
		hero,
		band,
		confettiBand,
		flavorRow,
		nutritionGrid,
		chipCluster,
		subscribe,
		footer
	]);

	console.log('Demo project seeded: Tropika Juice Co.');
}

// ==========================================================================================
// Forge Wellness Club -- gym & wellness center landing page, subscription-tier pricing.
//
// Exercises: a Plan axis (basic/pro/elite) resolved per-instance on the Plan Card kit --
// unlike Flavor above (which only varies background), Plan varies background AND border AND
// padding together, and the null layer covers Basic entirely (no {plan:basic} layer exists --
// Basic is just "whatever the unconditioned card looks like", the same "no divergence needed"
// shape as seedDemoProject's own theme/density button layers). Also nests a Cluster of feature
// chips inside a Stack card inside a Stack row (composition depth), and covers the Center
// arrangement on a two-child (heading + CTA) banner without forcing a stretch.
// ==========================================================================================
export async function seedGymLandingPage(
	dialect: SchemaDialect,
	builtinPlugins: BuiltinPlugins
): Promise<void> {
	const api: Api = queryBuilder(dialect);
	const ws = (await api.getAllWorkspaces().execute())[0]!;
	const proj = (await api.createProjectInWorkspace(ws.workspaceId, 'Forge Wellness Club'))!;
	await api.setProjectInterpreter(proj.id, builtinPlugins.charter.id);

	const { boxKit, textKit, textView, boxView, imageKit, imageView, registerBundledAsset } =
		makeSeedHelpers(api, proj.id);

	// --- Plan axis: Basic has no conditioned layer at all -- it's just the null layer's own
	// unconditioned look, same shape as a design system where the "default" tier needs no
	// bespoke treatment. Pro and Elite each diverge on background + border + padding together.
	const planAxis = (await api.createAxis(
		proj.id,
		'Plan',
		'Which membership tier this card represents',
		'categorical'
	))!;
	await api.createAxisValue(planAxis.id, { type: 'literal', value: 'basic' });
	const planPro = (await api.createAxisValue(planAxis.id, { type: 'literal', value: 'pro' }))!;
	const planElite = (await api.createAxisValue(planAxis.id, { type: 'literal', value: 'elite' }))!;

	const planCardKit = (await api.createKitInProject(proj.id, 'Plan Card'))!;
	await api.consumeAxis(planCardKit.id, planAxis.id);

	const planNull = (await api.createLayer(planCardKit.id))!;
	const planNullSnip = (await api.createRenderSnippet(planNull.id))!;
	await api.createRenderEntry(planNullSnip.id, 'arrange', 'stack');
	await api.createRenderEntry(planNullSnip.id, 'align-items', 'stretch');
	await api.createRenderEntry(planNullSnip.id, 'gap', '16px');
	await api.createRenderEntry(planNullSnip.id, 'padding', '28px');
	await api.createRenderEntry(planNullSnip.id, 'border', 'oklch(88% 0.01 260)');
	await api.createRenderEntry(planNullSnip.id, 'border-radius', '16px');
	await api.createRenderEntry(planNullSnip.id, 'background', 'oklch(100% 0 0)');
	await api.createRenderEntry(planNullSnip.id, 'width', 'fill');

	const planProLayer = (await api.createLayer(planCardKit.id))!;
	await api.addAxisValueToLayer(planProLayer.id, planPro.id);
	const planProSnip = (await api.createRenderSnippet(planProLayer.id))!;
	await api.createRenderEntry(planProSnip.id, 'border', 'oklch(64% 0.19 35)');
	await api.createRenderEntry(planProSnip.id, 'background', 'oklch(97% 0.02 35)');

	const planEliteLayer = (await api.createLayer(planCardKit.id))!;
	await api.addAxisValueToLayer(planEliteLayer.id, planElite.id);
	const planEliteSnip = (await api.createRenderSnippet(planEliteLayer.id))!;
	await api.createRenderEntry(planEliteSnip.id, 'border', 'oklch(80% 0.13 85)');
	await api.createRenderEntry(planEliteSnip.id, 'background', 'oklch(16% 0.01 260)');
	await api.createRenderEntry(planEliteSnip.id, 'padding', '32px');
	// A static stand-in for what would eventually be an idle MotionPath highlight orbiting this
	// one card (Deform is authored per-property today, not a standing "this node animates" bit -
	// see resources/foundation-execution.md M6): a bolder gold border + squircle corner draws the
	// eye without needing motion.
	await api.createRenderEntry(planEliteSnip.id, 'border-width', '2.5px');
	await api.createRenderEntry(planEliteSnip.id, 'border-radius-squircle', '1');

	// --- Style kits ---
	const h1Kit = await textKit('Heading', {
		'font-size': '42px',
		// Inter's catalogued variant tops out at 700 (see plugins/fontavious/catalogue.json) --
		// 700 is the boldest weight this family actually ships, not an arbitrary choice.
		'font-weight': '700',
		color: 'oklch(18% 0.01 260)'
	});
	const h2Kit = await textKit('Subheading', {
		'font-size': '19px',
		'font-weight': '700',
		color: 'oklch(18% 0.01 260)'
	});
	const bodyKit = await textKit('Body', {
		'font-size': '15px',
		'font-weight': '400',
		color: 'oklch(50% 0.01 260)'
	});
	const ctaLabelKit = await textKit('CTA Label', {
		'font-size': '15px',
		'font-weight': '600',
		color: 'oklch(100% 0 0)'
	});
	const navLinkKit = await textKit('Nav Link', {
		'font-size': '14px',
		'font-weight': '600',
		color: 'oklch(18% 0.01 260)'
	});
	const bandTextKit = await textKit('Band Text', {
		'font-size': '19px',
		'font-weight': '500',
		color: 'oklch(18% 0.01 260)',
		'line-height': '1.6',
		'text-align': 'center'
	});
	const bannerHeadingKit = await textKit('Banner Heading', {
		'font-size': '24px',
		'font-weight': '700',
		color: 'oklch(18% 0.01 260)'
	});
	const tierNameKit = await textKit('Tier Name', {
		'font-size': '20px',
		'font-weight': '700',
		color: 'oklch(18% 0.01 260)'
	});
	const priceKit = await textKit('Tier Price', {
		'font-size': '28px',
		'font-weight': '700',
		color: 'oklch(18% 0.01 260)'
	});
	const tierNameLightKit = await textKit('Tier Name Light', {
		'font-size': '20px',
		'font-weight': '700',
		color: 'oklch(95% 0 0)'
	});
	const priceLightKit = await textKit('Tier Price Light', {
		'font-size': '28px',
		'font-weight': '700',
		color: 'oklch(80% 0.13 85)'
	});
	const badgeKit = await textKit('Most Popular Badge', {
		'font-size': '12px',
		'font-weight': '700',
		color: 'oklch(64% 0.19 35)',
		'text-decoration': 'underline'
	});
	const featureChipKit = await textKit('Feature Chip', {
		'font-size': '13px',
		'font-weight': '500',
		color: 'oklch(30% 0.06 35)',
		background: 'oklch(95% 0.03 35)',
		'border-radius': '999px',
		padding: '5px 12px'
	});
	const featureChipLightKit = await textKit('Feature Chip Light', {
		'font-size': '13px',
		'font-weight': '500',
		color: 'oklch(90% 0.05 85)',
		background: 'oklch(24% 0.02 260)',
		'border-radius': '999px',
		padding: '5px 12px'
	});
	const classLabelKit = await textKit('Class Label', {
		'font-size': '14px',
		'font-weight': '600',
		color: 'oklch(18% 0.01 260)',
		'text-align': 'center'
	});
	const communityChipKit = await textKit('Community Chip', {
		'font-size': '13px',
		'font-weight': '600',
		color: 'oklch(45% 0.14 35)',
		background: 'oklch(95% 0.03 35)',
		'border-radius': '999px',
		padding: '6px 14px'
	});
	const footerTextKit = await textKit('Footer Text', {
		'font-size': '13px',
		'font-weight': '400',
		color: 'oklch(50% 0.01 260)'
	});

	// --- Layout kits ---
	const pageKit = await boxKit('Page', {
		arrange: 'stack',
		background: 'oklch(99% 0 0)',
		width: '960px',
		gap: '0px',
		padding: '0px'
	});
	const navKit = await boxKit('Nav', {
		arrange: 'split',
		padding: '20px 40px',
		background: 'oklch(100% 0 0)',
		// A top-level Page section: Page's own Stack (column) has no explicit align-items, so this
		// must spell out Fill itself rather than lean on the old implicit-stretch fallback -- see
		// the compile_arrange Stack-Column pitfall in CLAUDE.md.
		width: 'fill'
	});
	const navLinksKit = await boxKit('Nav Links', { arrange: 'cluster', gap: '20px' });
	const ctaKit = await boxKit('CTA', {
		arrange: 'center',
		padding: '13px 26px',
		background: 'oklch(64% 0.19 35)',
		'border-radius': '10px',
		width: 'hug'
	});
	const heroKit = await boxKit('Hero', {
		arrange: 'stack',
		'flex-direction': 'row',
		'align-items': 'center',
		gap: '32px',
		padding: '56px 64px',
		background: 'oklch(97% 0.01 260)',
		width: 'fill'
	});
	const heroContentKit = await boxKit('Hero Content', {
		arrange: 'stack',
		'align-items': 'center',
		gap: '18px'
	});
	const bandKit = await boxKit('Band', {
		arrange: 'stack',
		'align-items': 'stretch',
		padding: '48px 120px',
		background: 'oklch(100% 0 0)',
		width: 'fill'
	});
	const bannerKit = await boxKit('Trial Banner', {
		arrange: 'center',
		gap: '20px',
		padding: '40px',
		background: 'oklch(95% 0.03 35)',
		width: 'fill'
	});
	const plansRowKit = await boxKit('Plans Row', {
		arrange: 'stack',
		'flex-direction': 'row',
		'align-items': 'stretch',
		gap: '20px',
		padding: '48px 64px 56px 64px',
		background: 'oklch(99% 0 0)',
		width: 'fill'
	});
	const featuresClusterKit = await boxKit('Features Cluster', { arrange: 'cluster', gap: '8px' });
	// Explicit grid-template-areas, not the auto-fit `grid-cell-min` sugar every other seeded grid
	// uses: the class schedule has one real hero (Strength) among five supporting sessions, and
	// named areas are what let Strength claim a real 2x2 block instead of sitting in the same size
	// tile as Mobility. Rows: [strength|strength|hiit|cycling] / [strength|strength|yoga|boxing] /
	// [mobility x4] - Mobility spans the full width as a shorter recovery-track strip underneath.
	const classGridKit = await boxKit('Class Grid', {
		arrange: 'grid',
		'grid-template-columns': '1fr 1fr 1fr 1fr',
		'grid-template-rows': '1fr 1fr 0.6fr',
		'grid-template-areas': '"strength strength hiit cycling" "strength strength yoga boxing" "mobility mobility mobility mobility"',
		gap: '14px',
		padding: '48px',
		width: 'fill'
	});
	// A real per-instance property (grid-column/grid-row into the named areas above) can't be
	// baked onto one shared kit the way boxKit's flat props do - it needs the same axis+layer
	// pattern planCardKit uses just above, one value per tile. The "Class" axis is that grid-slot
	// selector; Strength/Mobility additionally get their own visual treatment (Strength claims the
	// hero tint, Mobility switches to a row layout for its wide strip) on the same conditioned
	// layer, since both are genuinely tied to which slot the tile occupies.
	const classAxis = (await api.createAxis(
		proj.id,
		'Class',
		'Which class this tile represents, and which grid area it occupies',
		'categorical'
	))!;
	const classTileKit = (await api.createKitInProject(proj.id, 'Class Tile'))!;
	await api.consumeAxis(classTileKit.id, classAxis.id);
	const classTileNull = (await api.createLayer(classTileKit.id))!;
	const classTileNullSnip = (await api.createRenderSnippet(classTileNull.id))!;
	await api.createRenderEntry(classTileNullSnip.id, 'arrange', 'stack');
	await api.createRenderEntry(classTileNullSnip.id, 'align-items', 'center');
	await api.createRenderEntry(classTileNullSnip.id, 'gap', '10px');
	await api.createRenderEntry(classTileNullSnip.id, 'padding', '18px 10px');
	await api.createRenderEntry(classTileNullSnip.id, 'background', 'oklch(97% 0.01 260)');
	await api.createRenderEntry(classTileNullSnip.id, 'border-radius', '14px');

	type ClassSlot = { slug: string; extra?: Record<string, string> };
	const classSlots: ClassSlot[] = [
		{
			slug: 'strength',
			extra: {
				background: 'oklch(95% 0.03 35)',
				padding: '22px 16px'
			}
		},
		{ slug: 'hiit' },
		{ slug: 'cycling' },
		{ slug: 'yoga' },
		{ slug: 'boxing' },
		{
			slug: 'mobility',
			extra: {
				'flex-direction': 'row',
				'justify-content': 'flex-start',
				gap: '14px'
			}
		}
	];
	for (const { slug, extra } of classSlots) {
		const value = (await api.createAxisValue(classAxis.id, { type: 'literal', value: slug }))!;
		const layer = (await api.createLayer(classTileKit.id))!;
		await api.addAxisValueToLayer(layer.id, value.id);
		const snip = (await api.createRenderSnippet(layer.id))!;
		await api.createRenderEntry(snip.id, 'grid-column', `${slug}-start / ${slug}-end`);
		await api.createRenderEntry(snip.id, 'grid-row', `${slug}-start / ${slug}-end`);
		for (const [k, v] of Object.entries(extra ?? {})) await api.createRenderEntry(snip.id, k, v);
	}

	const classIconKit = await boxKit('Class Icon', {
		width: '36px',
		height: '36px',
		'border-radius': '10px',
		background: 'oklch(64% 0.19 35)'
	});
	const communityClusterKit = await boxKit('Community Cluster', {
		arrange: 'cluster',
		gap: '10px',
		padding: '0px 64px 48px',
		width: 'fill'
	});
	const footerKit = await boxKit('Footer', {
		arrange: 'split',
		padding: '28px 64px',
		background: 'oklch(97% 0.01 260)',
		width: 'fill'
	});
	const footerLinksKit = await boxKit('Footer Links', { arrange: 'cluster', gap: '16px' });

	// Real, freely-licensed photo, bundled locally -- see the note in seedJuiceLandingPage above
	// on why this is NOT hotlinked (every app boot reseeds from scratch, and a live cross-origin
	// fetch on that path caused a real, reported lag/stall on every reload).
	const srcImageKit = await imageKit('Image Source', { width: '340px', height: '230px' });
	const heroAssetId = await registerBundledAsset({
		name: 'gym-hero.jpg',
		link: '/1x/stock/gym-hero.jpg',
		mimeType: 'image/jpeg',
		width: 640,
		height: 360
	});

	// --- Leaf text views ---
	const logo = await textView('Logo', h2Kit, 'FORGE');
	const navLinkClasses = await textView('Nav Link: Classes', navLinkKit, 'Classes');
	const navLinkCoaches = await textView('Nav Link: Coaches', navLinkKit, 'Coaches');
	const navCtaLabel = await textView('Nav CTA Label', ctaLabelKit, 'Join Now');
	const heroHeading = await textView('Hero Heading', h1Kit, 'Train harder. Recover smarter.');
	const heroSubtitle = await textView(
		'Hero Subtitle',
		bodyKit,
		'Strength, conditioning, and recovery under one roof, with coaching built into every membership.'
	);
	const heroCtaLabel = await textView('Hero CTA Label', ctaLabelKit, 'Book a Free Trial');
	const bandText = await textView(
		'Band Text',
		bandTextKit,
		'Every membership pairs strength and conditioning work with real recovery: sauna, mobility, and a coach who actually watches your form.'
	);
	const bannerHeading = await textView('Banner Heading', bannerHeadingKit, 'Your first class is on us.');
	const bannerCtaLabel = await textView('Banner CTA Label', ctaLabelKit, 'Reserve Your Spot');

	const basicName = await textView('Basic Name', tierNameKit, 'Basic');
	const basicPrice = await textView('Basic Price', priceKit, '$39/mo');
	const basicF1 = await textView('Basic Feature 1', featureChipKit, 'Gym floor access');
	const basicF2 = await textView('Basic Feature 2', featureChipKit, 'Locker room');
	const basicF3 = await textView('Basic Feature 3', featureChipKit, '2 group classes/mo');

	const proName = await textView('Pro Name', tierNameKit, 'Pro');
	const proBadge = await textView('Pro Badge', badgeKit, 'MOST POPULAR');
	const proPrice = await textView('Pro Price', priceKit, '$79/mo');
	const proF1 = await textView('Pro Feature 1', featureChipKit, 'Unlimited classes');
	const proF2 = await textView('Pro Feature 2', featureChipKit, 'Sauna & recovery suite');
	const proF3 = await textView('Pro Feature 3', featureChipKit, 'Monthly body scan');

	const eliteName = await textView('Elite Name', tierNameLightKit, 'Elite');
	const elitePrice = await textView('Elite Price', priceLightKit, '$149/mo');
	const eliteF1 = await textView('Elite Feature 1', featureChipLightKit, 'Everything in Pro');
	const eliteF2 = await textView('Elite Feature 2', featureChipLightKit, '2x personal training/mo');
	const eliteF3 = await textView('Elite Feature 3', featureChipLightKit, 'Priority booking');

	const classNames = ['Strength', 'HIIT', 'Cycling', 'Yoga', 'Boxing', 'Mobility'];
	const classLabelViews: string[] = [];
	for (const name of classNames)
		classLabelViews.push(await textView(`Class Label: ${name}`, classLabelKit, name));

	const communityMembers = await textView('Community: Members', communityChipKit, '500+ Members');
	const communityCoaches = await textView('Community: Coaches', communityChipKit, '12 Coaches');
	const communityHours = await textView('Community: Hours', communityChipKit, 'Open 5am\u201311pm');
	const communityLocations = await textView(
		'Community: Locations',
		communityChipKit,
		'3 Locations'
	);

	const footerText = await textView('Footer Text', footerTextKit, '\u00a9 2026 Forge Wellness Club.');
	const footerLinkMembership = await textView('Footer Link: Membership', navLinkKit, 'Membership');
	const footerLinkSchedule = await textView('Footer Link: Schedule', navLinkKit, 'Schedule');
	const footerLinkContact = await textView('Footer Link: Contact', navLinkKit, 'Contact');

	// --- Composed sections ---
	const navCta = await boxView('Nav CTA', ctaKit, [navCtaLabel]);
	const navLinks = await boxView('Nav Links', navLinksKit, [
		navLinkClasses,
		navLinkCoaches,
		navCta
	]);
	const nav = await boxView('Nav Bar', navKit, [logo, navLinks]);

	const heroCta = await boxView('Hero CTA', ctaKit, [heroCtaLabel]);
	const heroContent = await boxView('Hero Content', heroContentKit, [
		heroHeading,
		heroSubtitle,
		heroCta
	]);
	const heroImg = await imageView('Hero Image', srcImageKit, heroAssetId ?? undefined);
	const hero = await boxView('Hero Section', heroKit, [heroContent, heroImg]);

	const band = await boxView('Philosophy Band', bandKit, [bandText]);

	const bannerCta = await boxView('Banner CTA', ctaKit, [bannerCtaLabel]);
	const banner = await boxView('Trial Banner', bannerKit, [bannerHeading, bannerCta]);

	const basicFeatures = await boxView('Basic Features', featuresClusterKit, [
		basicF1,
		basicF2,
		basicF3
	]);
	const basicCard = await boxView('Plan: Basic', planCardKit, [basicName, basicPrice, basicFeatures]);
	await api.setAxisArg(basicCard, planCardKit.id, planAxis.id, { type: 'literal', value: 'basic' });

	const proFeatures = await boxView('Pro Features', featuresClusterKit, [proF1, proF2, proF3]);
	const proCard = await boxView('Plan: Pro', planCardKit, [
		proName,
		proBadge,
		proPrice,
		proFeatures
	]);
	await api.setAxisArg(proCard, planCardKit.id, planAxis.id, { type: 'literal', value: 'pro' });

	const eliteFeatures = await boxView('Elite Features', featuresClusterKit, [
		eliteF1,
		eliteF2,
		eliteF3
	]);
	const eliteCard = await boxView('Plan: Elite', planCardKit, [
		eliteName,
		elitePrice,
		eliteFeatures
	]);
	await api.setAxisArg(eliteCard, planCardKit.id, planAxis.id, { type: 'literal', value: 'elite' });

	const plansRow = await boxView('Plans Row', plansRowKit, [basicCard, proCard, eliteCard]);

	const classTiles: string[] = [];
	for (let i = 0; i < classNames.length; i++) {
		const icon = await boxView('Class Icon', classIconKit, []);
		const tile = await boxView('Class Tile', classTileKit, [icon, classLabelViews[i]!]);
		await api.setAxisArg(tile, classTileKit.id, classAxis.id, {
			type: 'literal',
			value: classSlots[i]!.slug
		});
		classTiles.push(tile);
	}
	const classGrid = await boxView('Class Grid', classGridKit, classTiles);

	const communityCluster = await boxView('Community Cluster', communityClusterKit, [
		communityMembers,
		communityCoaches,
		communityHours,
		communityLocations
	]);

	const footerLinks = await boxView('Footer Links', footerLinksKit, [
		footerLinkMembership,
		footerLinkSchedule,
		footerLinkContact
	]);
	const footer = await boxView('Footer', footerKit, [footerText, footerLinks]);

	await boxView('Landing Page', pageKit, [
		nav,
		hero,
		band,
		banner,
		plansRow,
		classGrid,
		communityCluster,
		footer
	]);

	console.log('Demo project seeded: Forge Wellness Club');
}

// ==========================================================================================
// Meridian -- a minimalist "premium essentials" apparel store, selling ordinary shirts and
// pants dressed up in editorial copy and a monochrome + single-accent palette.
//
// Exercises: a Category axis (shirts/pants) resolved per-instance on the Product Tile kit
// (border color only, the lightest-touch axis divergence of the three landing pages); the
// Center arrangement on a hug-sized (not stretched) hero, so its children keep their own
// natural width; a full-bleed Img at width:'100%' with fit:'contain' (vs. the other two pages'
// fixed-px cover default); text-align:'justify' on a real stretched paragraph (distinct from
// the other two pages' 'center'); and a nested Split-containing-Cluster nav.
// ==========================================================================================
export async function seedMerchLandingPage(
	dialect: SchemaDialect,
	builtinPlugins: BuiltinPlugins
): Promise<void> {
	const api: Api = queryBuilder(dialect);
	const ws = (await api.getAllWorkspaces().execute())[0]!;
	const proj = (await api.createProjectInWorkspace(ws.workspaceId, 'Meridian'))!;
	await api.setProjectInterpreter(proj.id, builtinPlugins.charter.id);

	const { boxKit, textKit, textView, boxView, imageKit, imageView, registerBundledAsset } =
		makeSeedHelpers(api, proj.id);

	// --- Category axis: the lightest-touch divergence of the three landing pages -- only the
	// tile's own border color changes; everything else (padding, radius, layout) stays uniform
	// across categories, which is itself a legitimate axis-usage shape (not every axis needs to
	// touch many properties to be worth modeling).
	const categoryAxis = (await api.createAxis(
		proj.id,
		'Category',
		'Which product category this tile represents',
		'categorical'
	))!;
	const categoryShirts = (await api.createAxisValue(categoryAxis.id, {
		type: 'literal',
		value: 'shirts'
	}))!;
	const categoryPants = (await api.createAxisValue(categoryAxis.id, {
		type: 'literal',
		value: 'pants'
	}))!;

	const productTileKit = (await api.createKitInProject(proj.id, 'Product Tile'))!;
	await api.consumeAxis(productTileKit.id, categoryAxis.id);

	const tileNull = (await api.createLayer(productTileKit.id))!;
	const tileNullSnip = (await api.createRenderSnippet(tileNull.id))!;
	await api.createRenderEntry(tileNullSnip.id, 'arrange', 'stack');
	await api.createRenderEntry(tileNullSnip.id, 'align-items', 'stretch');
	await api.createRenderEntry(tileNullSnip.id, 'gap', '10px');
	await api.createRenderEntry(tileNullSnip.id, 'padding', '20px');
	await api.createRenderEntry(tileNullSnip.id, 'border', 'oklch(85% 0 0)');
	await api.createRenderEntry(tileNullSnip.id, 'border-radius', '4px');
	await api.createRenderEntry(tileNullSnip.id, 'background', 'oklch(100% 0 0)');
	// Squircle, quietly: the same superellipse-corner primitive Tropika reaches for loudly on its
	// flavor cans, used here at a whisper - a few extra points of curve on an already-small 4px
	// radius, restrained rather than a rounded-everything look, matching the brand's whole point.
	await api.createRenderEntry(tileNullSnip.id, 'border-radius-squircle', '1');

	const tileShirts = (await api.createLayer(productTileKit.id))!;
	await api.addAxisValueToLayer(tileShirts.id, categoryShirts.id);
	const tileShirtsSnip = (await api.createRenderSnippet(tileShirts.id))!;
	await api.createRenderEntry(tileShirtsSnip.id, 'border', 'oklch(45% 0.09 40)');

	const tilePants = (await api.createLayer(productTileKit.id))!;
	await api.addAxisValueToLayer(tilePants.id, categoryPants.id);
	const tilePantsSnip = (await api.createRenderSnippet(tilePants.id))!;
	await api.createRenderEntry(tilePantsSnip.id, 'border', 'oklch(40% 0.05 250)');

	// --- Grid Slot axis: a second axis on the SAME kit, independent of Category (border color) -
	// this one exists purely to place each of the four shared-kit tiles into its own named area of
	// the editorial grid below (see productGridKit). A lookbook page is a spread, not a catalog: the
	// hero image claims real column/row space and the garments arrange around it, the way an art
	// director lays out a magazine page rather than tiling everything evenly.
	const slotAxis = (await api.createAxis(
		proj.id,
		'Grid Slot',
		'Which named area of the editorial grid this tile occupies',
		'categorical'
	))!;
	const productSlots = ['oxford', 'tee', 'trouser', 'denim'];
	for (const slug of productSlots) {
		const value = (await api.createAxisValue(slotAxis.id, { type: 'literal', value: slug }))!;
		const layer = (await api.createLayer(productTileKit.id))!;
		await api.addAxisValueToLayer(layer.id, value.id);
		const snip = (await api.createRenderSnippet(layer.id))!;
		await api.createRenderEntry(snip.id, 'grid-column', `${slug}-start / ${slug}-end`);
		await api.createRenderEntry(snip.id, 'grid-row', `${slug}-start / ${slug}-end`);
	}
	await api.consumeAxis(productTileKit.id, slotAxis.id);

	// --- Style kits ---
	const h1Kit = await textKit('Heading', {
		'font-size': '40px',
		'font-weight': '700',
		color: 'oklch(12% 0 0)',
		'text-align': 'center',
		'line-height': '1.1'
	});
	const h2Kit = await textKit('Subheading', {
		'font-size': '20px',
		// Inter's catalogued variant tops out at 700 -- see the h1Kit comment above.
		'font-weight': '700',
		color: 'oklch(12% 0 0)'
	});
	const bodyKit = await textKit('Body', {
		'font-size': '16px',
		'font-weight': '400',
		color: 'oklch(45% 0 0)',
		'text-align': 'center',
		'line-height': '1.5'
	});
	const ctaLabelKit = await textKit('CTA Label', {
		'font-size': '14px',
		'font-weight': '700',
		color: 'oklch(96% 0 0)'
	});
	const navLinkKit = await textKit('Nav Link', {
		'font-size': '13px',
		'font-weight': '600',
		color: 'oklch(12% 0 0)'
	});
	const bandTextKit = await textKit('Band Text', {
		'font-size': '16px',
		'font-weight': '400',
		color: 'oklch(30% 0 0)',
		'line-height': '1.6',
		'text-align': 'justify'
	});
	const shippingLabelKit = await textKit('Shipping Label', {
		'font-size': '14px',
		'font-weight': '600',
		color: 'oklch(12% 0 0)',
		'text-align': 'center'
	});
	const productNameKit = await textKit('Product Name', {
		'font-size': '15px',
		'font-weight': '600',
		color: 'oklch(12% 0 0)'
	});
	const priceOldKit = await textKit('Price Old', {
		'font-size': '13px',
		'font-weight': '500',
		color: 'oklch(55% 0 0)',
		'text-decoration': 'line-through'
	});
	const priceNewKit = await textKit('Price New', {
		'font-size': '16px',
		'font-weight': '700',
		color: 'oklch(12% 0 0)'
	});
	const materialChipKit = await textKit('Material Chip', {
		'font-size': '13px',
		'font-weight': '500',
		color: 'oklch(96% 0 0)',
		background: 'oklch(22% 0 0)',
		'border-radius': '999px',
		padding: '6px 14px'
	});
	const footerTextKit = await textKit('Footer Text', {
		'font-size': '13px',
		'font-weight': '400',
		color: 'oklch(45% 0 0)'
	});

	// --- Layout kits ---
	const pageKit = await boxKit('Page', {
		arrange: 'stack',
		background: 'oklch(100% 0 0)',
		width: '900px',
		gap: '0px',
		padding: '0px'
	});
	const navKit = await boxKit('Nav', {
		arrange: 'split',
		padding: '24px 48px',
		background: 'oklch(100% 0 0)',
		// A top-level Page section: Page's own Stack (column) has no explicit align-items, so this
		// must spell out Fill itself rather than lean on the old implicit-stretch fallback -- see
		// the compile_arrange Stack-Column pitfall in CLAUDE.md.
		width: 'fill'
	});
	const navLinksKit = await boxKit('Nav Links', { arrange: 'cluster', gap: '24px' });
	const ctaKit = await boxKit('CTA', {
		arrange: 'center',
		padding: '14px 28px',
		background: 'oklch(12% 0 0)',
		'border-radius': '2px',
		width: 'hug'
	});
	const heroKit = await boxKit('Hero', {
		arrange: 'center',
		gap: '20px',
		padding: '96px 64px 80px',
		width: 'fill'
	});
	const shippingRowKit = await boxKit('Shipping Row', {
		arrange: 'stack',
		'flex-direction': 'row',
		'align-items': 'stretch',
		gap: '1px',
		padding: '0px',
		background: 'oklch(90% 0 0)',
		width: 'fill'
	});
	const shippingBoxKit = await boxKit('Shipping Box', {
		arrange: 'center',
		padding: '28px 20px',
		background: 'oklch(100% 0 0)',
		width: 'fill'
	});
	const bandKit = await boxKit('Band', {
		arrange: 'stack',
		'align-items': 'stretch',
		padding: '48px 140px',
		background: 'oklch(100% 0 0)',
		width: 'fill'
	});
	// Editorial grid: the lookbook photo spans the full left column across both rows (a real
	// spread), with the four products arranged two-up beside it - see the Grid Slot axis above for
	// how each shared-kit tile places itself, and lookbookCellKit below for the image's own slot.
	const productGridKit = await boxKit('Product Grid', {
		arrange: 'grid',
		'grid-template-columns': '1.3fr 1fr 1fr',
		'grid-template-rows': 'minmax(220px, auto) minmax(160px, auto)',
		'grid-template-areas': '"lookbook oxford tee" "lookbook trouser denim"',
		gap: '20px',
		padding: '0px 64px 56px',
		width: 'fill'
	});
	// The lookbook photo's own grid slot: unlike the four product tiles it's a singleton, so its
	// placement is baked directly rather than routed through an axis. Deliberately no radius/
	// squircle here - Img has no corner_radius of its own (only Box/Text do) and this cell has no
	// padding, so a rounded box background would sit fully hidden behind the full-bleed photo. Full
	// bleed is the right call for the hero spread anyway; the squircle refinement lives on the four
	// product cards below, which have real padding for it to show through.
	const lookbookCellKit = await boxKit('Lookbook Cell', {
		'grid-column': 'lookbook-start / lookbook-end',
		'grid-row': 'lookbook-start / lookbook-end'
	});
	const priceRowKit = await boxKit('Price Row', {
		arrange: 'stack',
		'flex-direction': 'row',
		'align-items': 'center',
		gap: '10px'
	});
	const materialsKit = await boxKit('Materials Band', {
		arrange: 'cluster',
		gap: '10px',
		padding: '40px 64px',
		background: 'oklch(10% 0 0)',
		width: 'fill'
	});
	const footerKit = await boxKit('Footer', {
		arrange: 'split',
		padding: '28px 64px',
		background: 'oklch(100% 0 0)',
		width: 'fill'
	});
	const footerLinksKit = await boxKit('Footer Links', { arrange: 'cluster', gap: '18px' });

	// Real, freely-licensed photos, bundled locally rather than flat color swatches -- see the
	// matching note in seedJuiceLandingPage above on why these are NOT hotlinked. Also replaces
	// the four product tiles' plain color-swatch placeholders with a real photo per product.
	// `height: 'fill'` (not a fixed px) now that this sits inside a grid cell whose height is
	// computed from the row tracks rather than page flow; `cover` (not the old `contain`) so it
	// reads as a full-bleed spread photo rather than a letterboxed thumbnail.
	const srcImageKit = await imageKit('Image Source', { width: '100%', height: 'fill', fit: 'cover' });
	const lookbookAssetId = await registerBundledAsset({
		name: 'merch-lookbook.jpg',
		link: '/1x/stock/merch-lookbook.jpg',
		mimeType: 'image/jpeg',
		width: 900,
		height: 675
	});
	const productPhotoKit = await imageKit('Product Photo', {
		width: '100%',
		height: '160px',
		fit: 'cover'
	});
	const oxfordPhotoAssetId = await registerBundledAsset({
		name: 'merch-oxford.jpg',
		link: '/1x/stock/merch-oxford.jpg',
		mimeType: 'image/jpeg',
		width: 360,
		height: 480
	});
	const teePhotoAssetId = await registerBundledAsset({
		name: 'merch-tee.jpg',
		link: '/1x/stock/merch-tee.jpg',
		mimeType: 'image/jpeg',
		width: 360,
		height: 480
	});
	const trouserPhotoAssetId = await registerBundledAsset({
		name: 'merch-trouser.jpg',
		link: '/1x/stock/merch-trouser.jpg',
		mimeType: 'image/jpeg',
		width: 480,
		height: 360
	});
	const denimPhotoAssetId = await registerBundledAsset({
		name: 'merch-denim.jpg',
		link: '/1x/stock/merch-denim.jpg',
		mimeType: 'image/jpeg',
		width: 480,
		height: 270
	});

	// --- Leaf text views ---
	const wordmark = await textView('Wordmark', h2Kit, 'MERIDIAN');
	const navLinkShirts = await textView('Nav Link: Shirts', navLinkKit, 'Shirts');
	const navLinkPants = await textView('Nav Link: Pants', navLinkKit, 'Pants');
	const navLinkAbout = await textView('Nav Link: About', navLinkKit, 'About');
	const navLinkCart = await textView('Nav Link: Cart', navLinkKit, 'Cart (0)');
	const heroHeading = await textView('Hero Heading', h1Kit, 'Fewer things. Made better.');
	const heroSubtitle = await textView(
		'Hero Subtitle',
		bodyKit,
		'Considered essentials in long-staple cotton and Japanese denim, cut to last and priced to match the work that goes into them.'
	);
	const heroCtaLabel = await textView('Hero CTA Label', ctaLabelKit, 'Shop the Edit');

	const shippingFree = await textView('Shipping: Free', shippingLabelKit, 'Free Shipping over $150');
	const shippingReturns = await textView(
		'Shipping: Returns',
		shippingLabelKit,
		'30-Day Returns, No Questions'
	);
	const shippingCarbon = await textView(
		'Shipping: Carbon',
		shippingLabelKit,
		'Carbon-Neutral Delivery'
	);

	const bandText = await textView(
		'Band Text',
		bandTextKit,
		'We work with four mills, all audited for labor and environmental standards, and produce in small batches so nothing sits in a warehouse waiting to go on sale. If a style does not sell, we do not remake it. That is the whole model.'
	);

	const oxfordName = await textView('Oxford Name', productNameKit, 'The Oxford Shirt');
	const oxfordOld = await textView('Oxford Old Price', priceOldKit, '$128');
	const oxfordNew = await textView('Oxford New Price', priceNewKit, '$98');

	const teeName = await textView('Tee Name', productNameKit, 'The Everyday Tee');
	const teeOld = await textView('Tee Old Price', priceOldKit, '$58');
	const teeNew = await textView('Tee New Price', priceNewKit, '$48');

	const trouserName = await textView('Trouser Name', productNameKit, 'The Straight Trouser');
	const trouserOld = await textView('Trouser Old Price', priceOldKit, '$168');
	const trouserNew = await textView('Trouser New Price', priceNewKit, '$138');

	const denimName = await textView('Denim Name', productNameKit, 'The Selvedge Denim');
	const denimOld = await textView('Denim Old Price', priceOldKit, '$198');
	const denimNew = await textView('Denim New Price', priceNewKit, '$168');

	const materialCotton = await textView(
		'Material: Cotton',
		materialChipKit,
		'100% Long-Staple Cotton'
	);
	const materialDyed = await textView('Material: Dyed', materialChipKit, 'Garment-Dyed');
	const materialOrigin = await textView('Material: Origin', materialChipKit, 'Made in Portugal');
	const materialBatch = await textView(
		'Material: Batch',
		materialChipKit,
		'Small-Batch, No Overproduction'
	);

	const footerText = await textView('Footer Text', footerTextKit, '\u00a9 2026 Meridian.');
	const footerLinkShipping = await textView('Footer Link: Shipping', navLinkKit, 'Shipping');
	const footerLinkReturns = await textView('Footer Link: Returns', navLinkKit, 'Returns');
	const footerLinkSize = await textView('Footer Link: Size Guide', navLinkKit, 'Size Guide');

	// --- Composed sections ---
	const navLinks = await boxView('Nav Links', navLinksKit, [
		navLinkShirts,
		navLinkPants,
		navLinkAbout,
		navLinkCart
	]);
	const nav = await boxView('Nav Bar', navKit, [wordmark, navLinks]);

	const heroCta = await boxView('Hero CTA', ctaKit, [heroCtaLabel]);
	const hero = await boxView('Hero Section', heroKit, [heroHeading, heroSubtitle, heroCta]);

	const lookbookImg = await imageView('Lookbook Image', srcImageKit, lookbookAssetId ?? undefined);
	const lookbookCell = await boxView('Lookbook Cell', lookbookCellKit, [lookbookImg]);

	const shippingBoxFree = await boxView('Shipping Box: Free', shippingBoxKit, [shippingFree]);
	const shippingBoxReturns = await boxView('Shipping Box: Returns', shippingBoxKit, [
		shippingReturns
	]);
	const shippingBoxCarbon = await boxView('Shipping Box: Carbon', shippingBoxKit, [shippingCarbon]);
	const shippingRow = await boxView('Shipping Row', shippingRowKit, [
		shippingBoxFree,
		shippingBoxReturns,
		shippingBoxCarbon
	]);

	const band = await boxView('Our Approach Band', bandKit, [bandText]);

	const oxfordPrices = await boxView('Oxford Prices', priceRowKit, [oxfordOld, oxfordNew]);
	const oxfordPhoto = await imageView(
		'Oxford Photo',
		productPhotoKit,
		oxfordPhotoAssetId ?? undefined
	);
	const oxfordTile = await boxView('Product: Oxford Shirt', productTileKit, [
		oxfordPhoto,
		oxfordName,
		oxfordPrices
	]);
	await api.setAxisArg(oxfordTile, productTileKit.id, categoryAxis.id, {
		type: 'literal',
		value: 'shirts'
	});
	await api.setAxisArg(oxfordTile, productTileKit.id, slotAxis.id, {
		type: 'literal',
		value: 'oxford'
	});

	const teePrices = await boxView('Tee Prices', priceRowKit, [teeOld, teeNew]);
	const teePhoto = await imageView('Tee Photo', productPhotoKit, teePhotoAssetId ?? undefined);
	const teeTile = await boxView('Product: Everyday Tee', productTileKit, [
		teePhoto,
		teeName,
		teePrices
	]);
	await api.setAxisArg(teeTile, productTileKit.id, categoryAxis.id, {
		type: 'literal',
		value: 'shirts'
	});
	await api.setAxisArg(teeTile, productTileKit.id, slotAxis.id, { type: 'literal', value: 'tee' });

	const trouserPrices = await boxView('Trouser Prices', priceRowKit, [trouserOld, trouserNew]);
	const trouserPhoto = await imageView(
		'Trouser Photo',
		productPhotoKit,
		trouserPhotoAssetId ?? undefined
	);
	const trouserTile = await boxView('Product: Straight Trouser', productTileKit, [
		trouserPhoto,
		trouserName,
		trouserPrices
	]);
	await api.setAxisArg(trouserTile, productTileKit.id, categoryAxis.id, {
		type: 'literal',
		value: 'pants'
	});
	await api.setAxisArg(trouserTile, productTileKit.id, slotAxis.id, {
		type: 'literal',
		value: 'trouser'
	});

	const denimPrices = await boxView('Denim Prices', priceRowKit, [denimOld, denimNew]);
	const denimPhoto = await imageView('Denim Photo', productPhotoKit, denimPhotoAssetId ?? undefined);
	const denimTile = await boxView('Product: Selvedge Denim', productTileKit, [
		denimPhoto,
		denimName,
		denimPrices
	]);
	await api.setAxisArg(denimTile, productTileKit.id, categoryAxis.id, {
		type: 'literal',
		value: 'pants'
	});
	await api.setAxisArg(denimTile, productTileKit.id, slotAxis.id, {
		type: 'literal',
		value: 'denim'
	});

	const productGrid = await boxView('Product Grid', productGridKit, [
		lookbookCell,
		oxfordTile,
		teeTile,
		trouserTile,
		denimTile
	]);

	const materials = await boxView('Materials Band', materialsKit, [
		materialCotton,
		materialDyed,
		materialOrigin,
		materialBatch
	]);

	const footerLinks = await boxView('Footer Links', footerLinksKit, [
		footerLinkShipping,
		footerLinkReturns,
		footerLinkSize
	]);
	const footer = await boxView('Footer', footerKit, [footerText, footerLinks]);

	await boxView('Landing Page', pageKit, [
		nav,
		hero,
		shippingRow,
		band,
		productGrid,
		materials,
		footer
	]);

	console.log('Demo project seeded: Meridian');
}
