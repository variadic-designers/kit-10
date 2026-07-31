// Local account state for the Settings > Account tabs.
//
// KIT-10 has no auth/account backend yet, so this is a per-browser, localStorage-backed store --
// honest about being local (the Privacy tab says so). It's shaped like a real account profile so
// the wiring is already in place the day a backend exists: swap this store's load/persist for API
// calls and the tabs don't change.

import { type Writable, writable, get } from 'svelte/store';

export interface ConnectedApp {
	id: string;
	label: string;
	icon: string; // Font Awesome class
	connected: boolean;
}

export interface Achievement {
	id: string;
	label: string;
	icon: string;
	description: string;
	earned: boolean;
}

export interface AccountState {
	username: string;
	// Sensitive fields, revealed only behind the Privacy tab's click-to-show.
	email: string;
	accountId: string;
	connectedApps: ConnectedApp[];
	// Local privacy toggles (analytics/telemetry). No network today; wired for when there is one.
	shareAnalytics: boolean;
	shareCrashReports: boolean;
}

// The default catalogue of apps a designer might connect. `connected` persists per-user.
const DEFAULT_CONNECTED_APPS: ConnectedApp[] = [
	{ id: 'github', label: 'GitHub', icon: 'fa-brands fa-github', connected: false },
	{ id: 'figma', label: 'Figma', icon: 'fa-brands fa-figma', connected: false },
	{ id: 'slack', label: 'Slack', icon: 'fa-brands fa-slack', connected: false },
	{ id: 'dribbble', label: 'Dribbble', icon: 'fa-brands fa-dribbble', connected: false }
];

// Achievements are static definitions; which are earned is derived/persisted locally for now.
export const ACHIEVEMENTS: Achievement[] = [
	{
		id: 'first-kit',
		label: 'First Light',
		icon: 'fa-solid fa-seedling',
		description: 'Created your first kit.',
		earned: true
	},
	{
		id: 'axis-bender',
		label: 'Axis Bender',
		icon: 'fa-solid fa-sliders',
		description: 'Wired up three or more axes on a single view.',
		earned: true
	},
	{
		id: 'token-smith',
		label: 'Token Smith',
		icon: 'fa-solid fa-hammer',
		description: 'Defined a view token and composed a nested view.',
		earned: false
	},
	{
		id: 'font-forager',
		label: 'Font Forager',
		icon: 'fa-solid fa-font',
		description: 'Loaded a font from three different foundries.',
		earned: false
	},
	{
		id: 'deep-zoom',
		label: 'Pixel Peeper',
		icon: 'fa-solid fa-magnifying-glass-plus',
		description: 'Zoomed past 1600% to inspect the pixel grid.',
		earned: false
	}
];

const DEFAULTS: AccountState = {
	username: 'designer',
	email: 'you@example.com',
	accountId: 'kit10-local-0001',
	connectedApps: DEFAULT_CONNECTED_APPS,
	shareAnalytics: false,
	shareCrashReports: true
};

const STORAGE_KEY = 'kit10:account';
// The change-password gate stores a local secret separately (never in the account blob that a
// future export might include). Empty string = no password set yet.
const PASSWORD_KEY = 'kit10:account-password';

function load(): AccountState {
	try {
		if (typeof localStorage === 'undefined') return structuredClone(DEFAULTS);
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return structuredClone(DEFAULTS);
		const parsed = JSON.parse(raw) as Partial<AccountState>;
		// Merge over defaults so a value written by an older build stays complete; keep the default
		// app catalogue but overlay saved `connected` flags.
		const apps = DEFAULT_CONNECTED_APPS.map((app) => {
			const saved = parsed.connectedApps?.find((a) => a.id === app.id);
			return saved ? { ...app, connected: !!saved.connected } : app;
		});
		return { ...DEFAULTS, ...parsed, connectedApps: apps };
	} catch {
		return structuredClone(DEFAULTS);
	}
}

export const account: Writable<AccountState> = writable(load());

function persist(value: AccountState): void {
	try {
		if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
	} catch {
		// best-effort
	}
}

export function updateAccount(patch: Partial<AccountState>): void {
	const next = { ...get(account), ...patch };
	account.set(next);
	persist(next);
}

export function toggleConnectedApp(id: string): void {
	const state = get(account);
	const connectedApps = state.connectedApps.map((a) =>
		a.id === id ? { ...a, connected: !a.connected } : a
	);
	updateAccount({ connectedApps });
}

// --- Password gate (local, best-effort) ---

export function hasPassword(): boolean {
	try {
		return typeof localStorage !== 'undefined' && !!localStorage.getItem(PASSWORD_KEY);
	} catch {
		return false;
	}
}

// Verifies the current password. If none is set yet, any check passes (first set is unguarded).
export function verifyPassword(current: string): boolean {
	try {
		if (typeof localStorage === 'undefined') return true;
		const stored = localStorage.getItem(PASSWORD_KEY);
		if (!stored) return true;
		return stored === current;
	} catch {
		return true;
	}
}

// Sets a new password iff the current one verifies. Returns whether it changed.
export function changePassword(current: string, next: string): boolean {
	if (!next) return false;
	if (!verifyPassword(current)) return false;
	try {
		if (typeof localStorage !== 'undefined') localStorage.setItem(PASSWORD_KEY, next);
		return true;
	} catch {
		return false;
	}
}
