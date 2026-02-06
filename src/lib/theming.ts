import { type Writable, writable, get } from 'svelte/store';
import { page } from '$app/state';

export type Theme = 'light' | 'dark' | 'auto';

export const themeOptions: Theme[] = ['dark', 'light', 'auto'];

// --- Theme Store ---
export const theme: Writable<Theme | null> = writable(null);

// --- Context aware theme source of truth CSR / SSR
export const getTheme = (): Theme => {
	return get(theme) ?? page.data.theme;
};

// Idempotent initialization, preferably on root +layout.svelte
export const initializeTheme = (newTheme: Theme) => {
	if (get(theme) === null) {
		theme.set(newTheme);
	}
};

// --- Immediate DOM updates ---
export const applyCompelTheme = (newTheme: Theme) => {
	document
		.querySelectorAll<HTMLElement>('[data-compel-color-scheme]')
		.forEach((el) => el.setAttribute('data-compel-color-scheme', newTheme));
};

// --- Cookie for SSR to prevent flicker on reloads or direct links ---
export const setThemeCookie = (newTheme: Theme) => {
	if (newTheme !== 'auto') {
		document.cookie = `theme=${encodeURIComponent(newTheme)}; path=/; max-age=${60 * 60 * 24 * 365}`;
	} else {
		// SSR infers 'auto' from no cookie
		document.cookie = 'theme=; Max-Age=0; path=/';
	}
};

// --- All in together now ---
export const updateTheme = (newTheme: Theme = 'auto') => {
	// Immediately switches, consistent with CSR nav
	theme.set(newTheme);
	// All [data-compel-color-scheme] updates values for css
	applyCompelTheme(newTheme);
	// SSR aware of theme via cookies
	setThemeCookie(newTheme);
};
