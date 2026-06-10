import { PGlite } from '@electric-sql/pglite';

import { pg_uuidv7 } from '@electric-sql/pglite/pg_uuidv7';
import { worker } from '@electric-sql/pglite/worker';
import { live } from '@electric-sql/pglite/live';

worker({
	async init() {
		const dataDir = 'kit10-editor';

		try {
			const { OpfsAhpFS } = await import('@electric-sql/pglite/opfs-ahp');
			const pg = new PGlite({
				dataDir,
				fs: new OpfsAhpFS(dataDir, {
					initialPoolSize: 50,
					maintainedPoolSize: 25
				}),
				extensions: { pg_uuidv7, live }
			});
			await pg.waitReady;
			return pg;
		} catch {
			console.warn('OPFS-AHP unavailable, falling back to memory storage');
			const pg = new PGlite({
				dataDir: 'memory://',
				extensions: { pg_uuidv7, live }
			});
			await pg.waitReady;
			return pg;
		}
	}
});