import { type Writable, writable, get } from 'svelte/store';
import { page } from '$app/state';

export type ReducedMotion = 'no-reduce' | 'reduce' | 'auto';

export const reducedMotionOptions: ReducedMotion[] = ['no-reduce', 'reduce', 'auto'];

// --- ReducedMotion Store ---
export const reducedMotion: Writable<ReducedMotion | null> = writable(null);

// --- Context aware theme source of truth CSR / SSR
export const getReducedMotion = (): ReducedMotion => {
	return get(reducedMotion) ?? page.data.reducedMotion;
};

// Idempotent initialization, preferably on root +layout.svelte
export const initializeReducedMotion = (newReducedMotion: ReducedMotion) => {
	if (get(reducedMotion) === null) {
		reducedMotion.set(newReducedMotion);
	}
};

// --- Immediate DOM updates ---
export const applyCompelReducedMotion = (newReducedMotion: ReducedMotion) => {
	document
		.querySelectorAll<HTMLElement>('[data-compel-reduced-motion]')
		.forEach((el) => el.setAttribute('data-compel-reduced-motion', newReducedMotion));
};

// --- Cookie for SSR to prevent flicker on reloads or direct links ---
export const setReducedMotionCookie = (newReducedMotion: ReducedMotion) => {
	if (newReducedMotion !== 'auto') {
		document.cookie = `reduced-motion=${encodeURIComponent(newReducedMotion)}; path=/; max-age=${60 * 60 * 24 * 365}`;
	} else {
		// SSR infers 'auto' from no cookie
		document.cookie = 'reduced-motion=; Max-Age=0; path=/';
	}
};

// --- All in together now ---
export const updateReducedMotion = (newReducedMotion: ReducedMotion = 'auto') => {
	// Immediately switches, consistent with CSR nav
	reducedMotion.set(newReducedMotion);
	// All [data-compel-reduced-motion] updates values for css
	applyCompelReducedMotion(newReducedMotion);
	// SSR aware of theme via cookies
	setReducedMotionCookie(newReducedMotion);
};
