// Triggers a browser download of in-memory text -- shared by Project.svelte's export submenu and
// Export.svelte's per-target Export button so the blob/object-URL dance exists in one place.
export function downloadText(text: string, filename: string, mimeType: string) {
	const blob = new Blob([text], { type: mimeType });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	a.click();
	URL.revokeObjectURL(url);
}
