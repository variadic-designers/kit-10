// ---------------- Left-click view listing ----------------
export const selectView = (view: ComponentView, id: string, selection: EditorSelection) => {
	return () => {
		selection.selectedKitIndex = null;

		// reset for already selected
		if (selection.selectedViewPrimary === id) {
			selection.selectedViewPrimary = null;
			return;
		}

		// autoselect first kit in the composition
		if (view.resolve.length > 0) {
			selection.selectedKitIndex = 0;
		}

		// set as primary selection
		selection.selectedViewPrimary = id;
	};
};

// ---------------- Right-click Panel ----------------
let viewsPanelContextMenu: ContextMenuContentGenerator = () => [
	{
		name: 'add',
		displayText: 'Box',
		icon: 'fa-regular fa-window-maximize',
		onClick: () => {}
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
		displayText: 'Image',
		icon: 'fa-solid fa-image',
		onClick: () => console.log('Add')
	},
	{
		name: 'add',
		displayText: 'Shape',
		icon: 'fa-solid fa-star',
		onClick: () => console.log('Add')
	},
	'hr',
	{
		name: 'add',
		displayText: 'Screen',
		icon: 'fa-solid fa-display',
		onClick: () => console.log('Add')
	}
];

// ---------------- Right-click View Field ----------------
let viewContextMenu = () => [
	{
		name: 'add',
		displayText: 'Mark as Export',
		icon: 'fa-solid fa-file-export',
		onClick: () => console.log('Add')
	},
	'hr',
	{
		name: 'add',
		displayText: 'Rename',
		icon: 'fa-solid fa-italic',
		onClick: () => console.log('Add')
	},
	{
		name: 'add',
		displayText: 'Deselect',
		icon: 'fa-solid fa-minus',
		onClick: () => {}
	},
	'hr',
	{
		name: 'add',
		displayText: 'New View',
		icon: 'fa-solid fa-diamond',
		onClick: () => {}
	},

	{
		name: 'trash',
		displayText: 'Clone View',
		icon: 'fa-solid fa-clone',
		onClick: () => {}
	},
	'hr',
	{
		name: 'trash',
		displayText: 'Delete View',
		icon: 'fa-solid fa-trash-can',
		onClick: () => {}
	}
];

export default {};
