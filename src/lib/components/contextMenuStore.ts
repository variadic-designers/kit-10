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
	onClick?: (target: HTMLElement | null) => void;
	submenu?: ContextMenu[];
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

function resolveContent(content: ContextMenu, target: HTMLElement | null): ContextMenuContent {
	return typeof content === 'function' ? content(target) : content;
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
