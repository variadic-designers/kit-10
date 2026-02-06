// ------------------------------------------
// 🧠 KIT•10 AxesCascade
// ------------------------------------------
// This class models a deterministic "axes-based" styling cascade.
// Think of it like CSS, but instead of selectors, you have AxesSets
// that define when a particular style block applies.
// ------------------------------------------

// TODO: Some functions are overengineered. Simplify to fit design intentions

/** A single axis can contain one or multiple variant values */
export type Axis = string | string[];

/** A dictionary of layer (Axes Set) resolution for each Axis variant */
export type AxisVariantLayerTrace = {
	[axisVariantId: Axis]: AxesSet[];
};

/** An AxesSet represents the active combination of axis states */
export type AxesSet = Partial<{
	[axisName: string]: Axis;
}>;

/** Basic CSS-style rule dictionary */
export type Style = Partial<{
	[property: string]: string;
}>;

/** Debugging info for a single style entry */
export type StyleSource = {
	axesSignature: string;
	axes: AxesSet;
	style: Style;
	specificity: number;
};

export interface StyleSourceRuntime extends StyleSource {
	axesSignature: string;
	specificity: number;
}

/** Trace entry returned after cascade resolution */
export type TraceEntry = {
	source: AxesSet; // The AxesSet that defined this layer
	applied: Style; // The style values that were merged
	overridden: string[]; // List of properties that were overridden later
	specificity: number; // Numeric precedence score
};

/** Final resolved result */
export type CascadeResult = {
	finalStyle: Style;
	trace: TraceEntry[];
};

// ------------------------------------------
// 🎨 Axes Visualization Helpers
// ------------------------------------------
// These utilities describe relationships between AxesSets,
// allowing the UI to group or color-code them consistently.
// ------------------------------------------

/**
 * Generate a canonical "shape" signature from an AxesSet.
 * Two AxesSets are considered to belong to the same family if
 * their signature strings are equal.
 *
 * Example:
 *   { theme: 'dark', density: 'compact' } → "density+theme"
 */
export function getAxesSignature(axes: AxesSet): string {
	return Object.keys(axes).sort().join('+');
}

/**
 * Determine whether two AxesSets are orthogonal, coinciding, or overlapping.
 * - "coincide" → exactly same keys
 * - "overlap" → share at least one key
 * - "orthogonal" → share no keys
 *
 * Example:
 *   getAxesRelationship({theme:'light'}, {theme:'dark'}) → "coincide"
 *   getAxesRelationship({theme:'light'}, {density:'compact'}) → "orthogonal"
 */
export function getAxesRelationship(a: AxesSet, b: AxesSet): 'coincide' | 'overlap' | 'orthogonal' {
	const keysA = new Set(Object.keys(a));
	const keysB = new Set(Object.keys(b));
	const intersection = [...keysA].filter((k) => keysB.has(k));

	if (intersection.length === keysA.size && keysA.size === keysB.size) return 'coincide';
	if (intersection.length > 0) return 'overlap';
	return 'orthogonal';
}

export interface AxesManager {
	layers: StyleSource[];
	axisRank: AxisDefinition[];
}

export const calculateSpecificity = (axesManager: axesManager, axes: AxesSet): number => {
	let score = Object.keys(axes).length * 100;

	for (const [i, name] of axesManager.axisRank.entries()) {
		if (name in axes) {
			// Give more weight to axes appearing earlier in the rank list
			score += axesManager.axisRank.length - i;
		}
	}

	return score;
};

export const areAxesSetsEquivalent = (a: AxesSet, b: AxesSet): boolean => {
	const keysA = Object.keys(a).sort();
	const keysB = Object.keys(b).sort();
	if (keysA.length !== keysB.length) {
		console.log('Length is very different');
		console.dir(keysA);
		console.dir(keysB);
		console.log('-------------------------');
		return false;
	}
	if (!keysA.every((k, i) => k === keysB[i])) {
		console.log('Keys are not exactly the same');
		return false;
	}

	for (const key of keysA) {
		const aVals = Array.isArray(a[key]) ? [...a[key]].sort() : [a[key]];
		const bVals = Array.isArray(b[key]) ? [...b[key]].sort() : [b[key]];
		if (aVals.length !== bVals.length) return false;
		for (let i = 0; i < aVals.length; i++) {
			if (aVals[i] !== bVals[i]) return false;
		}
	}

	return true;
};

export const add = (axesManager: axesManager, axes: AxesSet, style: Style) => {
	// Step 1: Try to find an existing layer with an equivalent AxesSet
	const existing = axesManager.layers.find((layer) => areAxesSetsEquivalent(layer.axes, axes));

	if (existing) {
		// Step 2: Override the existing layer's style
		// Optionally merge — but overwrite takes priority for same keys
		existing.style = { ...existing.style, ...style };

		// Recalculate specificity in case axisRank changed or expanded
		existing.specificity = calculateSpecificity(axesManager, axes);
		console.log(`Exists, adding to set ${JSON.stringify(existing)}`);
	} else {
		// Step 3: Create a new layer if no match was found
		axesManager.layers.push({
			axes,
			style,
			specificity: calculateSpecificity(axesManager, axes)
		});

		console.log(`Spawned new layer ${JSON.stringify(axes)}`);
	}
};

export const addAxis = (axesManager: AxesManager, axis: AxisDefinition) => {
	axesManager.axisRank.push(axis);
};

export const matches = (context: AxesSet, ruleAxes: AxesSet): boolean => {
	for (const key in ruleAxes) {
		const ruleVal = Array.isArray(ruleAxes[key]) ? ruleAxes[key] : [ruleAxes[key]];
		const ctxVal = Array.isArray(context[key]) ? context[key] : [context[key]];
		if (!ruleVal.every((v) => ctxVal.includes(v))) return false;
	}
	return true;
};

export const resolve = (axesManager: AxesManager, context: AxesSet): CascadeResult => {
	const matched = axesManager.layers
		.filter(({ axes }) => matches(context, axes))
		.sort((a, b) => a.specificity - b.specificity);

	const trace: TraceEntry[] = [];
	const finalStyle: Style = {};
	const appliedProps = new Set<string>();

	for (const { axes, style, specificity } of matched) {
		const overridden: string[] = [];

		for (const prop in style) {
			if (appliedProps.has(prop)) overridden.push(prop);
			finalStyle[prop] = style[prop];
			appliedProps.add(prop);
		}

		trace.push({
			source: axes,
			applied: style,
			overridden,
			specificity
		});
	}

	return { finalStyle, trace };
};

export type ManagerTraceEntry = TraceEntry & {
	managerIndex: number;
	managerId?: string;
};

export type CrossManagerOverride = {
	property: string;
	overriddenByManager: number;
};

export type MultiCascadeResult = {
	finalStyle: Style;
	trace: ManagerTraceEntry[];
	crossOverrides: CrossManagerOverride[];
};

export const resolveMany = (
	managers: AxesManager[],
	context: AxesSet
): MultiCascadeResult => {
	const perManager = managers.map((manager, index) => {
		const result = resolve(manager, context);
		return {
			managerIndex: index,
			manager,
			result
		};
	});

	// Merge styles: last → first so first manager wins
	const finalStyle: Style = {};
	const appliedBy = new Map<string, number>();
	const crossOverrides: CrossManagerOverride[] = [];
	const trace: ManagerTraceEntry[] = [];

	for (let i = perManager.length - 1; i >= 0; i--) {
		const { managerIndex, result } = perManager[i];

		for (const entry of result.trace) {
			trace.push({
				...entry,
				managerIndex
			});
		}

		for (const prop in result.finalStyle) {
			if (prop in finalStyle) {
				crossOverrides.push({
					property: prop,
					overriddenByManager: appliedBy.get(prop)!
				});
				continue;
			}

			finalStyle[prop] = result.finalStyle[prop];
			appliedBy.set(prop, managerIndex);
		}
	}

	return {
		finalStyle,
		trace,
		crossOverrides
	};
};
