// Host-owned keybind registry (keyboard AND mouse gestures).
//
// The editor's interactions used to be hardcoded literals scattered across components
// (`e.altKey`, `Shift+P`, the pan-gesture select, ...). This module makes them data: a small set
// of named actions, each mapped to a rebindable `Binding` that captures either a keyboard combo or
// a mouse gesture, plus ctrl/shift/alt/meta (and a Figma-style Space-held) modifier. Same
// store-as-source-of-truth / patch-then-persist shape as `viewport-input.ts` (localStorage-backed,
// no SSR anti-flicker need), so a call site can never forget to persist.
//
// Call sites READ the store and match events against it (`matchKey`/`matchMouse`) instead of
// checking literals. The Settings > Keybinds tab writes it via `updateKeybind`.

import { type Writable, writable, get } from 'svelte/store';

// A single input binding. `source` picks which event kind it matches:
//   'key'   -- a KeyboardEvent whose `.code` equals `code` ('BracketLeft', 'ArrowUp', 'KeyB', ...)
//   'mouse' -- a PointerEvent/MouseEvent whose button equals `code` ('Mouse0' left, 'Mouse1'
//              middle, 'Mouse2' right)
// The four standard modifiers must match exactly. `space` is a 5th, non-standard modifier for the
// held-Space pan gesture (Figma-style) -- only meaningful on a mouse binding; keyboard matching
// ignores it.
export interface Binding {
	source: 'key' | 'mouse';
	code: string;
	ctrl: boolean;
	shift: boolean;
	alt: boolean;
	meta: boolean;
	space: boolean;
}

export type KeybindAction =
	| 'nav.parent'
	| 'nav.child'
	| 'nav.prevSibling'
	| 'nav.nextSibling'
	| 'canvas.pan'
	| 'canvas.toggleBoxModel'
	| 'canvas.pixelSnap'
	| 'layer.delete'
	| 'property.remove'
	| 'edit.cancel';

// Grouping headers in the Keybinds tab.
const NAV = 'Navigation';
const CANVAS = 'Canvas';
const AUTHORING = 'Authoring';

function key(code: string, mods: Partial<Binding> = {}): Binding {
	return { source: 'key', code, ctrl: false, shift: false, alt: false, meta: false, space: false, ...mods };
}
function mouse(code: string, mods: Partial<Binding> = {}): Binding {
	return { source: 'mouse', code, ctrl: false, shift: false, alt: false, meta: false, space: false, ...mods };
}

// One rebindable action, declared as data (mirrors `hostPreferences`). `allow` constrains which
// input kinds the capture control will accept for this action (e.g. pan is mouse-only; nav is
// key-only), so a user can't bind a keyboard combo to a mouse-gesture slot.
export interface KeybindActionDef {
	id: KeybindAction;
	label: string;
	group: string;
	allow: Array<'key' | 'mouse'>;
	default: Binding;
}

export const KEYBIND_ACTIONS: KeybindActionDef[] = [
	{ id: 'nav.parent', label: 'Go to parent', group: NAV, allow: ['key'], default: key('BracketLeft') },
	{ id: 'nav.child', label: 'Go to child', group: NAV, allow: ['key'], default: key('BracketRight') },
	{ id: 'nav.prevSibling', label: 'Previous sibling', group: NAV, allow: ['key'], default: key('ArrowUp') },
	{ id: 'nav.nextSibling', label: 'Next sibling', group: NAV, allow: ['key'], default: key('ArrowDown') },
	{ id: 'canvas.pan', label: 'Pan canvas', group: CANVAS, allow: ['mouse'], default: mouse('Mouse0') },
	{
		id: 'canvas.toggleBoxModel',
		label: 'Toggle padding/gap overlay',
		group: CANVAS,
		allow: ['key'],
		default: key('KeyB', { shift: true })
	},
	{ id: 'canvas.pixelSnap', label: 'Toggle pixel snap', group: CANVAS, allow: ['key'], default: key('KeyP', { shift: true }) },
	{ id: 'layer.delete', label: 'Delete layer', group: AUTHORING, allow: ['mouse'], default: mouse('Mouse0', { alt: true }) },
	{
		id: 'property.remove',
		label: 'Remove property',
		group: AUTHORING,
		allow: ['mouse'],
		default: mouse('Mouse0', { alt: true })
	},
	{ id: 'edit.cancel', label: 'Cancel (pipette / create / drag)', group: AUTHORING, allow: ['key'], default: key('Escape') }
];

export type KeybindMap = Record<KeybindAction, Binding>;

export const KEYBIND_DEFAULTS: KeybindMap = Object.fromEntries(
	KEYBIND_ACTIONS.map((a) => [a.id, a.default])
) as KeybindMap;

const STORAGE_KEY = 'kit10:keybinds';

function load(): KeybindMap {
	try {
		if (typeof localStorage === 'undefined') return structuredCloneMap(KEYBIND_DEFAULTS);
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return structuredCloneMap(KEYBIND_DEFAULTS);
		const parsed = JSON.parse(raw) as Partial<KeybindMap>;
		// Merge over defaults so a binding added by a newer build (missing from an older stored map)
		// still resolves, and a partial/corrupt stored binding falls back per action.
		const out = structuredCloneMap(KEYBIND_DEFAULTS);
		for (const a of KEYBIND_ACTIONS) {
			const b = parsed[a.id];
			if (b && typeof b.code === 'string' && (b.source === 'key' || b.source === 'mouse')) {
				out[a.id] = {
					source: b.source,
					code: b.code,
					ctrl: !!b.ctrl,
					shift: !!b.shift,
					alt: !!b.alt,
					meta: !!b.meta,
					space: !!b.space
				};
			}
		}
		return out;
	} catch {
		return structuredCloneMap(KEYBIND_DEFAULTS);
	}
}

function structuredCloneMap(map: KeybindMap): KeybindMap {
	const out = {} as KeybindMap;
	for (const a of KEYBIND_ACTIONS) out[a.id] = { ...map[a.id] };
	return out;
}

export const keybinds: Writable<KeybindMap> = writable(load());

function persist(map: KeybindMap): void {
	try {
		if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
	} catch {
		// best-effort -- a storage fault just means the binding doesn't survive reload
	}
}

// Rebind one action, persisting the result. The Keybinds tab never writes the store directly, so
// persistence can't be forgotten at a call site.
export function updateKeybind(action: KeybindAction, binding: Binding): void {
	const next = { ...get(keybinds), [action]: binding };
	keybinds.set(next);
	persist(next);
}

// Reset one action to its declared default.
export function resetKeybind(action: KeybindAction): void {
	updateKeybind(action, { ...KEYBIND_DEFAULTS[action] });
}

// Reset every action to defaults.
export function resetAllKeybinds(): void {
	const next = structuredCloneMap(KEYBIND_DEFAULTS);
	keybinds.set(next);
	persist(next);
}

// ---------------------------------------------------------------------------
// Matching + capture (pure -- no Svelte, unit-testable)
// ---------------------------------------------------------------------------

interface ModEvent {
	ctrlKey: boolean;
	shiftKey: boolean;
	altKey: boolean;
	metaKey: boolean;
}

function modsMatch(e: ModEvent, b: Binding): boolean {
	return e.ctrlKey === b.ctrl && e.shiftKey === b.shift && e.altKey === b.alt && e.metaKey === b.meta;
}

// Does a keydown event satisfy this binding? A mouse binding never matches a key event.
export function matchKey(e: KeyboardEvent, b: Binding): boolean {
	if (b.source !== 'key') return false;
	return e.code === b.code && modsMatch(e, b);
}

const MOUSE_BUTTON_CODE: Record<number, string> = { 0: 'Mouse0', 1: 'Mouse1', 2: 'Mouse2' };

// Does a mouse/pointer event satisfy this binding? `spaceHeld` supplies the non-standard Space
// modifier state (tracked by the caller, e.g. Viewport). A key binding never matches a mouse event.
export function matchMouse(
	e: ModEvent & { button: number },
	b: Binding,
	spaceHeld: boolean
): boolean {
	if (b.source !== 'mouse') return false;
	if (MOUSE_BUTTON_CODE[e.button] !== b.code) return false;
	if (b.space !== spaceHeld) return false;
	return modsMatch(e, b);
}

// Capture: turn a raw key/mouse event into the Binding it represents (for the record widget).
// Modifier-only keydowns (Shift/Control/Alt/Meta pressed alone) are rejected -- returns null so the
// capture control keeps waiting for a real key.
export function readEventToBinding(e: KeyboardEvent | MouseEvent): Binding | null {
	const mods = {
		ctrl: e.ctrlKey,
		shift: e.shiftKey,
		alt: e.altKey,
		meta: e.metaKey,
		space: false
	};
	// Discriminate on the presence of `key` rather than `instanceof KeyboardEvent`: only KeyboardEvent
	// carries it, and this keeps the function testable with plain event-shaped objects (no DOM globals).
	if ('key' in e && typeof e.key === 'string') {
		if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return null;
		return { source: 'key', code: e.code, ...mods };
	}
	const code = MOUSE_BUTTON_CODE[(e as MouseEvent).button];
	if (!code) return null;
	return { source: 'mouse', code, ...mods };
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

// Human-friendly labels for the more opaque KeyboardEvent.code values. Anything not listed falls
// back to a cleaned-up form of the code itself (KeyB -> B, Digit1 -> 1).
const KEY_LABELS: Record<string, string> = {
	BracketLeft: '[',
	BracketRight: ']',
	ArrowUp: '↑',
	ArrowDown: '↓',
	ArrowLeft: '←',
	ArrowRight: '→',
	Escape: 'Esc',
	Space: 'Space',
	Enter: 'Enter',
	Comma: ',',
	Period: '.',
	Slash: '/',
	Backslash: '\\',
	Minus: '-',
	Equal: '='
};

const MOUSE_LABELS: Record<string, string> = {
	Mouse0: 'Left-click',
	Mouse1: 'Middle-click',
	Mouse2: 'Right-click'
};

function codeLabel(b: Binding): string {
	if (b.source === 'mouse') return MOUSE_LABELS[b.code] ?? b.code;
	if (KEY_LABELS[b.code]) return KEY_LABELS[b.code];
	if (b.code.startsWith('Key')) return b.code.slice(3);
	if (b.code.startsWith('Digit')) return b.code.slice(5);
	return b.code;
}

// A display string like "Alt + Left-click", "Shift + B", "[".
export function formatBinding(b: Binding): string {
	const parts: string[] = [];
	if (b.ctrl) parts.push('Ctrl');
	if (b.meta) parts.push('Meta');
	if (b.alt) parts.push('Alt');
	if (b.shift) parts.push('Shift');
	if (b.space) parts.push('Space');
	parts.push(codeLabel(b));
	return parts.join(' + ');
}

// ---------------------------------------------------------------------------
// Shared guard
// ---------------------------------------------------------------------------

// True when a keyboard event originates from a text-entry surface -- global keybinds (nav keys,
// the Space pan modifier, single-letter toggles) must ignore those so typing isn't hijacked.
export function isTextEntryTarget(t: EventTarget | null): boolean {
	const el = t as HTMLElement | null;
	if (!el || !el.tagName) return false;
	const tag = el.tagName.toLowerCase();
	return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
}
