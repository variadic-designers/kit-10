export interface TrackedVariant {
	name: string;
	id?: string;
	tooltip: string;
}

export interface TrackedRange {
	maximum?: number;
	minimum?: number;
}

export interface TrackedDiscrete {}

export type AxisValue = TrackedVariant[] | TrackedRange | TrackedDiscrete;

export interface AxisArgs {
	[ident: string]: {};
}

export interface AxisDefinition {
	category: 'Static' | 'Dynamic';
	id: string;
	name: string;
	description: string;
	args?: string[];
	variants: AxisValue;
}

export const builtinAxes: (AxisDefinition | null)[] = [
	{
		category: 'Dynamic',
		name: 'Dark Mode',
		description: 'Support for Light and Dark mode states',
		id: '@builtin-darkmode',
		variants: [
			{
				name: 'Light',
				id: 'light',
				tooltip: 'Light mode'
			},
			{
				name: 'Dark',
				id: 'dark',
				tooltip: 'Dark mode'
			}
		]
	},
	{
		category: 'Dynamic',
		name: 'Interaction',
		id: '@builtin-interaction',
		description: 'Response to user interaction',
		variants: [
			// { name: 'Default', id: 'default', tooltip: 'No interaction state' },
			// { name: 'Disabled', id: 'disabled', tooltip: 'Suppressed interaction' },
			{ name: 'Hover', id: 'hover', tooltip: 'When the pointer is over the element' },
			{ name: 'Focus', id: 'focus', tooltip: 'When the element receives focus' },
			{
				name: 'Keyboard Focus',
				id: 'keyboard focus',
				tooltip: 'When focus is visible (keyboard navigation)'
			},
			{
				name: 'Active',
				id: 'active',
				tooltip: 'While the element is being activated (e.g., mouse down)'
			},
			{ name: 'Pressed', id: 'pressed', tooltip: 'After a click event occurs' }
		]
	},
	{
		category: 'Dynamic',
		name: 'Device Screen',
		description: 'Response to device screen',
		id: '@builtin-devicewidth',
		variants: [
			{ name: 'Default', tooltip: 'No interaction state' },
			{ name: 'Disabled', tooltip: 'Suppressed interaction' },
			{ name: 'Hover', tooltip: 'When the pointer is over the element' },
			{ name: 'Focus', tooltip: 'When the element receives focus' },
			{ name: 'Keyboard Focus', tooltip: 'When focus is visible (keyboard navigation)' },
			{ name: 'Active', tooltip: 'While the element is being activated (e.g., mouse down)' },
			{ name: 'Pressed', tooltip: 'After a click event occurs' }
		]
	},
	null,
	{
		category: 'Static',
		name: 'Child Of <KIT>',
		description: 'Parent context',
		id: '@builtin-childof',
		variants: [
			{
				name: 'Nav',
				tooltip: 'Nav Parent'
			}
		]
	},

	{
		category: 'Static',
		name: 'Button Emphasis',
		description: 'Variants for button semantics in emphasis',
		id: '@builtin-btn-emphasis',
		variants: [
			{ name: 'Primary', tooltip: 'Highest-priority call to action' },
			{ name: 'Secondary', tooltip: 'Supporting or less-prominent action' },
			{ name: 'Tertiary', tooltip: 'Low-emphasis or contextual action' },
			{ name: 'Ghost', tooltip: 'Minimal emphasis; used for subtle actions' }
		]
	},
	{
		category: 'Static',
		name: 'Button Tone',
		description: 'Variants for button semantics in tone',
		id: '@builtin-btn-tone',
		variants: [
			{ name: 'Neutral', tooltip: 'Neutral tone' },
			{
				name: 'Destructive',
				id: 'destructive',
				tooltip: 'Destructive or dangerous action'
			},
			{
				name: 'Confirmative',
				id: 'confirmative',
				tooltip: 'Positive or affirming action'
			}
		]
	}
];
