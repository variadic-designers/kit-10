// Opt-in resolve-cycle profiling (editor side).
// Enable:  localStorage.setItem('kit10:profile-resolve', '1')
// Disable: localStorage.removeItem('kit10:profile-resolve')
//
// Mirrors manager/src/resolve/profile.ts so resolve.ts, manager.svelte.ts, and
// Editor.svelte all share one flag and one log namespace. Kept as a separate file
// here (rather than re-exported from manager) so the manager package's public API
// stays free of profiling plumbing.

const FLAG = 'kit10:profile-resolve';

function enabled(): boolean {
	try {
		return typeof localStorage !== 'undefined' && localStorage.getItem(FLAG) === '1';
	} catch {
		return false;
	}
}

export function mark(name: string): void {
	if (!enabled()) return;
	performance.mark(name);
}

export function measure(start: string, end: string, label: string): void {
	if (!enabled()) return;
	try {
		performance.measure(label, start, end);
		const entries = performance.getEntriesByName(label);
		const entry = entries[entries.length - 1];
		if (entry) {
			console.log(`[profile:resolve] ${label}: ${entry.duration.toFixed(2)}ms`);
		}
	} catch {
		// missing marks -- skip
	}
}
