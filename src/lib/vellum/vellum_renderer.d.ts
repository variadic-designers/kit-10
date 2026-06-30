/* tslint:disable */
/* eslint-disable */

export function get_selection(x: number, y: number): number | undefined;

export function initialize(canvas_id: string, width: number, height: number): Promise<void>;

export function render(): void;

export function resize(width: number, height: number): void;

export function set_data(json: string): void;

export function set_pan(dx: number, dy: number): void;

export function set_zoom(zoom: number): void;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly get_selection: (a: number, b: number) => number;
    readonly initialize: (a: number, b: number, c: number, d: number) => number;
    readonly render: () => void;
    readonly resize: (a: number, b: number) => void;
    readonly set_data: (a: number, b: number) => void;
    readonly set_pan: (a: number, b: number) => void;
    readonly set_zoom: (a: number) => void;
    readonly __wasm_bindgen_func_elem_7242: (a: number, b: number, c: number, d: number) => void;
    readonly __wasm_bindgen_func_elem_7261: (a: number, b: number, c: number, d: number) => void;
    readonly __wasm_bindgen_func_elem_5856: (a: number, b: number, c: number) => void;
    readonly __wbindgen_export: (a: number, b: number) => number;
    readonly __wbindgen_export2: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_export3: (a: number) => void;
    readonly __wbindgen_export4: (a: number, b: number) => void;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
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
