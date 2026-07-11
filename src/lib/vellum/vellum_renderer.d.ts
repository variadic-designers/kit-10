/* tslint:disable */
/* eslint-disable */

export function ensure_index_visible(index: number): boolean;

export function get_selection(x: number, y: number): number | undefined;

export function initialize(canvas_id: string, width: number, height: number): Promise<void>;

export function is_font_loaded(name: string): boolean;

export function load_font(bytes: Uint8Array): string[];

export function load_image(id: string, bytes: Uint8Array): void;

export function render(): void;

export function resize(width: number, height: number): void;

export function set_colors(grid_r: number, grid_g: number, grid_b: number, grid_a: number, bg_r: number, bg_g: number, bg_b: number, bg_a: number): void;

export function set_data(json: string): void;

/**
 * Binary-path equivalent of `set_data` — deserializes a MessagePack-encoded `Vec<UiNode>` instead of
 * JSON. ~4× faster than serde_json for the same data, and avoids the 47ms parse wall at 10k views.
 * Kept as a separate export so the JS side can choose which to call based on what Charter emitted.
 */
export function set_data_binary(bytes: Uint8Array): void;

export function set_pan(dx: number, dy: number): void;

export function set_pixel_snap(on: boolean): void;

export function set_zoom(zoom: number): void;

export function zoom_in(): void;

export function zoom_in_at(cx: number, cy: number): void;

export function zoom_out(): void;

export function zoom_out_at(cx: number, cy: number): void;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly ensure_index_visible: (a: number) => number;
    readonly get_selection: (a: number, b: number) => number;
    readonly initialize: (a: number, b: number, c: number, d: number) => number;
    readonly is_font_loaded: (a: number, b: number) => number;
    readonly load_font: (a: number, b: number, c: number) => void;
    readonly load_image: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly render: () => void;
    readonly resize: (a: number, b: number) => void;
    readonly set_colors: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
    readonly set_data: (a: number, b: number) => void;
    readonly set_data_binary: (a: number, b: number) => void;
    readonly set_pan: (a: number, b: number) => void;
    readonly set_pixel_snap: (a: number) => void;
    readonly set_zoom: (a: number) => void;
    readonly zoom_in: () => void;
    readonly zoom_in_at: (a: number, b: number) => void;
    readonly zoom_out: () => void;
    readonly zoom_out_at: (a: number, b: number) => void;
    readonly __wasm_bindgen_func_elem_8656: (a: number, b: number, c: number, d: number) => void;
    readonly __wasm_bindgen_func_elem_8675: (a: number, b: number, c: number, d: number) => void;
    readonly __wasm_bindgen_func_elem_7268: (a: number, b: number, c: number) => void;
    readonly __wbindgen_export: (a: number, b: number) => number;
    readonly __wbindgen_export2: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_export3: (a: number) => void;
    readonly __wbindgen_export4: (a: number, b: number) => void;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
    readonly __wbindgen_export5: (a: number, b: number, c: number) => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
