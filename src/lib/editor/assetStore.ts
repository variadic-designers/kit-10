import { type Writable, writable } from 'svelte/store';
import type { AssetRow } from 'manager';
import { getVellumInstance, requestVellumRender } from './vellum-instance.ts';
import { assetBytes } from './asset-bytes.ts';
import type { Api } from 'manager';

export type AssetRecord = {
	id: string;
	name: string;
	mimeType: string;
	checksum: string;
	link: string;
	width: number;
	height: number;
	createdAt: Date;
};

export let assetRegister: Writable<AssetRecord[]> = writable([]);

function rowToRecord(row: AssetRow): AssetRecord {
	return {
		id: row.id,
		name: row.name,
		mimeType: row.mime_type,
		checksum: row.checksum,
		link: row.link,
		width: row.width,
		height: row.height,
		createdAt: row.created_at
	};
}

export function registerAsset(row: AssetRow) {
	const record = rowToRecord(row);
	assetRegister.update((list) => {
		if (list.some((a) => a.id === record.id)) return list;
		return [...list, record];
	});
}

function checksumHex(bytes: Uint8Array): Promise<string> {
	const hash = crypto.subtle.digest('SHA-256', bytes.buffer as ArrayBuffer);
	return hash.then((h) => {
		const hex = Array.from(new Uint8Array(h))
			.map((b) => b.toString(16).padStart(2, '0'))
			.join('');
		return hex;
	});
}

function sniffMimeType(bytes: Uint8Array): string {
	// PNG: 89 50 4E 47
	if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)
		return 'image/png';
	// JPEG: FF D8 FF
	if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
	// WEBP: 52 49 46 46 ... 57 45 42 50
	if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46)
		return 'image/webp';
	// GIF: 47 49 46 38
	if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38)
		return 'image/gif';
	// AVIF: 00 00 00 1C 66 74 79 70 61 76 69 66
	if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70)
		return 'image/avif';
	// SVG: <svg or <?xml
	const preamble = new TextDecoder().decode(bytes.slice(0, 128));
	if (preamble.includes('<svg') || preamble.includes('<?xml')) return 'image/svg+xml';
	return 'application/octet-stream';
}

function decodeDimensions(
	bytes: Uint8Array,
	mimeType: string
): Promise<{ width: number; height: number }> {
	if (mimeType === 'image/svg+xml') {
		return Promise.resolve({ width: 0, height: 0 });
	}
	return new Promise((resolve, reject) => {
		const blob = new Blob([bytes.buffer as ArrayBuffer], { type: mimeType });
		const img = new Image();
		img.onload = () => {
			resolve({ width: img.naturalWidth, height: img.naturalHeight });
			URL.revokeObjectURL(img.src);
		};
		img.onerror = () => {
			URL.revokeObjectURL(img.src);
			reject(new Error(`Failed to decode image`));
		};
		img.src = URL.createObjectURL(blob);
	});
}

// Import a file from the local filesystem: stores bytes in IndexedDB, upserts metadata
// in PGlite, and uploads to Vellum's GPU cache. Dedup by project+checksum.
export async function importAssetFile(
	api: {
		upsertAsset: (input: {
			projectId: string;
			name: string;
			mimeType: string;
			checksum: string;
			link: string;
			width: number;
			height: number;
		}) => Promise<AssetRow>;
	},
	projectId: string,
	file: File
): Promise<AssetRecord | null> {
	const raw = new Uint8Array(await file.arrayBuffer());
	if (raw.length === 0) return null;

	const checksum = await checksumHex(raw);
	const mimeType = sniffMimeType(raw);
	let width = 0;
	let height = 0;
	try {
		const dims = await decodeDimensions(raw, mimeType);
		width = dims.width;
		height = dims.height;
	} catch {
		// dimensions unknown - use 0
	}

	const row = await api.upsertAsset({
		projectId,
		name: file.name,
		mimeType,
		checksum,
		link: '',
		width,
		height
	});

	// Store bytes in IndexedDB regardless of whether the row already existed
	// (the call above returned an existing row if checksum matched, but the bytes
	// might not be in IDB yet if the DB was restored from an export without blobs).
	await assetBytes.put(row.id, raw);

	// Upload to Vellum's GPU cache synchronously so the image is loaded before the re-resolve
	// this import triggers runs layout - intrinsic sizing needs the decoded dimensions on the
	// first layout pass, otherwise a freshly-imported image renders at the wrong size for a
	// frame. The WASM decode + GPU upload blocks the main thread for ~50ms on a 4K image, which
	// is acceptable for a one-off manual import (vs. the old deferred queueMicrotask upload).
	const vellum = getVellumInstance();
	if (vellum) {
		try {
			vellum.load_image(row.id, raw);
			requestVellumRender();
		} catch (e) {
			console.warn('Failed to load image into Vellum:', e);
		}
	}

	const record = rowToRecord(row);
	registerAsset(row);
	return record;
}

// Remove an asset and its bytes from local storage. Does NOT touch cloud backup (link).
export async function removeAsset(api: Api, id: string): Promise<void> {
	await assetBytes.remove(id);
	await api.deleteAsset(id);
	assetRegister.update((list) => list.filter((a) => a.id !== id));
}
