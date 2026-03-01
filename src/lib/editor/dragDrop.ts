import type { Action } from 'svelte/action';

export interface DragDropPayload<Item> {
	payload: Item;
}

export interface DropZoneOptions<Item> extends DragDropPayload {
	ondrop?: (payload: Item) => void;
	dragOverClassName?: string;
}

export interface DragOptions extends DragDropPayload {
	className: string;
}

export const dropzone =
	<Item>(): Action<HTMLElement, DropZoneOptions<Item>> =>
	(node, options) => {
		function handleDragOver(e: DragEvent) {
			e.preventDefault();
			node.classList.add(options.dragOverClassName ?? 'drag-over');
		}

		function handleDragLeave(e: DragEvent) {
			e.preventDefault();
			node.classList.remove(options.dragOverClassName ?? 'drag-over');
		}

		function handleDrop(e: DragEvent) {
			e.preventDefault();
			node.classList.remove(options.dragOverClassName ?? 'drag-over');

			const raw = e.dataTransfer?.getData('application/json');
			console.log('Being dropped');
			if (!raw) return;

			const data = JSON.parse(raw) as { payload: Item };
			options.ondrop(data.payload);
		}

		node.addEventListener('dragover', handleDragOver);
		node.addEventListener('dragleave', handleDragLeave);
		node.addEventListener('drop', handleDrop);

		return {
			destroy() {
				node.removeEventListener('dragover', handleDragOver);
				node.removeEventListener('dragleave', handleDragLeave);
				node.removeEventListener('drop', handleDrop);
			}
		};
	};

export const drag =
	<Item>(): Action<HTMLElement, DragOptions<Item>> =>
	(node, dragOptions) => {
		node.draggable = true;

		function handleDragStart(e: DragEvent) {
			node.classList.add(dragOptions.className);
			e.dataTransfer?.setData('application/json', JSON.stringify({ payload: dragOptions.payload }));
		}

		function handleDragEnd() {
			node.classList.remove(dragOptions.className);
		}

		node.addEventListener('dragstart', handleDragStart);
		node.addEventListener('dragend', handleDragEnd);

		return {
			destroy() {
				node.removeEventListener('dragstart', handleDragStart);
				node.removeEventListener('dragend', handleDragEnd);
			}
		};
	};
