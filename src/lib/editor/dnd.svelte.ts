// Reusable pointer-based drag-and-drop shared across editor panels.
//
// Why pointer events, not HTML5 native drag: native DnD gives you a frozen drag *image* and only
// coarse dragover feedback -- you can't make the dragged thing leave the flow and chase the cursor,
// and you can't show a live "it'll land here" indicator between items. A pointer-driven controller
// can: it renders one floating ghost that follows the mouse, and on every move it hit-tests the
// registered drop zones to light up the exact insertion point.
//
// Two actions plus a central controller:
//   - `draggable(node, { payload, preview?, disabled? })` -- a drag source. Nothing drags until the
//     pointer moves past a small threshold (so a plain click is never a drag). `disabled` leaves the
//     element fully inert/interactive (e.g. a rename <input> nested in a source stays selectable).
//   - `dropZone(node, { accepts, onDrop, canDrop?, mode? })` -- a target. `mode: 'into'` (default)
//     highlights the whole node (`dnd-over`); `mode: 'reorder'` computes a before/after edge from
//     the pointer's position over the node and marks it (`dnd-insert-before`/`dnd-insert-after`),
//     passing that edge to `onDrop` so a list can insert on the correct side.
// The payload is a discriminated union keyed on `kind`; extend it as new surfaces appear.

import { get } from 'svelte/store';
import { keybinds, matchKey } from './keybinds.js';

export type DragPayload =
	| { kind: 'axis'; axisId: string; kitId: string; label?: string }
	| { kind: 'axis-value'; axisValueId: string; axisId: string }
	| { kind: 'token'; tokenId: string; alias: string; valueType?: string }
	| { kind: 'view'; viewId: string; viewName: string; parentViewId: string | null };

export type DragKind = DragPayload['kind'];
// Where a drop lands relative to the hovered node. `reorder` zones only ever yield before/after;
// `tree` zones add `into` (drop onto the middle of a row to nest under it, Figma-style).
export type DropPosition = 'before' | 'after' | 'into';

let active = $state<DragPayload | null>(null);
/** The drag currently in flight, or null. Reactive -- reading it in a template/$derived tracks it. */
export function activeDrag(): DragPayload | null {
	return active;
}

// --- controller state (plain, non-reactive: driven imperatively during a drag) ---
const pointer = { x: 0, y: 0 };
let ghost: HTMLElement | null = null;
let sourceNode: HTMLElement | null = null;
// Setting `body { cursor: grabbing }` isn't enough: any element with its own `cursor` (e.g. another
// draggable header with `cursor: pointer`) wins on hover and the cursor flickers back to normal
// mid-drag. A document-wide `!important` override, injected only while a drag is in flight, forces
// grabbing over every element the pointer crosses.
let cursorLock: HTMLStyleElement | null = null;

type ZoneConfig = {
	accepts: DragKind[];
	mode: 'into' | 'reorder' | 'tree';
	canDrop?: (p: DragPayload) => boolean;
	onDrop: (p: DragPayload, detail: { position: DropPosition }) => void;
};
const zones = new Map<HTMLElement, ZoneConfig>();

let hovered: HTMLElement | null = null;
let hoveredPosition: DropPosition | null = null;

function zoneEligible(cfg: ZoneConfig, p: DragPayload): boolean {
	return cfg.accepts.includes(p.kind) && (!cfg.canDrop || cfg.canDrop(p));
}

function clearHints() {
	if (hovered) {
		hovered.classList.remove('dnd-over', 'dnd-insert-before', 'dnd-insert-after');
	}
	hovered = null;
	hoveredPosition = null;
}

const POSITION_CLASS: Record<DropPosition, string> = {
	before: 'dnd-insert-before',
	after: 'dnd-insert-after',
	into: 'dnd-over'
};

// Closest registered, eligible zone at the current pointer position (ghost is pointer-events:none,
// so elementFromPoint sees through it to the real target underneath).
function zoneAtPointer(): { node: HTMLElement; cfg: ZoneConfig } | null {
	if (!active) return null;
	let el = document.elementFromPoint(pointer.x, pointer.y) as HTMLElement | null;
	while (el) {
		const cfg = zones.get(el);
		if (cfg) return zoneEligible(cfg, active) ? { node: el, cfg } : null;
		el = el.parentElement;
	}
	return null;
}

function updateHover() {
	const hit = zoneAtPointer();
	if (!hit) {
		clearHints();
		return;
	}
	if (hit.node !== hovered) {
		clearHints();
		hovered = hit.node;
	}
	// Where in the node is the pointer? `into` covers the whole node; `reorder` splits at the
	// midpoint into before/after; `tree` reserves the top/bottom bands for before/after sibling
	// insertion and the middle for nesting `into` the row.
	let position: DropPosition;
	if (hit.cfg.mode === 'into') {
		position = 'into';
	} else {
		const r = hit.node.getBoundingClientRect();
		const rel = (pointer.y - r.top) / r.height;
		if (hit.cfg.mode === 'tree') {
			position = rel < 0.3 ? 'before' : rel > 0.7 ? 'after' : 'into';
		} else {
			position = rel < 0.5 ? 'before' : 'after';
		}
	}
	if (position !== hoveredPosition) {
		hit.node.classList.remove('dnd-over', 'dnd-insert-before', 'dnd-insert-after');
		hit.node.classList.add(POSITION_CLASS[position]);
		hoveredPosition = position;
	}
}

function positionGhost() {
	if (ghost) ghost.style.transform = `translate(${pointer.x + 14}px, ${pointer.y + 10}px)`;
}

function beginDrag(payload: DragPayload, preview: string, node: HTMLElement) {
	active = payload;
	sourceNode = node;
	node.classList.add('dnd-dragging');
	document.body.style.userSelect = 'none';
	cursorLock = document.createElement('style');
	cursorLock.textContent = '*{cursor:grabbing !important;}';
	document.head.appendChild(cursorLock);

	ghost = document.createElement('div');
	ghost.textContent = preview;
	Object.assign(ghost.style, {
		position: 'fixed',
		left: '0',
		top: '0',
		pointerEvents: 'none',
		zIndex: '99999',
		padding: '4px 10px',
		borderRadius: '6px',
		background: 'var(--color-surface-alt, oklch(32.1% 0 0))',
		color: 'var(--color-primary, oklch(100% 0 0))',
		border: '1px solid var(--color-primary, oklch(62.7% 0 0))',
		boxShadow: '0 8px 24px oklch(0% 0 0 / 0.28)',
		font: '600 12px/1.4 system-ui, sans-serif',
		letterSpacing: '0.5px',
		whiteSpace: 'nowrap',
		opacity: '0.96'
	} satisfies Partial<CSSStyleDeclaration>);
	document.body.appendChild(ghost);
	positionGhost();

	window.addEventListener('pointermove', onDragMove, true);
	window.addEventListener('pointerup', onDragUp, true);
	window.addEventListener('pointercancel', endDrag, true);
	window.addEventListener('keydown', onDragKey, true);
}

function onDragMove(e: PointerEvent) {
	pointer.x = e.clientX;
	pointer.y = e.clientY;
	positionGhost();
	updateHover();
}

function onDragUp(e: PointerEvent) {
	pointer.x = e.clientX;
	pointer.y = e.clientY;
	updateHover();
	const hit = zoneAtPointer();
	const position = hoveredPosition ?? 'into';
	const payload = active;
	endDrag();
	if (hit && payload) hit.cfg.onDrop(payload, { position });
}

function onDragKey(e: KeyboardEvent) {
	if (matchKey(e, get(keybinds)['edit.cancel'])) endDrag();
}

function endDrag() {
	clearHints();
	ghost?.remove();
	ghost = null;
	sourceNode?.classList.remove('dnd-dragging');
	sourceNode = null;
	active = null;
	document.body.style.userSelect = '';
	cursorLock?.remove();
	cursorLock = null;
	window.removeEventListener('pointermove', onDragMove, true);
	window.removeEventListener('pointerup', onDragUp, true);
	window.removeEventListener('pointercancel', endDrag, true);
	window.removeEventListener('keydown', onDragKey, true);
}

// --- draggable action ---

export type PayloadGetter = () => DragPayload | null;

export interface DraggableOptions {
	/** Produces the payload at drag time; returning null aborts the drag. */
	payload: PayloadGetter;
	/** Text shown in the floating ghost that follows the cursor. Defaults to the payload kind. */
	preview?: string;
	/**
	 * When true the element never starts a drag and stays fully interactive. Read this eagerly in
	 * the `use:` argument (pass an object literal, not a bare arrow) so Svelte actually re-runs the
	 * action's `update` when it flips -- a flag hidden inside an uncalled arrow has no reactive read.
	 */
	disabled?: boolean;
}

function normalize(param: PayloadGetter | DraggableOptions): DraggableOptions {
	return typeof param === 'function' ? { payload: param } : param;
}

export function draggable(node: HTMLElement, param: PayloadGetter | DraggableOptions) {
	let o = normalize(param);
	let startX = 0;
	let startY = 0;
	let armed = false;
	// True once the current gesture crossed the threshold into a real drag. Used to swallow the
	// trailing `click` the browser still synthesizes on pointerup -- otherwise dragging an element
	// that also handles clicks (e.g. a <summary> that toggles its <details>) would fire that action
	// as an accidental side effect of the drag. Reset at the start of every gesture (onDown).
	let dragged = false;

	function disarm() {
		armed = false;
		window.removeEventListener('pointermove', onArmMove, true);
		window.removeEventListener('pointerup', onArmUp, true);
	}

	function onArmMove(e: PointerEvent) {
		if (!armed) return;
		if (Math.hypot(e.clientX - startX, e.clientY - startY) < 4) return; // below drag threshold
		const p = o.payload();
		disarm();
		if (!p) return;
		dragged = true;
		pointer.x = e.clientX;
		pointer.y = e.clientY;
		beginDrag(p, o.preview ?? p.kind, node);
		e.preventDefault();
	}

	function onClickCapture(e: MouseEvent) {
		if (dragged) {
			e.preventDefault();
			e.stopPropagation();
			dragged = false;
		}
	}

	function onArmUp() {
		disarm();
	}

	function onDown(e: PointerEvent) {
		dragged = false;
		if (e.button !== 0 || o.disabled) return;
		if (!o.payload()) return;
		startX = e.clientX;
		startY = e.clientY;
		armed = true;
		window.addEventListener('pointermove', onArmMove, true);
		window.addEventListener('pointerup', onArmUp, true);
	}

	node.style.touchAction = 'none';
	node.addEventListener('pointerdown', onDown);
	node.addEventListener('click', onClickCapture, true);

	return {
		update(next: PayloadGetter | DraggableOptions) {
			o = normalize(next);
		},
		destroy() {
			disarm();
			node.removeEventListener('pointerdown', onDown);
			node.removeEventListener('click', onClickCapture, true);
		}
	};
}

// --- dropZone action ---

export interface DropOptions {
	/** Which drag kind(s) this zone accepts. */
	accepts: DragKind | DragKind[];
	onDrop: (payload: DragPayload, detail: { position: DropPosition }) => void;
	/** Extra per-drag veto beyond `accepts`. */
	canDrop?: (payload: DragPayload) => boolean;
	/**
	 * `into` (default) highlights the whole node and always drops `into` it; `reorder` splits the
	 * node at its midpoint into before/after; `tree` adds a middle `into` band for nesting.
	 */
	mode?: 'into' | 'reorder' | 'tree';
}

function toConfig(o: DropOptions): ZoneConfig {
	return {
		accepts: Array.isArray(o.accepts) ? o.accepts : [o.accepts],
		mode: o.mode ?? 'into',
		canDrop: o.canDrop,
		onDrop: o.onDrop
	};
}

export function dropZone(node: HTMLElement, opts: DropOptions) {
	zones.set(node, toConfig(opts));
	return {
		update(next: DropOptions) {
			zones.set(node, toConfig(next));
		},
		destroy() {
			zones.delete(node);
			if (hovered === node) clearHints();
		}
	};
}
