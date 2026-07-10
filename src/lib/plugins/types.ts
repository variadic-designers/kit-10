import type { ResolvedKit } from 'manager';

export type InputType = 'color' | 'text' | 'number' | 'select' | 'slider' | 'font' | 'children';

// Names which utility plugin + functions serve suggestions for a field -- the editor never
// hardcodes a specific plugin (e.g. Fontavious) or property key. See VISION.md's 1st Principle.
export interface SuggestionSource {
	plugin: string;
	searchFn: string;
	fetchFn?: string;
}

export interface FieldDef {
	key: string;
	displayText?: string;
	inputType?: InputType;
	options?: string[];
	layerId?: string;
	suggestionsFrom?: SuggestionSource;
}

export interface FieldCategory {
	name: string;
	fields: FieldDef[];
}

export interface FieldUpdate {
	layerId: string;
	property: string;
	value?: string | null;
	tokenId?: string | null;
}

export interface WriteRenderEntryInput {
	layer_id: string;
	property: string;
	value?: string | null;
	token_id?: string | null;
}

export interface WriteRenderEntryResult {
	success: boolean;
	entry_id?: string;
	error?: string;
}

export type FlexDir = 'Row' | 'Column' | 'RowReverse' | 'ColumnReverse';
export type FontStyle = 'Normal' | 'Italic' | 'Oblique';
export type ImageSource = 'None' | { Url: string } | { Bytes: number[] };

export interface BoxShadow {
	offset_x: number;
	offset_y: number;
	blur_radius: number;
	spread_radius: number;
	color: [number, number, number, number];
	inset: boolean;
}

export interface UiBoxNode {
	Box: {
		parent_id: number | null;
		width: number;
		height: number;
		max_width: number;
		max_height: number;
		padding: [number, number, number, number];
		bg_color: [number, number, number, number];
		flex_direction: FlexDir;
		show_border: boolean;
		border_color: [number, number, number, number];
		border_width: number;
		corner_radius: number;
		opacity: number;
		shadow: BoxShadow | null;
	};
}

export interface UiTextNode {
	Text: {
		parent_id: number | null;
		width: number;
		height: number;
		padding: [number, number, number, number];
		bg_color: [number, number, number, number];
		show_border: boolean;
		border_color: [number, number, number, number];
		border_width: number;
		corner_radius: number;
		opacity: number;
		content: string;
		font_size: number;
		font_family: string;
		font_weight: number;
		font_style: FontStyle;
		text_color: [number, number, number, number];
	};
}

export interface UiImgNode {
	Img: {
		parent_id: number | null;
		width: number;
		height: number;
		source: ImageSource;
		cover: boolean;
	};
}

export type UiNode = UiBoxNode | UiTextNode | UiImgNode;

export interface OnResolveResult {
	categories: FieldCategory[];
	viewport_data: UiNode[];
	// Parallel to viewport_data (same length/order) -- which view each node belongs to. "" for
	// structural grid scaffolding nodes that don't belong to any view. Used to resolve a
	// viewport click-to-select hit-test index (from vellum.get_selection) back to a view id.
	node_view_ids: string[];
	// Property keys the plugin declares as view-composition fields, view-independent (across all
	// primitives) -- the editor nests the Views tree off these regardless of the active view.
	composition_field_keys?: string[];
}

export interface PluginMeta {
	name: string;
	version: string;
	description: string;
}

export type PluginStatus = 'loading' | 'ready' | 'error' | 'disabled';

export interface ResolvedView {
	viewId: string;
	viewName: string;
	hints: Record<string, unknown> | null;
	resolvedKits: ResolvedKit[];
}

export interface LoadedPlugin {
	name: string;
	status: PluginStatus;
	error?: string;
}

export interface PluginManagerOptions {
	editor: import('manager').EditorState;
	api: import('manager').Api;
}

export interface PluginContext {
	resolvedKits: ResolvedKit[] | null;
}
