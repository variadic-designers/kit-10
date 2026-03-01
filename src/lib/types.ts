import type { ComponentFlat, ComponentView } from './editor/Component.svelte';
import type { Token, TokenLibrary } from './editor/Variables.svelte';
import { SvelteMap } from 'svelte/reactivity';
import type { AxesSet } from './cascadeAxesMap.ts';

export type Kit10ProjectRuntime = {
	viewPortFocus?: { x: number; y: number };
	selectedLayer?: AxesSet;
};

export type Kit10ProjectMeta = {
	title: string;
	description: string;
	author: string;
	license: string;
};

export type Kit10ProjectTokens = {
	tokens: Token[];
	tokenLibraries: TokenLibrary;
};

export type Kit10ProjectCore = {
	kitsPool: Record<string, ComponentFlat>; // UUID -> component
	viewsPool: Record<string, ComponentView>; // UUID -> view

	kits: string[];
	views: string[]; // maintains order of views
};

export interface Kit10Project extends Kit10ProjectMeta, Kit10ProjectTokens, Kit10ProjectCore {}
export interface Kit10ProjectEditor extends Kit10Project, Kit10ProjectRuntime {}

export interface Kit10Exporter {}

export type SemVer = string;
export type ISODateString = string;

export type PluginContext = undefined;

export interface Kit10PluginMeta {
	name: string;
	version: SemVer;
	authors: string[];
	canonicalLink: string;
	updated: ISODateString;

	homepage?: string;
	repository?: string;
}

export interface Kit10Plugin extends Kit10PluginMeta {
	register?(ctx: PluginContext): void;

	export?(ctx: PluginContext): void;
}
