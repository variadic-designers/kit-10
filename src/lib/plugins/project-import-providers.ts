// Import-side mirror of project-export-providers.ts -- same swappable-mapping shape (VISION.md's
// 1st Principle), same reason: the "Import" submenu never hardcodes a plugin's name, it reads
// this list. A provider only shows up once the matching plugin is actually registered in the
// DB-backed catalogue (checked via listPlugins -- see Project.svelte's availableImportProviders).

export interface ProjectImportProvider {
	// Must match a plugins.name row in the DB-backed plugin registry (manager's plugins table).
	id: string;
	// Menu item label shown to the user.
	label: string;
	// Utility plugin function to call via callUtilityPlugin(id, fn, payload).
	fn: string;
	// File picker's accept attribute, e.g. ".yaml,.yml".
	accept: string;
}

export const PROJECT_IMPORT_PROVIDERS: ProjectImportProvider[] = [
	{
		id: 'tenner',
		label: 'Import Raw with Tenner',
		fn: 'import_project',
		accept: '.yaml,.yml'
	}
];
