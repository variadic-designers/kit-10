export function tokenIcon(v: string | null | undefined): string {
	if (!v) return 'fa-question';
	if (v.startsWith('#') || v.startsWith('rgb') || v.startsWith('hsl')) return 'fa-square-full';
	if (/^\d/.test(v) && (v.includes('px') || v.includes('rem') || v.includes('em') || v.includes('%'))) return 'fa-arrows-left-right-to-line';
	return 'fa-circle';
}

export function isColorValue(v: string | null | undefined): boolean {
	if (!v) return false;
	return v.startsWith('#') || v.startsWith('rgb') || v.startsWith('hsl');
}