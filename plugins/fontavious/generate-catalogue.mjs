#!/usr/bin/env node
// Fontavious catalogue generator (Phase 2, keyless).
//
// Resolves each curated family to its latin-subset WOFF2 URL(s) via Google Fonts' CSS2 API,
// driven with a modern-browser User-Agent (that's what makes CSS2 hand back WOFF2 + the gstatic
// URLs -- see resources/nature-of-fonts.md §4.1/§6.2). No API key needed. A per-family query
// CASCADE handles the variable-vs-static split without us having to know each font's axes:
//
//   1. variable + italic  NAME:ital,wght@0,400..700;1,400..700   (most modern families, 1 shot)
//   2. variable normal    NAME:wght@400..700
//   3. static + italic    NAME:ital,wght@0,400;0,700;1,400;1,700
//   4. static normal      NAME:wght@400;700
//   5. single weight      NAME:wght@400                          (display/script one-weights)
//
// A static family REJECTS a range query (confirmed: Lato:wght@400..700 -> HTTP 400), which is
// exactly what makes the cascade fall through to discrete weights. The LAST @font-face in each
// (style,weight) group is the `latin` subset (Google orders subsets cyrillic..latin), same
// single-URL-per-variant convention the hand-authored catalogue already used.
//
// Rerun: `node plugins/fontavious/generate-catalogue.mjs` -> rewrites catalogue.json. Then
// rebuild+copy the wasm (see CLAUDE.md deploy pitfall).

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const UA =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'catalogue.json');

// Curated set. `a` = aliases (proprietary/import names -- NEVER become a `family`, see the
// trademark note in resources/fontavious-catalogue-plan.md §3). Keep genuinely distinct designs
// separate; only metric-clones/look-alikes fold via aliases.
const FAMILIES = [
	// --- sans ---
	['Inter', 'sans'],
	['Roboto', 'sans'],
	['Open Sans', 'sans'],
	['Lato', 'sans'],
	['Montserrat', 'sans'],
	['Poppins', 'sans'],
	['Nunito', 'sans'],
	['Nunito Sans', 'sans'],
	['Source Sans 3', 'sans'],
	['Work Sans', 'sans'],
	['DM Sans', 'sans'],
	['Manrope', 'sans'],
	['Raleway', 'sans'],
	['Rubik', 'sans'],
	['Karla', 'sans'],
	['Mulish', 'sans'],
	['Figtree', 'sans'],
	['Space Grotesk', 'sans'],
	['Sora', 'sans'],
	['Outfit', 'sans'],
	['Plus Jakarta Sans', 'sans'],
	['Archivo', 'sans'],
	['Libre Franklin', 'sans'],
	['IBM Plex Sans', 'sans'],
	['Noto Sans', 'sans'],
	['PT Sans', 'sans'],
	['Barlow', 'sans'],
	['Oswald', 'sans'],
	['Josefin Sans', 'sans'],
	['Quicksand', 'sans'],
	['Comfortaa', 'sans'],
	['Hind', 'sans'],
	['Cabin', 'sans'],
	['Titillium Web', 'sans'],
	['Kanit', 'sans'],
	['Heebo', 'sans'],
	['Assistant', 'sans'],
	['Overpass', 'sans'],
	['Red Hat Display', 'sans'],
	['Red Hat Text', 'sans'],
	['Public Sans', 'sans'],
	['Hanken Grotesk', 'sans'],
	['Albert Sans', 'sans'],
	['Lexend', 'sans'],
	['Urbanist', 'sans'],
	['Epilogue', 'sans'],
	['Be Vietnam Pro', 'sans'],
	['Jost', 'sans'],
	['Questrial', 'sans'],
	['Signika', 'sans'],
	['Saira', 'sans'],
	['Chivo', 'sans'],
	['Exo 2', 'sans'],
	['Prompt', 'sans'],
	['Sarabun', 'sans'],
	['Maven Pro', 'sans'],
	['Mukta', 'sans'],
	['Dosis', 'sans'],
	['Fira Sans', 'sans'],
	['Schibsted Grotesk', 'sans'],
	// --- serif ---
	['Playfair Display', 'serif'],
	['Merriweather', 'serif'],
	['Lora', 'serif'],
	['EB Garamond', 'serif'],
	['Fraunces', 'serif'],
	['Cormorant', 'serif'],
	['Cormorant Garamond', 'serif'],
	['Bitter', 'serif'],
	['Crimson Pro', 'serif'],
	['Crimson Text', 'serif'],
	['Spectral', 'serif'],
	['Newsreader', 'serif'],
	['Libre Baskerville', 'serif'],
	['Source Serif 4', 'serif'],
	['PT Serif', 'serif'],
	['Noto Serif', 'serif'],
	['IBM Plex Serif', 'serif'],
	['Roboto Slab', 'serif'],
	['Zilla Slab', 'serif'],
	['Domine', 'serif'],
	['Frank Ruhl Libre', 'serif'],
	['Cardo', 'serif'],
	['Alegreya', 'serif'],
	['Vollkorn', 'serif'],
	['Arvo', 'serif'],
	['Rokkitt', 'serif'],
	['DM Serif Display', 'serif'],
	['DM Serif Text', 'serif'],
	['Marcellus', 'serif'],
	['Cinzel', 'serif'],
	['Bree Serif', 'serif'],
	// --- mono ---
	['JetBrains Mono', 'mono'],
	['Fira Code', 'mono'],
	['IBM Plex Mono', 'mono'],
	['Space Mono', 'mono'],
	['Roboto Mono', 'mono'],
	['Source Code Pro', 'mono'],
	['Inconsolata', 'mono'],
	['Ubuntu Mono', 'mono'],
	['DM Mono', 'mono'],
	['Overpass Mono', 'mono'],
	['PT Mono', 'mono'],
	// --- display ---
	['Bebas Neue', 'display'],
	['Righteous', 'display'],
	['Lobster', 'display'],
	['Abril Fatface', 'display'],
	['Bungee', 'display'],
	['Alfa Slab One', 'display'],
	['Staatliches', 'display'],
	['Bangers', 'display'],
	['Fredoka', 'display'],
	['Titan One', 'display'],
	['Anton', 'display'],
	['Teko', 'display'],
	['Fjalla One', 'display'],
	['Passion One', 'display'],
	// --- handwriting / script ---
	['Pacifico', 'handwriting'],
	['Caveat', 'handwriting'],
	['Dancing Script', 'handwriting'],
	['Satisfy', 'handwriting'],
	['Great Vibes', 'handwriting'],
	['Shadows Into Light', 'handwriting'],
	['Permanent Marker', 'handwriting'],
	['Sacramento', 'handwriting'],
	['Kalam', 'handwriting'],
	['Indie Flower', 'handwriting'],
	['Amatic SC', 'handwriting'],
	['Courgette', 'handwriting'],
	// --- OFL metric-clone roots (system-font namespace via aliases; trademark-safe, see §2.1/§3) ---
	['Arimo', 'sans', ['Arial', 'Helvetica', 'Liberation Sans', 'Nimbus Sans']],
	['Tinos', 'serif', ['Times New Roman', 'Times', 'Liberation Serif']],
	['Cousine', 'mono', ['Courier New', 'Liberation Mono']],
	['Carlito', 'sans', ['Calibri']],
	['Caladea', 'serif', ['Cambria']],
	['Gelasio', 'serif', ['Georgia']]
];

function curlGet(url) {
	try {
		const out = execFileSync('curl', ['-s', '-A', UA, '-w', '\n%{http_code}', url], {
			encoding: 'utf8',
			timeout: 20000
		});
		const nl = out.lastIndexOf('\n');
		return { code: out.slice(nl + 1).trim(), body: out.slice(0, nl) };
	} catch {
		return { code: '000', body: '' };
	}
}

function fetchCss(spec) {
	return curlGet(`https://fonts.googleapis.com/css2?family=${spec}&display=swap`);
}

// Parse @font-face blocks -> Map keyed "style|weightspec" -> url. Last write wins = latin subset.
function parseFaces(css) {
	const faces = new Map();
	for (const block of css.split('@font-face')) {
		const style = block.match(/font-style:\s*([a-z]+)/i)?.[1];
		const weight = block.match(/font-weight:\s*([\d ]+);/)?.[1]?.trim();
		const url = block.match(/src:\s*url\(([^)]+)\)/)?.[1];
		if (style && weight && url) faces.set(`${style}|${weight}`, url);
	}
	return faces;
}

function variantsFrom(faces) {
	const variants = [];
	for (const [key, url] of faces) {
		const [style, weight] = key.split('|');
		const parts = weight.split(/\s+/).map(Number);
		const [min, max] = parts.length === 2 ? parts : [parts[0], parts[0]];
		variants.push({ weightMin: min, weightMax: max, style, url });
	}
	// Deterministic order: normal before italic, ascending weight.
	variants.sort((a, b) => a.style.localeCompare(b.style) || a.weightMin - b.weightMin);
	return variants;
}

function enc(name) {
	return name.replace(/ /g, '+');
}

function resolve(name) {
	const n = enc(name);
	// Cascade: first query that returns 200 wins. Variable+italic is the common 1-shot case.
	const cascade = [
		`${n}:ital,wght@0,400..700;1,400..700`,
		`${n}:wght@400..700`,
		`${n}:ital,wght@0,400;0,700;1,400;1,700`,
		`${n}:wght@400;700`,
		`${n}:wght@400`
	];
	for (const spec of cascade) {
		const { code, body } = fetchCss(spec);
		if (code === '200') {
			const v = variantsFrom(parseFaces(body));
			if (v.length) return v;
		}
	}
	return null;
}

// --- Fontshare tier (ITF, free-proprietary): [slug, category]. The display name comes from the
// API's own `font-family`, so we never hand-transcribe it. Omitting weights returns the WHOLE
// family (all weights + italics) in one request. These are `free-proprietary`: free to fetch/
// render/cache, but NOT rehostable/bundleable -- see resources/fontavious-catalogue-plan.md §3.
const FONTSHARE = [
	['satoshi', 'sans'],
	['general-sans', 'sans'],
	['clash-display', 'display'],
	['clash-grotesk', 'sans'],
	['cabinet-grotesk', 'sans'],
	['switzer', 'sans'],
	['sentient', 'serif'],
	['zodiak', 'serif'],
	['chillax', 'sans'],
	['supreme', 'sans'],
	['melodrama', 'serif'],
	['ranade', 'serif']
];

// Fontshare serves one discrete @font-face per (weight, style) -- no unicode-range splitting, so
// one woff2 URL each (protocol-relative // -> https:). Returns {family, variants} or null.
function resolveFontshare(slug) {
	const { code, body } = curlGet(`https://api.fontshare.com/v2/css?f%5B%5D=${slug}`);
	if (code !== '200') return null;
	const faces = new Map();
	let family = null;
	for (const block of body.split('@font-face')) {
		const fam = block.match(/font-family:\s*'([^']+)'/)?.[1];
		const weight = block.match(/font-weight:\s*(\d+)/)?.[1];
		const style = block.match(/font-style:\s*([a-z]+)/i)?.[1];
		const woff2 = block.match(/url\('(\/\/[^']+\.woff2)'\)/)?.[1];
		if (fam && weight && style && woff2) {
			family = fam;
			faces.set(`${style}|${weight}`, `https:${woff2}`);
		}
	}
	if (!family) return null;
	const variants = [...faces].map(([key, url]) => {
		const [style, w] = key.split('|');
		const n = Number(w);
		return { weightMin: n, weightMax: n, style, url };
	});
	variants.sort((a, b) => a.style.localeCompare(b.style) || a.weightMin - b.weightMin);
	return { family, variants };
}

const entries = [];
const failed = [];

function report(family, variants) {
	const styles = new Set(variants.map((v) => v.style));
	process.stderr.write(
		`  ok   ${family} (${variants.length} variant${variants.length > 1 ? 's' : ''}${styles.has('italic') ? ', +italic' : ''})\n`
	);
}

for (const [family, category, aliases] of FAMILIES) {
	const variants = resolve(family);
	if (!variants) {
		failed.push(family);
		process.stderr.write(`  FAIL ${family}\n`);
		continue;
	}
	const entry = { family, vendor: 'google', licenseTier: 'ofl', category };
	if (aliases) entry.aliases = aliases;
	entry.variants = variants;
	entries.push(entry);
	report(family, variants);
}

process.stderr.write('  --- fontshare ---\n');
for (const [slug, category] of FONTSHARE) {
	const res = resolveFontshare(slug);
	if (!res) {
		failed.push(slug);
		process.stderr.write(`  FAIL ${slug}\n`);
		continue;
	}
	entries.push({
		family: res.family,
		vendor: 'fontshare',
		licenseTier: 'free-proprietary',
		category,
		variants: res.variants
	});
	report(res.family, res.variants);
}

writeFileSync(OUT, JSON.stringify(entries, null, 2) + '\n');
process.stderr.write(`\nWrote ${entries.length} families to ${OUT}\n`);
if (failed.length) process.stderr.write(`Failed (${failed.length}): ${failed.join(', ')}\n`);
