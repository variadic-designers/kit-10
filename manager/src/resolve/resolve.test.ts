import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFile } from 'node:fs/promises';
import { createTestDb, type TestContext } from '../test-helpers.js';
import {
	resolve,
	resolveManySlowPath,
	resolveManyViews,
	resolveViewsFromRows,
	fetchResolutionRows,
	flattenKitResults,
	type ResolvedKit,
	type ResolvedProperty
} from './resolve.js';
import type { TokenValue } from '../schema.js';

const s = (value: string): TokenValue => ({ type: 'scalar', value });

// Inserts one `view`-typed token row directly (bypassing the API's auto-incrementing addViewRef)
// so tests can control `priority_index` explicitly, to exercise aggregation ORDER -- something a
// single view-list token's array used to give for free, that N independent rows now need an
// explicit ordering column for.
async function insertViewToken(
	ctx: TestContext,
	projectId: string,
	alias: string,
	viewId: string,
	priorityIndex: number,
	scope?: { kitId?: string; viewId?: string }
): Promise<string> {
	const row = await ctx.db
		.insertInto('tokens')
		.values({
			project_id: projectId,
			alias: null,
			composition_alias: alias,
			value: { type: 'view', view_id: viewId } as any,
			kit_id: scope?.kitId ?? null,
			view_id: scope?.viewId ?? null,
			priority_index: priorityIndex
		})
		.returning('id')
		.executeTakeFirstOrThrow();
	return row.id;
}

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

		const themeAxis = (await ctx.api.createAxis(
			proj.id,
			'theme',
			'Light or dark mode',
			'categorical',
			['light', 'dark']
		))!;
		const densityAxis = (await ctx.api.createAxis(
			proj.id,
			'density',
			'Spacing density',
			'categorical',
			['compact', 'comfortable']
		))!;

		const themeLight = (await ctx.api.createAxisValue(themeAxis.id, {
			type: 'literal',
			value: 'light'
		}))!;
		const themeDark = (await ctx.api.createAxisValue(themeAxis.id, {
			type: 'literal',
			value: 'dark'
		}))!;
		const densityCompact = (await ctx.api.createAxisValue(densityAxis.id, {
			type: 'literal',
			value: 'compact'
		}))!;
		const densityComfortable = (await ctx.api.createAxisValue(densityAxis.id, {
			type: 'literal',
			value: 'comfortable'
		}))!;

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
			proj,
			kit,
			themeAxis,
			densityAxis,
			themeLight,
			themeDark,
			densityCompact,
			densityComfortable,
			tokenBg,
			tokenPrimary,
			nullLayer,
			darkLayer,
			darkCompactLayer,
			compactLayer
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
			tokenId: s.tokenBg.id,
			conditionCount: 0,
			keys: [],
			conditionValues: [],
			viewRefs: null
		});
		expect(result.get('color')).toEqual({
			property: 'color',
			value: '#333333',
			sourceLayerId: s.nullLayer.id,
			kitId: s.kit.id,
			isToken: false,
			tokenAlias: null,
			tokenId: null,
			conditionCount: 0,
			keys: [],
			conditionValues: [],
			viewRefs: null
		});
		expect(result.get('padding')).toEqual({
			property: 'padding',
			value: '16px',
			sourceLayerId: s.nullLayer.id,
			kitId: s.kit.id,
			isToken: false,
			tokenAlias: null,
			tokenId: null,
			conditionCount: 0,
			keys: [],
			conditionValues: [],
			viewRefs: null
		});
	});

	it('resolves single-axis layer when theme=dark', async () => {
		const s = await seedButtonKit();

		const result = await resolve(ctx.db, s.kit.id, {
			[s.themeAxis.id]: { type: 'literal', value: 'dark' }
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
			[s.densityAxis.id]: { type: 'literal', value: 'compact' }
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

		// Set only density=compact - no theme layer matches
		const result = await resolve(ctx.db, s.kit.id, {
			[s.densityAxis.id]: { type: 'literal', value: 'compact' }
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
			[s.densityAxis.id]: { type: 'literal', value: 'compact' }
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
		// So they merge orthogonally - no contest.
		// Now test with both matching: theme=dark, density=compact
		// darkCompactLayer (2 conditions) wins on padding over compactLayer (1 condition)
		// and over darkLayer (1 condition) on background and color.
		const result = await resolve(ctx.db, s.kit.id, {
			[s.themeAxis.id]: { type: 'literal', value: 'dark' },
			[s.densityAxis.id]: { type: 'literal', value: 'compact' }
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
		const vpGte1024 = (await ctx.api.createAxisValue(vpAxis.id, {
			type: 'range',
			operator: '>=',
			threshold: 1024
		}))!;
		const vpGte768 = (await ctx.api.createAxisValue(vpAxis.id, {
			type: 'range',
			operator: '>=',
			threshold: 768
		}))!;

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
			[vpAxis.id]: { type: 'literal', value: '500' }
		});
		expect(resultNarrow.get('columns')!.value).toBe('1');
		expect(resultNarrow.get('sidebar')!.value).toBe('hidden');

		// viewport = 900 → only >=768 matches
		const resultMed = await resolve(ctx.db, kit.id, {
			[vpAxis.id]: { type: 'literal', value: '900' }
		});
		expect(resultMed.get('columns')!.value).toBe('2');
		expect(resultMed.get('sidebar')!.value).toBe('visible');

		// viewport = 1200 → both >=768 and >=1024 match.
		// Both are 1-condition layers on the same axis (same specificity).
		// For overlapping ranges on the same axis, layers that declare contested
		// properties are resolved in creation order. wideLayer overtakes mediumLayer
		// on 'columns' because it was created after and overwrites in order.
		// 'sidebar' is uncontested - inherited from mediumLayer.
		const resultWide = await resolve(ctx.db, kit.id, {
			[vpAxis.id]: { type: 'literal', value: '1200' }
		});
		expect(resultWide.get('sidebar')!.value).toBe('visible');
	});
});

describe('resolveManySlowPath', () => {
	let ctx: TestContext;

	beforeEach(async () => {
		ctx = await createTestDb();
	});

	afterEach(async () => {
		await ctx.pg.close();
	});

	it('resolves view with two kits - lower-priority kit fills gaps, higher-priority kit wins contested properties', async () => {
		const ws = (await ctx.api.getAllWorkspaces().execute())[0]!;
		const proj = (await ctx.api.createProjectInWorkspace(ws.workspaceId, 'Multi-Kit'))!;

		const themeAxis = (await ctx.api.createAxis(proj.id, 'theme', 'Light or dark'))!;
		const themeDark = (await ctx.api.createAxisValue(themeAxis.id, {
			type: 'literal',
			value: 'dark'
		}))!;

		// Layout kit (lower priority) - provides structure
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

		// Button kit (higher priority) - provides component styling
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
		await ctx.api.attachKitToComposition(layoutKit.id, view.id); // priority 1000
		await ctx.api.attachKitToComposition(buttonKit.id, view.id); // priority 2000
		await ctx.api.setAxisArg(view.id, layoutKit.id, themeAxis.id, {
			type: 'literal',
			value: 'dark'
		});
		await ctx.api.setAxisArg(view.id, buttonKit.id, themeAxis.id, {
			type: 'literal',
			value: 'dark'
		});

		const kits = await resolveManySlowPath(ctx.db, view.id);

		console.log('\n=== resolveManySlowPath output ===');
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

	it('a lower-priority kit\'s conditioned layer beats a higher-priority kit\'s unconditioned one for the same property', async () => {
		const ws = (await ctx.api.getAllWorkspaces().execute())[0]!;
		const proj = (await ctx.api.createProjectInWorkspace(ws.workspaceId, 'Specificity Across Kits'))!;

		const themeAxis = (await ctx.api.createAxis(proj.id, 'theme', 'Light or dark'))!;
		const themeDark = (await ctx.api.createAxisValue(themeAxis.id, {
			type: 'literal',
			value: 'dark'
		}))!;

		// Base kit (higher priority, composed second) -- sets 'background' unconditionally.
		const baseKit = (await ctx.api.createKitInProject(proj.id, 'Base'))!;
		const baseNull = (await ctx.api.createLayer(baseKit.id))!;
		const baseNullSnip = (await ctx.api.createRenderSnippet(baseNull.id))!;
		await ctx.api.createRenderEntry(baseNullSnip.id, 'background', '#ffffff');

		// Variant kit (lower priority, composed first) -- sets 'background' only when theme=dark.
		const variantKit = (await ctx.api.createKitInProject(proj.id, 'Variant'))!;
		await ctx.api.consumeAxis(variantKit.id, themeAxis.id);
		const variantDarkLayer = (await ctx.api.createLayer(variantKit.id))!;
		await ctx.api.addAxisValueToLayer(variantDarkLayer.id, themeDark.id);
		const variantDarkSnip = (await ctx.api.createRenderSnippet(variantDarkLayer.id))!;
		await ctx.api.createRenderEntry(variantDarkSnip.id, 'background', '#1a1a2e');

		const view = (await ctx.api.createViewInProject(proj.id, 'Page'))!;
		await ctx.api.attachKitToComposition(variantKit.id, view.id); // priority 1000 (lower)
		await ctx.api.attachKitToComposition(baseKit.id, view.id); // priority 2000 (higher/top)
		await ctx.api.setAxisArg(view.id, variantKit.id, themeAxis.id, {
			type: 'literal',
			value: 'dark'
		});

		const kits = await resolveManySlowPath(ctx.db, view.id);
		const flat = flattenKitResults(kits);

		// Variant's 1-condition layer (conditionCount 1) outranks Base's 0-condition null layer,
		// even though Base is the higher-priority (top) kit -- this is the exact bug reported: a
		// property painted onto a non-top kit used to be permanently invisible whenever the top
		// kit defined that property at all, regardless of how much more specific the lower kit's
		// layer was.
		expect(flat.get('background')!.value).toBe('#1a1a2e');
		expect(flat.get('background')!.kitId).toBe(variantKit.id);

		// Once Base ALSO conditions on theme=dark (equal specificity, both conditionCount 1), kit
		// order breaks the tie and the higher-priority kit wins again -- unchanged from before.
		const baseDarkLayer = (await ctx.api.createLayer(baseKit.id))!;
		await ctx.api.addAxisValueToLayer(baseDarkLayer.id, themeDark.id);
		const baseDarkSnip = (await ctx.api.createRenderSnippet(baseDarkLayer.id))!;
		await ctx.api.createRenderEntry(baseDarkSnip.id, 'background', '#000000');
		await ctx.api.consumeAxis(baseKit.id, themeAxis.id);
		await ctx.api.setAxisArg(view.id, baseKit.id, themeAxis.id, { type: 'literal', value: 'dark' });

		const kits2 = await resolveManySlowPath(ctx.db, view.id);
		const flat2 = flattenKitResults(kits2);
		expect(flat2.get('background')!.value).toBe('#000000');
		expect(flat2.get('background')!.kitId).toBe(baseKit.id);
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
		const vpGte768 = (await ctx.api.createAxisValue(vpAxis.id, {
			type: 'range',
			operator: '>=',
			threshold: 768
		}))!;

		const kit = (await ctx.api.createKitInProject(proj.id, 'Layout'))!;
		await ctx.api.consumeAxis(kit.id, vpAxis.id);

		const nullLayer = (await ctx.api.createLayer(kit.id))!;
		const nullSnippet = (await ctx.api.createRenderSnippet(nullLayer.id))!;
		await ctx.api.createRenderEntry(nullSnippet.id, 'columns', '1');

		const wideLayer = (await ctx.api.createLayer(kit.id))!;
		await ctx.api.addAxisValueToLayer(wideLayer.id, vpGte768.id);
		const wideSnippet = (await ctx.api.createRenderSnippet(wideLayer.id))!;
		await ctx.api.createRenderEntry(wideSnippet.id, 'columns', '2');

		// Unconstrained range - should match >=768
		const result = await resolve(ctx.db, kit.id, {
			[vpAxis.id]: { type: 'range', min: null, max: null }
		});
		expect(result.get('columns')!.value).toBe('2');
	});

	it('ArgRange {min: 500, max: null} matches >=768 because [500,∞) overlaps [768,∞)', async () => {
		const ws = (await ctx.api.getAllWorkspaces().execute())[0]!;
		const proj = (await ctx.api.createProjectInWorkspace(ws.workspaceId, 'Range'))!;
		const vpAxis = (await ctx.api.createAxis(proj.id, 'viewport', 'Viewport width'))!;
		const vpGte768 = (await ctx.api.createAxisValue(vpAxis.id, {
			type: 'range',
			operator: '>=',
			threshold: 768
		}))!;

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
			[vpAxis.id]: { type: 'range', min: 500, max: null }
		});
		expect(result.get('columns')!.value).toBe('2');
	});

	it('ArgRange {min: null, max: 600} does not match >=768 because (-∞,600] does not overlap [768,∞)', async () => {
		const ws = (await ctx.api.getAllWorkspaces().execute())[0]!;
		const proj = (await ctx.api.createProjectInWorkspace(ws.workspaceId, 'Range'))!;
		const vpAxis = (await ctx.api.createAxis(proj.id, 'viewport', 'Viewport width'))!;
		const vpGte768 = (await ctx.api.createAxisValue(vpAxis.id, {
			type: 'range',
			operator: '>=',
			threshold: 768
		}))!;

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
			[vpAxis.id]: { type: 'range', min: null, max: 600 }
		});
		expect(result.get('columns')!.value).toBe('1');
	});

	it('ArgRange {min: 768, max: 900} matches >=768 because [768,900] overlaps [768,∞)', async () => {
		const ws = (await ctx.api.getAllWorkspaces().execute())[0]!;
		const proj = (await ctx.api.createProjectInWorkspace(ws.workspaceId, 'Range'))!;
		const vpAxis = (await ctx.api.createAxis(proj.id, 'viewport', 'Viewport width'))!;
		const vpGte768 = (await ctx.api.createAxisValue(vpAxis.id, {
			type: 'range',
			operator: '>=',
			threshold: 768
		}))!;

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
			[vpAxis.id]: { type: 'range', min: 768, max: 900 }
		});
		expect(result.get('columns')!.value).toBe('2');
	});

	it('ArgRange {min: 500, max: 600} does not match >=768 because [500,600] does not overlap [768,∞)', async () => {
		const ws = (await ctx.api.getAllWorkspaces().execute())[0]!;
		const proj = (await ctx.api.createProjectInWorkspace(ws.workspaceId, 'Range'))!;
		const vpAxis = (await ctx.api.createAxis(proj.id, 'viewport', 'Viewport width'))!;
		const vpGte768 = (await ctx.api.createAxisValue(vpAxis.id, {
			type: 'range',
			operator: '>=',
			threshold: 768
		}))!;

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
			[vpAxis.id]: { type: 'range', min: 500, max: 600 }
		});
		expect(result.get('columns')!.value).toBe('1');
	});

	it('ArgRange overlaps between condition: {min:500, max:900} matches between 480,1024', async () => {
		const ws = (await ctx.api.getAllWorkspaces().execute())[0]!;
		const proj = (await ctx.api.createProjectInWorkspace(ws.workspaceId, 'Range'))!;
		const vpAxis = (await ctx.api.createAxis(proj.id, 'viewport', 'Viewport width'))!;
		const vpBetween = (await ctx.api.createAxisValue(vpAxis.id, {
			type: 'range',
			operator: 'between',
			threshold: 480,
			threshold_high: 1024
		}))!;

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
			[vpAxis.id]: { type: 'range', min: 500, max: 900 }
		});
		expect(result.get('columns')!.value).toBe('2');
	});

	it('ArgRange {min: 1200, max: null} does not match between 480,1024 because [1200,∞) does not overlap [480,1024]', async () => {
		const ws = (await ctx.api.getAllWorkspaces().execute())[0]!;
		const proj = (await ctx.api.createProjectInWorkspace(ws.workspaceId, 'Range'))!;
		const vpAxis = (await ctx.api.createAxis(proj.id, 'viewport', 'Viewport width'))!;
		const vpBetween = (await ctx.api.createAxisValue(vpAxis.id, {
			type: 'range',
			operator: 'between',
			threshold: 480,
			threshold_high: 1024
		}))!;

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
			[vpAxis.id]: { type: 'range', min: 1200, max: null }
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

			const results = await resolveManySlowPath(ctx.db, view.id);
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
			const kitScopedToken = (await ctx.api.createToken(proj.id, 'accent', s('#ef4444'), {
				kitId: kit.id
			}))!;

			const view = (await ctx.api.createViewInProject(proj.id, 'Test View'))!;
			await ctx.api.attachKitToComposition(kit.id, view.id);

			const layer = (await ctx.api.createLayer(kit.id))!;
			const snippet = (await ctx.api.createRenderSnippet(layer.id))!;
			await ctx.api.createRenderEntry(snippet.id, 'color', null, kitScopedToken.id);

			const results = await resolveManySlowPath(ctx.db, view.id);
			const flat = flattenKitResults(results);
			// Kit token #ef4444 should override project token #3b82f6
			expect(flat.get('color')!.value).toBe('#ef4444');
		});

		it('a kit-scoped token with a layered override resolves to the override under matching axis_args, and to its base value otherwise', async () => {
			const ws = (await ctx.api.getAllWorkspaces().execute())[0]!;
			const proj = (await ctx.api.createProjectInWorkspace(ws.workspaceId, 'Token Layer Values'))!;

			const axis = (await ctx.api.createAxis(proj.id, 'theme'))!;
			const dark = (await ctx.api.createAxisValue(axis.id, { type: 'literal', value: 'dark' }))!;

			const kit = (await ctx.api.createKitInProject(proj.id, 'Button'))!;
			await ctx.api.consumeAxis(kit.id, axis.id);
			const kitToken = (await ctx.api.createToken(proj.id, 'accent', s('#3b82f6'), { kitId: kit.id }))!;

			const layer = (await ctx.api.createLayer(kit.id))!;
			const snippet = (await ctx.api.createRenderSnippet(layer.id))!;
			await ctx.api.createRenderEntry(snippet.id, 'color', null, kitToken.id);

			const { layerId } = (await ctx.api.paintTokenValue(kitToken.id, kit.id, [dark.id], s('#ef4444')))!;

			const lightView = (await ctx.api.createViewInProject(proj.id, 'Light'))!;
			await ctx.api.attachKitToComposition(kit.id, lightView.id);
			const darkView = (await ctx.api.createViewInProject(proj.id, 'Dark'))!;
			await ctx.api.attachKitToComposition(kit.id, darkView.id);
			await ctx.api.setAxisArg(darkView.id, kit.id, axis.id, { type: 'literal', value: 'dark' });

			// Slow path
			const lightResults = await resolveManySlowPath(ctx.db, lightView.id);
			expect(flattenKitResults(lightResults).get('color')!.value).toBe('#3b82f6');
			const darkResults = await resolveManySlowPath(ctx.db, darkView.id);
			expect(flattenKitResults(darkResults).get('color')!.value).toBe('#ef4444');

			// Batched path
			const views = await resolveManyViews(ctx.db, proj.id);
			const lightBatched = flattenKitResults(views.find((v) => v.viewId === lightView.id)!.resolvedKits);
			const darkBatched = flattenKitResults(views.find((v) => v.viewId === darkView.id)!.resolvedKits);
			expect(lightBatched.get('color')!.value).toBe('#3b82f6');
			expect(darkBatched.get('color')!.value).toBe('#ef4444');

			// Removing the override reverts both views' resolution back to the base value.
			await ctx.api.deleteTokenLayerValue(kitToken.id, layerId);
			const afterDelete = await resolveManySlowPath(ctx.db, darkView.id);
			expect(flattenKitResults(afterDelete).get('color')!.value).toBe('#3b82f6');
		});

		it('view token overrides both project and kit tokens with same alias', async () => {
			const ws = (await ctx.api.getAllWorkspaces().execute())[0]!;
			const proj = (await ctx.api.createProjectInWorkspace(ws.workspaceId, 'View Override'))!;

			const projToken = (await ctx.api.createToken(proj.id, 'accent', s('#3b82f6')))!;

			const kit = (await ctx.api.createKitInProject(proj.id, 'Button'))!;
			const kitToken = (await ctx.api.createToken(proj.id, 'accent', s('#ef4444'), {
				kitId: kit.id
			}))!;

			const view = (await ctx.api.createViewInProject(proj.id, 'Override View'))!;
			await ctx.api.attachKitToComposition(kit.id, view.id);

			const viewToken = (await ctx.api.createToken(proj.id, 'accent', s('#10b981'), {
				viewId: view.id
			}))!;

			const layer = (await ctx.api.createLayer(kit.id))!;
			const snippet = (await ctx.api.createRenderSnippet(layer.id))!;
			await ctx.api.createRenderEntry(snippet.id, 'color', null, viewToken.id);

			const results = await resolveManySlowPath(ctx.db, view.id);
			const flat = flattenKitResults(results);
			// View token #10b981 should win over both project #3b82f6 and kit #ef4444
			expect(flat.get('color')!.value).toBe('#10b981');
		});

		it('view-scope `view` token on children: wins over kit-scoped token, ignoring specificity', async () => {
			const ws = (await ctx.api.getAllWorkspaces().execute())[0]!;
			const proj = (await ctx.api.createProjectInWorkspace(
				ws.workspaceId,
				'Children Token Override'
			))!;

			const kit = (await ctx.api.createKitInProject(proj.id, 'Box'))!;
			const view = (await ctx.api.createViewInProject(proj.id, 'Parent View'))!;
			await ctx.api.attachKitToComposition(kit.id, view.id);

			const childA = (await ctx.api.createViewInProject(proj.id, 'Child A'))!;
			const childB = (await ctx.api.createViewInProject(proj.id, 'Child B'))!;

			const kitTokenId = await insertViewToken(ctx, proj.id, 'kids', childA.id, 0, {
				kitId: kit.id
			});
			const viewTokenId = await insertViewToken(ctx, proj.id, 'kids', childB.id, 0, {
				viewId: view.id
			});

			// Kit-scoped layer has 0 conditions (highest possible resolve-pass-1 specificity here);
			// the view-scoped token must still win in pass 2 regardless.
			const layer = (await ctx.api.createLayer(kit.id))!;
			const snippet = (await ctx.api.createRenderSnippet(layer.id))!;
			await ctx.api.createRenderEntry(snippet.id, 'children', null, kitTokenId);

			const results = await resolveManySlowPath(ctx.db, view.id);
			const flat = flattenKitResults(results);
			expect(flat.get('children')!.viewRefs).toEqual([{ viewId: childB.id, tokenId: viewTokenId }]);
			expect(viewTokenId).not.toBe(kitTokenId);
		});

		it('self-declaring view-scope children: a view-scope `children` token defines children with no render entry', async () => {
			const ws = (await ctx.api.getAllWorkspaces().execute())[0]!;
			const proj = (await ctx.api.createProjectInWorkspace(ws.workspaceId, 'Self-declaring'))!;

			const kit = (await ctx.api.createKitInProject(proj.id, 'Box'))!;
			const parent = (await ctx.api.createViewInProject(proj.id, 'Parent'))!;
			await ctx.api.attachKitToComposition(kit.id, parent.id);
			const child = (await ctx.api.createViewInProject(proj.id, 'Child'))!;

			// A view-scope `view` token, and NOTHING else -- no render entry declares this property
			// on any layer. The view token alone must produce a property carrying its refs.
			// Name-neutral: use an arbitrary alias, not "children", to prove the resolver reads no
			// meaning into the name (the composition opinion lives in the plugin/editor, not here).
			const { id: tokenId } = await ctx.api.addViewRef(proj.id, parent.id, 'slots', child.id);

			const views = await resolveManyViews(ctx.db, proj.id);
			const resolvedParent = views.find((v) => v.viewId === parent.id)!;
			const flat = flattenKitResults(resolvedParent.resolvedKits);
			expect(flat.get('slots')?.viewRefs).toEqual([{ viewId: child.id, tokenId }]);
		});

		it('a kit-scope `children` token does NOT self-declare (no forcing children onto every view)', async () => {
			const ws = (await ctx.api.getAllWorkspaces().execute())[0]!;
			const proj = (await ctx.api.createProjectInWorkspace(ws.workspaceId, 'No kit self-declare'))!;

			const kit = (await ctx.api.createKitInProject(proj.id, 'Box'))!;
			const parent = (await ctx.api.createViewInProject(proj.id, 'Parent'))!;
			await ctx.api.attachKitToComposition(kit.id, parent.id);
			const child = (await ctx.api.createViewInProject(proj.id, 'Child'))!;

			// A kit-scope `view` token with no render entry must NOT materialize a property -- only a
			// view's own token self-declares. Otherwise every view composing the kit would be forced
			// to carry it.
			await ctx.api.createToken(proj.id, 'slots', { type: 'view', view_id: child.id }, { kitId: kit.id });

			const views = await resolveManyViews(ctx.db, proj.id);
			const resolvedParent = views.find((v) => v.viewId === parent.id)!;
			expect(resolvedParent.resolvedKits.flatMap((k) => [...k.properties.keys()])).not.toContain(
				'slots'
			);
		});

		it('aggregates multiple same-scope `view` tokens sharing an alias, in priority_index order', async () => {
			const ws = (await ctx.api.getAllWorkspaces().execute())[0]!;
			const proj = (await ctx.api.createProjectInWorkspace(ws.workspaceId, 'Aggregation Order'))!;

			const kit = (await ctx.api.createKitInProject(proj.id, 'Box'))!;
			const parent = (await ctx.api.createViewInProject(proj.id, 'Parent'))!;
			await ctx.api.attachKitToComposition(kit.id, parent.id);

			const childA = (await ctx.api.createViewInProject(proj.id, 'Child A'))!;
			const childB = (await ctx.api.createViewInProject(proj.id, 'Child B'))!;
			const childC = (await ctx.api.createViewInProject(proj.id, 'Child C'))!;

			// Inserted out of order (C, A, B) but with priority_index 2, 0, 1 -- resolved order must
			// follow priority_index, not insertion order.
			const tokC = await insertViewToken(ctx, proj.id, 'children', childC.id, 2, {
				viewId: parent.id
			});
			const tokA = await insertViewToken(ctx, proj.id, 'children', childA.id, 0, {
				viewId: parent.id
			});
			const tokB = await insertViewToken(ctx, proj.id, 'children', childB.id, 1, {
				viewId: parent.id
			});

			const views = await resolveManyViews(ctx.db, proj.id);
			const resolvedParent = views.find((v) => v.viewId === parent.id)!;
			const flat = flattenKitResults(resolvedParent.resolvedKits);
			expect(flat.get('children')?.viewRefs).toEqual([
				{ viewId: childA.id, tokenId: tokA },
				{ viewId: childB.id, tokenId: tokB },
				{ viewId: childC.id, tokenId: tokC }
			]);
		});

		it('a view-scope alias with multiple `view` tokens fully replaces a kit-scope alias with multiple tokens (no merge)', async () => {
			const ws = (await ctx.api.getAllWorkspaces().execute())[0]!;
			const proj = (await ctx.api.createProjectInWorkspace(ws.workspaceId, 'Scope Replace'))!;

			const kit = (await ctx.api.createKitInProject(proj.id, 'Box'))!;
			const parent = (await ctx.api.createViewInProject(proj.id, 'Parent'))!;
			await ctx.api.attachKitToComposition(kit.id, parent.id);

			const kitChildA = (await ctx.api.createViewInProject(proj.id, 'Kit Child A'))!;
			const kitChildB = (await ctx.api.createViewInProject(proj.id, 'Kit Child B'))!;
			await insertViewToken(ctx, proj.id, 'children', kitChildA.id, 0, { kitId: kit.id });
			await insertViewToken(ctx, proj.id, 'children', kitChildB.id, 1, { kitId: kit.id });

			const viewChild = (await ctx.api.createViewInProject(proj.id, 'View Child'))!;
			const viewTok = await insertViewToken(ctx, proj.id, 'children', viewChild.id, 0, {
				viewId: parent.id
			});

			const views = await resolveManyViews(ctx.db, proj.id);
			const resolvedParent = views.find((v) => v.viewId === parent.id)!;
			const flat = flattenKitResults(resolvedParent.resolvedKits);
			// The view-scope's single row fully replaces the kit-scope's two rows -- not a 3-item merge.
			expect(flat.get('children')?.viewRefs).toEqual([{ viewId: viewChild.id, tokenId: viewTok }]);
		});

		it('the same target view can be referenced twice under one alias (duplicate targets survive)', async () => {
			const ws = (await ctx.api.getAllWorkspaces().execute())[0]!;
			const proj = (await ctx.api.createProjectInWorkspace(ws.workspaceId, 'Duplicate Targets'))!;

			const kit = (await ctx.api.createKitInProject(proj.id, 'Box'))!;
			const parent = (await ctx.api.createViewInProject(proj.id, 'Parent'))!;
			await ctx.api.attachKitToComposition(kit.id, parent.id);
			const child = (await ctx.api.createViewInProject(proj.id, 'Child'))!;

			const { id: first } = await ctx.api.addViewRef(proj.id, parent.id, 'children', child.id);
			const { id: second } = await ctx.api.addViewRef(proj.id, parent.id, 'children', child.id);
			expect(first).not.toBe(second);

			const views = await resolveManyViews(ctx.db, proj.id);
			const resolvedParent = views.find((v) => v.viewId === parent.id)!;
			const flat = flattenKitResults(resolvedParent.resolvedKits);
			expect(flat.get('children')?.viewRefs).toEqual([
				{ viewId: child.id, tokenId: first },
				{ viewId: child.id, tokenId: second }
			]);
		});
	});

	describe('per-occurrence axis overrides (OverriddenOccurrence)', () => {
		it('a view-scalar token axis override changes which Layer matches for that occurrence, leaving the view\'s own resolution untouched', async () => {
			const ws = (await ctx.api.getAllWorkspaces().execute())[0]!;
			const proj = (await ctx.api.createProjectInWorkspace(ws.workspaceId, 'Axis Override'))!;

			const themeAxis = (await ctx.api.createAxis(proj.id, 'theme', '', 'categorical', [
				'light',
				'dark'
			]))!;
			const themeDark = (await ctx.api.createAxisValue(themeAxis.id, {
				type: 'literal',
				value: 'dark'
			}))!;

			const kit = (await ctx.api.createKitInProject(proj.id, 'Button'))!;
			await ctx.api.consumeAxis(kit.id, themeAxis.id);

			// Null layer: baseline color. {theme: dark} layer: overridden color.
			const nullLayer = (await ctx.api.createLayer(kit.id))!;
			const nullSnippet = (await ctx.api.createRenderSnippet(nullLayer.id))!;
			await ctx.api.createRenderEntry(nullSnippet.id, 'color', '#ffffff');

			const darkLayer = (await ctx.api.createLayer(kit.id))!;
			await ctx.api.addAxisValueToLayer(darkLayer.id, themeDark.id);
			const darkSnippet = (await ctx.api.createRenderSnippet(darkLayer.id))!;
			await ctx.api.createRenderEntry(darkSnippet.id, 'color', '#000000');

			// The target view never picks 'dark' itself (no axis_args row) -- its own resolution
			// should stay on the baseline color.
			const target = (await ctx.api.createViewInProject(proj.id, 'Target'))!;
			await ctx.api.attachKitToComposition(kit.id, target.id);

			const parent = (await ctx.api.createViewInProject(proj.id, 'Parent'))!;
			const { id: tokenId } = await ctx.api.addViewRef(proj.id, parent.id, 'children', target.id);
			await ctx.api.setTokenAxisOverride(tokenId, themeAxis.id, { type: 'literal', value: 'dark' });

			const rows = await fetchResolutionRows(ctx.db, proj.id);
			const { views, overriddenOccurrences } = resolveViewsFromRows(rows);

			// The view's own project-wide entry is untouched (still resolves to the baseline, since
			// it never set theme:dark itself).
			const targetView = views.find((v) => v.viewId === target.id)!;
			const targetFlat = flattenKitResults(targetView.resolvedKits);
			expect(targetFlat.get('color')?.value).toBe('#ffffff');

			// The occurrence reached via the overriding token resolves with theme:dark applied.
			expect(overriddenOccurrences).toHaveLength(1);
			const occurrence = overriddenOccurrences[0]!;
			expect(occurrence.occurrenceKey).toBe(tokenId);
			expect(occurrence.viewId).toBe(target.id);
			const occFlat = flattenKitResults(occurrence.resolvedKits);
			expect(occFlat.get('color')?.value).toBe('#000000');
		});

		it('a kit token whose layered override matches under the occurrence\'s merged args re-resolves for that occurrence only', async () => {
			// The occurrence path reuses the target view's token-substitution scope, which used to
			// mean the BASE-arg maps wholesale. Once kit tokens gained their own axis-conditioned
			// values (token_layer_values), that reuse was wrong: the occurrence's merged args change
			// which layered override matches, so its substituted token value must re-match too --
			// alias winners unchanged, only the layered VALUE differs.
			const ws = (await ctx.api.getAllWorkspaces().execute())[0]!;
			const proj = (await ctx.api.createProjectInWorkspace(ws.workspaceId, 'Occurrence Token Layer'))!;

			const themeAxis = (await ctx.api.createAxis(proj.id, 'theme', '', 'categorical', [
				'light',
				'dark'
			]))!;
			const themeDark = (await ctx.api.createAxisValue(themeAxis.id, {
				type: 'literal',
				value: 'dark'
			}))!;

			const kit = (await ctx.api.createKitInProject(proj.id, 'Button'))!;
			await ctx.api.consumeAxis(kit.id, themeAxis.id);

			// Kit token 'accent': base blue, layered override red on theme:dark.
			const accent = (await ctx.api.createToken(proj.id, 'accent', s('#3b82f6'), { kitId: kit.id }))!;
			await ctx.api.paintTokenValue(accent.id, kit.id, [themeDark.id], s('#ef4444'));

			// The kit's color entry references the kit token.
			const nullLayer = (await ctx.api.createLayer(kit.id))!;
			const nullSnippet = (await ctx.api.createRenderSnippet(nullLayer.id))!;
			await ctx.api.createRenderEntry(nullSnippet.id, 'color', null, accent.id);

			// The target view never picks dark itself -- its own resolution stays on the base value.
			const target = (await ctx.api.createViewInProject(proj.id, 'Target'))!;
			await ctx.api.attachKitToComposition(kit.id, target.id);

			const parent = (await ctx.api.createViewInProject(proj.id, 'Parent'))!;
			const { id: tokenId } = await ctx.api.addViewRef(proj.id, parent.id, 'children', target.id);
			await ctx.api.setTokenAxisOverride(tokenId, themeAxis.id, { type: 'literal', value: 'dark' });

			const rows = await fetchResolutionRows(ctx.db, proj.id);
			const { views, overriddenOccurrences } = resolveViewsFromRows(rows);

			const targetView = views.find((v) => v.viewId === target.id)!;
			expect(flattenKitResults(targetView.resolvedKits).get('color')?.value).toBe('#3b82f6');

			expect(overriddenOccurrences).toHaveLength(1);
			const occurrence = overriddenOccurrences[0]!;
			expect(occurrence.occurrenceKey).toBe(tokenId);
			// The occurrence's theme:dark merged args make the kit token's layered override match,
			// so the substituted color resolves to the override, not the base.
			expect(flattenKitResults(occurrence.resolvedKits).get('color')?.value).toBe('#ef4444');
		});

		it('a project with zero axis overrides anywhere produces an empty overriddenOccurrences array', async () => {
			const ws = (await ctx.api.getAllWorkspaces().execute())[0]!;
			const proj = (await ctx.api.createProjectInWorkspace(ws.workspaceId, 'No Overrides'))!;
			const kit = (await ctx.api.createKitInProject(proj.id, 'Box'))!;
			const view = (await ctx.api.createViewInProject(proj.id, 'View'))!;
			await ctx.api.attachKitToComposition(kit.id, view.id);

			const rows = await fetchResolutionRows(ctx.db, proj.id);
			const { overriddenOccurrences } = resolveViewsFromRows(rows);
			expect(overriddenOccurrences).toEqual([]);
		});

		// 'linked' overrides: instead of a static literal snapshot, the override tracks a SOURCE
		// (view, kit)'s own CURRENT axis_args live -- re-read fresh every resolve, never a copy.
		// Shared fixture: `source` is the (view, kit) pair the override tracks; `target` is the view
		// whose Layers get matched (null=baseline, dark, light -- three distinct outcomes so
		// "reverted to baseline" and "explicitly light" are never confusable); `linker` holds the
		// referencing token whose override points at `source`.
		describe("'linked' overrides track their source live", () => {
			async function setupLinkedOverrideFixture() {
				const ws = (await ctx.api.getAllWorkspaces().execute())[0]!;
				const proj = (await ctx.api.createProjectInWorkspace(ws.workspaceId, 'Linked Override'))!;

				const themeAxis = (await ctx.api.createAxis(proj.id, 'theme', '', 'categorical', [
					'light',
					'dark'
				]))!;
				const themeDark = (await ctx.api.createAxisValue(themeAxis.id, {
					type: 'literal',
					value: 'dark'
				}))!;
				const themeLight = (await ctx.api.createAxisValue(themeAxis.id, {
					type: 'literal',
					value: 'light'
				}))!;

				const kit = (await ctx.api.createKitInProject(proj.id, 'Button'))!;
				await ctx.api.consumeAxis(kit.id, themeAxis.id);

				const nullLayer = (await ctx.api.createLayer(kit.id))!;
				const nullSnippet = (await ctx.api.createRenderSnippet(nullLayer.id))!;
				await ctx.api.createRenderEntry(nullSnippet.id, 'color', '#ffffff');

				const darkLayer = (await ctx.api.createLayer(kit.id))!;
				await ctx.api.addAxisValueToLayer(darkLayer.id, themeDark.id);
				const darkSnippet = (await ctx.api.createRenderSnippet(darkLayer.id))!;
				await ctx.api.createRenderEntry(darkSnippet.id, 'color', '#000000');

				const lightLayer = (await ctx.api.createLayer(kit.id))!;
				await ctx.api.addAxisValueToLayer(lightLayer.id, themeLight.id);
				const lightSnippet = (await ctx.api.createRenderSnippet(lightLayer.id))!;
				await ctx.api.createRenderEntry(lightSnippet.id, 'color', '#cccccc');

				const source = (await ctx.api.createViewInProject(proj.id, 'Source'))!;
				await ctx.api.attachKitToComposition(kit.id, source.id);

				const target = (await ctx.api.createViewInProject(proj.id, 'Target'))!;
				await ctx.api.attachKitToComposition(kit.id, target.id);

				const linker = (await ctx.api.createViewInProject(proj.id, 'Linker'))!;
				const { id: tokenId } = await ctx.api.addViewRef(proj.id, linker.id, 'children', target.id);
				await ctx.api.setTokenAxisOverride(tokenId, themeAxis.id, {
					type: 'linked',
					view_id: source.id,
					kit_id: kit.id
				});

				return { proj, kit, themeAxis, source, target, linker, tokenId };
			}

			async function resolveOccurrenceColor(projId: string, tokenId: string) {
				const rows = await fetchResolutionRows(ctx.db, projId);
				const { overriddenOccurrences } = resolveViewsFromRows(rows);
				const occurrence = overriddenOccurrences.find((o) => o.occurrenceKey === tokenId)!;
				return flattenKitResults(occurrence.resolvedKits).get('color')?.value;
			}

			it('resolves to the source (view, kit)\'s current axis_args value at resolve time', async () => {
				const { proj, kit, themeAxis, source, tokenId } = await setupLinkedOverrideFixture();
				await ctx.api.setAxisArg(source.id, kit.id, themeAxis.id, { type: 'literal', value: 'dark' });

				expect(await resolveOccurrenceColor(proj.id, tokenId)).toBe('#000000');
			});

			it('picks up a LATER change to the source\'s axis_args with no other action -- the live part', async () => {
				const { proj, kit, themeAxis, source, tokenId } = await setupLinkedOverrideFixture();
				await ctx.api.setAxisArg(source.id, kit.id, themeAxis.id, { type: 'literal', value: 'dark' });
				expect(await resolveOccurrenceColor(proj.id, tokenId)).toBe('#000000');

				// Nothing touches the override row itself -- only the SOURCE's own pick changes.
				await ctx.api.setAxisArg(source.id, kit.id, themeAxis.id, { type: 'literal', value: 'light' });
				expect(await resolveOccurrenceColor(proj.id, tokenId)).toBe('#cccccc');
			});

			it('behaves as unset (baseline wins) once the source\'s axis_args is cleared', async () => {
				const { proj, kit, themeAxis, source, tokenId } = await setupLinkedOverrideFixture();
				await ctx.api.setAxisArg(source.id, kit.id, themeAxis.id, { type: 'literal', value: 'dark' });
				expect(await resolveOccurrenceColor(proj.id, tokenId)).toBe('#000000');

				await ctx.api.clearAxisArg(source.id, kit.id, themeAxis.id);
				expect(await resolveOccurrenceColor(proj.id, tokenId)).toBe('#ffffff');
			});

			it('behaves as unset when the source never had an axis_args row for this axis at all', async () => {
				const { proj, tokenId } = await setupLinkedOverrideFixture();
				// setAxisArg is never called on `source` in this test.
				expect(await resolveOccurrenceColor(proj.id, tokenId)).toBe('#ffffff');
			});
		});
	});

	// A VIEW's OWN axis_args (not a token_axis_overrides row) can now itself be `{type:'linked',...}`
	// -- "drag-to-lock": the child view's own canonical pick, for EVERY occurrence of it anywhere,
	// tracks a parent (view,kit)'s current axis_args live. Distinct fixture/mechanism from the
	// per-occurrence override tests above (those write token_axis_overrides on a REFERENCING token;
	// these write axis_args on the TARGET view's own composed kit directly).
	describe("a view's own axis_args can be 'linked' (drag-to-lock)", () => {
		async function setupLockFixture() {
			const ws = (await ctx.api.getAllWorkspaces().execute())[0]!;
			const proj = (await ctx.api.createProjectInWorkspace(ws.workspaceId, 'Axis Lock'))!;

			const themeAxis = (await ctx.api.createAxis(proj.id, 'theme', '', 'categorical', [
				'light',
				'dark'
			]))!;
			const themeDark = (await ctx.api.createAxisValue(themeAxis.id, {
				type: 'literal',
				value: 'dark'
			}))!;
			const themeLight = (await ctx.api.createAxisValue(themeAxis.id, {
				type: 'literal',
				value: 'light'
			}))!;

			const kit = (await ctx.api.createKitInProject(proj.id, 'Button'))!;
			await ctx.api.consumeAxis(kit.id, themeAxis.id);

			const nullLayer = (await ctx.api.createLayer(kit.id))!;
			const nullSnippet = (await ctx.api.createRenderSnippet(nullLayer.id))!;
			await ctx.api.createRenderEntry(nullSnippet.id, 'color', '#ffffff');

			const darkLayer = (await ctx.api.createLayer(kit.id))!;
			await ctx.api.addAxisValueToLayer(darkLayer.id, themeDark.id);
			const darkSnippet = (await ctx.api.createRenderSnippet(darkLayer.id))!;
			await ctx.api.createRenderEntry(darkSnippet.id, 'color', '#000000');

			const lightLayer = (await ctx.api.createLayer(kit.id))!;
			await ctx.api.addAxisValueToLayer(lightLayer.id, themeLight.id);
			const lightSnippet = (await ctx.api.createRenderSnippet(lightLayer.id))!;
			await ctx.api.createRenderEntry(lightSnippet.id, 'color', '#cccccc');

			const parent = (await ctx.api.createViewInProject(proj.id, 'Parent'))!;
			await ctx.api.attachKitToComposition(kit.id, parent.id);

			const child = (await ctx.api.createViewInProject(proj.id, 'Child'))!;
			await ctx.api.attachKitToComposition(kit.id, child.id);
			await ctx.api.setAxisArg(child.id, kit.id, themeAxis.id, {
				type: 'linked',
				view_id: parent.id,
				kit_id: kit.id
			});

			return { proj, kit, themeAxis, parent, child };
		}

		async function resolveViewColor(projId: string, viewId: string) {
			const views = await resolveManyViews(ctx.db, projId);
			const view = views.find((v) => v.viewId === viewId)!;
			return flattenKitResults(view.resolvedKits).get('color')?.value;
		}

		it("resolves to the parent's current axis_args value at resolve time", async () => {
			const { proj, kit, themeAxis, parent, child } = await setupLockFixture();
			await ctx.api.setAxisArg(parent.id, kit.id, themeAxis.id, { type: 'literal', value: 'dark' });

			expect(await resolveViewColor(proj.id, child.id)).toBe('#000000');
		});

		it("picks up a LATER change to the parent's axis_args with no other action -- the live part", async () => {
			const { proj, kit, themeAxis, parent, child } = await setupLockFixture();
			await ctx.api.setAxisArg(parent.id, kit.id, themeAxis.id, { type: 'literal', value: 'dark' });
			expect(await resolveViewColor(proj.id, child.id)).toBe('#000000');

			// Nothing touches the child's own axis_args row -- only the parent's own pick changes.
			await ctx.api.setAxisArg(parent.id, kit.id, themeAxis.id, { type: 'literal', value: 'light' });
			expect(await resolveViewColor(proj.id, child.id)).toBe('#cccccc');
		});

		it('behaves as unset (baseline wins) once the parent\'s axis_args is cleared', async () => {
			const { proj, kit, themeAxis, parent, child } = await setupLockFixture();
			await ctx.api.setAxisArg(parent.id, kit.id, themeAxis.id, { type: 'literal', value: 'dark' });
			expect(await resolveViewColor(proj.id, child.id)).toBe('#000000');

			await ctx.api.clearAxisArg(parent.id, kit.id, themeAxis.id);
			expect(await resolveViewColor(proj.id, child.id)).toBe('#ffffff');
		});

		it('behaves as unset when the parent never had an axis_args row for this axis at all', async () => {
			const { proj, child } = await setupLockFixture();
			// setAxisArg is never called on `parent` in this test.
			expect(await resolveViewColor(proj.id, child.id)).toBe('#ffffff');
		});

		it('a genuine cycle (A links to B, B links to A) resolves both as unset, not hanging or crashing', async () => {
			const { proj, kit, themeAxis, parent: viewA, child: viewB } = await setupLockFixture();
			// viewB already links to viewA (set up by setupLockFixture as parent/child) -- close the
			// cycle by also linking viewA to viewB.
			await ctx.api.setAxisArg(viewA.id, kit.id, themeAxis.id, {
				type: 'linked',
				view_id: viewB.id,
				kit_id: kit.id
			});

			// Completing without a timeout is itself the proof the seen-set terminates the walk.
			expect(await resolveViewColor(proj.id, viewA.id)).toBe('#ffffff');
			expect(await resolveViewColor(proj.id, viewB.id)).toBe('#ffffff');
		});

		it('a dangling source (kit detached from the parent view) resolves as unset', async () => {
			const { proj, kit, themeAxis, parent, child } = await setupLockFixture();
			await ctx.api.setAxisArg(parent.id, kit.id, themeAxis.id, { type: 'literal', value: 'dark' });
			expect(await resolveViewColor(proj.id, child.id)).toBe('#000000');

			// detachKitFromComposition leaves the parent's axis_args row orphaned (existing, unchanged
			// behavior) -- the link must recognize the (view,kit) pair no longer exists via
			// validCompositions, not just read straight through the stale row.
			await ctx.api.detachKitFromComposition(kit.id, parent.id);
			expect(await resolveViewColor(proj.id, child.id)).toBe('#ffffff');
		});
	});

	// Regression coverage for a real, load-bearing authoring pattern (not a hypothetical): a
	// resolver change that made token resolution "token_id-authoritative" (an entry's value only
	// ever comes from the exact token row its own token_id names, ignoring any same-alias token at
	// a narrower scope) was tried and reverted because it broke this pattern -- see the warning
	// comment above `ScopedTokenMaps` in resolve.ts. `manager/src/seed.ts`'s `textKit`/`textView`
	// and `imageKit`/`imageView` helpers are the real production use of exactly this shape: a kit
	// declares a render entry whose token_id points at a KIT-scope placeholder token, and every VIEW
	// composing that kit supplies its own value via a separate, same-alias VIEW-scope token. These
	// tests mirror that helper pair directly so a future "make this token_id-authoritative" change
	// fails loudly here instead of only being discoverable by eyeballing a blank demo screenshot.
	describe('kit-default + view-override authoring pattern (seed.ts textKit/textView shape)', () => {
		it('a view composing the kit sees its OWN same-alias token value, not the kit-scope placeholder its entry declares', async () => {
			const ws = (await ctx.api.getAllWorkspaces().execute())[0]!;
			const proj = (await ctx.api.createProjectInWorkspace(ws.workspaceId, 'Text Kit'))!;

			// textKit(): kit declares `content` via a render entry whose token_id points at an empty
			// KIT-scope placeholder token.
			const kit = (await ctx.api.createKitInProject(proj.id, 'Label'))!;
			const snippet = (await ctx.api.createRenderSnippet((await ctx.api.createLayer(kit.id))!.id))!;
			const placeholderTok = (await ctx.api.createToken(proj.id, 'content', s(''), {
				kitId: kit.id
			}))!;
			await ctx.api.createRenderEntry(snippet.id, 'content', null, placeholderTok.id);

			// textView(): the view composes the kit and supplies its own `content` via a VIEW-scope
			// token of the same alias -- never touching the entry's token_id.
			const view = (await ctx.api.createViewInProject(proj.id, 'Submit Button'))!;
			await ctx.api.attachKitToComposition(kit.id, view.id);
			await ctx.api.createToken(proj.id, 'content', s('Submit'), { viewId: view.id });

			const views = await resolveManyViews(ctx.db, proj.id);
			const resolved = views.find((v) => v.viewId === view.id)!;
			const flat = flattenKitResults(resolved.resolvedKits);
			expect(flat.get('content')!.value).toBe('Submit');
		});

		it('two different views composing the SAME kit each see their own content, never the placeholder or a sibling view\'s value', async () => {
			const ws = (await ctx.api.getAllWorkspaces().execute())[0]!;
			const proj = (await ctx.api.createProjectInWorkspace(ws.workspaceId, 'Text Kit Multi'))!;

			const kit = (await ctx.api.createKitInProject(proj.id, 'Label'))!;
			const snippet = (await ctx.api.createRenderSnippet((await ctx.api.createLayer(kit.id))!.id))!;
			const placeholderTok = (await ctx.api.createToken(proj.id, 'content', s(''), {
				kitId: kit.id
			}))!;
			await ctx.api.createRenderEntry(snippet.id, 'content', null, placeholderTok.id);

			const submitView = (await ctx.api.createViewInProject(proj.id, 'Submit'))!;
			await ctx.api.attachKitToComposition(kit.id, submitView.id);
			await ctx.api.createToken(proj.id, 'content', s('Submit'), { viewId: submitView.id });

			const cancelView = (await ctx.api.createViewInProject(proj.id, 'Cancel'))!;
			await ctx.api.attachKitToComposition(kit.id, cancelView.id);
			await ctx.api.createToken(proj.id, 'content', s('Cancel'), { viewId: cancelView.id });

			const views = await resolveManyViews(ctx.db, proj.id);
			const submitFlat = flattenKitResults(views.find((v) => v.viewId === submitView.id)!.resolvedKits);
			const cancelFlat = flattenKitResults(views.find((v) => v.viewId === cancelView.id)!.resolvedKits);
			expect(submitFlat.get('content')!.value).toBe('Submit');
			expect(cancelFlat.get('content')!.value).toBe('Cancel');
		});

		it('a view with no content override falls back to the kit-scope placeholder the entry actually declares', async () => {
			const ws = (await ctx.api.getAllWorkspaces().execute())[0]!;
			const proj = (await ctx.api.createProjectInWorkspace(ws.workspaceId, 'Text Kit Fallback'))!;

			const kit = (await ctx.api.createKitInProject(proj.id, 'Label'))!;
			const snippet = (await ctx.api.createRenderSnippet((await ctx.api.createLayer(kit.id))!.id))!;
			const placeholderTok = (await ctx.api.createToken(proj.id, 'content', s('Placeholder'), {
				kitId: kit.id
			}))!;
			await ctx.api.createRenderEntry(snippet.id, 'content', null, placeholderTok.id);

			const view = (await ctx.api.createViewInProject(proj.id, 'Unlabeled'))!;
			await ctx.api.attachKitToComposition(kit.id, view.id);
			// No view-scope `content` token created.

			const views = await resolveManyViews(ctx.db, proj.id);
			const flat = flattenKitResults(views.find((v) => v.viewId === view.id)!.resolvedKits);
			expect(flat.get('content')!.value).toBe('Placeholder');
		});

		it('imageKit/imageView shape: a view overrides a kit-declared `src` the same way', async () => {
			const ws = (await ctx.api.getAllWorkspaces().execute())[0]!;
			const proj = (await ctx.api.createProjectInWorkspace(ws.workspaceId, 'Image Kit'))!;

			const kit = (await ctx.api.createKitInProject(proj.id, 'Photo'))!;
			const snippet = (await ctx.api.createRenderSnippet((await ctx.api.createLayer(kit.id))!.id))!;
			const placeholderTok = (await ctx.api.createToken(proj.id, 'src', s(''), { kitId: kit.id }))!;
			await ctx.api.createRenderEntry(snippet.id, 'src', null, placeholderTok.id);

			const view = (await ctx.api.createViewInProject(proj.id, 'Avatar'))!;
			await ctx.api.attachKitToComposition(kit.id, view.id);
			await ctx.api.createToken(proj.id, 'src', s('/avatar.png'), { viewId: view.id });

			const views = await resolveManyViews(ctx.db, proj.id);
			const flat = flattenKitResults(views.find((v) => v.viewId === view.id)!.resolvedKits);
			expect(flat.get('src')!.value).toBe('/avatar.png');
		});
	});
});

// `flattenKitResults` (here) and Charter's `merge_kits` (plugins/charter/src/lib.rs) are two
// independent implementations of the SAME rule, documented in AGENTS.md as "must be kept in
// lockstep by hand" with no automated cross-language enforcement -- this is that enforcement.
// Both load ../../../fixtures/kit-flatten-golden.json and must agree with its `expected` block.
// Unlike every other test in this file, this one bypasses the DB/resolver entirely and constructs
// ResolvedKit[] directly -- it's a pure-function parity check on the merge algorithm itself, not
// an integration test of resolution.
describe('flattenKitResults cross-language parity (kit-flatten-golden.json)', () => {
	it('agrees with the shared golden fixture Charter\'s merge_kits also asserts against', async () => {
		const url = new URL('../../../fixtures/kit-flatten-golden.json', import.meta.url);
		const raw = await readFile(url, 'utf-8');
		const fixture = JSON.parse(raw) as {
			kits: { kitId: string; kitName: string; properties: Record<string, ResolvedProperty> }[];
			expected: Record<string, { value: string; kitId: string }>;
		};

		const kits: ResolvedKit[] = fixture.kits.map((k) => ({
			kitId: k.kitId,
			kitName: k.kitName,
			properties: new Map(Object.entries(k.properties))
		}));

		const flat = flattenKitResults(kits);

		for (const [property, expected] of Object.entries(fixture.expected)) {
			const resolved = flat.get(property);
			expect(resolved, `expected a resolved value for "${property}"`).toBeDefined();
			expect(resolved!.value, `"${property}".value`).toBe(expected.value);
			expect(resolved!.kitId, `"${property}".kitId`).toBe(expected.kitId);
		}
	});
});

describe('export/import round trip at the resolution layer', () => {
	let ctx: TestContext;

	beforeEach(async () => {
		ctx = await createTestDb();
	});

	afterEach(async () => {
		await ctx.pg.close();
	});

	// Regression test for a reported "every view is laid out flat, hierarchy gone entirely" bug
	// after Tenner export -> import. Exercises the exact mechanism seed.ts's own buildComposedView
	// uses for real projects (addViewRef, not a raw array-valued token -- see seed.ts's own comment
	// on that), through the FULL resolution layer (resolveManyViews + flattenKitResults), not just
	// raw exported row shapes -- so this catches a break in the actual parent/child linkage a broken
	// import would produce (every view becoming an unreferenced "root"), not just a reordering.
	it('a two-level tree built via addViewRef keeps its exact shape (roots and per-parent children) after import', async () => {
		const ws = (await ctx.api.getAllWorkspaces().execute())[0]!;
		const proj = (await ctx.api.createProjectInWorkspace(ws.workspaceId, 'Nested Source'))!;
		const boxKit = (await ctx.api.createKitInProject(proj.id, 'Box'))!;

		const root = (await ctx.api.createViewInProject(proj.id, 'Root'))!;
		await ctx.api.attachKitToComposition(boxKit.id, root.id);
		const navBar = (await ctx.api.createViewInProject(proj.id, 'NavBar'))!;
		await ctx.api.attachKitToComposition(boxKit.id, navBar.id);
		const hero = (await ctx.api.createViewInProject(proj.id, 'Hero'))!;
		await ctx.api.attachKitToComposition(boxKit.id, hero.id);
		const wordmark = (await ctx.api.createViewInProject(proj.id, 'Wordmark'))!;
		const navLink = (await ctx.api.createViewInProject(proj.id, 'NavLink'))!;
		const heroHeading = (await ctx.api.createViewInProject(proj.id, 'HeroHeading'))!;

		await ctx.api.addViewRef(proj.id, root.id, 'children', navBar.id);
		await ctx.api.addViewRef(proj.id, root.id, 'children', hero.id);
		await ctx.api.addViewRef(proj.id, navBar.id, 'children', wordmark.id);
		await ctx.api.addViewRef(proj.id, navBar.id, 'children', navLink.id);
		await ctx.api.addViewRef(proj.id, hero.id, 'children', heroHeading.id);

		function summarize(
			views: Awaited<ReturnType<typeof resolveManyViews>>,
			nameById: Map<string, string>
		) {
			const childrenByName = new Map<string, string[]>();
			const referenced = new Set<string>();
			for (const v of views) {
				const flat = flattenKitResults(v.resolvedKits);
				const refs = flat.get('children')?.viewRefs ?? [];
				childrenByName.set(
					nameById.get(v.viewId)!,
					refs.map((r) => nameById.get(r.viewId)!)
				);
				for (const r of refs) referenced.add(r.viewId);
			}
			const roots = views.filter((v) => !referenced.has(v.viewId)).map((v) => nameById.get(v.viewId)!);
			return { childrenByName, roots };
		}

		const sourceNameById = new Map([
			[root.id, 'Root'],
			[navBar.id, 'NavBar'],
			[hero.id, 'Hero'],
			[wordmark.id, 'Wordmark'],
			[navLink.id, 'NavLink'],
			[heroHeading.id, 'HeroHeading']
		]);
		const before = summarize(await resolveManyViews(ctx.db, proj.id), sourceNameById);
		expect(before.roots).toEqual(['Root']);
		expect(before.childrenByName.get('Root')).toEqual(['NavBar', 'Hero']);
		expect(before.childrenByName.get('NavBar')).toEqual(['Wordmark', 'NavLink']);
		expect(before.childrenByName.get('Hero')).toEqual(['HeroHeading']);

		const exported = await ctx.api.exportProject(proj.id);
		const imported = (await ctx.api.importProjectData(ws.workspaceId, exported))!;
		const reexported = await ctx.api.exportProject(imported.id);
		const newNameById = new Map<string, string>(
			reexported.views.map((v: any) => [v.id as string, v.name as string])
		);

		const after = summarize(await resolveManyViews(ctx.db, imported.id), newNameById);
		expect(after.roots).toEqual(before.roots);
		expect(after.childrenByName.get('Root')).toEqual(before.childrenByName.get('Root'));
		expect(after.childrenByName.get('NavBar')).toEqual(before.childrenByName.get('NavBar'));
		expect(after.childrenByName.get('Hero')).toEqual(before.childrenByName.get('Hero'));
	});
});
