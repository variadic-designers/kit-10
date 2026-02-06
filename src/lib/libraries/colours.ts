import type { Kit10Project, Kit10ProjectTokens } from '../types.ts';
import Colours from './colours.json';

const colours: Kit10ProjectTokens = {
	tokens: Colours.map((c) => {
		return {
			name: toKebab(c.name),
			displayName: toDisplayName(c.name),
			semantic: false,
			value: toOKLCH(c.value),
			type: 'color'
		};
	})
};

export const coloursOfCss: Kit10Project = {
	name: 'Colours of CSS',
	description: 'All named Colours of CSS',
	author: '',
	license: 'MIT',
	tokens: colours,
	tokenLibraries: [],
	kits: [],
	kitViews: []
};

export default colours;

function toOKLCH(value: string): string {
	// value looks like "[0.9564, 0.0045, 0.0055]"
	const [l, a, b] = JSON.parse(value);
	return `oklch(${l} ${a} ${b})`;
}

function toDisplayName(name: string): string {
	// Insert a space before capital letters
	const spaced = name.replace(/([A-Z])/g, ' $1');

	// Capitalize the first letter
	return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function toKebab(name: string): string {
	return name
		.replace(/([A-Z])/g, '-$1') // insert hyphen before capitals
		.toLowerCase(); // make everything lowercase
}
