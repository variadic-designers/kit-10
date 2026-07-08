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

// Vellum renders on demand (Viewport.svelte registers its own requestRender as the
// requester on mount) rather than via a perpetual requestAnimationFrame loop -- see the
// DPR-awareness/render-loop notes in CLAUDE.md. Anything outside Viewport.svelte that mutates
// state Vellum's canvas depends on -- currently just `load_font`, called directly against
// getVellumInstance() from here and StyleField.svelte, entirely outside Viewport's own
// data/theme/pan/zoom effects -- needs to ask for a repaint through here, or the newly-loaded
// font's re-layout (Vellum does this internally, synchronously, as part of load_font) sits
// applied-but-unpainted until some unrelated interaction happens to trigger the next render.
let renderRequester: (() => void) | null = null;

export function setRenderRequester(fn: () => void) {
	renderRequester = fn;
}

export function requestVellumRender() {
	renderRequester?.();
}
