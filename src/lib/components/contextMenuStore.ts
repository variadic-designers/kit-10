// Context menu state store
import { writable, type Writable } from 'svelte/store';

export type ContextMenuContent = (MenuItem | 'hr')[];

export type ContextMenuContentGenerator = (target: HTMLElement | null) => ContextMenuContent;

export type ContextMenu = ContextMenuContent | ContextMenuContentGenerator;

export type MenuItem = {
	name: string;
	description?: string;
	displayText?: string;
	icon?: string;
	disabled?: boolean;
	tone?: 'neutral' | 'destructive';
	// A plain (sync or async, fire-and-forget) onClick just performs an action. Returning
	// { link, tab } synchronously instead tells the menu to open that URL (see handleAction
	// in ContextMenuList.svelte) -- e.g. an external donate/docs link that shouldn't be a raw
	// <a> inside the menu's own click handling.
	onClick?: (target: HTMLElement | null) => void | { link: string; tab?: string } | Promise<void>;
	// A nested flyout, resolved lazily (same as the root menu's own content) when the item is
	// opened, not when the parent menu is built -- so a submenu generator sees fresh state.
	submenu?: ContextMenu;
};

type ContextMenuState = {
	show: boolean;
	pos: { x: number; y: number };
	target: HTMLElement | null;
	options: ContextMenuContent;
};

export const contextMenuState: Writable<ContextMenuState> = writable({
	show: false,
	pos: { x: 200, y: 200 },
	target: null,
	options: []
});

export function resolveContent(content: ContextMenu, target: HTMLElement | null): ContextMenuContent {
	return typeof content === 'function' ? content(target) : content;
}

// Shared by the root menu and every submenu flyout -- keeps a `margin`-px gap from the
// viewport edge on whichever side would otherwise clip.
export function clampToViewport(
	x: number,
	y: number,
	width: number,
	height: number,
	margin = 8
): { x: number; y: number } {
	const maxX = window.innerWidth - width - margin;
	const maxY = window.innerHeight - height - margin;

	return {
		x: Math.max(margin, Math.min(x, maxX)),
		y: Math.max(margin, Math.min(y, maxY))
	};
}

export function openContextMenu(x: number, y: number, target: HTMLElement, content: ContextMenu) {
	contextMenuState.set({
		show: true,
		pos: { x, y },
		target,
		options: resolveContent(content, target)
	});
}

export function closeContextMenu() {
	contextMenuState.update((s) => ({ ...s, show: false }));
}
