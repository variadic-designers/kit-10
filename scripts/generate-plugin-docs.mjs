// Generates the machine-derivable parts of PLUGINS.md from their in-code source of truth, so the
// plugin-author docs cannot silently drift from the shipped contract (see
// resources/api-formalization.md, Phase 2). Today it owns the inputType reference table, derived
// from the `InputType` union in src/lib/plugins/types.ts.
//
//   node scripts/generate-plugin-docs.mjs           # rewrite PLUGINS.md in place
//   node scripts/generate-plugin-docs.mjs --check    # exit 1 if PLUGINS.md is stale (CI guard)
//
// The pure functions are exported for the drift-guard test (generate-plugin-docs.test.ts). Adding
// a new generated section = add a parse+render pair and a marker block, same shape as input-types.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as prettier from 'prettier';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES_PATH = resolve(REPO_ROOT, 'src/lib/plugins/types.ts');
const PLUGINS_MD_PATH = resolve(REPO_ROOT, 'PLUGINS.md');

export const INPUT_TYPES_BEGIN = '<!-- BEGIN GENERATED: input-types';
export const INPUT_TYPES_END = '<!-- END GENERATED: input-types';

/** @typedef {{ name: string, doc: string }} InputTypeEntry */

// Parse the `export type InputType = | 'x' | 'y' ...;` union out of types.ts. Each member's row
// description is its `// @doc: ...` comment line; freeform explanatory comments above it are
// ignored. Order is preserved from the union.
/**
 * @param {string} typesSource
 * @returns {InputTypeEntry[]}
 */
export function parseInputTypes(typesSource) {
	const match = typesSource.match(/export type InputType =([\s\S]*?);/);
	if (!match)
		throw new Error('generate-plugin-docs: could not find the `InputType` union in types.ts');

	const entries = [];
	let pendingDoc = null;
	for (const rawLine of match[1].split('\n')) {
		const line = rawLine.trim();
		const doc = line.match(/^\/\/\s*@doc:\s*(.+?)\s*$/);
		if (doc) {
			pendingDoc = doc[1];
			continue;
		}
		const member = line.match(/^\|\s*'([^']+)'/);
		if (member) {
			entries.push({ name: member[1], doc: pendingDoc ?? '' });
			pendingDoc = null;
		}
	}
	if (entries.length === 0) throw new Error('generate-plugin-docs: parsed zero InputType members');
	return entries;
}

// Render the inputType reference table (GitHub-flavored markdown). A missing @doc is surfaced
// loudly in the cell rather than silently blank, so the drift test catches it.
/**
 * @param {InputTypeEntry[]} entries
 * @returns {string}
 */
export function renderInputTypeTable(entries) {
	const rows = entries.map((e) => `| \`${e.name}\` | ${e.doc || '**(missing @doc)**'} |`);
	return ['| `inputType` | Widget |', '| --- | --- |', ...rows].join('\n');
}

// Replace the text between a BEGIN/END marker pair (matched by stable prefix, not exact text, so
// the marker line's trailing prose can change without breaking the anchor). The marker lines
// themselves are preserved; `content` lands between them, blank-line padded.
/**
 * @param {string} source
 * @param {string} beginPrefix
 * @param {string} endPrefix
 * @param {string} content
 * @returns {string}
 */
export function injectBetweenMarkers(source, beginPrefix, endPrefix, content) {
	const lines = source.split('\n');
	const beginIdx = lines.findIndex((l) => l.startsWith(beginPrefix));
	const endIdx = lines.findIndex((l) => l.startsWith(endPrefix));
	if (beginIdx === -1 || endIdx === -1 || endIdx < beginIdx) {
		throw new Error(
			`generate-plugin-docs: markers "${beginPrefix}" / "${endPrefix}" not found (or out of order)`
		);
	}
	const rebuilt = [...lines.slice(0, beginIdx + 1), '', content, '', ...lines.slice(endIdx)];
	return rebuilt.join('\n');
}

// Run a markdown fragment through the repo's Prettier config so the generated table lands
// column-aligned exactly the way `prettier --write` would produce it — otherwise the generator and
// Prettier would fight over the same lines forever. Table alignment depends only on the table's own
// cells, so formatting the standalone snippet matches how Prettier renders it in-file.
/**
 * @param {string} fragment
 * @returns {Promise<string>}
 */
async function formatMarkdown(fragment) {
	const config = (await prettier.resolveConfig(PLUGINS_MD_PATH)) ?? {};
	const out = await prettier.format(fragment, { ...config, parser: 'markdown' });
	return out.replace(/\n+$/, ''); // injectBetweenMarkers adds its own surrounding blank lines
}

// Full transform: given both files' current text, return the up-to-date PLUGINS.md text. Async
// because it defers table formatting to Prettier (see formatMarkdown).
/**
 * @param {string} typesSource
 * @param {string} pluginsMd
 * @returns {Promise<string>}
 */
export async function generatePluginsMd(typesSource, pluginsMd) {
	const table = await formatMarkdown(renderInputTypeTable(parseInputTypes(typesSource)));
	return injectBetweenMarkers(pluginsMd, INPUT_TYPES_BEGIN, INPUT_TYPES_END, table);
}

async function main() {
	const check = process.argv.includes('--check');
	const typesSource = readFileSync(TYPES_PATH, 'utf8');
	const current = readFileSync(PLUGINS_MD_PATH, 'utf8');
	const next = await generatePluginsMd(typesSource, current);

	if (next === current) {
		console.log('generate-plugin-docs: PLUGINS.md is up to date.');
		return;
	}
	if (check) {
		console.error(
			'generate-plugin-docs: PLUGINS.md is STALE. Run `npm run generate-docs` and commit.'
		);
		process.exit(1);
	}
	writeFileSync(PLUGINS_MD_PATH, next);
	console.log('generate-plugin-docs: PLUGINS.md regenerated.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().catch((err) => {
		console.error(err);
		process.exit(1);
	});
}
