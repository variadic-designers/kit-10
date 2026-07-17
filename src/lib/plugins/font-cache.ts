// Persistent, per-user font-byte cache backed by IndexedDB. Fetched WOFF2 bytes otherwise live
// only in Vellum's session memory + the editor's in-memory URL set (both die on reload), so every
// family re-fetches from the network each session. This module persists the *bytes* keyed by
// their resolved URL, so a reload's font loading is network-free and works offline.
//
// It is exposed to the plugin layer as the host functions `kit10_font_cache_get` /
// `kit10_font_cache_put` (see manager.svelte.ts); Fontavious's `fetch_font` checks the cache
// before hitting the vendor CDN and stores the bytes after a miss. Full architecture +
// licensing rationale: resources/nature-of-fonts.md §7.
//
// LICENSING: a private, per-user, client-side cache is the same category as the browser's own
// HTTP cache -- safe for ALL tiers, proprietary included. Exposure (rehost / export-bundle) is a
// different act, guarded elsewhere. Each record carries `licenseTier` so a FUTURE export path can
// filter to `licenseTier === 'ofl'` only (§7.3) -- proprietary bytes stay cached but invisible to
// export by construction. Nothing reads that field yet.
//
// It never persists a GPU/loaded state (that can't survive a reload) -- only the bytes that feed
// each session's unavoidable `vellum.load_font()`.

// Host-level, plugin-AGNOSTIC store: it's keyed by URL and reached through the generic
// `kit10_font_cache_*` host functions, so any font-providing plugin's bytes land here -- the name
// must NOT be tied to Fontavious (a future icon/font plugin would use the same cache).
const DB_NAME = 'kit10-fonts';
const STORE = 'font-bytes';
const VERSION = 1;

export interface FontCacheMeta {
	url: string;
	licenseTier?: string;
	family?: string;
	category?: string;
	weightMin?: number;
	weightMax?: number;
	style?: string;
}

interface FontCacheRecord extends FontCacheMeta {
	bytes: ArrayBuffer;
	lastUsed: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
	if (dbPromise) return dbPromise;
	dbPromise = new Promise((resolve, reject) => {
		if (typeof indexedDB === 'undefined') {
			reject(new Error('IndexedDB unavailable'));
			return;
		}
		const req = indexedDB.open(DB_NAME, VERSION);
		req.onupgradeneeded = () => {
			const db = req.result;
			if (!db.objectStoreNames.contains(STORE)) {
				const os = db.createObjectStore(STORE, { keyPath: 'url' });
				os.createIndex('family', 'family', { unique: false });
			}
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
	// Best-effort: ask the browser not to evict the font cache under storage pressure.
	navigator.storage?.persist?.().catch(() => {});
	return dbPromise;
}

// Returns the cached bytes for a URL, or null on a miss / any error. Errors are swallowed to a
// miss so a cache fault never breaks font loading -- the caller just fetches from the network.
export async function getCachedFont(url: string): Promise<Uint8Array | null> {
	try {
		const db = await openDb();
		return await new Promise<Uint8Array | null>((resolve, reject) => {
			const tx = db.transaction(STORE, 'readonly');
			const req = tx.objectStore(STORE).get(url);
			req.onsuccess = () => {
				const rec = req.result as FontCacheRecord | undefined;
				resolve(rec ? new Uint8Array(rec.bytes) : null);
			};
			req.onerror = () => reject(req.error);
		});
	} catch {
		return null;
	}
}

// Stores font bytes keyed by URL. Best-effort: any failure is swallowed (the font still rendered
// this session; it just won't be cached for the next).
export async function putCachedFont(meta: FontCacheMeta, bytes: Uint8Array): Promise<void> {
	if (!meta?.url || bytes.length === 0) return;
	try {
		const db = await openDb();
		// Copy out of the (possibly larger) WASM-backed buffer into a tight ArrayBuffer.
		const buf = bytes.slice().buffer;
		const record: FontCacheRecord = { ...meta, bytes: buf, lastUsed: Date.now() };
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction(STORE, 'readwrite');
			tx.objectStore(STORE).put(record);
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
		});
	} catch {
		/* swallow -- caching is best-effort */
	}
}
