import type { ContextMenuContent } from '../contextMenuStore';

let tokenPanelContextMenu: ContextMenuContent = () => [
	{
		name: 'add',
		displayText: 'Import',
		icon: 'fa-solid fa-download',
		onClick: () => console.log('Add')
	},
	'hr',
	{
		name: 'add',
		displayText: 'Text',
		icon: 'fa-solid fa-italic',
		onClick: () => console.log('Add')
	},
	{
		name: 'add',
		displayText: 'Number',
		icon: 'fa-solid fa-list-ol',
		onClick: () => console.log('Add')
	},
	{
		name: 'add',
		displayText: 'Colour',
		icon: 'fa-solid fa-palette',
		onClick: () => console.log('Add')
	},
	'hr',
	{
		name: 'add',
		displayText: 'Content Flow',
		icon: 'fa-solid fa-table-cells-large',
		onClick: () => console.log('Add')
	},
	'hr',
	// Static editor evaluation
	{
		name: 'add',
		displayText: 'Derivation',
		icon: 'fa-solid fa-calculator',
		onClick: () => console.log('Add')
	},
	// Dynamic evaluation
	{
		name: 'add',
		displayText: 'Library',
		icon: 'fa-solid fa-book',
		onClick: () => console.log('Add')
	},
	{
		name: 'add',
		displayText: 'Schema',
		icon: 'fa-solid fa-microchip',
		onClick: () => console.log('Add')
	}
];

let tokenContextMenu: ContextMenuContent = [
	{
		name: 'add',
		displayText: 'Rename',
		icon: 'fa-solid fa-italic',
		onClick: () => console.log('Add')
	},

	{
		name: 'add',
		displayText: 'To New',
		icon: 'fa-solid fa-arrow-up-right-from-square',
		onClick: () => console.log('Add')
	},
	{
		name: 'add',
		displayText: 'Pin',
		icon: 'fa-solid fa-thumbtack',
		onClick: () => console.log('Add')
	},
	'hr',
	{
		name: 'trash',
		displayText: 'Copy',
		icon: 'fa-solid fa-copy',
		onClick: () => console.log('Remove')
	},
	{
		name: 'trash',
		displayText: 'Paste',
		disabled: true,
		icon: 'fa-solid fa-clipboard',
		onClick: () => console.log('Remove')
	},
	'hr',
	{
		name: 'trash',
		displayText: 'Delete',
		tone: 'destructive',
		icon: 'fa-solid fa-trash-can',
		onClick: () => console.log('Remove')
	}
];
