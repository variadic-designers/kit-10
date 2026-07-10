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
	// No utility-plugin linking -- Fontavious and Tenner are install-level (see
	// PluginActivation in schema.ts), loaded globally rather than per-project.

	// Project-scoped tokens
	const tokenBg = (await api.createToken(proj.id, 'colors.bg', s('#ffffff')))!;
	const tokenText = (await api.createToken(proj.id, 'colors.text', s('#1a1a1a')))!;
	const tokenPrimary = (await api.createToken(proj.id, 'colors.primary', s('#3b82f6')))!;
	const tokenSecondary = (await api.createToken(proj.id, 'colors.secondary', s('#64748b')))!;
	const tokenTertiary = (await api.createToken(proj.id, 'colors.tertiary', s('#e2e8f0')))!;
	const tokenSuccess = (await api.createToken(proj.id, 'colors.positive', s('#22c55e')))!;
	const tokenDanger = (await api.createToken(proj.id, 'colors.danger', s('#ef4444')))!;
	// Distinct from colors.bg — this is text-on-a-colored-surface, not the neutral page
	// background. They happen to share a value today, but changing colors.bg (a warmer
	// off-white, say) shouldn't also silently retint every button's label.
	const tokenOnColor = (await api.createToken(proj.id, 'colors.onColor', s('#ffffff')))!;

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
	await api.createRenderEntry(btnDarkSnip.id, 'background', '#1a1a2e');
	await api.createRenderEntry(btnDarkSnip.id, 'color', '#e0e0e0');

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
	// 'transparent' is not a color parse_color understands (only hex/rgb) — it falls through
	// to opaque black. Use an explicit 8-digit hex with a zero alpha channel instead.
	const btnGhost = (await api.createLayer(buttonKit.id))!;
	await api.addAxisValueToLayer(btnGhost.id, emphasisGhost.id);
	const btnGhostSnip = (await api.createRenderSnippet(btnGhost.id))!;
	await api.createRenderEntry(btnGhostSnip.id, 'background', '#00000000');
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
	await api.createRenderEntry(btnHoverSnip.id, 'background', '#e2e8f0');

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
	await api.createRenderEntry(btnPrimaryHoverSnip.id, 'background', '#2563eb');

	// {emphasis: primary, state: click}
	const btnPrimaryClick = (await api.createLayer(buttonKit.id))!;
	await api.addAxisValueToLayer(btnPrimaryClick.id, emphasisPrimary.id);
	await api.addAxisValueToLayer(btnPrimaryClick.id, stateClick.id);
	const btnPrimaryClickSnip = (await api.createRenderSnippet(btnPrimaryClick.id))!;
	await api.createRenderEntry(btnPrimaryClickSnip.id, 'background', '#1d4ed8');

	// {emphasis: primary, state: disabled}
	const btnPrimaryDisabled = (await api.createLayer(buttonKit.id))!;
	await api.addAxisValueToLayer(btnPrimaryDisabled.id, emphasisPrimary.id);
	await api.addAxisValueToLayer(btnPrimaryDisabled.id, stateDisabled.id);
	const btnPrimaryDisabledSnip = (await api.createRenderSnippet(btnPrimaryDisabled.id))!;
	await api.createRenderEntry(btnPrimaryDisabledSnip.id, 'background', '#93c5fd');
	await api.createRenderEntry(btnPrimaryDisabledSnip.id, 'opacity', '0.4');

	// {sentiment: positive, state: hover}
	const btnPositiveHover = (await api.createLayer(buttonKit.id))!;
	await api.addAxisValueToLayer(btnPositiveHover.id, sentimentPositive.id);
	await api.addAxisValueToLayer(btnPositiveHover.id, stateHover.id);
	const btnPositiveHoverSnip = (await api.createRenderSnippet(btnPositiveHover.id))!;
	await api.createRenderEntry(btnPositiveHoverSnip.id, 'background', '#16a34a');

	// {sentiment: positive, state: click}
	const btnPositiveClick = (await api.createLayer(buttonKit.id))!;
	await api.addAxisValueToLayer(btnPositiveClick.id, sentimentPositive.id);
	await api.addAxisValueToLayer(btnPositiveClick.id, stateClick.id);
	const btnPositiveClickSnip = (await api.createRenderSnippet(btnPositiveClick.id))!;
	await api.createRenderEntry(btnPositiveClickSnip.id, 'background', '#15803d');

	// {sentiment: positive, state: disabled}
	const btnPositiveDisabled = (await api.createLayer(buttonKit.id))!;
	await api.addAxisValueToLayer(btnPositiveDisabled.id, sentimentPositive.id);
	await api.addAxisValueToLayer(btnPositiveDisabled.id, stateDisabled.id);
	const btnPositiveDisabledSnip = (await api.createRenderSnippet(btnPositiveDisabled.id))!;
	await api.createRenderEntry(btnPositiveDisabledSnip.id, 'background', '#86efac');
	await api.createRenderEntry(btnPositiveDisabledSnip.id, 'opacity', '0.4');

	// {sentiment: danger, state: hover}
	const btnDangerHover = (await api.createLayer(buttonKit.id))!;
	await api.addAxisValueToLayer(btnDangerHover.id, sentimentDanger.id);
	await api.addAxisValueToLayer(btnDangerHover.id, stateHover.id);
	const btnDangerHoverSnip = (await api.createRenderSnippet(btnDangerHover.id))!;
	await api.createRenderEntry(btnDangerHoverSnip.id, 'background', '#dc2626');

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
	await api.createRenderEntry(btnDangerClickSnip.id, 'background', '#b91c1c');

	// {sentiment: danger, state: disabled} — mirrors btnPrimaryDisabled's pale/washed-out
	// treatment, same reasoning as click: without it, a disabled danger button falls back to
	// whatever 2-condition emphasis/theme combo happens to be active instead of reading as
	// disabled.
	const btnDangerDisabled = (await api.createLayer(buttonKit.id))!;
	await api.addAxisValueToLayer(btnDangerDisabled.id, sentimentDanger.id);
	await api.addAxisValueToLayer(btnDangerDisabled.id, stateDisabled.id);
	const btnDangerDisabledSnip = (await api.createRenderSnippet(btnDangerDisabled.id))!;
	await api.createRenderEntry(btnDangerDisabledSnip.id, 'background', '#fca5a5');
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

	// Label views. Forced to the text primitive explicitly (cheap insurance -- they'd
	// auto-detect as text anyway, given only paint properties). Whether a view renders as its
	// own top-level frame or only as someone's child is derived by Charter from the composition
	// graph, not declared here: a label referenced by some button's children nests under it; the
	// rest stay top-level until something composes them (`labelDefaultView` becomes buttonKit's
	// clone-per-view template master below; `labelPrimaryView`/`labelSecondaryView` stay unclaimed
	// library content).
	const textPrimitiveHint = { charter: { primitive: 'text' } };

	const labelDefaultView = (await api.createViewInProject(proj.id, 'Label: Default', textPrimitiveHint))!;
	await api.attachKitToComposition(labelKit.id, labelDefaultView.id);

	const labelPrimaryView = (await api.createViewInProject(proj.id, 'Label: Primary', textPrimitiveHint))!;
	await api.attachKitToComposition(labelKit.id, labelPrimaryView.id);
	await api.setAxisArg(labelPrimaryView.id, labelKit.id, emphasisAxis.id, { type: 'literal', value: 'primary' });

	const labelSecondaryView = (await api.createViewInProject(proj.id, 'Label: Secondary', textPrimitiveHint))!;
	await api.attachKitToComposition(labelKit.id, labelSecondaryView.id);
	await api.setAxisArg(labelSecondaryView.id, labelKit.id, emphasisAxis.id, { type: 'literal', value: 'secondary' });

	const labelTertiaryView = (await api.createViewInProject(proj.id, 'Label: Tertiary', textPrimitiveHint))!;
	await api.attachKitToComposition(labelKit.id, labelTertiaryView.id);
	await api.setAxisArg(labelTertiaryView.id, labelKit.id, emphasisAxis.id, { type: 'literal', value: 'tertiary' });

	const labelGhostView = (await api.createViewInProject(proj.id, 'Label: Ghost', textPrimitiveHint))!;
	await api.attachKitToComposition(labelKit.id, labelGhostView.id);
	await api.setAxisArg(labelGhostView.id, labelKit.id, emphasisAxis.id, { type: 'literal', value: 'ghost' });

	const labelPositiveView = (await api.createViewInProject(proj.id, 'Label: Positive', textPrimitiveHint))!;
	await api.attachKitToComposition(labelKit.id, labelPositiveView.id);
	await api.setAxisArg(labelPositiveView.id, labelKit.id, sentimentAxis.id, { type: 'literal', value: 'positive' });

	const labelDangerView = (await api.createViewInProject(proj.id, 'Label: Danger', textPrimitiveHint))!;
	await api.attachKitToComposition(labelKit.id, labelDangerView.id);
	await api.setAxisArg(labelDangerView.id, labelKit.id, sentimentAxis.id, { type: 'literal', value: 'danger' });

	const labelDisabledView = (await api.createViewInProject(proj.id, 'Label: Disabled', textPrimitiveHint))!;
	await api.attachKitToComposition(labelKit.id, labelDisabledView.id);
	await api.setAxisArg(labelDisabledView.id, labelKit.id, stateAxis.id, { type: 'literal', value: 'disabled' });

	// Three more emphasis=primary label views, one dedicated to each of the three primary-emphasis
	// button variants below -- NOT a shared reference to labelPrimaryView, even though all four
	// resolve identical "Submit" content via the same lblPrimary layer. Reusing labelPrimaryView
	// as more than one button's child would violate the one-reference rule (see the self-declaring
	// children comment below); labelPrimaryView itself stays unclaimed library content.
	const labelLightDefaultView = (await api.createViewInProject(proj.id, 'Label: Light Default', textPrimitiveHint))!;
	await api.attachKitToComposition(labelKit.id, labelLightDefaultView.id);
	await api.setAxisArg(labelLightDefaultView.id, labelKit.id, emphasisAxis.id, { type: 'literal', value: 'primary' });

	const labelDarkDefaultView = (await api.createViewInProject(proj.id, 'Label: Dark Default', textPrimitiveHint))!;
	await api.attachKitToComposition(labelKit.id, labelDarkDefaultView.id);
	await api.setAxisArg(labelDarkDefaultView.id, labelKit.id, emphasisAxis.id, { type: 'literal', value: 'primary' });

	const labelPrimaryHoverView = (await api.createViewInProject(proj.id, 'Label: Light Comfort Primary Hover', textPrimitiveHint))!;
	await api.attachKitToComposition(labelKit.id, labelPrimaryHoverView.id);
	await api.setAxisArg(labelPrimaryHoverView.id, labelKit.id, emphasisAxis.id, { type: 'literal', value: 'primary' });

	// buttonKit declares NO `children` render entry -- deliberately. A view's children are
	// self-declaring: each button view below carries its own View-scoped `children` view-list token
	// that materializes that view's children directly (see resolve.ts), so there's no shared
	// kit/null-layer children anchor to force a children slot onto every view composing buttonKit.
	// Every button view gets a freshly-created, dedicated label view (never a shared reference --
	// a view is referenced as a child at most once, ever; see CLAUDE.md).

	// buttonKit's DEFAULT children (a clone-per-view template): a Kit-scope `children` view-list
	// token naming the template subtree (here the unclaimed `Label: Default`). It has NO render
	// entry, so it never resolves into a shared child on its own -- it's read directly by
	// `api.instantiateKitDefaults` when a view composes buttonKit, which deep-clones the template
	// into that view's OWN per-instance children. So composing buttonKit onto a fresh view auto-
	// populates a unique cloned label, while `Label: Default` stays the editable top-level master.
	await api.createToken(proj.id, 'children', { type: 'view-list', view_ids: [labelDefaultView.id] }, {
		kitId: buttonKit.id
	});

	// --- Views ---

	// View: Light Default
	const lightDefaultView = (await api.createViewInProject(proj.id, 'Light Default', {
		charter: { primitive: 'box' },
		vellum: { position: [0, 0] }
	}))!;
	await api.attachKitToComposition(buttonKit.id, lightDefaultView.id);
	await api.setAxisArg(lightDefaultView.id, buttonKit.id, themeAxis.id, {
		type: 'literal',
		value: 'light'
	});
	await api.setAxisArg(lightDefaultView.id, buttonKit.id, densityAxis.id, {
		type: 'literal',
		value: 'compact'
	});
	await api.setAxisArg(lightDefaultView.id, buttonKit.id, emphasisAxis.id, {
		type: 'literal',
		value: 'primary'
	});
	await api.setAxisArg(lightDefaultView.id, buttonKit.id, sentimentAxis.id, {
		type: 'literal',
		value: 'neutral'
	});
	await api.setAxisArg(lightDefaultView.id, buttonKit.id, stateAxis.id, {
		type: 'literal',
		value: 'default'
	});
	await api.createToken(
		proj.id,
		'children',
		{ type: 'view-list', view_ids: [labelLightDefaultView.id] },
		{ viewId: lightDefaultView.id }
	);

	// View: Dark Default
	const darkDefaultView = (await api.createViewInProject(proj.id, 'Dark Default', {
		charter: { primitive: 'box' },
		vellum: { position: [500, 0] }
	}))!;
	await api.attachKitToComposition(buttonKit.id, darkDefaultView.id);
	await api.setAxisArg(darkDefaultView.id, buttonKit.id, themeAxis.id, {
		type: 'literal',
		value: 'dark'
	});
	await api.setAxisArg(darkDefaultView.id, buttonKit.id, densityAxis.id, {
		type: 'literal',
		value: 'compact'
	});
	await api.setAxisArg(darkDefaultView.id, buttonKit.id, emphasisAxis.id, {
		type: 'literal',
		value: 'primary'
	});
	await api.setAxisArg(darkDefaultView.id, buttonKit.id, sentimentAxis.id, {
		type: 'literal',
		value: 'neutral'
	});
	await api.setAxisArg(darkDefaultView.id, buttonKit.id, stateAxis.id, {
		type: 'literal',
		value: 'default'
	});
	await api.createToken(
		proj.id,
		'children',
		{ type: 'view-list', view_ids: [labelDarkDefaultView.id] },
		{ viewId: darkDefaultView.id }
	);

	// View: Light Comfort Primary Hover
	const lightDensePrimaryHoverView = (await api.createViewInProject(
		proj.id,
		'Light Comfort Primary Hover',
		{
			charter: { primitive: 'box' },
			vellum: { position: [1000, 0] }
		}
	))!;
	await api.attachKitToComposition(buttonKit.id, lightDensePrimaryHoverView.id);
	await api.setAxisArg(lightDensePrimaryHoverView.id, buttonKit.id, themeAxis.id, {
		type: 'literal',
		value: 'light'
	});
	await api.setAxisArg(lightDensePrimaryHoverView.id, buttonKit.id, densityAxis.id, {
		type: 'literal',
		value: 'comfort'
	});
	await api.setAxisArg(lightDensePrimaryHoverView.id, buttonKit.id, emphasisAxis.id, {
		type: 'literal',
		value: 'primary'
	});
	await api.setAxisArg(lightDensePrimaryHoverView.id, buttonKit.id, sentimentAxis.id, {
		type: 'literal',
		value: 'neutral'
	});
	await api.setAxisArg(lightDensePrimaryHoverView.id, buttonKit.id, stateAxis.id, {
		type: 'literal',
		value: 'hover'
	});
	await api.createToken(
		proj.id,
		'children',
		{ type: 'view-list', view_ids: [labelPrimaryHoverView.id] },
		{ viewId: lightDensePrimaryHoverView.id }
	);

	// View: Dark Comfort Danger Click
	const darkDenseDangerClickView = (await api.createViewInProject(
		proj.id,
		'Dark Comfort Danger Click',
		{
			charter: { primitive: 'box' },
			vellum: { position: [0, 400] }
		}
	))!;
	await api.attachKitToComposition(buttonKit.id, darkDenseDangerClickView.id);
	await api.setAxisArg(darkDenseDangerClickView.id, buttonKit.id, themeAxis.id, {
		type: 'literal',
		value: 'dark'
	});
	await api.setAxisArg(darkDenseDangerClickView.id, buttonKit.id, densityAxis.id, {
		type: 'literal',
		value: 'comfort'
	});
	await api.setAxisArg(darkDenseDangerClickView.id, buttonKit.id, emphasisAxis.id, {
		type: 'literal',
		value: 'primary'
	});
	await api.setAxisArg(darkDenseDangerClickView.id, buttonKit.id, sentimentAxis.id, {
		type: 'literal',
		value: 'danger'
	});
	await api.setAxisArg(darkDenseDangerClickView.id, buttonKit.id, stateAxis.id, {
		type: 'literal',
		value: 'click'
	});
	// Its own dedicated view-scoped children token -- labelDangerView isn't referenced by
	// any other view.
	await api.createToken(
		proj.id,
		'children',
		{ type: 'view-list', view_ids: [labelDangerView.id] },
		{ viewId: darkDenseDangerClickView.id }
	);

	// View: Light Compact Ghost Disabled
	const lightCompactGhostDisabledView = (await api.createViewInProject(
		proj.id,
		'Light Compact Ghost Disabled',
		{
			charter: { primitive: 'box' },
			vellum: { position: [500, 400] }
		}
	))!;
	await api.attachKitToComposition(buttonKit.id, lightCompactGhostDisabledView.id);
	await api.setAxisArg(lightCompactGhostDisabledView.id, buttonKit.id, themeAxis.id, {
		type: 'literal',
		value: 'light'
	});
	await api.setAxisArg(lightCompactGhostDisabledView.id, buttonKit.id, densityAxis.id, {
		type: 'literal',
		value: 'compact'
	});
	await api.setAxisArg(lightCompactGhostDisabledView.id, buttonKit.id, emphasisAxis.id, {
		type: 'literal',
		value: 'ghost'
	});
	await api.setAxisArg(lightCompactGhostDisabledView.id, buttonKit.id, sentimentAxis.id, {
		type: 'literal',
		value: 'neutral'
	});
	await api.setAxisArg(lightCompactGhostDisabledView.id, buttonKit.id, stateAxis.id, {
		type: 'literal',
		value: 'disabled'
	});
	// Its own dedicated view-scoped children token.
	await api.createToken(
		proj.id,
		'children',
		{ type: 'view-list', view_ids: [labelDisabledView.id] },
		{ viewId: lightCompactGhostDisabledView.id }
	);

	// View: Dark Compact Secondary Positive Default
	const darkCompactSecondaryPositiveView = (await api.createViewInProject(
		proj.id,
		'Dark Compact Positive',
		{
			charter: { primitive: 'box' },
			vellum: { position: [1000, 400] }
		}
	))!;
	await api.attachKitToComposition(buttonKit.id, darkCompactSecondaryPositiveView.id);
	await api.setAxisArg(darkCompactSecondaryPositiveView.id, buttonKit.id, themeAxis.id, {
		type: 'literal',
		value: 'dark'
	});
	await api.setAxisArg(darkCompactSecondaryPositiveView.id, buttonKit.id, densityAxis.id, {
		type: 'literal',
		value: 'compact'
	});
	await api.setAxisArg(darkCompactSecondaryPositiveView.id, buttonKit.id, emphasisAxis.id, {
		type: 'literal',
		value: 'secondary'
	});
	await api.setAxisArg(darkCompactSecondaryPositiveView.id, buttonKit.id, sentimentAxis.id, {
		type: 'literal',
		value: 'positive'
	});
	await api.setAxisArg(darkCompactSecondaryPositiveView.id, buttonKit.id, stateAxis.id, {
		type: 'literal',
		value: 'default'
	});
	// Its own dedicated view-scoped children token.
	await api.createToken(
		proj.id,
		'children',
		{ type: 'view-list', view_ids: [labelPositiveView.id] },
		{ viewId: darkCompactSecondaryPositiveView.id }
	);

	// View: Light Comfort Tertiary Neutral Click
	const lightDenseTertiaryClickView = (await api.createViewInProject(
		proj.id,
		'Light Comfort Tertiary Click',
		{
			charter: { primitive: 'box' },
			vellum: { position: [1500, 400] }
		}
	))!;
	await api.attachKitToComposition(buttonKit.id, lightDenseTertiaryClickView.id);
	await api.setAxisArg(lightDenseTertiaryClickView.id, buttonKit.id, themeAxis.id, {
		type: 'literal',
		value: 'light'
	});
	await api.setAxisArg(lightDenseTertiaryClickView.id, buttonKit.id, densityAxis.id, {
		type: 'literal',
		value: 'comfort'
	});
	await api.setAxisArg(lightDenseTertiaryClickView.id, buttonKit.id, emphasisAxis.id, {
		type: 'literal',
		value: 'tertiary'
	});
	await api.setAxisArg(lightDenseTertiaryClickView.id, buttonKit.id, sentimentAxis.id, {
		type: 'literal',
		value: 'neutral'
	});
	await api.setAxisArg(lightDenseTertiaryClickView.id, buttonKit.id, stateAxis.id, {
		type: 'literal',
		value: 'click'
	});
	// Its own dedicated view-scoped children token.
	await api.createToken(
		proj.id,
		'children',
		{ type: 'view-list', view_ids: [labelTertiaryView.id] },
		{ viewId: lightDenseTertiaryClickView.id }
	);

	// View: Button (cloned default) -- demonstrates clone-per-view end-to-end. Unlike every button
	// above (which hand-wires its own dedicated label token), this one is composed from buttonKit
	// alone and then `instantiateKitDefaults` deep-clones buttonKit's default child (`Label:
	// Default`) into a UNIQUE per-instance label -- exactly the path the editor's Compose panel
	// runs. `Label: Default` itself stays the top-level editable master; this view nests its own
	// distinct clone.
	const clonedDefaultButtonView = (await api.createViewInProject(proj.id, 'Button (cloned default)', {
		charter: { primitive: 'box' },
		vellum: { position: [2000, 400] }
	}))!;
	await api.attachKitToComposition(buttonKit.id, clonedDefaultButtonView.id);
	await api.setAxisArg(clonedDefaultButtonView.id, buttonKit.id, themeAxis.id, {
		type: 'literal',
		value: 'light'
	});
	await api.setAxisArg(clonedDefaultButtonView.id, buttonKit.id, densityAxis.id, {
		type: 'literal',
		value: 'compact'
	});
	await api.instantiateKitDefaults(clonedDefaultButtonView.id);

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
		const v = (await api.createViewInProject(proj.id, name, { charter: { primitive: 'text' } }))!;
		await api.attachKitToComposition(kit.id, v.id);
		await api.createToken(proj.id, 'content', s(content), { viewId: v.id });
		return v.id;
	}

	async function boxView(
		name: string,
		kit: { id: string },
		childIds: string[],
		hints: Record<string, unknown> = { charter: { primitive: 'box' } }
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

	// --- Style kits ---
	const h1Kit = await textKit('Heading', { 'font-size': '40px', 'font-weight': '700', color: '#0f172a' });
	const h2Kit = await textKit('Subheading', { 'font-size': '19px', 'font-weight': '700', color: '#0f172a' });
	const bodyKit = await textKit('Body', { 'font-size': '15px', 'font-weight': '400', color: '#64748b' });
	const ctaLabelKit = await textKit('CTA Label', { 'font-size': '15px', 'font-weight': '600', color: '#ffffff' });
	const footerTextKit = await textKit('Footer Text', { 'font-size': '13px', 'font-weight': '400', color: '#cbd5e1' });

	// --- Layout kits ---
	const pageKit = await boxKit('Page', { 'flex-direction': 'column', background: '#ffffff', width: '900px', gap: '0px', padding: '0px' });
	const navKit = await boxKit('Nav', { 'flex-direction': 'row', 'justify-content': 'space-between', 'align-items': 'center', padding: '20px', gap: '16px', background: '#ffffff' });
	const heroKit = await boxKit('Hero', { 'flex-direction': 'column', 'align-items': 'center', gap: '18px', padding: '64px', background: '#f8fafc' });
	const featuresKit = await boxKit('Features', { 'flex-direction': 'row', 'justify-content': 'center', gap: '24px', padding: '48px', background: '#ffffff' });
	const cardKit = await boxKit('Card', { 'flex-direction': 'column', gap: '8px', padding: '24px', background: '#ffffff', border: '#e2e8f0', 'border-radius': '12px', width: '230px' });
	const footerKit = await boxKit('Footer', { 'flex-direction': 'row', 'justify-content': 'center', padding: '28px', background: '#0f172a' });
	const ctaKit = await boxKit('CTA', { 'flex-direction': 'row', 'align-items': 'center', 'justify-content': 'center', padding: '13px', background: '#3b82f6', 'border-radius': '8px' });

	// --- Leaf text views ---
	const logo = await textView('Logo', h2Kit, 'KIT\u202210');
	const navCtaLabel = await textView('Nav CTA Label', ctaLabelKit, 'Sign in');
	const heroHeading = await textView('Hero Heading', h1Kit, 'Design the system, not the screenshots');
	const heroSubtitle = await textView('Hero Subtitle', bodyKit, 'Model UI as axes, kits, and views \u2014 and resolve every variant at once.');
	const heroCtaLabel = await textView('Hero CTA Label', ctaLabelKit, 'Get started');
	const c1t = await textView('Card 1 Title', h2Kit, 'Axes');
	const c1b = await textView('Card 1 Body', bodyKit, 'Define the dimensions your UI varies across \u2014 theme, density, state.');
	const c2t = await textView('Card 2 Title', h2Kit, 'Kits');
	const c2b = await textView('Card 2 Body', bodyKit, 'Bundle opinionated rules per concern, then compose them into any view.');
	const c3t = await textView('Card 3 Title', h2Kit, 'Views');
	const c3b = await textView('Card 3 Body', bodyKit, 'Nest views into views. Kits ship defaults; each instance clones its own.');
	const footerText = await textView('Footer Text', footerTextKit, '\u00a9 2026 KIT\u202210 \u2014 composable design, resolved.');

	// --- CTAs (box + label) ---
	const navCta = await boxView('Nav CTA', ctaKit, [navCtaLabel]);
	const heroCta = await boxView('Hero CTA', ctaKit, [heroCtaLabel]);

	// --- Cards ---
	const card1 = await boxView('Card: Axes', cardKit, [c1t, c1b]);
	const card2 = await boxView('Card: Kits', cardKit, [c2t, c2b]);
	const card3 = await boxView('Card: Views', cardKit, [c3t, c3b]);

	// --- Sections ---
	const nav = await boxView('Nav Bar', navKit, [logo, navCta]);
	const hero = await boxView('Hero Section', heroKit, [heroHeading, heroSubtitle, heroCta]);
	const features = await boxView('Features', featuresKit, [card1, card2, card3]);
	const footer = await boxView('Footer', footerKit, [footerText]);

	// --- Page root (positioned off to the left of the component gallery) ---
	await boxView('Landing Page', pageKit, [nav, hero, features, footer], {
		charter: { primitive: 'box' },
		vellum: { position: [-1100, 0] }
	});

	console.log('Demo project seeded: KIT\u202210 Demo');
}
