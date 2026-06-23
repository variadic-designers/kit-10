import type { SchemaDialect } from './schema.js';
import { queryBuilder, type Api } from './api/index.js';

export async function seedDemoProject(dialect: SchemaDialect): Promise<void> {
	const api: Api = queryBuilder(dialect);

	const ws = (await api.getAllWorkspaces().execute())[0]!;
	const proj = (await api.createProjectInWorkspace(ws.workspaceId, 'KIT\u202210 Demo'))!;

	const tokenBg = (await api.createToken(proj.id, 'colors.bg', '#ffffff'))!;
	const tokenPrimary = (await api.createToken(proj.id, 'colors.primary', '#3b82f6'))!;
	const tokenSurface = (await api.createToken(proj.id, 'colors.surface', '#f5f5f5'))!;
	const tokenText = (await api.createToken(proj.id, 'colors.text', '#1a1a1a'))!;

	// Button kit - theme axis (categorical)
	const themeAxis = (await api.createAxis(proj.id, 'Theme', 'Light or dark mode', 'categorical'))!;
	const themeLight = (await api.createAxisValue(themeAxis.id, { type: 'literal', value: 'light' }))!;
	const themeDark = (await api.createAxisValue(themeAxis.id, { type: 'literal', value: 'dark' }))!;

	// Density axis (categorical)
	const densityAxis = (await api.createAxis(proj.id, 'Density', 'Spacing density', 'categorical'))!;
	const densityCompact = (await api.createAxisValue(densityAxis.id, { type: 'literal', value: 'compact' }))!;
	const densityComfortable = (await api.createAxisValue(densityAxis.id, { type: 'literal', value: 'comfortable' }))!;

	// Viewport axis (range)
	const vpAxis = (await api.createAxis(proj.id, 'Viewport', 'Viewport width in pixels', 'range'))!;
	const vpGte768 = (await api.createAxisValue(vpAxis.id, { type: 'range', operator: '>=', threshold: 768 }))!;
	const vpGte1024 = (await api.createAxisValue(vpAxis.id, { type: 'range', operator: '>=', threshold: 1024 }))!;

	// State axis (categorical)
	const stateAxis = (await api.createAxis(proj.id, 'State', 'Interaction state', 'categorical'))!;
	const stateDefault = (await api.createAxisValue(stateAxis.id, { type: 'literal', value: 'default' }))!;
	const stateHover = (await api.createAxisValue(stateAxis.id, { type: 'literal', value: 'hover' }))!;
	const stateActive = (await api.createAxisValue(stateAxis.id, { type: 'literal', value: 'active' }))!;
	const stateDisabled = (await api.createAxisValue(stateAxis.id, { type: 'literal', value: 'disabled' }))!;

	// Emphasis axis (categorical)
	const emphasisAxis = (await api.createAxis(proj.id, 'Emphasis', 'Visual emphasis level', 'categorical'))!;
	const emphasisPrimary = (await api.createAxisValue(emphasisAxis.id, { type: 'literal', value: 'primary' }))!;
	const emphasisSecondary = (await api.createAxisValue(emphasisAxis.id, { type: 'literal', value: 'secondary' }))!;
	const emphasisGhost = (await api.createAxisValue(emphasisAxis.id, { type: 'literal', value: 'ghost' }))!;

	// Button kit
	const buttonKit = (await api.createKitInProject(proj.id, 'Button'))!;
	await api.consumeAxis(buttonKit.id, themeAxis.id);
	await api.consumeAxis(buttonKit.id, densityAxis.id);
	await api.consumeAxis(buttonKit.id, vpAxis.id);
	await api.consumeAxis(buttonKit.id, stateAxis.id);
	await api.consumeAxis(buttonKit.id, emphasisAxis.id);
	await api.reorderAxesInKit(buttonKit.id, themeAxis.id, 1000);
	await api.reorderAxesInKit(buttonKit.id, densityAxis.id, 2000);
	await api.reorderAxesInKit(buttonKit.id, vpAxis.id, 3000);
	await api.reorderAxesInKit(buttonKit.id, stateAxis.id, 4000);
	await api.reorderAxesInKit(buttonKit.id, emphasisAxis.id, 5000);

	// Kit-scoped token for Button
	const tokenBtnRadius = (await api.createToken(proj.id, 'border-radius', '8px', { kitId: buttonKit.id }))!;

	// Button null layer (0 conditions)
	const btnNull = (await api.createLayer(buttonKit.id))!;
	const btnNullSnip = (await api.createRenderSnippet(btnNull.id))!;
	await api.createRenderEntry(btnNullSnip.id, 'background', null, tokenBg.id);
	await api.createRenderEntry(btnNullSnip.id, 'color', null, tokenText.id);
	await api.createRenderEntry(btnNullSnip.id, 'padding', '16px');
	await api.createRenderEntry(btnNullSnip.id, 'border-radius', null, tokenBtnRadius.id);

	// {theme: dark} (1 condition)
	const btnDark = (await api.createLayer(buttonKit.id))!;
	await api.addAxisValueToLayer(btnDark.id, themeDark.id);
	const btnDarkSnip = (await api.createRenderSnippet(btnDark.id))!;
	await api.createRenderEntry(btnDarkSnip.id, 'background', '#1a1a2e');
	await api.createRenderEntry(btnDarkSnip.id, 'color', '#e0e0e0');

	// {state: hover} (1 condition)
	const btnHover = (await api.createLayer(buttonKit.id))!;
	await api.addAxisValueToLayer(btnHover.id, stateHover.id);
	const btnHoverSnip = (await api.createRenderSnippet(btnHover.id))!;
	await api.createRenderEntry(btnHoverSnip.id, 'background', '#e2e8f0');
	await api.createRenderEntry(btnHoverSnip.id, 'cursor', 'pointer');

	// {state: active} (1 condition)
	const btnActive = (await api.createLayer(buttonKit.id))!;
	await api.addAxisValueToLayer(btnActive.id, stateActive.id);
	const btnActiveSnip = (await api.createRenderSnippet(btnActive.id))!;
	await api.createRenderEntry(btnActiveSnip.id, 'background', '#cbd5e1');
	await api.createRenderEntry(btnActiveSnip.id, 'transform', 'scale(0.98)');

	// {state: disabled} (1 condition)
	const btnDisabled = (await api.createLayer(buttonKit.id))!;
	await api.addAxisValueToLayer(btnDisabled.id, stateDisabled.id);
	const btnDisabledSnip = (await api.createRenderSnippet(btnDisabled.id))!;
	await api.createRenderEntry(btnDisabledSnip.id, 'opacity', '0.5');
	await api.createRenderEntry(btnDisabledSnip.id, 'cursor', 'not-allowed');

	// {emphasis: primary} (1 condition)
	const btnPrimary = (await api.createLayer(buttonKit.id))!;
	await api.addAxisValueToLayer(btnPrimary.id, emphasisPrimary.id);
	const btnPrimarySnip = (await api.createRenderSnippet(btnPrimary.id))!;
	await api.createRenderEntry(btnPrimarySnip.id, 'background', null, tokenPrimary.id);
	await api.createRenderEntry(btnPrimarySnip.id, 'color', '#ffffff');
	await api.createRenderEntry(btnPrimarySnip.id, 'font-weight', '600');

	// {emphasis: secondary} (1 condition)
	const btnSecondary = (await api.createLayer(buttonKit.id))!;
	await api.addAxisValueToLayer(btnSecondary.id, emphasisSecondary.id);
	const btnSecondarySnip = (await api.createRenderSnippet(btnSecondary.id))!;
	await api.createRenderEntry(btnSecondarySnip.id, 'background', 'transparent');
	await api.createRenderEntry(btnSecondarySnip.id, 'border', '1px solid currentColor');

	// {emphasis: ghost} (1 condition)
	const btnGhost = (await api.createLayer(buttonKit.id))!;
	await api.addAxisValueToLayer(btnGhost.id, emphasisGhost.id);
	const btnGhostSnip = (await api.createRenderSnippet(btnGhost.id))!;
	await api.createRenderEntry(btnGhostSnip.id, 'background', 'transparent');
	await api.createRenderEntry(btnGhostSnip.id, 'border', 'none');

	// {theme: dark, density: compact} (2 conditions)
	const btnDarkCompact = (await api.createLayer(buttonKit.id))!;
	await api.addAxisValueToLayer(btnDarkCompact.id, themeDark.id);
	await api.addAxisValueToLayer(btnDarkCompact.id, densityCompact.id);
	const btnDarkCompactSnip = (await api.createRenderSnippet(btnDarkCompact.id))!;
	await api.createRenderEntry(btnDarkCompactSnip.id, 'padding', '8px');
	await api.createRenderEntry(btnDarkCompactSnip.id, 'font-size', null, tokenPrimary.id);

	// {emphasis: primary, state: hover} (2 conditions)
	const btnPrimaryHover = (await api.createLayer(buttonKit.id))!;
	await api.addAxisValueToLayer(btnPrimaryHover.id, emphasisPrimary.id);
	await api.addAxisValueToLayer(btnPrimaryHover.id, stateHover.id);
	const btnPrimaryHoverSnip = (await api.createRenderSnippet(btnPrimaryHover.id))!;
	await api.createRenderEntry(btnPrimaryHoverSnip.id, 'background', '#2563eb');
	await api.createRenderEntry(btnPrimaryHoverSnip.id, 'box-shadow', '0 2px 8px rgba(59,130,246,0.3)');

	// {emphasis: primary, state: active} (2 conditions)
	const btnPrimaryActive = (await api.createLayer(buttonKit.id))!;
	await api.addAxisValueToLayer(btnPrimaryActive.id, emphasisPrimary.id);
	await api.addAxisValueToLayer(btnPrimaryActive.id, stateActive.id);
	const btnPrimaryActiveSnip = (await api.createRenderSnippet(btnPrimaryActive.id))!;
	await api.createRenderEntry(btnPrimaryActiveSnip.id, 'background', '#1d4ed8');
	await api.createRenderEntry(btnPrimaryActiveSnip.id, 'transform', 'scale(0.98)');

	// {theme: dark, emphasis: primary} (2 conditions)
	const btnDarkPrimary = (await api.createLayer(buttonKit.id))!;
	await api.addAxisValueToLayer(btnDarkPrimary.id, themeDark.id);
	await api.addAxisValueToLayer(btnDarkPrimary.id, emphasisPrimary.id);
	const btnDarkPrimarySnip = (await api.createRenderSnippet(btnDarkPrimary.id))!;
	await api.createRenderEntry(btnDarkPrimarySnip.id, 'background', '#3b82f6');
	await api.createRenderEntry(btnDarkPrimarySnip.id, 'color', '#0f172a');

	// {theme: dark, emphasis: primary, state: hover} (3 conditions)
	const btnDarkPrimaryHover = (await api.createLayer(buttonKit.id))!;
	await api.addAxisValueToLayer(btnDarkPrimaryHover.id, themeDark.id);
	await api.addAxisValueToLayer(btnDarkPrimaryHover.id, emphasisPrimary.id);
	await api.addAxisValueToLayer(btnDarkPrimaryHover.id, stateHover.id);
	const btnDarkPrimaryHoverSnip = (await api.createRenderSnippet(btnDarkPrimaryHover.id))!;
	await api.createRenderEntry(btnDarkPrimaryHoverSnip.id, 'background', '#60a5fa');
	await api.createRenderEntry(btnDarkPrimaryHoverSnip.id, 'box-shadow', '0 4px 16px rgba(96,165,250,0.4)');

	// {theme: dark, emphasis: primary, state: disabled} (3 conditions)
	const btnDarkPrimaryDisabled = (await api.createLayer(buttonKit.id))!;
	await api.addAxisValueToLayer(btnDarkPrimaryDisabled.id, themeDark.id);
	await api.addAxisValueToLayer(btnDarkPrimaryDisabled.id, emphasisPrimary.id);
	await api.addAxisValueToLayer(btnDarkPrimaryDisabled.id, stateDisabled.id);
	const btnDarkPrimaryDisabledSnip = (await api.createRenderSnippet(btnDarkPrimaryDisabled.id))!;
	await api.createRenderEntry(btnDarkPrimaryDisabledSnip.id, 'background', '#1e3a5f');
	await api.createRenderEntry(btnDarkPrimaryDisabledSnip.id, 'opacity', '0.4');

	// {density: compact} (1 condition)
	const btnCompact = (await api.createLayer(buttonKit.id))!;
	await api.addAxisValueToLayer(btnCompact.id, densityCompact.id);
	const btnCompactSnip = (await api.createRenderSnippet(btnCompact.id))!;
	await api.createRenderEntry(btnCompactSnip.id, 'padding', '10px');

	// {viewport >= 1024} (1 condition)
	const btnWide = (await api.createLayer(buttonKit.id))!;
	await api.addAxisValueToLayer(btnWide.id, vpGte1024.id);
	const btnWideSnip = (await api.createRenderSnippet(btnWide.id))!;
	await api.createRenderEntry(btnWideSnip.id, 'width', '320px');

	// Layout kit
	const layoutKit = (await api.createKitInProject(proj.id, 'Layout'))!;
	await api.consumeAxis(layoutKit.id, themeAxis.id);
	await api.consumeAxis(layoutKit.id, vpAxis.id);
	await api.reorderAxesInKit(layoutKit.id, themeAxis.id, 1000);
	await api.reorderAxesInKit(layoutKit.id, vpAxis.id, 2000);

	// Layout null layer
	const layNull = (await api.createLayer(layoutKit.id))!;
	const layNullSnip = (await api.createRenderSnippet(layNull.id))!;
	await api.createRenderEntry(layNullSnip.id, 'gap', '16px');
	await api.createRenderEntry(layNullSnip.id, 'padding', '24px');
	await api.createRenderEntry(layNullSnip.id, 'background', null, tokenSurface.id);

	// Layout {theme: dark}
	const layDark = (await api.createLayer(layoutKit.id))!;
	await api.addAxisValueToLayer(layDark.id, themeDark.id);
	const layDarkSnip = (await api.createRenderSnippet(layDark.id))!;
	await api.createRenderEntry(layDarkSnip.id, 'background', '#1a1a2e');
	await api.createRenderEntry(layDarkSnip.id, 'gap', '12px');

	// View: Dark Compact
	const darkCompactView = (await api.createViewInProject(proj.id, 'Dark Compact'))!;
	await api.attachKitToComposition(layoutKit.id, darkCompactView.id);
	await api.attachKitToComposition(buttonKit.id, darkCompactView.id);
	await api.setAxisArg(darkCompactView.id, buttonKit.id, themeAxis.id, { type: 'literal', value: 'dark' });
	await api.setAxisArg(darkCompactView.id, buttonKit.id, densityAxis.id, { type: 'literal', value: 'compact' });
	await api.setAxisArg(darkCompactView.id, layoutKit.id, themeAxis.id, { type: 'literal', value: 'dark' });

	// View-scoped token: Dark Compact overrides colors.primary to indigo
	await api.createToken(proj.id, 'colors.primary', '#6366f1', { viewId: darkCompactView.id });

	// View: Light Comfortable
	const lightComfortableView = (await api.createViewInProject(proj.id, 'Light Comfortable'))!;
	await api.attachKitToComposition(layoutKit.id, lightComfortableView.id);
	await api.attachKitToComposition(buttonKit.id, lightComfortableView.id);
	await api.setAxisArg(lightComfortableView.id, buttonKit.id, themeAxis.id, { type: 'literal', value: 'light' });
	await api.setAxisArg(lightComfortableView.id, buttonKit.id, densityAxis.id, { type: 'literal', value: 'comfortable' });
	await api.setAxisArg(lightComfortableView.id, layoutKit.id, themeAxis.id, { type: 'literal', value: 'light' });

	// --- Additional kits for Dashboard view ---

	// Card kit
	const cardKit = (await api.createKitInProject(proj.id, 'Card'))!;
	await api.consumeAxis(cardKit.id, themeAxis.id);
	await api.consumeAxis(cardKit.id, vpAxis.id);
	await api.reorderAxesInKit(cardKit.id, themeAxis.id, 1000);
	await api.reorderAxesInKit(cardKit.id, vpAxis.id, 2000);

	const tokenCardRadius = (await api.createToken(proj.id, 'card.radius', '12px', { kitId: cardKit.id }))!;

	const cardNull = (await api.createLayer(cardKit.id))!;
	const cardNullSnip = (await api.createRenderSnippet(cardNull.id))!;
	await api.createRenderEntry(cardNullSnip.id, 'background', null, tokenSurface.id);
	await api.createRenderEntry(cardNullSnip.id, 'border-radius', null, tokenCardRadius.id);
	await api.createRenderEntry(cardNullSnip.id, 'padding', '20px');
	await api.createRenderEntry(cardNullSnip.id, 'box-shadow', '0 1px 3px rgba(0,0,0,0.1)');

	const cardDark = (await api.createLayer(cardKit.id))!;
	await api.addAxisValueToLayer(cardDark.id, themeDark.id);
	const cardDarkSnip = (await api.createRenderSnippet(cardDark.id))!;
	await api.createRenderEntry(cardDarkSnip.id, 'background', '#1e293b');
	await api.createRenderEntry(cardDarkSnip.id, 'box-shadow', '0 1px 3px rgba(0,0,0,0.4)');

	const cardWide = (await api.createLayer(cardKit.id))!;
	await api.addAxisValueToLayer(cardWide.id, vpGte1024.id);
	const cardWideSnip = (await api.createRenderSnippet(cardWide.id))!;
	await api.createRenderEntry(cardWideSnip.id, 'padding', '28px');

	// Form kit
	const formKit = (await api.createKitInProject(proj.id, 'Form'))!;
	await api.consumeAxis(formKit.id, themeAxis.id);
	await api.consumeAxis(formKit.id, densityAxis.id);
	await api.reorderAxesInKit(formKit.id, themeAxis.id, 1000);
	await api.reorderAxesInKit(formKit.id, densityAxis.id, 2000);

	const formNull = (await api.createLayer(formKit.id))!;
	const formNullSnip = (await api.createRenderSnippet(formNull.id))!;
	await api.createRenderEntry(formNullSnip.id, 'background', '#ffffff');
	await api.createRenderEntry(formNullSnip.id, 'border', '1px solid #e2e8f0');
	await api.createRenderEntry(formNullSnip.id, 'border-radius', '6px');
	await api.createRenderEntry(formNullSnip.id, 'padding', '12px');

	const formDark = (await api.createLayer(formKit.id))!;
	await api.addAxisValueToLayer(formDark.id, themeDark.id);
	const formDarkSnip = (await api.createRenderSnippet(formDark.id))!;
	await api.createRenderEntry(formDarkSnip.id, 'background', '#1e293b');
	await api.createRenderEntry(formDarkSnip.id, 'border', '1px solid #475569');

	const formCompact = (await api.createLayer(formKit.id))!;
	await api.addAxisValueToLayer(formCompact.id, densityCompact.id);
	const formCompactSnip = (await api.createRenderSnippet(formCompact.id))!;
	await api.createRenderEntry(formCompactSnip.id, 'padding', '8px');

	// View: Dashboard (4 kits)
	const dashboardView = (await api.createViewInProject(proj.id, 'Dashboard'))!;
	await api.attachKitToComposition(layoutKit.id, dashboardView.id);
	await api.attachKitToComposition(cardKit.id, dashboardView.id);
	await api.attachKitToComposition(formKit.id, dashboardView.id);
	await api.attachKitToComposition(buttonKit.id, dashboardView.id);
	await api.setAxisArg(dashboardView.id, layoutKit.id, themeAxis.id, { type: 'literal', value: 'dark' });
	await api.setAxisArg(dashboardView.id, cardKit.id, themeAxis.id, { type: 'literal', value: 'dark' });
	await api.setAxisArg(dashboardView.id, formKit.id, themeAxis.id, { type: 'literal', value: 'dark' });
	await api.setAxisArg(dashboardView.id, formKit.id, densityAxis.id, { type: 'literal', value: 'compact' });
	await api.setAxisArg(dashboardView.id, buttonKit.id, themeAxis.id, { type: 'literal', value: 'dark' });
	await api.setAxisArg(dashboardView.id, buttonKit.id, densityAxis.id, { type: 'literal', value: 'compact' });

	// --- Additional kits for Showcase view (8 kits total) ---

	// Typography kit
	const typographyKit = (await api.createKitInProject(proj.id, 'Typography'))!;
	await api.consumeAxis(typographyKit.id, themeAxis.id);
	await api.reorderAxesInKit(typographyKit.id, themeAxis.id, 1000);

	const typoNull = (await api.createLayer(typographyKit.id))!;
	const typoNullSnip = (await api.createRenderSnippet(typoNull.id))!;
	await api.createRenderEntry(typoNullSnip.id, 'font-size', '16px');
	await api.createRenderEntry(typoNullSnip.id, 'line-height', '1.5');
	await api.createRenderEntry(typoNullSnip.id, 'color', null, tokenText.id);

	const typoDark = (await api.createLayer(typographyKit.id))!;
	await api.addAxisValueToLayer(typoDark.id, themeDark.id);
	const typoDarkSnip = (await api.createRenderSnippet(typoDark.id))!;
	await api.createRenderEntry(typoDarkSnip.id, 'color', '#e0e0e0');

	// Feedback kit
	const feedbackKit = (await api.createKitInProject(proj.id, 'Feedback'))!;
	await api.consumeAxis(feedbackKit.id, themeAxis.id);
	await api.reorderAxesInKit(feedbackKit.id, themeAxis.id, 1000);

	const tokenFeedbackRadius = (await api.createToken(proj.id, 'feedback.radius', '8px', { kitId: feedbackKit.id }))!;

	const fbNull = (await api.createLayer(feedbackKit.id))!;
	const fbNullSnip = (await api.createRenderSnippet(fbNull.id))!;
	await api.createRenderEntry(fbNullSnip.id, 'padding', '12px 16px');
	await api.createRenderEntry(fbNullSnip.id, 'border-radius', null, tokenFeedbackRadius.id);
	await api.createRenderEntry(fbNullSnip.id, 'font-size', '14px');

	const fbDark = (await api.createLayer(feedbackKit.id))!;
	await api.addAxisValueToLayer(fbDark.id, themeDark.id);
	const fbDarkSnip = (await api.createRenderSnippet(fbDark.id))!;
	await api.createRenderEntry(fbDarkSnip.id, 'background', '#1e293b');
	await api.createRenderEntry(fbDarkSnip.id, 'color', '#e2e8f0');

	// Navigation kit
	const navKit = (await api.createKitInProject(proj.id, 'Navigation'))!;
	await api.consumeAxis(navKit.id, themeAxis.id);
	await api.consumeAxis(navKit.id, vpAxis.id);
	await api.reorderAxesInKit(navKit.id, themeAxis.id, 1000);
	await api.reorderAxesInKit(navKit.id, vpAxis.id, 2000);

	const navNull = (await api.createLayer(navKit.id))!;
	const navNullSnip = (await api.createRenderSnippet(navNull.id))!;
	await api.createRenderEntry(navNullSnip.id, 'height', '56px');
	await api.createRenderEntry(navNullSnip.id, 'background', null, tokenSurface.id);
	await api.createRenderEntry(navNullSnip.id, 'border-bottom', '1px solid #e2e8f0');

	const navDark = (await api.createLayer(navKit.id))!;
	await api.addAxisValueToLayer(navDark.id, themeDark.id);
	const navDarkSnip = (await api.createRenderSnippet(navDark.id))!;
	await api.createRenderEntry(navDarkSnip.id, 'background', '#0f172a');
	await api.createRenderEntry(navDarkSnip.id, 'border-bottom', '1px solid #1e293b');

	const navWide = (await api.createLayer(navKit.id))!;
	await api.addAxisValueToLayer(navWide.id, vpGte1024.id);
	const navWideSnip = (await api.createRenderSnippet(navWide.id))!;
	await api.createRenderEntry(navWideSnip.id, 'height', '64px');

	// Overlay kit
	const overlayKit = (await api.createKitInProject(proj.id, 'Overlay'))!;
	await api.consumeAxis(overlayKit.id, themeAxis.id);
	await api.reorderAxesInKit(overlayKit.id, themeAxis.id, 1000);

	const tokenOverlayRadius = (await api.createToken(proj.id, 'overlay.radius', '16px', { kitId: overlayKit.id }))!;

	const ovNull = (await api.createLayer(overlayKit.id))!;
	const ovNullSnip = (await api.createRenderSnippet(ovNull.id))!;
	await api.createRenderEntry(ovNullSnip.id, 'background', '#ffffff');
	await api.createRenderEntry(ovNullSnip.id, 'border-radius', null, tokenOverlayRadius.id);
	await api.createRenderEntry(ovNullSnip.id, 'padding', '24px');
	await api.createRenderEntry(ovNullSnip.id, 'box-shadow', '0 8px 32px rgba(0,0,0,0.15)');

	const ovDark = (await api.createLayer(overlayKit.id))!;
	await api.addAxisValueToLayer(ovDark.id, themeDark.id);
	const ovDarkSnip = (await api.createRenderSnippet(ovDark.id))!;
	await api.createRenderEntry(ovDarkSnip.id, 'background', '#1e293b');
	await api.createRenderEntry(ovDarkSnip.id, 'box-shadow', '0 8px 32px rgba(0,0,0,0.5)');

	// View: Showcase (8 kits, low → high priority)
	const showcaseView = (await api.createViewInProject(proj.id, 'Showcase'))!;
	await api.attachKitToComposition(layoutKit.id, showcaseView.id);
	await api.attachKitToComposition(typographyKit.id, showcaseView.id);
	await api.attachKitToComposition(navKit.id, showcaseView.id);
	await api.attachKitToComposition(cardKit.id, showcaseView.id);
	await api.attachKitToComposition(formKit.id, showcaseView.id);
	await api.attachKitToComposition(feedbackKit.id, showcaseView.id);
	await api.attachKitToComposition(overlayKit.id, showcaseView.id);
	await api.attachKitToComposition(buttonKit.id, showcaseView.id);
	await api.setAxisArg(showcaseView.id, layoutKit.id, themeAxis.id, { type: 'literal', value: 'dark' });
	await api.setAxisArg(showcaseView.id, typographyKit.id, themeAxis.id, { type: 'literal', value: 'dark' });
	await api.setAxisArg(showcaseView.id, navKit.id, themeAxis.id, { type: 'literal', value: 'dark' });
	await api.setAxisArg(showcaseView.id, cardKit.id, themeAxis.id, { type: 'literal', value: 'dark' });
	await api.setAxisArg(showcaseView.id, formKit.id, themeAxis.id, { type: 'literal', value: 'dark' });
	await api.setAxisArg(showcaseView.id, formKit.id, densityAxis.id, { type: 'literal', value: 'compact' });
	await api.setAxisArg(showcaseView.id, feedbackKit.id, themeAxis.id, { type: 'literal', value: 'dark' });
	await api.setAxisArg(showcaseView.id, overlayKit.id, themeAxis.id, { type: 'literal', value: 'dark' });
	await api.setAxisArg(showcaseView.id, buttonKit.id, themeAxis.id, { type: 'literal', value: 'dark' });
	await api.setAxisArg(showcaseView.id, buttonKit.id, densityAxis.id, { type: 'literal', value: 'compact' });

	// View: Primary Hover Button (single kit, deep axis args to exercise 0/1/2/3-condition layers)
	const primaryHoverView = (await api.createViewInProject(proj.id, 'Primary Hover'))!;
	await api.attachKitToComposition(buttonKit.id, primaryHoverView.id);
	await api.setAxisArg(primaryHoverView.id, buttonKit.id, themeAxis.id, { type: 'literal', value: 'dark' });
	await api.setAxisArg(primaryHoverView.id, buttonKit.id, emphasisAxis.id, { type: 'literal', value: 'primary' });
	await api.setAxisArg(primaryHoverView.id, buttonKit.id, stateAxis.id, { type: 'literal', value: 'hover' });
	await api.setAxisArg(primaryHoverView.id, buttonKit.id, densityAxis.id, { type: 'literal', value: 'compact' });

	// View-scoped token: Primary Hover overrides colors.primary to violet
	await api.createToken(proj.id, 'colors.primary', '#8b5cf6', { viewId: primaryHoverView.id });

	console.log('Demo project seeded: KIT\u202210 Demo');
}