// Shared browser-side base64<->bytes helpers -- the convention this codebase already uses to carry
// real binary through a String-typed Extism plugin_fn boundary (Charter's `viewport_data_binary`
// field, Tenner's `export_project_gz`/`import_project_gz`). Kept as one pair of pure functions so
// every call site (manager.svelte.ts's Charter wire decode, download.ts's compressed-export
// download, Project.svelte's compressed-import file read) can't drift from each other.
export function base64ToBytes(b64: string): Uint8Array {
	const binaryStr = atob(b64);
	const bytes = new Uint8Array(binaryStr.length);
	for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
	return bytes;
}

export function bytesToBase64(bytes: Uint8Array): string {
	let binaryStr = '';
	// Chunked rather than one `String.fromCharCode(...bytes)` spread -- that call takes one
	// argument per array element, which blows the engine's max-arguments limit on a large file
	// (a real risk here: this backs whole-project export files, not small fixed-size payloads).
	const chunkSize = 0x8000;
	for (let i = 0; i < bytes.length; i += chunkSize) {
		binaryStr += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
	}
	return btoa(binaryStr);
}
