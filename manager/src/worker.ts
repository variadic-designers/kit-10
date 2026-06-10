import { PGlite } from '@electric-sql/pglite';
import { OpfsAhpFS } from '@electric-sql/pglite/opfs-ahp';

import { pg_uuidv7 } from '@electric-sql/pglite/pg_uuidv7';
import { worker } from '@electric-sql/pglite/worker';
import { live } from '@electric-sql/pglite/live';

worker({
	async init() {
		const dataDir = 'kit10-editor';

		try {
			const fs = new OpfsAhpFS(dataDir, {
				initialPoolSize: 50,
				maintainedPoolSize: 25
			});

			return new PGlite({
				dataDir,
				fs,
				extensions: { pg_uuidv7, live }
			});
		} catch (e) {
			console.warn('OPFS-AHP not available, falling back to IndexedDB:', e);
			return new PGlite({
				dataDir: `idb://${dataDir}`,
				extensions: { pg_uuidv7, live }
			});
		}
	}
});