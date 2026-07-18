// Shared context every settings tab receives. Kept in its own module (not tabs.ts) so tab
// components can import the type without a circular dependency through the registry.
import type { Api } from 'manager';
import type { PluginManager } from '$lib/plugins/manager.svelte.js';

// Structural mirror of Editor.svelte's EditorActivity. TypeScript's ambient `.svelte` module
// declarations don't carry named-export info into plain .ts files (same reason selection.ts
// redeclares its shapes), so we mirror the fields tabs actually read/mutate here.
export interface EditorActivity {
	activeWorkspaceId: string | null;
	activeWorkspaceName: string | null;
	activeProjectId: string | null;
	activeProjectName: string | null;
	activeViewId: string | null;
	activeKitId: string | null;
}

export interface SettingsContext {
	api: Api;
	// The live editor-activity $state object. Tabs mutate its fields directly (it's a shared
	// reference, so field writes propagate without a bind).
	editorActivity: EditorActivity;
	pluginManager: PluginManager | null;
	// Closes the Settings dialog.
	close: () => void;
}
