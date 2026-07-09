// Opt-in resolve-cycle profiling.
// Enable:  localStorage.setItem('kit10:profile-resolve', '1')
// Disable: localStorage.removeItem('kit10:profile-resolve')
//
// All calls are no-ops when disabled, so this is safe to ship. Marks and measures
// are gated on the flag to avoid populating the performance timeline with entries
// nobody is reading (which would grow memory unbounded over a long session).
//
// Caveat: mark names are reused across resolve cycles. `performance.measure` pairs
// the most recent mark with a given name, so concurrent interleaved resolves would
// pair wrong marks. The live-query loop debounces and version-guards resolves, so
// concurrent resolves are not expected during normal operation -- fine for profiling.

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
