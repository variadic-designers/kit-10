// The settings tab registry -- tabs as data, not hardcoded markup. The dialog shell renders the
// sidebar and content purely from this list, so adding a tab is one entry here. `section` groups
// tabs under a sidebar heading; order is preserved (first-seen section order wins).
//
// Component prop contract: the shell renders every tab as `<Comp ctx={SettingsContext} />`. Tabs
// that need editor/plugin access destructure `ctx`; purely-local tabs (Appearance, Billing, ...)
// ignore the extra prop (Svelte drops unknown props silently). The field is typed loosely because
// Svelte's Component type is contravariant in props and these tabs have heterogeneous signatures.
import type { Component } from 'svelte';
import ProfileTab from './ProfileTab.svelte';
import PrivacyTab from './PrivacyTab.svelte';
import WorkspacesTab from './WorkspacesTab.svelte';
import BillingTab from './BillingTab.svelte';
import AppearanceTab from './AppearanceTab.svelte';
import CanvasTab from './CanvasTab.svelte';
import KeybindsTab from './KeybindsTab.svelte';
import PluginsTab from './PluginsTab.svelte';
import AboutTab from './AboutTab.svelte';

export interface SettingsTab {
	id: string;
	label: string;
	icon: string;
	section: string;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	component: Component<any>;
}

export const SETTINGS_TABS: SettingsTab[] = [
	{ id: 'profile', label: 'Profile', icon: 'fa-solid fa-user', section: 'Account', component: ProfileTab },
	{ id: 'privacy', label: 'Privacy', icon: 'fa-solid fa-shield-halved', section: 'Account', component: PrivacyTab },
	{ id: 'workspaces', label: 'Workspaces', icon: 'fa-solid fa-folder', section: 'Account', component: WorkspacesTab },
	{ id: 'billing', label: 'Billing', icon: 'fa-solid fa-credit-card', section: 'Account', component: BillingTab },
	{ id: 'appearance', label: 'Appearance', icon: 'fa-solid fa-palette', section: 'Editor', component: AppearanceTab },
	{ id: 'canvas', label: 'Canvas', icon: 'fa-solid fa-arrows-up-down-left-right', section: 'Editor', component: CanvasTab },
	{ id: 'keybinds', label: 'Keybinds', icon: 'fa-solid fa-keyboard', section: 'Editor', component: KeybindsTab },
	{ id: 'plugins', label: 'Plugins', icon: 'fa-solid fa-plug', section: 'System', component: PluginsTab },
	{ id: 'about', label: 'About', icon: 'fa-solid fa-circle-info', section: 'System', component: AboutTab }
];
