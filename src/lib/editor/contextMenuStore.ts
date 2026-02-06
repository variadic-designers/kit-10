// contextMenuStore.ts
import { type Writable, writable } from 'svelte/store';

export type ContextMenuContentGenerator = () => ContextMenuContent;
export type ContextMenuContent = (MenuItem | 'hr')[];

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
	target: null | HTMLElement;
	options: ContextMenuContent;
};

export const contextMenuState: Writable<ContextMenuState> = writable({
	show: false,
	pos: { x: 200, y: 200 },
	target: null,

	options: () => []
});

export function openContextMenu(
	x: number,
	y: number,
	target: HTMLElement,
	options: ContextMenuContentGenerator
) {
	contextMenuState.update(() => ({ show: true, pos: { x, y }, target, options: options() }));
}

export function closeContextMenu() {
	contextMenuState.update((s) => ({
		...s,
		show: false,
		target: null,
		options: () => {
			return [];
		}
	}));
}
