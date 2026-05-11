import { PGlite } from '@electric-sql/pglite';
// import { OpfsAhpFS } from '@electric-sql/pglite/opfs-ahp';
import { pg_uuidv7 } from '@electric-sql/pglite/pg_uuidv7';
import { worker } from '@electric-sql/pglite/worker';
import { live } from '@electric-sql/pglite/live';
const uri = 'kit10-editor';
// const idb = `idb://${uri}`;
const opfs = `opfs-ahp://${uri}`;
// TODO: Upgrade to Opfs when they stable
worker({
    async init() {
        return new PGlite({
            dataDir: opfs,
            extensions: { pg_uuidv7, live }
        });
    }
});
