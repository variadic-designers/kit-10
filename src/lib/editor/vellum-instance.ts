// Shared handle to the initialized Vellum wasm module. Viewport.svelte owns the actual
// instance (it's the only thing that calls `initialize`), but other parts of the editor --
// the font picker, the resolve-time font scan -- need to call `load_font`/`is_font_loaded`
// without being anywhere in Viewport's component subtree. A plain module-level singleton
// (same pattern as theming.ts's store) avoids threading it through props across branches of
// the component tree that don't otherwise share a parent-child relationship.
type VellumModule = typeof import('../vellum/vellum_renderer.js');

let instance: VellumModule | null = null;

export function setVellumInstance(v: VellumModule) {
	instance = v;
}

export function getVellumInstance(): VellumModule | null {
	return instance;
}
