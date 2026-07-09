import type { TokenValue } from 'manager';

export function tokenStr(v: TokenValue | null | undefined): string | null {
	if (!v) return null;
	if (v.type === 'scalar') return v.value;
	if (v.type === 'view-list') return `${v.view_ids.length} view${v.view_ids.length === 1 ? '' : 's'}`;
	return null;
}

export function tokenIcon(v: TokenValue | null | undefined): string {
	if (v?.type === 'view-list') return 'fa-square-binary';
	const str = tokenStr(v);
	if (!str) return 'fa-question';
	if (str.startsWith('#') || str.startsWith('rgb') || str.startsWith('hsl')) return 'fa-square-full';
	if (/^\d/.test(str) && (str.includes('px') || str.includes('rem') || str.includes('em') || str.includes('%'))) return 'fa-arrows-left-right-to-line';
	return 'fa-circle';
}

export function isColorValue(v: TokenValue | null | undefined): boolean {
	const str = tokenStr(v);
	if (!str) return false;
	return str.startsWith('#') || str.startsWith('rgb') || str.startsWith('hsl');
}

// Renders a list of view names as literal array syntax -- used anywhere a view-list token's
// value is shown (ChildViewField's value box, Variables panel's View Tokens rows), so a list of
// view refs reads as the array it actually is instead of a vague "N views" count or an opaque
// token-pill with no visible contents.
export function formatViewArray(names: string[]): string {
	return `[${names.join(', ')}]`;
}
