import type { AxisValueType } from 'manager';

// The single place that declares what each axis kind needs -- both the "New Axis" context menu
// (Axes.svelte) and the value-management UI (Axis.svelte) read from this instead of branching on
// `kind` themselves. Adding real Range/Number support later is "fill in this descriptor's
// functions and flip `enabled: true`", not a new creation flow or a new form component. Mirrors
// the "declare shape as data, one generic consumer renders/acts on it" convention Charter already
// uses for FieldDef's inputType + side-channel keys (arrangeKeys/resizeKeys).

export type AxisKindId = 'categorical' | 'range' | 'number';

export interface AxisKindDescriptor {
	id: AxisKindId;
	label: string;
	icon: string;
	description: string;
	enabled: boolean;
	// What createAxisWithValues seeds a brand-new axis of this kind with.
	createSeedValues: () => AxisValueType[];
	// What "+ Add Value" inserts, given the axis's current values (for numbering, uniqueness, etc).
	createDefaultValue: (existing: AxisValueType[]) => AxisValueType;
	// Display text for a value, fed to Renameable's `value` prop.
	valueLabel: (v: AxisValueType) => string;
	// Renameable's onCommit -> the new AxisValueType to write back.
	parseLabel: (raw: string, prev: AxisValueType) => AxisValueType;
}

function nextOptionLabel(existing: AxisValueType[]): string {
	const used = new Set(
		existing
			.map((v) => (v.type === 'literal' || v.type === 'discrete' ? v.value : null))
			.filter((v): v is string => v !== null)
	);
	let n = existing.length + 1;
	while (used.has(`Option ${n}`)) n++;
	return `Option ${n}`;
}

function notImplemented(kind: AxisKindId): never {
	throw new Error(`Axis kind "${kind}" is not implemented yet`);
}

export const AXIS_KINDS: Record<AxisKindId, AxisKindDescriptor> = {
	categorical: {
		id: 'categorical',
		label: 'Categorical',
		icon: 'fa-solid fa-list',
		description: 'Discrete named variants (e.g. theme: light/dark)',
		enabled: true,
		createSeedValues: () => [{ type: 'literal', value: 'Option 1' }],
		createDefaultValue: (existing) => ({ type: 'literal', value: nextOptionLabel(existing) }),
		valueLabel: (v) => (v.type === 'literal' || v.type === 'discrete' ? v.value : String(v)),
		parseLabel: (raw, prev) => {
			const trimmed = raw.trim();
			if (prev.type === 'literal' || prev.type === 'discrete') {
				return { ...prev, value: trimmed };
			}
			return { type: 'literal', value: trimmed };
		}
	},
	range: {
		id: 'range',
		label: 'Range (exclusive)',
		icon: 'fa-solid fa-arrow-right-arrow-left',
		description: 'Not yet available',
		enabled: false,
		createSeedValues: () => notImplemented('range'),
		createDefaultValue: () => notImplemented('range'),
		valueLabel: () => notImplemented('range'),
		parseLabel: () => notImplemented('range')
	},
	number: {
		id: 'number',
		label: 'Number (continuous)',
		icon: 'fa-solid fa-arrow-down-1-9',
		description: 'Not yet available',
		enabled: false,
		createSeedValues: () => notImplemented('number'),
		createDefaultValue: () => notImplemented('number'),
		valueLabel: () => notImplemented('number'),
		parseLabel: () => notImplemented('number')
	}
};
