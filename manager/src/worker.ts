import { PGlite } from '@electric-sql/pglite';
import { OpfsAhpFS } from '@electric-sql/pglite/opfs-ahp';

import { pg_uuidv7 } from '@electric-sql/pglite/pg_uuidv7';
import { worker } from '@electric-sql/pglite/worker';
import { live } from '@electric-sql/pglite/live';

worker({
	async init() {
		return new PGlite({
			dataDir: 'kit10-editor',
			fs: new OpfsAhpFS('kit10-editor', {
				initialPoolSize: 50,
				maintainedPoolSize: 25
			}),
			extensions: { pg_uuidv7, live }
		});
	}
});