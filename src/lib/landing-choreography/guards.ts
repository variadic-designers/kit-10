// The pre-hide guard and the reduced-motion policy.
//
// A module-level pre-hide class keeps the nav and hero invisible from first paint until
// the entrance timeline has installed its real initial states, so the reveal never plays
// catch-up against already-visible content. Three ways out: the choreography lifts it
// once states are installed, a failsafe timer lifts it if the chunks never arrive, and
// it is never added at all when the visitor opted out of motion. Reduced motion, the
// app's own setting first and the OS preference for "auto", gets none of it: no
// pre-hide, no pin, no triggers, content in its final state.

import { getReducedMotion } from '$lib/reduced-motion.js';

export const PENDING_CLASS = 'landing-anim-pending';
const PENDING_FAILSAFE_MS = 4000;

let failsafeTimer: ReturnType<typeof setTimeout> | undefined;

// The app persists its reduced-motion override as a cookie (setReducedMotionCookie).
// Reading it here lets the pre-hide guard agree with the store before hydration runs;
// no cookie means "auto", which defers to the OS preference.
function forcedReducedMotion(): 'reduce' | 'no-reduce' | null {
	if (typeof document === 'undefined') return null;
	const match = document.cookie.match(/(?:^|;\s*)reduced-motion=([^;]*)/);
	if (!match) return null;
	return decodeURIComponent(match[1]) === 'reduce' ? 'reduce' : 'no-reduce';
}

function osPrefersReducedMotion(): boolean {
	return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// Runs from the page's module script, i.e. as early as the route chunk exists. Purely
// additive: the failsafe guarantees the content appears even if everything downstream
// fails, and visitors who opted out of motion never see the guard at all.
export function armLandingPrehide(): void {
	if (typeof window === 'undefined') return;
	if (forcedReducedMotion() === 'reduce') return;
	if (forcedReducedMotion() === null && osPrefersReducedMotion()) return;
	document.documentElement.classList.add(PENDING_CLASS);
	if (failsafeTimer !== undefined) clearTimeout(failsafeTimer);
	failsafeTimer = setTimeout(() => {
		failsafeTimer = undefined;
		document.documentElement.classList.remove(PENDING_CLASS);
	}, PENDING_FAILSAFE_MS);
}

export function disarmPrehide(): void {
	if (failsafeTimer !== undefined) {
		clearTimeout(failsafeTimer);
		failsafeTimer = undefined;
	}
	document.documentElement.classList.remove(PENDING_CLASS);
}

export function reducedMotionNow(): boolean {
	const setting = getReducedMotion() ?? 'auto';
	if (setting === 'reduce') return true;
	if (setting === 'no-reduce') return false;
	return osPrefersReducedMotion();
}
