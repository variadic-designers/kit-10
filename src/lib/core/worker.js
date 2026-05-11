import { PGlite } from '@electric-sql/pglite';
import { OpfsAhpFS } from '@electric-sql/pglite/opfs-ahp';

import { pg_uuidv7 } from '@electric-sql/pglite/pg_uuidv7';
import { worker } from '@electric-sql/pglite/worker';
import { live } from '@electric-sql/pglite/live';

const uri = 'kit10-projects';

const memory = `memory://${uri}`;
const indexedDb = `idb://${uri}`;

// upcoming support
const opfs = `opfs-ahp://${uri}`;

worker({
	async init() {
		const dataDir = import.meta.env.DEV ? memory : indexedDb;

		return new PGlite(dataDir, {
			extensions: { pg_uuidv7, live }
		});
	}
});

self.postMessage('Worker is initialized');
