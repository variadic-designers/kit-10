type AxesSet = Partial<Record<string, string | string[]>>;

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