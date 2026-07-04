import type { SchemaDialect } from './schema.js';
import { queryBuilder, type Api } from './api/index.js';
import type { TokenValue } from './schema.js';

const s = (value: string): TokenValue => ({ type: 'scalar', value });

export async function seedDemoProject(dialect: SchemaDialect): Promise<void> {
	const api: Api = queryBuilder(dialect);

	const ws = (await api.getAllWorkspaces().execute())[0]!;
	const proj = (await api.createProjectInWorkspace(ws.workspaceId, 'KIT\u202210 Demo'))!;

	// Project-scoped tokens
	const tokenBg = (await api.createToken(proj.id, 'colors.bg', s('#ffffff')))!;
	const tokenText = (await api.createToken(proj.id, 'colors.text', s('#1a1a1a')))!;
	const tokenPrimary = (await api.createToken(proj.id, 'colors.primary', s('#3b82f6')))!;
	const tokenSecondary = (await api.createToken(proj.id, 'colors.secondary', s('#64748b')))!;
	const tokenTertiary = (await api.createToken(proj.id, 'colors.tertiary', s('#e2e8f0')))!;
	const tokenSuccess = (await api.createToken(proj.id, 'colors.positive', s('#22c55e')))!;
	const tokenDanger = (await api.createToken(proj.id, 'colors.danger', s('#ef4444')))!;

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
		value: 'dense'
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
	await api.createRenderEntry(btnPrimarySnip.id, 'color', '#ffffff');
	await api.createRenderEntry(btnPrimarySnip.id, 'font-weight', '600');

	// {emphasis: secondary}
	const btnSecondary = (await api.createLayer(buttonKit.id))!;
	await api.addAxisValueToLayer(btnSecondary.id, emphasisSecondary.id);
	const btnSecondarySnip = (await api.createRenderSnippet(btnSecondary.id))!;
	await api.createRenderEntry(btnSecondarySnip.id, 'background', null, tokenSecondary.id);
	await api.createRenderEntry(btnSecondarySnip.id, 'color', '#ffffff');

	// {emphasis: tertiary}
	const btnTertiary = (await api.createLayer(buttonKit.id))!;
	await api.addAxisValueToLayer(btnTertiary.id, emphasisTertiary.id);
	const btnTertiarySnip = (await api.createRenderSnippet(btnTertiary.id))!;
	await api.createRenderEntry(btnTertiarySnip.id, 'background', null, tokenTertiary.id);
	await api.createRenderEntry(btnTertiarySnip.id, 'color', '#1a1a1a');

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
	await api.createRenderEntry(btnPositiveSnip.id, 'color', '#ffffff');

	// {sentiment: danger}
	const btnDanger = (await api.createLayer(buttonKit.id))!;
	await api.addAxisValueToLayer(btnDanger.id, sentimentDanger.id);
	const btnDangerSnip = (await api.createRenderSnippet(btnDanger.id))!;
	await api.createRenderEntry(btnDangerSnip.id, 'background', null, tokenDanger.id);
	await api.createRenderEntry(btnDangerSnip.id, 'color', '#ffffff');

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

	// {theme: dark, density: compact}
	const btnDarkCompact = (await api.createLayer(buttonKit.id))!;
	await api.addAxisValueToLayer(btnDarkCompact.id, themeDark.id);
	await api.addAxisValueToLayer(btnDarkCompact.id, densityCompact.id);
	const btnDarkCompactSnip = (await api.createRenderSnippet(btnDarkCompact.id))!;
	await api.createRenderEntry(btnDarkCompactSnip.id, 'padding', '8px');

	// {theme: dark, density: dense}
	const btnDarkDense = (await api.createLayer(buttonKit.id))!;
	await api.addAxisValueToLayer(btnDarkDense.id, themeDark.id);
	await api.addAxisValueToLayer(btnDarkDense.id, densityDense.id);
	const btnDarkDenseSnip = (await api.createRenderSnippet(btnDarkDense.id))!;
	await api.createRenderEntry(btnDarkDenseSnip.id, 'padding', '24px');

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

	// {theme: dark, emphasis: primary}
	const btnDarkPrimary = (await api.createLayer(buttonKit.id))!;
	await api.addAxisValueToLayer(btnDarkPrimary.id, themeDark.id);
	await api.addAxisValueToLayer(btnDarkPrimary.id, emphasisPrimary.id);
	const btnDarkPrimarySnip = (await api.createRenderSnippet(btnDarkPrimary.id))!;
	await api.createRenderEntry(btnDarkPrimarySnip.id, 'background', '#3b82f6');
	await api.createRenderEntry(btnDarkPrimarySnip.id, 'color', '#0f172a');

	// {sentiment: positive, state: hover}
	const btnPositiveHover = (await api.createLayer(buttonKit.id))!;
	await api.addAxisValueToLayer(btnPositiveHover.id, sentimentPositive.id);
	await api.addAxisValueToLayer(btnPositiveHover.id, stateHover.id);
	const btnPositiveHoverSnip = (await api.createRenderSnippet(btnPositiveHover.id))!;
	await api.createRenderEntry(btnPositiveHoverSnip.id, 'background', '#16a34a');

	// {sentiment: danger, state: hover}
	const btnDangerHover = (await api.createLayer(buttonKit.id))!;
	await api.addAxisValueToLayer(btnDangerHover.id, sentimentDanger.id);
	await api.addAxisValueToLayer(btnDangerHover.id, stateHover.id);
	const btnDangerHoverSnip = (await api.createRenderSnippet(btnDangerHover.id))!;
	await api.createRenderEntry(btnDangerHoverSnip.id, 'background', '#dc2626');

	// 3-condition layers

	// {theme: dark, emphasis: primary, state: hover}
	const btnDarkPrimaryHover = (await api.createLayer(buttonKit.id))!;
	await api.addAxisValueToLayer(btnDarkPrimaryHover.id, themeDark.id);
	await api.addAxisValueToLayer(btnDarkPrimaryHover.id, emphasisPrimary.id);
	await api.addAxisValueToLayer(btnDarkPrimaryHover.id, stateHover.id);
	const btnDarkPrimaryHoverSnip = (await api.createRenderSnippet(btnDarkPrimaryHover.id))!;
	await api.createRenderEntry(btnDarkPrimaryHoverSnip.id, 'background', '#60a5fa');

	// {theme: dark, emphasis: primary, state: disabled}
	const btnDarkPrimaryDisabled = (await api.createLayer(buttonKit.id))!;
	await api.addAxisValueToLayer(btnDarkPrimaryDisabled.id, themeDark.id);
	await api.addAxisValueToLayer(btnDarkPrimaryDisabled.id, emphasisPrimary.id);
	await api.addAxisValueToLayer(btnDarkPrimaryDisabled.id, stateDisabled.id);
	const btnDarkPrimaryDisabledSnip = (await api.createRenderSnippet(btnDarkPrimaryDisabled.id))!;
	await api.createRenderEntry(btnDarkPrimaryDisabledSnip.id, 'background', '#1e3a5f');
	await api.createRenderEntry(btnDarkPrimaryDisabledSnip.id, 'opacity', '0.4');

	// {theme: dark, sentiment: danger, state: hover}
	const btnDarkDangerHover = (await api.createLayer(buttonKit.id))!;
	await api.addAxisValueToLayer(btnDarkDangerHover.id, themeDark.id);
	await api.addAxisValueToLayer(btnDarkDangerHover.id, sentimentDanger.id);
	await api.addAxisValueToLayer(btnDarkDangerHover.id, stateHover.id);
	const btnDarkDangerHoverSnip = (await api.createRenderSnippet(btnDarkDangerHover.id))!;
	await api.createRenderEntry(btnDarkDangerHoverSnip.id, 'background', '#b91c1c');

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

	// Per-emphasis content
	const lblPrimary = (await api.createLayer(labelKit.id))!;
	await api.addAxisValueToLayer(lblPrimary.id, emphasisPrimary.id);
	const lblPrimarySnip = (await api.createRenderSnippet(lblPrimary.id))!;
	await api.createRenderEntry(lblPrimarySnip.id, 'content', 'Submit');
	await api.createRenderEntry(lblPrimarySnip.id, 'color', '#ffffff');
	await api.createRenderEntry(lblPrimarySnip.id, 'font-weight', '600');

	const lblSecondary = (await api.createLayer(labelKit.id))!;
	await api.addAxisValueToLayer(lblSecondary.id, emphasisSecondary.id);
	const lblSecondarySnip = (await api.createRenderSnippet(lblSecondary.id))!;
	await api.createRenderEntry(lblSecondarySnip.id, 'content', 'Cancel');
	await api.createRenderEntry(lblSecondarySnip.id, 'color', '#ffffff');

	const lblTertiary = (await api.createLayer(labelKit.id))!;
	await api.addAxisValueToLayer(lblTertiary.id, emphasisTertiary.id);
	const lblTertiarySnip = (await api.createRenderSnippet(lblTertiary.id))!;
	await api.createRenderEntry(lblTertiarySnip.id, 'content', 'Learn More');
	await api.createRenderEntry(lblTertiarySnip.id, 'color', '#1a1a1a');

	const lblGhost = (await api.createLayer(labelKit.id))!;
	await api.addAxisValueToLayer(lblGhost.id, emphasisGhost.id);
	const lblGhostSnip = (await api.createRenderSnippet(lblGhost.id))!;
	await api.createRenderEntry(lblGhostSnip.id, 'content', 'Dismiss');

	// Per-sentiment content (higher priority than emphasis)
	const lblPositive = (await api.createLayer(labelKit.id))!;
	await api.addAxisValueToLayer(lblPositive.id, sentimentPositive.id);
	const lblPositiveSnip = (await api.createRenderSnippet(lblPositive.id))!;
	await api.createRenderEntry(lblPositiveSnip.id, 'content', 'Confirm');
	await api.createRenderEntry(lblPositiveSnip.id, 'color', '#ffffff');

	const lblDanger = (await api.createLayer(labelKit.id))!;
	await api.addAxisValueToLayer(lblDanger.id, sentimentDanger.id);
	const lblDangerSnip = (await api.createRenderSnippet(lblDanger.id))!;
	await api.createRenderEntry(lblDangerSnip.id, 'content', 'Delete');
	await api.createRenderEntry(lblDangerSnip.id, 'color', '#ffffff');

	// Disabled state label
	const lblDisabled = (await api.createLayer(labelKit.id))!;
	await api.addAxisValueToLayer(lblDisabled.id, stateDisabled.id);
	const lblDisabledSnip = (await api.createRenderSnippet(lblDisabled.id))!;
	await api.createRenderEntry(lblDisabledSnip.id, 'content', 'Unavailable');

	// Label views — child_only so charter skips them as top-level frames
	const childOnlyHint = { charter: { primitive: 'text', childOnly: true } };

	const labelDefaultView = (await api.createViewInProject(proj.id, 'Label: Default', childOnlyHint))!;
	await api.attachKitToComposition(labelKit.id, labelDefaultView.id);

	const labelPrimaryView = (await api.createViewInProject(proj.id, 'Label: Primary', childOnlyHint))!;
	await api.attachKitToComposition(labelKit.id, labelPrimaryView.id);
	await api.setAxisArg(labelPrimaryView.id, labelKit.id, emphasisAxis.id, { type: 'literal', value: 'primary' });

	const labelSecondaryView = (await api.createViewInProject(proj.id, 'Label: Secondary', childOnlyHint))!;
	await api.attachKitToComposition(labelKit.id, labelSecondaryView.id);
	await api.setAxisArg(labelSecondaryView.id, labelKit.id, emphasisAxis.id, { type: 'literal', value: 'secondary' });

	const labelTertiaryView = (await api.createViewInProject(proj.id, 'Label: Tertiary', childOnlyHint))!;
	await api.attachKitToComposition(labelKit.id, labelTertiaryView.id);
	await api.setAxisArg(labelTertiaryView.id, labelKit.id, emphasisAxis.id, { type: 'literal', value: 'tertiary' });

	const labelGhostView = (await api.createViewInProject(proj.id, 'Label: Ghost', childOnlyHint))!;
	await api.attachKitToComposition(labelKit.id, labelGhostView.id);
	await api.setAxisArg(labelGhostView.id, labelKit.id, emphasisAxis.id, { type: 'literal', value: 'ghost' });

	const labelPositiveView = (await api.createViewInProject(proj.id, 'Label: Positive', childOnlyHint))!;
	await api.attachKitToComposition(labelKit.id, labelPositiveView.id);
	await api.setAxisArg(labelPositiveView.id, labelKit.id, sentimentAxis.id, { type: 'literal', value: 'positive' });

	const labelDangerView = (await api.createViewInProject(proj.id, 'Label: Danger', childOnlyHint))!;
	await api.attachKitToComposition(labelKit.id, labelDangerView.id);
	await api.setAxisArg(labelDangerView.id, labelKit.id, sentimentAxis.id, { type: 'literal', value: 'danger' });

	// Wire children onto button layers — specificity handles which label wins per view:
	// sentiment (priority 4000) beats emphasis (3000) beats null layer
	await api.setLayerChildren(btnNull.id, [labelDefaultView.id]);
	await api.setLayerChildren(btnPrimary.id, [labelPrimaryView.id]);
	await api.setLayerChildren(btnSecondary.id, [labelSecondaryView.id]);
	await api.setLayerChildren(btnTertiary.id, [labelTertiaryView.id]);
	await api.setLayerChildren(btnGhost.id, [labelGhostView.id]);
	await api.setLayerChildren(btnPositive.id, [labelPositiveView.id]);
	await api.setLayerChildren(btnDanger.id, [labelDangerView.id]);

	// --- Views ---

	// View: Light Default
	const lightDefaultView = (await api.createViewInProject(proj.id, 'Light Default', {
		charter: { primitive: 'box', position: [0, 0] }
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

	// View: Dark Default
	const darkDefaultView = (await api.createViewInProject(proj.id, 'Dark Default', {
		charter: { primitive: 'box', position: [280, 0] }
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

	// View: Light Dense Primary Hover
	const lightDensePrimaryHoverView = (await api.createViewInProject(
		proj.id,
		'Light Dense Primary Hover',
		{
			charter: { primitive: 'box', position: [560, 0] }
		}
	))!;
	await api.attachKitToComposition(buttonKit.id, lightDensePrimaryHoverView.id);
	await api.setAxisArg(lightDensePrimaryHoverView.id, buttonKit.id, themeAxis.id, {
		type: 'literal',
		value: 'light'
	});
	await api.setAxisArg(lightDensePrimaryHoverView.id, buttonKit.id, densityAxis.id, {
		type: 'literal',
		value: 'dense'
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

	// View: Dark Dense Danger Click
	const darkDenseDangerClickView = (await api.createViewInProject(
		proj.id,
		'Dark Dense Danger Click',
		{
			charter: { primitive: 'box', position: [0, 120] }
		}
	))!;
	await api.attachKitToComposition(buttonKit.id, darkDenseDangerClickView.id);
	await api.setAxisArg(darkDenseDangerClickView.id, buttonKit.id, themeAxis.id, {
		type: 'literal',
		value: 'dark'
	});
	await api.setAxisArg(darkDenseDangerClickView.id, buttonKit.id, densityAxis.id, {
		type: 'literal',
		value: 'dense'
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

	// View: Light Compact Ghost Disabled
	const lightCompactGhostDisabledView = (await api.createViewInProject(
		proj.id,
		'Light Compact Ghost Disabled',
		{
			charter: { primitive: 'box', position: [280, 120] }
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

	// View: Dark Compact Secondary Positive Default
	const darkCompactSecondaryPositiveView = (await api.createViewInProject(
		proj.id,
		'Dark Compact Positive',
		{
			charter: { primitive: 'box', position: [560, 120] }
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

	// View: Light Dense Tertiary Neutral Click
	const lightDenseTertiaryClickView = (await api.createViewInProject(
		proj.id,
		'Light Dense Tertiary Click',
		{
			charter: { primitive: 'box', position: [840, 120] }
		}
	))!;
	await api.attachKitToComposition(buttonKit.id, lightDenseTertiaryClickView.id);
	await api.setAxisArg(lightDenseTertiaryClickView.id, buttonKit.id, themeAxis.id, {
		type: 'literal',
		value: 'light'
	});
	await api.setAxisArg(lightDenseTertiaryClickView.id, buttonKit.id, densityAxis.id, {
		type: 'literal',
		value: 'dense'
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

	console.log('Demo project seeded: KIT\u202210 Demo');
}
