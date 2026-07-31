// Pure parse/serialize helpers for `grid-template-areas` raw CSS text, backing GridAreaPainter.
// Mirrors Charter's parse_grid_template_areas / WebCodium's grid_template_areas_css so the visual
// painter and the raw "Custom tracks" text escape hatch stay two views onto the exact same
// property, and the painted output always round-trips as genuine, spec-correct CSS.

export interface Area {
	name: string;
	// 1-indexed grid lines, end exclusive -- mirrors kit10-scene's GridTemplateArea exactly.
	rowStart: number;
	rowEnd: number;
	colStart: number;
	colEnd: number;
}

export function parseAreas(raw: string): Area[] {
	const rows: string[][] = [];
	const rowMatches = raw.match(/"([^"]*)"/g) ?? [];
	for (const m of rowMatches) {
		rows.push(m.slice(1, -1).trim().split(/\s+/).filter(Boolean));
	}

	const bounds = new Map<string, [number, number, number, number]>(); // name -> [rs, re, cs, ce]
	rows.forEach((row, rowIdx) => {
		row.forEach((name, colIdx) => {
			if (name === '.') return;
			const rowLine = rowIdx + 1;
			const colLine = colIdx + 1;
			const existing = bounds.get(name);
			if (existing) {
				existing[0] = Math.min(existing[0], rowLine);
				existing[1] = Math.max(existing[1], rowLine + 1);
				existing[2] = Math.min(existing[2], colLine);
				existing[3] = Math.max(existing[3], colLine + 1);
			} else {
				bounds.set(name, [rowLine, rowLine + 1, colLine, colLine + 1]);
			}
		});
	});

	return Array.from(bounds.entries())
		.map(([name, [rowStart, rowEnd, colStart, colEnd]]) => ({ name, rowStart, rowEnd, colStart, colEnd }))
		.sort((a, b) => a.name.localeCompare(b.name));
}

// `rowCount`/`colCount` come from the actual defined track lists (GridTracksField's own parsed
// state), not re-inferred from the areas alone -- a trailing row/column with no named area would
// otherwise silently truncate out of the exported grid-template-areas text.
export function serializeAreas(areas: Area[], rowCount: number, colCount: number): string {
	if (rowCount <= 0 || colCount <= 0) return '';
	const rows: string[] = [];
	for (let row = 1; row <= rowCount; row++) {
		const cells: string[] = [];
		for (let col = 1; col <= colCount; col++) {
			const area = areas.find(
				(a) => row >= a.rowStart && row < a.rowEnd && col >= a.colStart && col < a.colEnd
			);
			cells.push(area?.name ?? '.');
		}
		rows.push(`"${cells.join(' ')}"`);
	}
	return rows.join(' ');
}

// Removes any existing area's overlap with a newly painted rectangle -- a cell belongs to at most
// one named area, so painting over part of an existing region shrinks/splits/removes it. Simple
// "clip to bounding box minus the painted rect" model: since areas are always rectangles and the
// painter can only ever paint rectangles too, an overlap is resolved by dropping the old area
// entirely when it overlaps at all (rather than attempting a non-rectangular remainder) -- honest
// and simple; the user can just repaint the remaining cells under a name again.
export function paintArea(existing: Area[], next: Area): Area[] {
	const overlaps = (a: Area) =>
		next.rowStart < a.rowEnd && next.rowEnd > a.rowStart && next.colStart < a.colEnd && next.colEnd > a.colStart;
	const kept = existing.filter((a) => a.name !== next.name && !overlaps(a));
	return [...kept, next];
}

export function removeArea(existing: Area[], name: string): Area[] {
	return existing.filter((a) => a.name !== name);
}

export function renameArea(existing: Area[], oldName: string, newName: string): Area[] {
	if (!newName || newName === oldName) return existing;
	return existing
		.filter((a) => a.name !== newName) // a rename onto an existing name merges into it
		.map((a) => (a.name === oldName ? { ...a, name: newName } : a));
}

export function nextAreaName(existing: Area[]): string {
	let n = 1;
	const names = new Set(existing.map((a) => a.name));
	while (names.has(`area-${n}`)) n++;
	return `area-${n}`;
}
