import { base64ToBytes } from './base64.js';

// Triggers a browser download of in-memory content -- shared by Project.svelte's export submenu
// and Export.svelte's per-target Export button so the blob/object-URL dance exists in one place.
// `encoding: 'base64'` is for a plugin_fn's compressed-export output (see ExportCapability's
// `compressedVariant` doc comment) -- Extism plugin_fn results are String-typed, so real binary
// bytes travel as base64 text and need decoding back to bytes before the Blob is built, or the
// downloaded file would just be the base64 TEXT itself rather than the actual gzip bytes it names.
export function downloadText(
	text: string,
	filename: string,
	mimeType: string,
	encoding: 'text' | 'base64' = 'text'
) {
	const blob =
		encoding === 'base64'
			? new Blob([base64ToBytes(text).buffer as ArrayBuffer], { type: mimeType })
			: new Blob([text], { type: mimeType });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	a.click();
	URL.revokeObjectURL(url);
}

export interface DownloadableFile {
	filename: string;
	mimeType: string;
	content: string;
}

// Pure: decides WHAT to download, no DOM access -- testable without mocking Blob/URL/anchor. A
// multiFile-declaring plugin (see ExportCapability.multiFile) returns a { files: [...] } JSON
// envelope naming its own files, so e.g. an HTML export's <link href="styles.css"> is guaranteed
// to match the actually-downloaded CSS filename -- the host never invents names for these.
export function resolveDownloadFiles(
	resultText: string,
	multiFile: boolean | undefined,
	fallbackFilename: string,
	fallbackMimeType: string
): DownloadableFile[] {
	if (!multiFile) {
		return [{ filename: fallbackFilename, mimeType: fallbackMimeType, content: resultText }];
	}
	const parsed = JSON.parse(resultText) as { files: DownloadableFile[] };
	return parsed.files;
}

// Thin glue: resolves the file list, then downloads each. A small delay between downloads is a
// pragmatic mitigation for browsers that block/prompt on rapid successive auto-downloads -- a
// real, known browser quirk with no API-level fix, documented here rather than silently hoping
// single-file exports (the overwhelming common case, delay never applies) never regress.
export async function downloadExportResult(
	resultText: string,
	multiFile: boolean | undefined,
	fallbackFilename: string,
	fallbackMimeType: string,
	encoding: 'text' | 'base64' = 'text'
): Promise<void> {
	const files = resolveDownloadFiles(resultText, multiFile, fallbackFilename, fallbackMimeType);
	for (const [i, file] of files.entries()) {
		if (i > 0) await new Promise((r) => setTimeout(r, 150));
		downloadText(file.content, file.filename, file.mimeType, encoding);
	}
}
