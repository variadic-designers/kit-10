// Context menu Svelte action
import { openContextMenu, type ContextMenu } from './contextMenuStore.js';

export type { ContextMenuContent, ContextMenuContentGenerator, ContextMenu, MenuItem } from './contextMenuStore.js';

export function contextMenu(node: HTMLElement, content: ContextMenu) {
	function handler(e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();
		openContextMenu(e.clientX, e.clientY, node, content);
	}

	function keyHandler(e: KeyboardEvent) {
		if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
			e.preventDefault();
			const rect = node.getBoundingClientRect();
			openContextMenu(rect.left + rect.width / 2, rect.top + rect.height / 2, node, content);
		}
	}

	node.addEventListener('contextmenu', handler);
	node.addEventListener('keydown', keyHandler);

	return {
		update(newContent: ContextMenu) {
			content = newContent;
		},
		destroy() {
			node.removeEventListener('contextmenu', handler);
			node.removeEventListener('keydown', keyHandler);
		}
	};
}
