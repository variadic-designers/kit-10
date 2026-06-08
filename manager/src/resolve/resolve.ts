import type { SchemaDialect } from '../schema.js';
import type { ArgValue } from '../schema.js';

export interface ResolvedKit {
	kitId: string;
	kitName: string;
	properties: Map<string, ResolvedProperty>;
}

type AxisValueType =
	| { type: 'literal'; value: string }
	| { type: 'range'; operator: '>=' | '<=' | '>' | '<' | 'between'; threshold: number; threshold_high?: number }
	| { type: 'discrete'; value: string };

export interface ResolvedProperty {
	property: string;
	value: string;
	sourceLayerId: string;
	isToken: boolean;
	tokenAlias: string | null;
}

interface LayerCondition {
	axisId: string;
	axisValue: AxisValueType;
	priorityIndex: number;
}

interface LayerEntry {
	property: string;
	literalValue: string | null;
	tokenId: string | null;
	tokenAlias: string | null;
	tokenValue: string | null;
}

interface LayerData {
	id: string;
	conditions: LayerCondition[];
	entries: LayerEntry[];
}

function matchesArg(condition: AxisValueType, arg: ArgValue): boolean {
	switch (condition.type) {
		case 'literal':
			return arg.type === 'literal' && arg.value === condition.value;
		case 'discrete':
			return arg.type === 'literal' && arg.value === condition.value;
		case 'range': {
			const num =
				arg.type === 'literal'
					? parseFloat(arg.value)
					: arg.type === 'range'
						? arg.min
						: NaN;
			if (isNaN(num)) return false;
			switch (condition.operator) {
				case '>=':
					return num >= condition.threshold;
				case '<=':
					return num <= condition.threshold;
				case '>':
					return num > condition.threshold;
				case '<':
					return num < condition.threshold;
				case 'between':
					return num >= condition.threshold && num <= (condition.threshold_high ?? condition.threshold);
			}
			return false;
		}
	}
}

function computeSpecificity(conditions: LayerCondition[]): number[] {
	const count = conditions.length;
	const priorities = conditions.map((c) => c.priorityIndex).sort((a, b) => b - a);
	return [count, ...priorities];
}

function compareSpecificity(a: number[], b: number[]): number {
	for (let i = 0; i < Math.max(a.length, b.length); i++) {
		const ai = a[i] ?? 0;
		const bi = b[i] ?? 0;
		if (ai !== bi) return ai - bi;
	}
	return 0;
}

export async function resolve(
	db: SchemaDialect,
	kitId: string,
	axisArgs: Record<string, ArgValue>,
): Promise<Map<string, ResolvedProperty>> {
	const layers = await db
		.selectFrom('layers')
		.where('layers.kit_id', '=', kitId)
		.select(['layers.id'])
		.execute();

	const layerIds = layers.map((l) => l.id);
	if (layerIds.length === 0) return new Map();

	const conditions = await db
		.selectFrom('layers')
		.where('layers.id', 'in', layerIds)
		.innerJoin('layer_axis_values', 'layer_axis_values.layer_id', 'layers.id')
		.innerJoin('axis_values', 'axis_values.id', 'layer_axis_values.axis_value_id')
		.innerJoin('axes_consumed', (join) =>
			join
				.onRef('axes_consumed.axis_id', '=', 'axis_values.axis_id')
				.onRef('axes_consumed.kit_id', '=', 'layers.kit_id'),
		)
		.select([
			'layer_axis_values.layer_id',
			'axis_values.value',
			'axis_values.axis_id',
			'axes_consumed.priority_index',
		])
		.execute();

	const entries = await db
		.selectFrom('render_entries')
		.innerJoin('render_snippets', 'render_snippets.id', 'render_entries.snippet_id')
		.innerJoin('layers', 'layers.id', 'render_snippets.layer_id')
		.leftJoin('tokens', 'tokens.id', 'render_entries.token_id')
		.where('layers.id', 'in', layerIds)
		.select([
			'layers.id as layer_id',
			'render_entries.property',
			'render_entries.value as literal_value',
			'render_entries.token_id',
			'tokens.alias as token_alias',
			'tokens.value as token_value',
		])
		.execute();

	const layerDataMap = new Map<string, LayerData>();
	for (const layerId of layerIds) {
		layerDataMap.set(layerId, { id: layerId, conditions: [], entries: [] });
	}

	for (const c of conditions) {
		const data = layerDataMap.get(c.layer_id);
		if (data && c.value) {
			data.conditions.push({
				axisId: c.axis_id,
				axisValue: c.value as any as AxisValueType,
				priorityIndex: c.priority_index,
			});
		}
	}

	for (const e of entries) {
		const data = layerDataMap.get(e.layer_id);
		if (data) {
			data.entries.push({
				property: e.property,
				literalValue: e.literal_value,
				tokenId: e.token_id,
				tokenAlias: e.token_alias,
				tokenValue: e.token_value,
			});
		}
	}

	const matchingLayers: { data: LayerData; specificity: number[] }[] = [];
	for (const [, data] of layerDataMap) {
		const allMatch = data.conditions.every((c) => {
			const arg = axisArgs[c.axisId];
			if (!arg) return false;
			return matchesArg(c.axisValue, arg);
		});

		if (allMatch) {
			const specificity = computeSpecificity(data.conditions);
			matchingLayers.push({ data, specificity });
		}
	}

	matchingLayers.sort((a, b) => compareSpecificity(a.specificity, b.specificity));

	const result = new Map<string, ResolvedProperty>();
	for (const { data } of matchingLayers) {
		for (const entry of data.entries) {
			const resolvedValue = entry.tokenId ? (entry.tokenValue ?? '') : (entry.literalValue ?? '');
			result.set(entry.property, {
				property: entry.property,
				value: resolvedValue,
				sourceLayerId: data.id,
				isToken: !!entry.tokenId,
				tokenAlias: entry.tokenAlias,
			});
		}
	}

	return result;
}

export async function resolveMany(
	db: SchemaDialect,
	viewId: string,
): Promise<ResolvedKit[]> {
	const compositions = await db
		.selectFrom('compositions')
		.innerJoin('kits', 'kits.id', 'compositions.kit_id')
		.where('compositions.view_id', '=', viewId)
		.orderBy('compositions.priority_index', 'asc')
		.select(['compositions.kit_id', 'compositions.priority_index', 'kits.name as kit_name'])
		.execute();

	const axisArgs = await db
		.selectFrom('axis_args')
		.where('axis_args.view_id', '=', viewId)
		.select(['axis_args.kit_id', 'axis_args.axis_id', 'axis_args.value'])
		.execute();

	const argsByKit = new Map<string, Record<string, ArgValue>>();
	for (const arg of axisArgs) {
		if (!arg.value) continue;
		if (!argsByKit.has(arg.kit_id)) argsByKit.set(arg.kit_id, {});
		argsByKit.get(arg.kit_id)![arg.axis_id] = arg.value as ArgValue;
	}

	const results: ResolvedKit[] = [];
	for (const comp of compositions) {
		const kitArgs = argsByKit.get(comp.kit_id) ?? {};
		const properties = await resolve(db, comp.kit_id, kitArgs);
		results.push({
			kitId: comp.kit_id,
			kitName: comp.kit_name,
			properties,
		});
	}

	return results;
}

export function flattenKitResults(kits: ResolvedKit[]): Map<string, ResolvedProperty> {
	const merged = new Map<string, ResolvedProperty>();
	for (const kit of kits) {
		for (const [prop, resolved] of kit.properties) {
			merged.set(prop, resolved);
		}
	}
	return merged;
}