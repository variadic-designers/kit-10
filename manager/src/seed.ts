import type { SchemaDialect } from './schema.js';
import { queryBuilder, type Api } from './api/index.js';
import type { TokenValue } from './schema.js';
import type { BuiltinPlugins } from './plugins-bootstrap.js';

const s = (value: string): TokenValue => ({ type: 'scalar', value });

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
	// Distinct from colors.bg — this is text-on-a-colored-surface, not the neutral page
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
	// {theme:dark, role} variant — a saturated brand color reads fine on any page background,
	// and re-tinting every solid button for dark mode is the kind of combinatorial expansion
	// that looks thorough but isn't actually a design decision anyone made on purpose. Theme's
	// job is the neutral/default look only (btnDark, above) — once a role sets its own
	// background, theme steps out of the way entirely.
	//
	// Only the three semantic/hero roles — primary (emphasis), positive and danger (sentiment)
	// — get a full base→hover→click→disabled ramp. Secondary/tertiary/ghost deliberately share
	// the universal 1-condition state layers (btnHover/btnClick/btnDisabled) instead of each
	// getting bespoke interaction colors — not every variant needs its own hover art, and a
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

	// {sentiment: danger, state: click} — without this, any view combining
	// sentiment:danger with emphasis:primary (or any other 2-condition emphasis/theme combo)
	// at state:click renders danger invisibly: btnDanger alone is only 1 condition, so it loses
	// to btnPrimaryClick {emphasis, state} on raw condition count, regardless of sentiment's
	// higher axis priority. Same axis pair shape as btnPrimaryClick (sentiment+state vs
	// emphasis+state) means the tie is broken by priority instead — sentiment (4000) beats
	// emphasis (3000), so danger correctly wins here.
	const btnDangerClick = (await api.createLayer(buttonKit.id))!;
	await api.addAxisValueToLayer(btnDangerClick.id, sentimentDanger.id);
	await api.addAxisValueToLayer(btnDangerClick.id, stateClick.id);
	const btnDangerClickSnip = (await api.createRenderSnippet(btnDangerClick.id))!;
	await api.createRenderEntry(btnDangerClickSnip.id, 'background', 'oklch(50.5% 0.1905 27.5)');

	// {sentiment: danger, state: disabled} — mirrors btnPrimaryDisabled's pale/washed-out
	// treatment, same reasoning as click: without it, a disabled danger button falls back to
	// whatever 2-condition emphasis/theme combo happens to be active instead of reading as
	// disabled.
	const btnDangerDisabled = (await api.createLayer(buttonKit.id))!;
	await api.addAxisValueToLayer(btnDangerDisabled.id, sentimentDanger.id);
	await api.addAxisValueToLayer(btnDangerDisabled.id, stateDisabled.id);
	const btnDangerDisabledSnip = (await api.createRenderSnippet(btnDangerDisabled.id))!;
	await api.createRenderEntry(btnDangerDisabledSnip.id, 'background', 'oklch(80.8% 0.1035 19.6)');
	await api.createRenderEntry(btnDangerDisabledSnip.id, 'opacity', '0.4');

	// Button label kit — text child rendered inside each button box
	const labelKit = (await api.createKitInProject(proj.id, 'ButtonLabel'))!;
	await api.consumeAxis(labelKit.id, themeAxis.id);
	await api.consumeAxis(labelKit.id, emphasisAxis.id);
	await api.consumeAxis(labelKit.id, sentimentAxis.id);
	await api.consumeAxis(labelKit.id, stateAxis.id);
	// auto-assigned priorities (1000/2000/3000/4000) already give the right relative order

	// Null layer — baseline label
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
	// children (view-list) tokens wiring the tree together. Built bottom-up (leaves first) since a
	// parent's children token must reference views that already exist.
	// ==========================================================================================

	// A Box layout kit: all its properties baked on the null layer (unconditional).
	async function boxKit(name: string, props: Record<string, string>) {
		const kit = (await api.createKitInProject(proj.id, name))!;
		const snip = (await api.createRenderSnippet((await api.createLayer(kit.id))!.id))!;
		for (const [k, v] of Object.entries(props)) await api.createRenderEntry(snip.id, k, v);
		return kit;
	}

	// A Text style kit: baked font/paint style + a token-backed `content` entry, so every view
	// composing it supplies its OWN text via a View-scope `content` token (which overrides the kit
	// default by alias). One style kit, many distinct-text views.
	async function textKit(name: string, style: Record<string, string>) {
		const kit = (await api.createKitInProject(proj.id, name))!;
		const snip = (await api.createRenderSnippet((await api.createLayer(kit.id))!.id))!;
		await api.createRenderEntry(snip.id, 'font-family', 'Inter');
		for (const [k, v] of Object.entries(style)) await api.createRenderEntry(snip.id, k, v);
		const contentTok = (await api.createToken(proj.id, 'content', s(''), { kitId: kit.id }))!;
		await api.createRenderEntry(snip.id, 'content', null, contentTok.id);
		return kit;
	}

	async function textView(name: string, kit: { id: string }, content: string): Promise<string> {
		const v = (await api.createViewInProject(proj.id, name, {
			charter: { primitive: 'text' },
			view_icon: 'fa-solid fa-italic'
		}))!;
		await api.attachKitToComposition(kit.id, v.id);
		await api.createToken(proj.id, 'content', s(content), { viewId: v.id });
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
		const v = (await api.createViewInProject(proj.id, name, hints))!;
		await api.attachKitToComposition(kit.id, v.id);
		if (childIds.length)
			await api.createToken(
				proj.id,
				'children',
				{ type: 'view-list', view_ids: childIds },
				{ viewId: v.id }
			);
		return v.id;
	}

	// An Image kit: declares an `src` render entry backed by a kit-scope token, so every view
	// composing it supplies its own image source via a View-scope override. Same pattern as
	// textKit's `content` token. `props` should always set an explicit width/height: an image
	// view with no src override falls back to this kit-scope placeholder (empty string), which
	// measures to a literal 0x0 (ImageSource::None, no intrinsic size) -- so without one the
	// placeholder would occupy zero layout space instead of a visible slot.
	async function imageKit(name: string, props: Record<string, string> = {}) {
		const kit = (await api.createKitInProject(proj.id, name))!;
		const snip = (await api.createRenderSnippet((await api.createLayer(kit.id))!.id))!;
		const srcTok = (await api.createToken(proj.id, 'src', s(''), { kitId: kit.id }))!;
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
		const v = (await api.createViewInProject(proj.id, name, {
			charter: { primitive: 'image' },
			view_icon: 'fa-solid fa-image'
		}))!;
		await api.attachKitToComposition(kit.id, v.id);
		if (src) await api.createToken(proj.id, 'src', s(src), { viewId: v.id });
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
				projectId: proj.id,
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
		background: 'oklch(100% 0 0)'
	});
	const heroKit = await boxKit('Hero', {
		'flex-direction': 'row',
		'align-items': 'center',
		gap: '18px',
		padding: '64px',
		background: 'oklch(98.4% 0.0034 247.9)'
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
		background: 'oklch(100% 0 0)'
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
		background: 'oklch(20.8% 0.0398 265.8)'
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
