import { PGlite } from '@electric-sql/pglite';

import { pg_uuidv7 } from '@electric-sql/pglite/pg_uuidv7';
import { worker } from '@electric-sql/pglite/worker';
import { live } from '@electric-sql/pglite/live';

worker({
	async init() {
		const pg = new PGlite('idb://kit10-editor', {
			relaxedDurability: true,
			extensions: { pg_uuidv7, live }
		});
		await pg.waitReady;
		return pg;
	}
});
