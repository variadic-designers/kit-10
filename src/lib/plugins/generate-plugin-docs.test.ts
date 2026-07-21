import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	INPUT_TYPES_BEGIN,
	INPUT_TYPES_END,
	extractJsonBlockAfter,
	generatePluginsMd,
	parseDocumentedHostFns,
	parseGoldenNodeFields,
	parseInputTypes,
	parseRegisteredHostFns
} from '../../../scripts/generate-plugin-docs.mjs';

// Drift guard for the generated parts of PLUGINS.md (see resources/api-formalization.md, Phase 2).
// The inputType reference table in PLUGINS.md is DERIVED from the `InputType` union in types.ts;
// this test fails if they diverge, so a plugin author never reads a stale contract. Same instinct
// as resolve-live-query.test.ts asserting the live-query JOIN against RESOLUTION_RELEVANT_TABLES.
const ROOT = process.cwd();
const typesSource = readFileSync(resolve(ROOT, 'src/lib/plugins/types.ts'), 'utf8');
const pluginsMd = readFileSync(resolve(ROOT, 'PLUGINS.md'), 'utf8');
const managerSource = readFileSync(resolve(ROOT, 'src/lib/plugins/manager.svelte.ts'), 'utf8');
const wireGolden = readFileSync(
	resolve(ROOT, 'plugins/charter/tests/wire-format.golden.json'),
	'utf8'
);

describe('generate-plugin-docs (inputType table)', () => {
	it('parses every InputType union member with a non-empty @doc description', () => {
		const entries = parseInputTypes(typesSource);
		// Sanity floor: today there are 14. If this drops, the union parse regressed.
		expect(entries.length).toBeGreaterThanOrEqual(14);
		for (const e of entries) {
			expect(e.name, 'member name is a bare kebab/lower token').toMatch(/^[a-z-]+$/);
			expect(e.doc, `member '${e.name}' is missing an // @doc: line`).not.toBe('');
		}
	});

	it('PLUGINS.md inputType table is up to date — run `npm run generate-docs` if this fails', async () => {
		expect(await generatePluginsMd(typesSource, pluginsMd)).toBe(pluginsMd);
	});

	it('every InputType member has a row inside the generated markers', () => {
		const begin = pluginsMd.indexOf(INPUT_TYPES_BEGIN);
		const end = pluginsMd.indexOf(INPUT_TYPES_END);
		expect(begin, 'BEGIN marker present').toBeGreaterThan(-1);
		expect(end, 'END marker after BEGIN').toBeGreaterThan(begin);
		const region = pluginsMd.slice(begin, end);
		for (const e of parseInputTypes(typesSource)) {
			expect(region, `table row for '${e.name}'`).toContain(`\`${e.name}\``);
		}
	});
});

describe('generate-plugin-docs (host functions)', () => {
	it('PLUGINS.md documents exactly the host fns registered in manager.svelte.ts', () => {
		const registered = parseRegisteredHostFns(managerSource);
		const documented = parseDocumentedHostFns(pluginsMd);
		// Sanity floor so a parse regression (e.g. zero matches) can't make this pass vacuously.
		expect(registered.length).toBeGreaterThanOrEqual(11);
		// Set equality both ways — an undocumented new host fn OR a doc for a removed one both fail.
		expect(documented, 'PLUGINS.md host-fn headings vs. makeHostFunctions').toEqual(registered);
	});
});

describe('generate-plugin-docs (wire node examples)', () => {
	// Fields deliberately elided from the illustrative examples for brevity — PLUGINS.md documents
	// each omission in prose (e.g. "extra: BoxExtra ... is omitted here; it defaults when absent").
	// Anything NOT listed here must appear in its node's example.
	const OMITTED: Record<string, string[]> = { Box: ['extra'], Text: [], Img: [] };
	const MARKER: Record<string, string> = {
		Box: '**Box node:**',
		Text: '**Text node:**',
		Img: '**Image node:**'
	};

	const nodeFields = parseGoldenNodeFields(wireGolden);

	it('golden covers exactly the Box/Text/Img variants', () => {
		expect(Object.keys(nodeFields).sort()).toEqual(['Box', 'Img', 'Text']);
	});

	for (const variant of ['Box', 'Text', 'Img'] as const) {
		it(`PLUGINS.md ${variant} example documents every wire field (source: golden)`, () => {
			const block = extractJsonBlockAfter(pluginsMd, MARKER[variant]);
			const omitted = OMITTED[variant];
			const missing = nodeFields[variant].filter(
				(key) => !omitted.includes(key) && !block.includes(`"${key}"`)
			);
			expect(missing, `${variant} example is missing wire fields`).toEqual([]);
		});
	}
});
