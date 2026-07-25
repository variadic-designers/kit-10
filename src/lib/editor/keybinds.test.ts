import { describe, it, expect } from 'vitest';
import {
	matchKey,
	matchMouse,
	matchWheel,
	readEventToBinding,
	formatBinding,
	KEYBIND_DEFAULTS,
	type Binding
} from './keybinds.js';

function key(code: string, mods: Partial<Binding> = {}): Binding {
	return { source: 'key', code, ctrl: false, shift: false, alt: false, meta: false, space: false, ...mods };
}
function mouse(code: string, mods: Partial<Binding> = {}): Binding {
	return { source: 'mouse', code, ctrl: false, shift: false, alt: false, meta: false, space: false, ...mods };
}
function wheel(mods: Partial<Binding> = {}): Binding {
	return { source: 'wheel', code: 'Wheel', ctrl: false, shift: false, alt: false, meta: false, space: false, ...mods };
}

// Minimal event-shaped stubs (matchKey/matchMouse/matchWheel read only these fields).
function keyEvent(code: string, mods: Partial<{ ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean }> = {}) {
	return { code, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...mods } as KeyboardEvent;
}
function mouseEvent(button: number, mods: Partial<{ ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean }> = {}) {
	return { button, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...mods };
}
function wheelEvent(mods: Partial<{ ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean }> = {}, deltaY = 100) {
	return { deltaY, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...mods };
}

describe('matchKey', () => {
	it('matches code + exact modifiers', () => {
		expect(matchKey(keyEvent('BracketLeft'), key('BracketLeft'))).toBe(true);
		expect(matchKey(keyEvent('KeyB', { shiftKey: true }), key('KeyB', { shift: true }))).toBe(true);
	});

	it('rejects on wrong code or extra/missing modifier', () => {
		expect(matchKey(keyEvent('BracketRight'), key('BracketLeft'))).toBe(false);
		expect(matchKey(keyEvent('KeyB'), key('KeyB', { shift: true }))).toBe(false); // missing shift
		expect(matchKey(keyEvent('KeyB', { ctrlKey: true }), key('KeyB'))).toBe(false); // extra ctrl
	});

	it('never matches a mouse binding', () => {
		expect(matchKey(keyEvent('KeyB'), mouse('Mouse0'))).toBe(false);
	});
});

describe('matchMouse', () => {
	it('matches button + modifiers', () => {
		expect(matchMouse(mouseEvent(0), mouse('Mouse0'), false)).toBe(true);
		expect(matchMouse(mouseEvent(0, { altKey: true }), mouse('Mouse0', { alt: true }), false)).toBe(true);
		expect(matchMouse(mouseEvent(1), mouse('Mouse1'), false)).toBe(true);
	});

	it('honors the Space held-modifier', () => {
		const panSpace = mouse('Mouse0', { space: true });
		expect(matchMouse(mouseEvent(0), panSpace, true)).toBe(true);
		expect(matchMouse(mouseEvent(0), panSpace, false)).toBe(false); // Space not held
		expect(matchMouse(mouseEvent(0), mouse('Mouse0'), true)).toBe(false); // held but binding doesn't want it
	});

	it('rejects wrong button / a key binding', () => {
		expect(matchMouse(mouseEvent(2), mouse('Mouse0'), false)).toBe(false);
		expect(matchMouse(mouseEvent(0), key('KeyB'), false)).toBe(false);
	});
});

describe('matchWheel', () => {
	it('matches modifiers regardless of scroll amount/direction', () => {
		expect(matchWheel(wheelEvent({ shiftKey: true }), wheel({ shift: true }))).toBe(true);
		expect(matchWheel(wheelEvent({ shiftKey: true }, -50), wheel({ shift: true }))).toBe(true);
	});

	it('rejects on missing/extra modifier or a key/mouse binding', () => {
		expect(matchWheel(wheelEvent(), wheel({ shift: true }))).toBe(false); // missing shift
		expect(matchWheel(wheelEvent({ shiftKey: true, ctrlKey: true }), wheel({ shift: true }))).toBe(false); // extra ctrl
		expect(matchWheel(wheelEvent({ shiftKey: true }), key('KeyB', { shift: true }))).toBe(false);
		expect(matchWheel(wheelEvent({ shiftKey: true }), mouse('Mouse0', { shift: true }))).toBe(false);
	});
});

describe('readEventToBinding', () => {
	it('reads a key event with modifiers', () => {
		const b = readEventToBinding({ key: 'b', code: 'KeyB', ctrlKey: false, shiftKey: true, altKey: false, metaKey: false } as KeyboardEvent);
		expect(b).toEqual(key('KeyB', { shift: true }));
	});

	it('rejects a modifier-only keypress', () => {
		expect(readEventToBinding({ key: 'Shift', code: 'ShiftLeft', ctrlKey: false, shiftKey: true, altKey: false, metaKey: false } as KeyboardEvent)).toBeNull();
	});

	it('reads a mouse event', () => {
		const b = readEventToBinding({ button: 0, ctrlKey: false, shiftKey: false, altKey: true, metaKey: false } as MouseEvent);
		expect(b).toEqual(mouse('Mouse0', { alt: true }));
	});

	it('reads a wheel event', () => {
		const b = readEventToBinding({ deltaY: 100, ctrlKey: false, shiftKey: true, altKey: false, metaKey: false } as WheelEvent);
		expect(b).toEqual(wheel({ shift: true }));
	});
});

describe('formatBinding', () => {
	it('renders friendly labels', () => {
		expect(formatBinding(key('BracketLeft'))).toBe('[');
		expect(formatBinding(key('ArrowUp'))).toBe('↑');
		expect(formatBinding(key('KeyB', { shift: true }))).toBe('Shift + B');
		expect(formatBinding(mouse('Mouse0', { alt: true }))).toBe('Alt + Left-click');
		expect(formatBinding(wheel({ shift: true }))).toBe('Shift + Scroll');
	});
});

describe('KEYBIND_DEFAULTS', () => {
	it('has a binding for every declared action', () => {
		expect(KEYBIND_DEFAULTS['nav.parent']).toEqual(key('BracketLeft'));
		expect(KEYBIND_DEFAULTS['canvas.pan']).toEqual(mouse('Mouse0'));
		expect(KEYBIND_DEFAULTS['layer.delete']).toEqual(mouse('Mouse0', { alt: true }));
		expect(KEYBIND_DEFAULTS['axis.cycleValue']).toEqual(wheel({ shift: true }));
	});
});
