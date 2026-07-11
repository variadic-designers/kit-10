const DB = 'kit10-assets';
const STORE = 'bytes';

function open(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB, 1);
		req.onupgradeneeded = () => req.result.createObjectStore(STORE);
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

async function tx(
	mode: IDBTransactionMode,
	fn: (store: IDBObjectStore) => IDBRequest
): Promise<unknown> {
	const db = await open();
	return new Promise((resolve, reject) => {
		const t = db.transaction(STORE, mode);
		t.oncomplete = () => {
			db.close();
			resolve(undefined);
		};
		t.onerror = () => {
			db.close();
			reject(t.error);
		};
		const req = fn(t.objectStore(STORE));
		req.onsuccess = () => resolve(req.result);
	});
}

export const assetBytes = {
	put(id: string, data: Uint8Array): Promise<void> {
		return tx('readwrite', (s) => s.put(data, id)) as Promise<void>;
	},

	get(id: string): Promise<Uint8Array | undefined> {
		return tx('readonly', (s) => s.get(id)) as Promise<Uint8Array | undefined>;
	},

	remove(id: string): Promise<void> {
		return tx('readwrite', (s) => s.delete(id)) as Promise<void>;
	},

	async list(): Promise<string[]> {
		const db = await open();
		return new Promise((resolve, reject) => {
			const t = db.transaction(STORE, 'readonly');
			t.onerror = () => {
				db.close();
				reject(t.error);
			};
			const req = t.objectStore(STORE).getAllKeys();
			req.onsuccess = () => {
				db.close();
				resolve(req.result as string[]);
			};
		});
	}
};
