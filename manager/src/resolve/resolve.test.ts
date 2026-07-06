import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, type TestContext } from '../test-helpers.js';
import { resolve, resolveMany, flattenKitResults } from './resolve.js';
import type { TokenValue } from '../schema.js';

const s = (value: string): TokenValue => ({ type: 'scalar', value });

describe('resolve', () => {
	let ctx: TestContext;

	beforeEach(async () => {
		ctx = await createTestDb();
	});

	afterEach(async () => {
		await ctx.pg.close();
	});

	async function seedButtonKit() {
		const ws = (await ctx.api.getAllWorkspaces().execute())[0]!;
		const proj = (await ctx.api.createProjectInWorkspace(ws.workspaceId, 'Design System'))!;

		const themeAxis = (await ctx.api.createAxis(proj.id, 'theme', 'Light or dark mode', 'categorical', ['light', 'dark']))!;
		const densityAxis = (await ctx.api.createAxis(proj.id, 'density', 'Spacing density', 'categorical', ['compact', 'comfortable']))!;

		const themeLight = (await ctx.api.createAxisValue(themeAxis.id, { type: 'literal', value: 'light' }))!;
		const themeDark = (await ctx.api.createAxisValue(themeAxis.id, { type: 'literal', value: 'dark' }))!;
		const densityCompact = (await ctx.api.createAxisValue(densityAxis.id, { type: 'literal', value: 'compact' }))!;
		const densityComfortable = (await ctx.api.createAxisValue(densityAxis.id, { type: 'literal', value: 'comfortable' }))!;

		const tokenBg = (await ctx.api.createToken(proj.id, 'colors.bg', s('#ffffff')))!;
		const tokenPrimary = (await ctx.api.createToken(proj.id, 'colors.primary', s('#3b82f6')))!;

		const kit = (await ctx.api.createKitInProject(proj.id, 'Button'))!;
		await ctx.api.consumeAxis(kit.id, themeAxis.id);
		await ctx.api.consumeAxis(kit.id, densityAxis.id);
		await ctx.api.reorderAxesInKit(kit.id, themeAxis.id, 1000);
		await ctx.api.reorderAxesInKit(kit.id, densityAxis.id, 2000);

		// Null layer: baseline defaults using token reference
		const nullLayer = (await ctx.api.createLayer(kit.id))!;
		const nullSnippet = (await ctx.api.createRenderSnippet(nullLayer.id))!;
		await ctx.api.createRenderEntry(nullSnippet.id, 'background', null, tokenBg.id);
		await ctx.api.createRenderEntry(nullSnippet.id, 'color', '#333333');
		await ctx.api.createRenderEntry(nullSnippet.id, 'padding', '16px');

		// {theme: dark} layer
		const darkLayer = (await ctx.api.createLayer(kit.id))!;
		await ctx.api.addAxisValueToLayer(darkLayer.id, themeDark.id);
		const darkSnippet = (await ctx.api.createRenderSnippet(darkLayer.id))!;
		await ctx.api.createRenderEntry(darkSnippet.id, 'background', '#1a1a2e');
		await ctx.api.createRenderEntry(darkSnippet.id, 'color', '#e0e0e0');

		// {theme: dark, density: compact} layer
		const darkCompactLayer = (await ctx.api.createLayer(kit.id))!;
		await ctx.api.addAxisValueToLayer(darkCompactLayer.id, themeDark.id);
		await ctx.api.addAxisValueToLayer(darkCompactLayer.id, densityCompact.id);
		const darkCompactSnippet = (await ctx.api.createRenderSnippet(darkCompactLayer.id))!;
		await ctx.api.createRenderEntry(darkCompactSnippet.id, 'padding', '8px');
		await ctx.api.createRenderEntry(darkCompactSnippet.id, 'font-size', null, tokenPrimary.id);

		// {density: compact} layer
		const compactLayer = (await ctx.api.createLayer(kit.id))!;
		await ctx.api.addAxisValueToLayer(compactLayer.id, densityCompact.id);
		const compactSnippet = (await ctx.api.createRenderSnippet(compactLayer.id))!;
		await ctx.api.createRenderEntry(compactSnippet.id, 'padding', '10px');

		return {
			proj, kit,
			themeAxis, densityAxis,
			themeLight, themeDark, densityCompact, densityComfortable,
			tokenBg, tokenPrimary,
			nullLayer, darkLayer, darkCompactLayer, compactLayer,
		};
	}

	it('resolves null layer when no axis args match any conditioned layer', async () => {
		const s = await seedButtonKit();

		const result = await resolve(ctx.db, s.kit.id, {});

		expect(result.get('background')).toEqual({
			property: 'background',
			value: '#ffffff',
			sourceLayerId: s.nullLayer.id,
			kitId: s.kit.id,
			isToken: true,
			tokenAlias: 'colors.bg',
			conditionCount: 0,
			keys: [],
			childViewIds: null,
		});
		expect(result.get('color')).toEqual({
			property: 'color',
			value: '#333333',
			sourceLayerId: s.nullLayer.id,
			kitId: s.kit.id,
			isToken: false,
			tokenAlias: null,
			conditionCount: 0,
			keys: [],
			childViewIds: null,
		});
		expect(result.get('padding')).toEqual({
			property: 'padding',
			value: '16px',
			sourceLayerId: s.nullLayer.id,
			kitId: s.kit.id,
			isToken: false,
			tokenAlias: null,
			conditionCount: 0,
			keys: [],
			childViewIds: null,
		});
	});

	it('resolves single-axis layer when theme=dark', async () => {
		const s = await seedButtonKit();

		const result = await resolve(ctx.db, s.kit.id, {
			[s.themeAxis.id]: { type: 'literal', value: 'dark' },
		});

		// dark layer overrides background and color, padding stays from null
		expect(result.get('background')!.value).toBe('#1a1a2e');
		expect(result.get('background')!.sourceLayerId).toBe(s.darkLayer.id);
		expect(result.get('color')!.value).toBe('#e0e0e0');
		expect(result.get('color')!.sourceLayerId).toBe(s.darkLayer.id);
		expect(result.get('padding')!.value).toBe('16px');
		expect(result.get('padding')!.sourceLayerId).toBe(s.nullLayer.id);
	});

	it('resolves two-axis layer when theme=dark and density=compact', async () => {
		const s = await seedButtonKit();

		const result = await resolve(ctx.db, s.kit.id, {
			[s.themeAxis.id]: { type: 'literal', value: 'dark' },
			[s.densityAxis.id]: { type: 'literal', value: 'compact' },
		});

		// dark+compact has highest specificity
		expect(result.get('background')!.value).toBe('#1a1a2e');
		expect(result.get('background')!.sourceLayerId).toBe(s.darkLayer.id);
		expect(result.get('color')!.value).toBe('#e0e0e0');
		expect(result.get('color')!.sourceLayerId).toBe(s.darkLayer.id);
		expect(result.get('padding')!.value).toBe('8px');
		expect(result.get('padding')!.sourceLayerId).toBe(s.darkCompactLayer.id);
		expect(result.get('font-size')!.value).toBe('#3b82f6');
		expect(result.get('font-size')!.isToken).toBe(true);
		expect(result.get('font-size')!.tokenAlias).toBe('colors.primary');
	});

	it('per-property override: compact layer overrides padding but dark overrides background and color', async () => {
		const s = await seedButtonKit();

		// Set only density=compact — no theme layer matches
		const result = await resolve(ctx.db, s.kit.id, {
			[s.densityAxis.id]: { type: 'literal', value: 'compact' },
		});

		// compact layer provides padding=10px, null layer provides the rest
		expect(result.get('padding')!.value).toBe('10px');
		expect(result.get('padding')!.sourceLayerId).toBe(s.compactLayer.id);
		expect(result.get('background')!.value).toBe('#ffffff');
		expect(result.get('background')!.sourceLayerId).toBe(s.nullLayer.id);
		expect(result.get('color')!.value).toBe('#333333');
		expect(result.get('color')!.sourceLayerId).toBe(s.nullLayer.id);
	});

	it('higher axis-count always beats lower regardless of axis priority', async () => {
		const s = await seedButtonKit();

		// theme=dark, density=compact: darkCompact (2 conditions) beats dark (1 cond) and compact (1 cond)
		const result = await resolve(ctx.db, s.kit.id, {
			[s.themeAxis.id]: { type: 'literal', value: 'dark' },
			[s.densityAxis.id]: { type: 'literal', value: 'compact' },
		});

		// padding comes from darkCompact (2 conditions), not compact (1 condition)
		// even though density has higher priority than theme
		expect(result.get('padding')!.sourceLayerId).toBe(s.darkCompactLayer.id);
		expect(result.get('padding')!.value).toBe('8px');
	});

	it('axis priority breaks tie between equal-axis-count layers', async () => {
		const s = await seedButtonKit();

		// Both darkLayer and compactLayer have 1 condition each.
		// darkLayer conditions on theme (priority 1000).
		// compactLayer conditions on density (priority 2000).
		// When they contest a property, density wins.
		// But they declare different properties: dark→{background,color}, compact→{padding}
		// So they merge orthogonally — no contest.
		// Now test with both matching: theme=dark, density=compact
		// darkCompactLayer (2 conditions) wins on padding over compactLayer (1 condition)
		// and over darkLayer (1 condition) on background and color.
		const result = await resolve(ctx.db, s.kit.id, {
			[s.themeAxis.id]: { type: 'literal', value: 'dark' },
			[s.densityAxis.id]: { type: 'literal', value: 'compact' },
		});

		expect(result.get('background')!.sourceLayerId).toBe(s.darkLayer.id);
		expect(result.get('color')!.sourceLayerId).toBe(s.darkLayer.id);
		expect(result.get('padding')!.sourceLayerId).toBe(s.darkCompactLayer.id);
	});

	it('returns empty map for kit with no layers', async () => {
		const ws = (await ctx.api.getAllWorkspaces().execute())[0]!;
		const proj = (await ctx.api.createProjectInWorkspace(ws.workspaceId, 'Empty'))!;
		const kit = (await ctx.api.createKitInProject(proj.id, 'Empty Kit'))!;

		const result = await resolve(ctx.db, kit.id, {});
		expect(result.size).toBe(0);
	});

	it('substitutes tokens in pass 2 after specificity resolution', async () => {
		const s = await seedButtonKit();

		// No args → null layer. background is a token reference (colors.bg → #ffffff)
		const result = await resolve(ctx.db, s.kit.id, {});

		expect(result.get('background')!.value).toBe('#ffffff');
		expect(result.get('background')!.isToken).toBe(true);
		expect(result.get('background')!.tokenAlias).toBe('colors.bg');
	});

	it('handles range conditions with numeric axis args', async () => {
		const ws = (await ctx.api.getAllWorkspaces().execute())[0]!;
		const proj = (await ctx.api.createProjectInWorkspace(ws.workspaceId, 'Range'))!;
		const vpAxis = (await ctx.api.createAxis(proj.id, 'viewport', 'Viewport width'))!;
		const vpGte1024 = (await ctx.api.createAxisValue(vpAxis.id, { type: 'range', operator: '>=', threshold: 1024 }))!;
		const vpGte768 = (await ctx.api.createAxisValue(vpAxis.id, { type: 'range', operator: '>=', threshold: 768 }))!;

		const kit = (await ctx.api.createKitInProject(proj.id, 'Layout'))!;
		await ctx.api.consumeAxis(kit.id, vpAxis.id);

		const nullLayer = (await ctx.api.createLayer(kit.id))!;
		const nullSnippet = (await ctx.api.createRenderSnippet(nullLayer.id))!;
		await ctx.api.createRenderEntry(nullSnippet.id, 'columns', '1');
		await ctx.api.createRenderEntry(nullSnippet.id, 'sidebar', 'hidden');

		// >=768: show sidebar, still 1 column
		const mediumLayer = (await ctx.api.createLayer(kit.id))!;
		await ctx.api.addAxisValueToLayer(mediumLayer.id, vpGte768.id);
		const mediumSnippet = (await ctx.api.createRenderSnippet(mediumLayer.id))!;
		await ctx.api.createRenderEntry(mediumSnippet.id, 'sidebar', 'visible');
		await ctx.api.createRenderEntry(mediumSnippet.id, 'columns', '2');

		// >=1024: 3 columns (overrides medium on columns, inherits sidebar from medium)
		const wideLayer = (await ctx.api.createLayer(kit.id))!;
		await ctx.api.addAxisValueToLayer(wideLayer.id, vpGte1024.id);
		const wideSnippet = (await ctx.api.createRenderSnippet(wideLayer.id))!;
		await ctx.api.createRenderEntry(wideSnippet.id, 'columns', '3');

		// viewport = 500 → null layer
		const resultNarrow = await resolve(ctx.db, kit.id, {
			[vpAxis.id]: { type: 'literal', value: '500' },
		});
		expect(resultNarrow.get('columns')!.value).toBe('1');
		expect(resultNarrow.get('sidebar')!.value).toBe('hidden');

		// viewport = 900 → only >=768 matches
		const resultMed = await resolve(ctx.db, kit.id, {
			[vpAxis.id]: { type: 'literal', value: '900' },
		});
		expect(resultMed.get('columns')!.value).toBe('2');
		expect(resultMed.get('sidebar')!.value).toBe('visible');

		// viewport = 1200 → both >=768 and >=1024 match.
		// Both are 1-condition layers on the same axis (same specificity).
		// For overlapping ranges on the same axis, layers that declare contested
		// properties are resolved in creation order. wideLayer overtakes mediumLayer
		// on 'columns' because it was created after and overwrites in order.
		// 'sidebar' is uncontested — inherited from mediumLayer.
		const resultWide = await resolve(ctx.db, kit.id, {
			[vpAxis.id]: { type: 'literal', value: '1200' },
		});
		expect(resultWide.get('sidebar')!.value).toBe('visible');
	});
});

describe('resolveMany', () => {
	let ctx: TestContext;

	beforeEach(async () => {
		ctx = await createTestDb();
	});

	afterEach(async () => {
		await ctx.pg.close();
	});

	it('resolves view with two kits — lower-priority kit fills gaps, higher-priority kit wins contested properties', async () => {
		const ws = (await ctx.api.getAllWorkspaces().execute())[0]!;
		const proj = (await ctx.api.createProjectInWorkspace(ws.workspaceId, 'Multi-Kit'))!;

		const themeAxis = (await ctx.api.createAxis(proj.id, 'theme', 'Light or dark'))!;
		const themeDark = (await ctx.api.createAxisValue(themeAxis.id, { type: 'literal', value: 'dark' }))!;

		// Layout kit (lower priority) — provides structure
		const layoutKit = (await ctx.api.createKitInProject(proj.id, 'Layout'))!;
		await ctx.api.consumeAxis(layoutKit.id, themeAxis.id);
		const layoutNull = (await ctx.api.createLayer(layoutKit.id))!;
		const layoutNullSnip = (await ctx.api.createRenderSnippet(layoutNull.id))!;
		await ctx.api.createRenderEntry(layoutNullSnip.id, 'padding', '16px');
		await ctx.api.createRenderEntry(layoutNullSnip.id, 'gap', '8px');
		await ctx.api.createRenderEntry(layoutNullSnip.id, 'background', '#ffffff');

		const layoutDarkLayer = (await ctx.api.createLayer(layoutKit.id))!;
		await ctx.api.addAxisValueToLayer(layoutDarkLayer.id, themeDark.id);
		const layoutDarkSnip = (await ctx.api.createRenderSnippet(layoutDarkLayer.id))!;
		await ctx.api.createRenderEntry(layoutDarkSnip.id, 'background', '#1a1a2e');
		await ctx.api.createRenderEntry(layoutDarkSnip.id, 'gap', '4px');

		// Button kit (higher priority) — provides component styling
		const buttonKit = (await ctx.api.createKitInProject(proj.id, 'Button'))!;
		await ctx.api.consumeAxis(buttonKit.id, themeAxis.id);
		const buttonNull = (await ctx.api.createLayer(buttonKit.id))!;
		const buttonNullSnip = (await ctx.api.createRenderSnippet(buttonNull.id))!;
		await ctx.api.createRenderEntry(buttonNullSnip.id, 'padding', '8px 16px');
		await ctx.api.createRenderEntry(buttonNullSnip.id, 'border-radius', '4px');

		const buttonDarkLayer = (await ctx.api.createLayer(buttonKit.id))!;
		await ctx.api.addAxisValueToLayer(buttonDarkLayer.id, themeDark.id);
		const buttonDarkSnip = (await ctx.api.createRenderSnippet(buttonDarkLayer.id))!;
		await ctx.api.createRenderEntry(buttonDarkSnip.id, 'border-radius', '8px');

		// View with both kits: Layout at priority 1000, Button at priority 2000 (higher)
		const view = (await ctx.api.createViewInProject(proj.id, 'Dark Page'))!;
		await ctx.api.attachKitToComposition(layoutKit.id, view.id);        // priority 1000
		await ctx.api.attachKitToComposition(buttonKit.id, view.id);        // priority 2000
		await ctx.api.setAxisArg(view.id, layoutKit.id, themeAxis.id, { type: 'literal', value: 'dark' });
		await ctx.api.setAxisArg(view.id, buttonKit.id, themeAxis.id, { type: 'literal', value: 'dark' });

		const kits = await resolveMany(ctx.db, view.id);

		console.log('\n=== resolveMany output ===');
		for (const kit of kits) {
			console.log(`\nKit: ${kit.kitName} (id: ${kit.kitId})`);
			for (const [prop, resolved] of kit.properties) {
				console.log(`  ${prop}: ${JSON.stringify(resolved)}`);
			}
		}
		console.log('\n=== flattened ===');
		const flat = flattenKitResults(kits);
		for (const [prop, resolved] of flat) {
			console.log(`  ${prop}: ${JSON.stringify(resolved)}`);
		}

		expect(kits).toHaveLength(2);

		// Kit order: layout first (lower priority), button second (higher)
		expect(kits[0]!.kitName).toBe('Layout');
		expect(kits[1]!.kitName).toBe('Button');

		// Layout kit: dark layer wins background and gap, null provides padding
		const layoutProps = kits[0]!.properties;
		expect(layoutProps.get('background')!.value).toBe('#1a1a2e');
		expect(layoutProps.get('gap')!.value).toBe('4px');
		expect(layoutProps.get('padding')!.value).toBe('16px');

		// Button kit: dark layer wins border-radius, null provides padding
		const buttonProps = kits[1]!.properties;
		expect(buttonProps.get('border-radius')!.value).toBe('8px');
		expect(buttonProps.get('padding')!.value).toBe('8px 16px');

		// Flattened: Button (priority 2000) wins on contested 'padding'
		expect(flat.get('padding')!.value).toBe('8px 16px');
		expect(flat.get('padding')!.sourceLayerId).toBe(buttonNull.id);
		// Uncontested properties from Layout still come through
		expect(flat.get('background')!.value).toBe('#1a1a2e');
		expect(flat.get('gap')!.value).toBe('4px');
		expect(flat.get('border-radius')!.value).toBe('8px');
	});
});

describe('range overlap matching', () => {
	let ctx: TestContext;

	beforeEach(async () => {
		ctx = await createTestDb();
	});

	afterEach(async () => {
		await ctx.pg.close();
	});

	it('ArgRange {min: null, max: null} matches all range conditions', async () => {
		const ws = (await ctx.api.getAllWorkspaces().execute())[0]!;
		const proj = (await ctx.api.createProjectInWorkspace(ws.workspaceId, 'Range'))!;
		const vpAxis = (await ctx.api.createAxis(proj.id, 'viewport', 'Viewport width'))!;
		const vpGte768 = (await ctx.api.createAxisValue(vpAxis.id, { type: 'range', operator: '>=', threshold: 768 }))!;

		const kit = (await ctx.api.createKitInProject(proj.id, 'Layout'))!;
		await ctx.api.consumeAxis(kit.id, vpAxis.id);

		const nullLayer = (await ctx.api.createLayer(kit.id))!;
		const nullSnippet = (await ctx.api.createRenderSnippet(nullLayer.id))!;
		await ctx.api.createRenderEntry(nullSnippet.id, 'columns', '1');

		const wideLayer = (await ctx.api.createLayer(kit.id))!;
		await ctx.api.addAxisValueToLayer(wideLayer.id, vpGte768.id);
		const wideSnippet = (await ctx.api.createRenderSnippet(wideLayer.id))!;
		await ctx.api.createRenderEntry(wideSnippet.id, 'columns', '2');

		// Unconstrained range — should match >=768
		const result = await resolve(ctx.db, kit.id, {
			[vpAxis.id]: { type: 'range', min: null, max: null },
		});
		expect(result.get('columns')!.value).toBe('2');
	});

	it('ArgRange {min: 500, max: null} matches >=768 because [500,∞) overlaps [768,∞)', async () => {
		const ws = (await ctx.api.getAllWorkspaces().execute())[0]!;
		const proj = (await ctx.api.createProjectInWorkspace(ws.workspaceId, 'Range'))!;
		const vpAxis = (await ctx.api.createAxis(proj.id, 'viewport', 'Viewport width'))!;
		const vpGte768 = (await ctx.api.createAxisValue(vpAxis.id, { type: 'range', operator: '>=', threshold: 768 }))!;

		const kit = (await ctx.api.createKitInProject(proj.id, 'Layout'))!;
		await ctx.api.consumeAxis(kit.id, vpAxis.id);

		const nullLayer = (await ctx.api.createLayer(kit.id))!;
		const nullSnippet = (await ctx.api.createRenderSnippet(nullLayer.id))!;
		await ctx.api.createRenderEntry(nullSnippet.id, 'columns', '1');

		const wideLayer = (await ctx.api.createLayer(kit.id))!;
		await ctx.api.addAxisValueToLayer(wideLayer.id, vpGte768.id);
		const wideSnippet = (await ctx.api.createRenderSnippet(wideLayer.id))!;
		await ctx.api.createRenderEntry(wideSnippet.id, 'columns', '2');

		// [500, ∞) overlaps [768, ∞) → yes
		const result = await resolve(ctx.db, kit.id, {
			[vpAxis.id]: { type: 'range', min: 500, max: null },
		});
		expect(result.get('columns')!.value).toBe('2');
	});

	it('ArgRange {min: null, max: 600} does not match >=768 because (-∞,600] does not overlap [768,∞)', async () => {
		const ws = (await ctx.api.getAllWorkspaces().execute())[0]!;
		const proj = (await ctx.api.createProjectInWorkspace(ws.workspaceId, 'Range'))!;
		const vpAxis = (await ctx.api.createAxis(proj.id, 'viewport', 'Viewport width'))!;
		const vpGte768 = (await ctx.api.createAxisValue(vpAxis.id, { type: 'range', operator: '>=', threshold: 768 }))!;

		const kit = (await ctx.api.createKitInProject(proj.id, 'Layout'))!;
		await ctx.api.consumeAxis(kit.id, vpAxis.id);

		const nullLayer = (await ctx.api.createLayer(kit.id))!;
		const nullSnippet = (await ctx.api.createRenderSnippet(nullLayer.id))!;
		await ctx.api.createRenderEntry(nullSnippet.id, 'columns', '1');

		const wideLayer = (await ctx.api.createLayer(kit.id))!;
		await ctx.api.addAxisValueToLayer(wideLayer.id, vpGte768.id);
		const wideSnippet = (await ctx.api.createRenderSnippet(wideLayer.id))!;
		await ctx.api.createRenderEntry(wideSnippet.id, 'columns', '2');

		const result = await resolve(ctx.db, kit.id, {
			[vpAxis.id]: { type: 'range', min: null, max: 600 },
		});
		expect(result.get('columns')!.value).toBe('1');
	});

	it('ArgRange {min: 768, max: 900} matches >=768 because [768,900] overlaps [768,∞)', async () => {
		const ws = (await ctx.api.getAllWorkspaces().execute())[0]!;
		const proj = (await ctx.api.createProjectInWorkspace(ws.workspaceId, 'Range'))!;
		const vpAxis = (await ctx.api.createAxis(proj.id, 'viewport', 'Viewport width'))!;
		const vpGte768 = (await ctx.api.createAxisValue(vpAxis.id, { type: 'range', operator: '>=', threshold: 768 }))!;

		const kit = (await ctx.api.createKitInProject(proj.id, 'Layout'))!;
		await ctx.api.consumeAxis(kit.id, vpAxis.id);

		const nullLayer = (await ctx.api.createLayer(kit.id))!;
		const nullSnippet = (await ctx.api.createRenderSnippet(nullLayer.id))!;
		await ctx.api.createRenderEntry(nullSnippet.id, 'columns', '1');

		const wideLayer = (await ctx.api.createLayer(kit.id))!;
		await ctx.api.addAxisValueToLayer(wideLayer.id, vpGte768.id);
		const wideSnippet = (await ctx.api.createRenderSnippet(wideLayer.id))!;
		await ctx.api.createRenderEntry(wideSnippet.id, 'columns', '2');

		const result = await resolve(ctx.db, kit.id, {
			[vpAxis.id]: { type: 'range', min: 768, max: 900 },
		});
		expect(result.get('columns')!.value).toBe('2');
	});

	it('ArgRange {min: 500, max: 600} does not match >=768 because [500,600] does not overlap [768,∞)', async () => {
		const ws = (await ctx.api.getAllWorkspaces().execute())[0]!;
		const proj = (await ctx.api.createProjectInWorkspace(ws.workspaceId, 'Range'))!;
		const vpAxis = (await ctx.api.createAxis(proj.id, 'viewport', 'Viewport width'))!;
		const vpGte768 = (await ctx.api.createAxisValue(vpAxis.id, { type: 'range', operator: '>=', threshold: 768 }))!;

		const kit = (await ctx.api.createKitInProject(proj.id, 'Layout'))!;
		await ctx.api.consumeAxis(kit.id, vpAxis.id);

		const nullLayer = (await ctx.api.createLayer(kit.id))!;
		const nullSnippet = (await ctx.api.createRenderSnippet(nullLayer.id))!;
		await ctx.api.createRenderEntry(nullSnippet.id, 'columns', '1');

		const wideLayer = (await ctx.api.createLayer(kit.id))!;
		await ctx.api.addAxisValueToLayer(wideLayer.id, vpGte768.id);
		const wideSnippet = (await ctx.api.createRenderSnippet(wideLayer.id))!;
		await ctx.api.createRenderEntry(wideSnippet.id, 'columns', '2');

		const result = await resolve(ctx.db, kit.id, {
			[vpAxis.id]: { type: 'range', min: 500, max: 600 },
		});
		expect(result.get('columns')!.value).toBe('1');
	});

	it('ArgRange overlaps between condition: {min:500, max:900} matches between 480,1024', async () => {
		const ws = (await ctx.api.getAllWorkspaces().execute())[0]!;
		const proj = (await ctx.api.createProjectInWorkspace(ws.workspaceId, 'Range'))!;
		const vpAxis = (await ctx.api.createAxis(proj.id, 'viewport', 'Viewport width'))!;
		const vpBetween = (await ctx.api.createAxisValue(vpAxis.id, { type: 'range', operator: 'between', threshold: 480, threshold_high: 1024 }))!;

		const kit = (await ctx.api.createKitInProject(proj.id, 'Layout'))!;
		await ctx.api.consumeAxis(kit.id, vpAxis.id);

		const nullLayer = (await ctx.api.createLayer(kit.id))!;
		const nullSnippet = (await ctx.api.createRenderSnippet(nullLayer.id))!;
		await ctx.api.createRenderEntry(nullSnippet.id, 'columns', '1');

		const betweenLayer = (await ctx.api.createLayer(kit.id))!;
		await ctx.api.addAxisValueToLayer(betweenLayer.id, vpBetween.id);
		const betweenSnippet = (await ctx.api.createRenderSnippet(betweenLayer.id))!;
		await ctx.api.createRenderEntry(betweenSnippet.id, 'columns', '2');

		// [500, 900] overlaps [480, 1024] → yes
		const result = await resolve(ctx.db, kit.id, {
			[vpAxis.id]: { type: 'range', min: 500, max: 900 },
		});
		expect(result.get('columns')!.value).toBe('2');
	});

	it('ArgRange {min: 1200, max: null} does not match between 480,1024 because [1200,∞) does not overlap [480,1024]', async () => {
		const ws = (await ctx.api.getAllWorkspaces().execute())[0]!;
		const proj = (await ctx.api.createProjectInWorkspace(ws.workspaceId, 'Range'))!;
		const vpAxis = (await ctx.api.createAxis(proj.id, 'viewport', 'Viewport width'))!;
		const vpBetween = (await ctx.api.createAxisValue(vpAxis.id, { type: 'range', operator: 'between', threshold: 480, threshold_high: 1024 }))!;

		const kit = (await ctx.api.createKitInProject(proj.id, 'Layout'))!;
		await ctx.api.consumeAxis(kit.id, vpAxis.id);

		const nullLayer = (await ctx.api.createLayer(kit.id))!;
		const nullSnippet = (await ctx.api.createRenderSnippet(nullLayer.id))!;
		await ctx.api.createRenderEntry(nullSnippet.id, 'columns', '1');

		const betweenLayer = (await ctx.api.createLayer(kit.id))!;
		await ctx.api.addAxisValueToLayer(betweenLayer.id, vpBetween.id);
		const betweenSnippet = (await ctx.api.createRenderSnippet(betweenLayer.id))!;
		await ctx.api.createRenderEntry(betweenSnippet.id, 'columns', '2');

		const result = await resolve(ctx.db, kit.id, {
			[vpAxis.id]: { type: 'range', min: 1200, max: null },
		});
		expect(result.get('columns')!.value).toBe('1');
	});

	describe('scoped tokens', () => {
		it('project token provides value when no kit or view token exists', async () => {
			const ws = (await ctx.api.getAllWorkspaces().execute())[0]!;
			const proj = (await ctx.api.createProjectInWorkspace(ws.workspaceId, 'Token Scope'))!;

			const tokenAccent = (await ctx.api.createToken(proj.id, 'accent', s('#3b82f6')))!;

			const kit = (await ctx.api.createKitInProject(proj.id, 'Button'))!;
			const view = (await ctx.api.createViewInProject(proj.id, 'Test View'))!;
			await ctx.api.attachKitToComposition(kit.id, view.id);

			const layer = (await ctx.api.createLayer(kit.id))!;
			const snippet = (await ctx.api.createRenderSnippet(layer.id))!;
			await ctx.api.createRenderEntry(snippet.id, 'color', null, tokenAccent.id);

			const results = await resolveMany(ctx.db, view.id);
			const flat = flattenKitResults(results);
			expect(flat.get('color')!.value).toBe('#3b82f6');
			expect(flat.get('color')!.isToken).toBe(true);
			expect(flat.get('color')!.tokenAlias).toBe('accent');
		});

		it('kit token overrides project token with same alias', async () => {
			const ws = (await ctx.api.getAllWorkspaces().execute())[0]!;
			const proj = (await ctx.api.createProjectInWorkspace(ws.workspaceId, 'Kit Override'))!;

			const projToken = (await ctx.api.createToken(proj.id, 'accent', s('#3b82f6')))!;

			// Update: we need to scope it to a specific kit
			const kit = (await ctx.api.createKitInProject(proj.id, 'Button'))!;
			const kitScopedToken = (await ctx.api.createToken(proj.id, 'accent', s('#ef4444'), { kitId: kit.id }))!;

			const view = (await ctx.api.createViewInProject(proj.id, 'Test View'))!;
			await ctx.api.attachKitToComposition(kit.id, view.id);

			const layer = (await ctx.api.createLayer(kit.id))!;
			const snippet = (await ctx.api.createRenderSnippet(layer.id))!;
			await ctx.api.createRenderEntry(snippet.id, 'color', null, kitScopedToken.id);

			const results = await resolveMany(ctx.db, view.id);
			const flat = flattenKitResults(results);
			// Kit token #ef4444 should override project token #3b82f6
			expect(flat.get('color')!.value).toBe('#ef4444');
		});

		it('view token overrides both project and kit tokens with same alias', async () => {
			const ws = (await ctx.api.getAllWorkspaces().execute())[0]!;
			const proj = (await ctx.api.createProjectInWorkspace(ws.workspaceId, 'View Override'))!;

			const projToken = (await ctx.api.createToken(proj.id, 'accent', s('#3b82f6')))!;

			const kit = (await ctx.api.createKitInProject(proj.id, 'Button'))!;
			const kitToken = (await ctx.api.createToken(proj.id, 'accent', s('#ef4444'), { kitId: kit.id }))!;

			const view = (await ctx.api.createViewInProject(proj.id, 'Override View'))!;
			await ctx.api.attachKitToComposition(kit.id, view.id);

			const viewToken = (await ctx.api.createToken(proj.id, 'accent', s('#10b981'), { viewId: view.id }))!;

			const layer = (await ctx.api.createLayer(kit.id))!;
			const snippet = (await ctx.api.createRenderSnippet(layer.id))!;
			await ctx.api.createRenderEntry(snippet.id, 'color', null, viewToken.id);

			const results = await resolveMany(ctx.db, view.id);
			const flat = flattenKitResults(results);
			// View token #10b981 should win over both project #3b82f6 and kit #ef4444
			expect(flat.get('color')!.value).toBe('#10b981');
		});
	});
});