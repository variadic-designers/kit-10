import type { TokenValue } from 'manager';

export function tokenStr(v: TokenValue | null | undefined): string | null {
	if (!v) return null;
	if (v.type === 'scalar') return v.value;
	if (v.type === 'view-list')
		return `${v.view_ids.length} view${v.view_ids.length === 1 ? '' : 's'}`;
	return null;
}

export function tokenIcon(v: TokenValue | null | undefined): string {
	if (v?.type === 'view-list') return 'fa-square-binary';
	const str = tokenStr(v);
	if (!str) return 'fa-question';
	if (isColorScalar(str)) return 'fa-square-full';
	if (
		/^\d/.test(str) &&
		(str.includes('px') || str.includes('rem') || str.includes('em') || str.includes('%'))
	)
		return 'fa-arrows-left-right-to-line';
	return 'fa-circle';
}

export function isColorValue(v: TokenValue | null | undefined): boolean {
	return isColorScalar(tokenStr(v));
}

// For the Render panel's StyleField: takes the already-resolved scalar string
// (ResolvedProperty.value) and chooses an icon purely by pattern-matching on the
// string's lexical shape. No TokenValue indirection — the Render panel never has one.
export function iconFromResolvedScalar(s: string | null | undefined): string {
	if (!s) return 'fa-question';
	if (isColorScalar(s)) return 'fa-square-full';
	if (
		/^\d/.test(s) &&
		(s.includes('px') || s.includes('rem') || s.includes('em') || s.includes('%'))
	)
		return 'fa-arrows-left-right-to-line';
	return 'fa-circle';
}

export function isColorScalar(s: string | null | undefined): boolean {
	return (
		!!s &&
		(s.startsWith('#') ||
			s.startsWith('rgb') ||
			s.startsWith('hsl') ||
			s.startsWith('oklch') ||
			s.startsWith('oklab'))
	);
}
