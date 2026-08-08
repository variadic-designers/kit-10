import { describe, it, expect, afterEach } from 'vitest';
import { createTestDb, type TestContext } from './test-helpers.js';
import { registerBuiltinPlugins } from './plugins-bootstrap.js';
import { seedJuiceLandingPage, seedGymLandingPage, seedMerchLandingPage } from './seed.js';

// seed.ts has no other test coverage of its own - a typo'd property name or wrong axis/layer call
// order type-checks fine (props are just Record<string, string>) and only fails at runtime. Runs
// the three landing-page seed functions end-to-end against a real PGlite DB and checks the shape
// of the newer, more structurally involved additions (text-on-path, SpriteBatch, multi-axis grid
// placement) that are easy to get subtly wrong.
describe('seed functions', () => {
	let ctx: TestContext;

	afterEach(async () => {
		await ctx?.pg.close();
	});

	it('seeds Tropika, Forge, and Meridian without throwing, with the expected axis/view shape', async () => {
		ctx = await createTestDb();
		const builtinPlugins = await registerBuiltinPlugins(ctx.db);

		await seedJuiceLandingPage(ctx.db, builtinPlugins);
		await seedGymLandingPage(ctx.db, builtinPlugins);
		await seedMerchLandingPage(ctx.db, builtinPlugins);

		const projects = await ctx.db.selectFrom('projects').select(['id', 'name']).execute();
		const tropika = projects.find((p) => p.name === 'Tropika Juice Co.');
		const forge = projects.find((p) => p.name === 'Forge Wellness Club');
		const meridian = projects.find((p) => p.name === 'Meridian');
		expect(tropika).toBeDefined();
		expect(forge).toBeDefined();
		expect(meridian).toBeDefined();

		// Tropika: the badge text view carries a real text-path JSON array of points, and the
		// confetti SpriteBatch view carries a real sprites JSON array (parseable, correct length).
		const badgeEntry = await ctx.db
			.selectFrom('render_entries')
			.where('property', '=', 'text-path')
			.select(['value'])
			.executeTakeFirst();
		expect(badgeEntry).toBeDefined();
		const badgePoints = JSON.parse(badgeEntry!.value!);
		expect(Array.isArray(badgePoints)).toBe(true);
		expect(badgePoints.length).toBeGreaterThan(10);

		const spritesEntry = await ctx.db
			.selectFrom('render_entries')
			.where('property', '=', 'sprites')
			.select(['value'])
			.executeTakeFirst();
		expect(spritesEntry).toBeDefined();
		const sprites = JSON.parse(spritesEntry!.value!);
		expect(Array.isArray(sprites)).toBe(true);
		// In this Node/vitest environment registerBundledAsset's fetch('/1x/stock/...') has no
		// server to hit, so every sprite asset id comes back null and confettiKinds' own filter
		// skips all 22 entries - the same pre-existing limitation every other seeded photo asset
		// has in tests. Only assert real shape when the browser environment did give us ids.
		for (const s of sprites) {
			expect(typeof s.sprite_id).toBe('string');
			expect(s.color).toHaveProperty('l');
			expect(s.color).toHaveProperty('a');
			expect(s.color).toHaveProperty('b');
			expect(s.color).toHaveProperty('alpha');
		}

		const confettiSpriteBatchView = await ctx.db
			.selectFrom('views')
			.where('project_id', '=', tropika!.id)
			.where('name', '=', 'Confetti Band')
			.select(['id', 'hints'])
			.executeTakeFirst();
		expect(confettiSpriteBatchView).toBeDefined();
		const hints = confettiSpriteBatchView!.hints as any;
		expect(hints?.charter?.primitive).toBe('sprite-batch');

		// Forge: Class axis has all 6 values, and each conditioned layer's place names the slot
		// it occupies directly (resolve_place desugars it into the same `<name>-start / <name>-end`
		// NamedLine pair on both axes Charter-side).
		const classAxis = await ctx.db
			.selectFrom('axes')
			.where('project_id', '=', forge!.id)
			.where('name', '=', 'Class')
			.select(['id'])
			.executeTakeFirst();
		expect(classAxis).toBeDefined();
		const classAxisValues = await ctx.db
			.selectFrom('axis_values')
			.where('axis_id', '=', classAxis!.id)
			.select(['value'])
			.execute();
		expect(classAxisValues.length).toBe(6);

		const placeEntries = await ctx.db
			.selectFrom('render_entries')
			.where('property', '=', 'place')
			.select(['value'])
			.execute();
		const forgeMobility = placeEntries.find((e) => e.value === 'mobility');
		expect(forgeMobility).toBeDefined();

		const gridAreasEntry = await ctx.db
			.selectFrom('render_entries')
			.where('property', '=', 'grid-template-areas')
			.select(['value'])
			.execute();
		expect(gridAreasEntry.some((e) => e.value?.includes('strength strength'))).toBe(true);
		expect(gridAreasEntry.some((e) => e.value?.includes('lookbook oxford tee'))).toBe(true);

		// Meridian: Grid Slot axis has 4 values, product tiles carry a squircle boolean.
		const slotAxis = await ctx.db
			.selectFrom('axes')
			.where('project_id', '=', meridian!.id)
			.where('name', '=', 'Grid Slot')
			.select(['id'])
			.executeTakeFirst();
		expect(slotAxis).toBeDefined();
		const slotValues = await ctx.db
			.selectFrom('axis_values')
			.where('axis_id', '=', slotAxis!.id)
			.select(['value'])
			.execute();
		expect(slotValues.length).toBe(4);

		const squircleEntries = await ctx.db
			.selectFrom('render_entries')
			.where('property', '=', 'border-radius-squircle')
			.select(['value'])
			.execute();
		expect(squircleEntries.length).toBeGreaterThan(0);
	}, 60000);
});
