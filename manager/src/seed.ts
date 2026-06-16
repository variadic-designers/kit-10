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

	// Button kit
	const buttonKit = (await api.createKitInProject(proj.id, 'Button'))!;
	await api.consumeAxis(buttonKit.id, themeAxis.id);
	await api.consumeAxis(buttonKit.id, densityAxis.id);
	await api.consumeAxis(buttonKit.id, vpAxis.id);
	await api.reorderAxesInKit(buttonKit.id, themeAxis.id, 1000);
	await api.reorderAxesInKit(buttonKit.id, densityAxis.id, 2000);
	await api.reorderAxesInKit(buttonKit.id, vpAxis.id, 3000);

	// Kit-scoped token for Button
	const tokenBtnRadius = (await api.createToken(proj.id, 'border-radius', '8px', { kitId: buttonKit.id }))!;

	// Button null layer (baseline)
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

	// {theme: dark, density: compact}
	const btnDarkCompact = (await api.createLayer(buttonKit.id))!;
	await api.addAxisValueToLayer(btnDarkCompact.id, themeDark.id);
	await api.addAxisValueToLayer(btnDarkCompact.id, densityCompact.id);
	const btnDarkCompactSnip = (await api.createRenderSnippet(btnDarkCompact.id))!;
	await api.createRenderEntry(btnDarkCompactSnip.id, 'padding', '8px');
	await api.createRenderEntry(btnDarkCompactSnip.id, 'font-size', null, tokenPrimary.id);

	// {density: compact}
	const btnCompact = (await api.createLayer(buttonKit.id))!;
	await api.addAxisValueToLayer(btnCompact.id, densityCompact.id);
	const btnCompactSnip = (await api.createRenderSnippet(btnCompact.id))!;
	await api.createRenderEntry(btnCompactSnip.id, 'padding', '10px');

	// {viewport >= 1024}
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

	console.log('Demo project seeded: KIT\u202210 Demo');
}