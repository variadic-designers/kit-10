import type { ResolvedKit } from 'manager';

export type InputType =
	'color' | 'text' | 'number' | 'select' | 'slider' | 'font' | 'children' | 'asset';

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
export type ImageSource = 'None' | { Url: string } | { Bytes: number[] } | { Ref: string };

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
		object_position: [number, number];
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
	// MessagePack-encoded Vec<UiNode>, base64-encoded for JSON transport. When present, the JS
	// side base64-decodes this and calls vellum.set_data_binary() instead of the JSON-stringified
	// viewport_data path — avoids the ~47ms JSON parse wall at 10k views.
	viewport_data_binary?: string;
}

// Panel manifest published by a plugin via `kit10_panel_publish`. The editor's panels are
// generic renderers over this shape — topology lives plugin-side, live metadata (view names,
// locked) stays in the editor's own DB query and is joined against `id` at render time. Wire
// keys are snake_case (plugin-authored output, see CLAUDE.md's camelCase pitfall).
export interface PanelOp {
	name: string;
	label: string;
	icon: string;
	// Op-specific payload. Today only `add-child` uses it to carry which primitive to create
	// ("box"|"text"|"image"); other ops leave it null.
	kind: string | null;
}

export interface PanelItem {
	id: string;
	// Token alias to upsert when DnD writes this item's children list. null when this item's
	// primitive has no `children` field (e.g. Text/Image) — panel hides the DnD-nest affordance.
	write_alias: string | null;
	// Ops the plugin declares available on this item — drives the editor's right-click context
	// menu. Each op is self-describing: `name` is the dispatch key, `label`/`icon` are what to
	// render. Editor switches on `name` to execute (rename/delete/clone/lock/hide/add-child).
	ops: PanelOp[];
}

export interface PanelManifest {
	panel_id: string;
	// The resolved-property keys Charter treats as view-composition fields (its fields whose
	// inputType is the composition kind). Charter's whole opinion on nesting: "this field's
	// `viewRefs` are the children." The host walks `resolvedViews` for these keys to build the
	// DAG client-side — root detection, ordering, cycle guarding are generic graph math, not
	// plugin-owned, so they don't ride the manifest.
	composition_field_keys: string[];
	// One entry per opaque id (one per project view today). The panel indexes by `id` and
	// applies per-view plugin-opinionated facts (write_alias + ops) as it renders the
	// host-computed DAG topology.
	items: PanelItem[];
	// Ops declared for the panel's header affordance (e.g. the "+" menu in the Views panel
	// header). Same shape as per-item `ops`; the editor renders the header menu straight off
	// this list.
	header_ops: PanelOp[];
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
