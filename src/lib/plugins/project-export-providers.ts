// Swappable mapping of "which plugins can export a whole project" -- same shape as
// suggestion-providers.ts's inputType -> plugin mapping, and for the same reason (VISION.md's
// 1st Principle): the UI that builds the Export submenu never hardcodes a specific plugin's
// name inline, it reads this list. Adding a new project-level export target later (a second
// utility plugin producing, say, a zipped bundle or a different format) is a one-entry addition
// here, not a change to Project.svelte's menu-building logic.
//
// A provider only actually shows up in a given project's Export submenu if that project also
// references the matching plugin (by `id`, matched against `kit10_get_project_export`-style
// registry rows via getProjectPlugins) -- see Project.svelte's providersForProject.

export interface ProjectExportProvider {
	// Must match a plugins.name row in the DB-backed plugin registry (manager's plugins table).
	id: string;
	// Menu item label shown to the user.
	label: string;
	// Utility plugin function to call via callUtilityPlugin(id, fn, payload).
	fn: string;
	// File extension (no leading dot) and MIME type used when saving the result to disk.
	fileExtension: string;
	mimeType: string;
}

export const PROJECT_EXPORT_PROVIDERS: ProjectExportProvider[] = [
	{
		id: 'tenner',
		label: 'Export Raw with Tenner',
		fn: 'export_project',
		fileExtension: 'yaml',
		mimeType: 'text/yaml'
	}
];
