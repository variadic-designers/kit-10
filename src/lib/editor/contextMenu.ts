// contextMenu.ts
import type { Action } from 'svelte/action';
import { openContextMenu } from './contextMenuStore';

export const contextMenu: Action<HTMLElement, ContextMenu> = (node, data) => {
	function handleContextMenu(e: MouseEvent) {
		e.preventDefault();
		openContextMenu(e.clientX, e.clientY, node, data);
	}

	function handleKey(e: KeyboardEvent) {
		if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
			e.preventDefault();
			const rect = node.getBoundingClientRect();
			openContextMenu(rect.left + rect.width / 2, rect.top + rect.height / 2, node);
		}
	}

	node.addEventListener('contextmenu', handleContextMenu);
	node.addEventListener('keydown', handleKey);

	return {
		destroy() {
			node.removeEventListener('contextmenu', handleContextMenu);
			node.removeEventListener('keydown', handleKey);
		}
	};
};
