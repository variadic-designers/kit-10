// contextMenuStore.ts
import { type Writable, writable } from 'svelte/store';

export type Panel = {
	collapse: boolean;
};

export let panelState: { collapse: Writable<boolean> } = {
	collapse: writable(true)
};

export let collapse: Writable<boolean> = writable(false);
