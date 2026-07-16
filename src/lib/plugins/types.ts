import type { ResolvedKit } from 'manager';

export type InputType =
	| 'color'
	| 'text'
	| 'number'
	| 'select'
	| 'slider'
	| 'font'
	| 'children'
	| 'asset'
	// Figma-style per-axis resizing: a Fixed/Hug/Fill segmented control that writes the keyword
	// values Charter's compile_resize understands (`fill` / `hug` / a length). See StyleField.
	| 'resize'
	// Charter's arrangement opinion: a Stack/Cluster/Split/Center/Grid tab row + inline submenu
	// that writes the keyword values compile_arrange understands. See ArrangeField.
	| 'arrange'
	// A numeric stepper (see FieldDef.spacingMode for scalar vs. CSS-shorthand box mode). See
	// SpacingField.
	| 'spacing';

// Names which utility plugin + functions serve suggestions for a field -- the editor never
// hardcodes a specific plugin (e.g. Fontavious) or property key. See VISION.md's 1st Principle.
export interface SuggestionSource {
	plugin: string;
	searchFn: string;
	fetchFn?: string;
}

// Declared only on the "arrange" FieldDef -- the companion property keys/FieldDefs its tab widget
// reads and writes, so the editor never hardcodes property names like "flex-direction" or "gap".
// Same "typed side-channel keyed by inputType" shape as SuggestionSource. Mirrors Charter's
// ArrangeKeys struct exactly (camelCase, see plugins/charter/src/lib.rs).
export interface ArrangeKeys {
	directionKey: string;
	gap: FieldDef;
	cellMin: FieldDef;
	advanced: FieldDef[];
	gridAdvanced: FieldDef[];
}

// Declared only on "resize" FieldDefs (width/height) -- the dimension's own min/max limit fields,
// revealed as inline follow-ons exactly when a limit is meaningful (Fill, or a fixed % of the
// parent) instead of four permanent top-level rows. Mirrors Charter's ResizeKeys struct exactly
// (camelCase, see plugins/charter/src/lib.rs).
export interface ResizeKeys {
	min: FieldDef;
	max: FieldDef;
}

export interface FieldDef {
	key: string;
	displayText?: string;
	inputType?: InputType;
	options?: string[];
	layerId?: string;
	suggestionsFrom?: SuggestionSource;
	arrangeKeys?: ArrangeKeys;
	resizeKeys?: ResizeKeys;
	// Only meaningful when inputType is "spacing". "scalar" (gap, cell-min -- one number) vs.
	// "box" (padding -- CSS 1/2/3/4-value shorthand with a 1<->4 expand/collapse affordance).
	spacingMode?: 'scalar' | 'box';
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

// A box-model size dimension, mirroring Vellum/Charter's `Extent` serde enum. `"Auto"` is a
// unit variant (bare string); `Px`/`Percent` are newtype variants (single-key object). These
// are produced by Charter and consumed by Vellum — the editor passes them through opaquely.
export type Extent = 'Auto' | { Px: number } | { Percent: number };

export interface UiBoxNode {
	Box: {
		parent_id: number | null;
		width: Extent;
		height: Extent;
		min_width: Extent;
		min_height: Extent;
		max_width: Extent;
		max_height: Extent;
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
		width: Extent;
		height: Extent;
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
		width: Extent;
		height: Extent;
		source: ImageSource;
		// CSS object-fit: "cover" | "contain" | "fill". Field name must match Vellum's `fit`.
		fit: string;
		object_position: [number, number];
	};
}

export type UiNode = UiBoxNode | UiTextNode | UiImgNode;

// One weight-range + style a font family actually has. Assembled host-side (Editor.svelte)
// from Fontavious's `family_facts` and handed to Charter in on_resolve's `fontFacts` map,
// where resolve_font_weight snaps requested weights to what the family can really render.
// camelCase: JS-authored input (see the wire-format pitfall in CLAUDE.md).
export interface FontFactVariant {
	weightMin: number;
	weightMax: number;
	style: string;
}

export interface FamilyFacts {
	variants: FontFactVariant[];
}

// The concrete (family, weight, style) set Charter's viewport renders, post weight-snapping —
// what the editor's font scan fetches, so it never re-derives weights from raw kit properties.
// snake_case fields: Charter-authored output.
export interface FontRequest {
	family: string;
	weight: number;
	style: string;
}

export interface OnResolveResult {
	categories: FieldCategory[];
	viewport_data: UiNode[];
	// Parallel to viewport_data (same length/order) -- which view each node belongs to. "" for
	// structural grid scaffolding nodes that don't belong to any view. Used to resolve a
	// viewport click-to-select hit-test index (from vellum.get_selection) back to a view id.
	node_view_ids: string[];
	font_requests?: FontRequest[];
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
