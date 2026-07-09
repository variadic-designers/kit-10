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

export type DragPayload =
	| { kind: 'axis'; axisId: string; kitId: string; label?: string }
	| { kind: 'token'; tokenId: string; alias: string; valueType?: string };

export type DragKind = DragPayload['kind'];
export type DropEdge = 'before' | 'after';

let active = $state<DragPayload | null>(null);
/** The drag currently in flight, or null. Reactive -- reading it in a template/$derived tracks it. */
export function activeDrag(): DragPayload | null {
	return active;
}

// --- controller state (plain, non-reactive: driven imperatively during a drag) ---
const pointer = { x: 0, y: 0 };
let ghost: HTMLElement | null = null;
let sourceNode: HTMLElement | null = null;

type ZoneConfig = {
	accepts: DragKind[];
	mode: 'into' | 'reorder';
	canDrop?: (p: DragPayload) => boolean;
	onDrop: (p: DragPayload, detail: { edge?: DropEdge }) => void;
};
const zones = new Map<HTMLElement, ZoneConfig>();

let hovered: HTMLElement | null = null;
let hoveredEdge: DropEdge | null = null;

function zoneEligible(cfg: ZoneConfig, p: DragPayload): boolean {
	return cfg.accepts.includes(p.kind) && (!cfg.canDrop || cfg.canDrop(p));
}

function clearHints() {
	if (hovered) {
		hovered.classList.remove('dnd-over', 'dnd-insert-before', 'dnd-insert-after');
	}
	hovered = null;
	hoveredEdge = null;
}

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
	if (hit.cfg.mode === 'into') {
		hit.node.classList.add('dnd-over');
		return;
	}
	// reorder: which half of the node is the pointer in?
	const r = hit.node.getBoundingClientRect();
	const edge: DropEdge = pointer.y < r.top + r.height / 2 ? 'before' : 'after';
	if (edge !== hoveredEdge) {
		hit.node.classList.remove('dnd-insert-before', 'dnd-insert-after');
		hit.node.classList.add(edge === 'before' ? 'dnd-insert-before' : 'dnd-insert-after');
		hoveredEdge = edge;
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
	document.body.style.cursor = 'grabbing';

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
		background: 'var(--color-surface-alt, #333)',
		color: 'var(--color-primary, #fff)',
		border: '1px solid var(--color-primary, #888)',
		boxShadow: '0 8px 24px rgba(0,0,0,0.28)',
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
	const edge = hoveredEdge ?? undefined;
	const payload = active;
	endDrag();
	if (hit && payload) hit.cfg.onDrop(payload, { edge });
}

function onDragKey(e: KeyboardEvent) {
	if (e.key === 'Escape') endDrag();
}

function endDrag() {
	clearHints();
	ghost?.remove();
	ghost = null;
	sourceNode?.classList.remove('dnd-dragging');
	sourceNode = null;
	active = null;
	document.body.style.userSelect = '';
	document.body.style.cursor = '';
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
		pointer.x = e.clientX;
		pointer.y = e.clientY;
		beginDrag(p, o.preview ?? p.kind, node);
		e.preventDefault();
	}

	function onArmUp() {
		disarm();
	}

	function onDown(e: PointerEvent) {
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

	return {
		update(next: PayloadGetter | DraggableOptions) {
			o = normalize(next);
		},
		destroy() {
			disarm();
			node.removeEventListener('pointerdown', onDown);
		}
	};
}

// --- dropZone action ---

export interface DropOptions {
	/** Which drag kind(s) this zone accepts. */
	accepts: DragKind | DragKind[];
	onDrop: (payload: DragPayload, detail: { edge?: DropEdge }) => void;
	/** Extra per-drag veto beyond `accepts`. */
	canDrop?: (payload: DragPayload) => boolean;
	/** `into` (default) highlights the whole node; `reorder` marks a before/after insertion edge. */
	mode?: 'into' | 'reorder';
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
