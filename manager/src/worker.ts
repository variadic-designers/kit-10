import { PGlite } from '@electric-sql/pglite';

import { pg_uuidv7 } from '@electric-sql/pglite/pg_uuidv7';
import { worker } from '@electric-sql/pglite/worker';
import { live } from '@electric-sql/pglite/live';

worker({
	async init() {
		return new PGlite({
			dataDir: 'idb://kit10-editor',
			extensions: { pg_uuidv7, live }
		});
	}
});