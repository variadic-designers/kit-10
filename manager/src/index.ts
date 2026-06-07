import type { PGliteInterfaceExtensions } from '@electric-sql/pglite';
import { PGliteWorker } from '@electric-sql/pglite/worker';
import { live } from '@electric-sql/pglite/live';

import { Kysely, sql } from 'kysely';
// The actual exported member is PgliteDialect
import { PgliteDialect } from '@soapbox/kysely-pglite';

export type { SelectQueryBuilder } from 'kysely';

import type { SchemaDialect, SchemaTS } from './schema.js';

export { queryBuilder } from './api/index.js';

export interface EditorState {
	core: EditorCore;
	dialect: SchemaTS;
}

export type EditorCore = PGliteWorker & PGliteInterfaceExtensions<{ live: typeof live }>;

export const initializeEditorState: () => Promise<EditorState | undefined> = async () => {
	try {
		const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });

		const options = {
			extensions: { live }
		};

		const pgWorker: EditorCore = await PGliteWorker.create(worker, options);

		await pgWorker.waitReady;

		console.log('PGlite Handshake successful!');

		const dialect: SchemaDialect = new Kysely({
			dialect: new PgliteDialect({
				database: pgWorker
			})
		});

		await initEditorDB(dialect);

		return { core: pgWorker, dialect };
	} catch (e) {
		console.error('Handshake failed: ', e);
	}
};

import { up } from './migrations/2026-04-21/index.js';

export const initEditorDB: (dialect: SchemaDialect) => Promise<void> = async (dialect) => {
	await sql`CREATE EXTENSION IF NOT EXISTS pg_uuidv7`.execute(dialect);

	await up(dialect as any);

	const workspaces = await dialect.selectFrom('workspaces').selectAll().executeTakeFirst();

	if (!workspaces) {
		await dialect.insertInto('workspaces').values({ name: 'Default' }).execute();
	}

	console.log('-------- Workspaces --------');
	console.table(workspaces);

	console.log('-------- Projects --------');
	const projects = await dialect.selectFrom('projects').selectAll().execute();
	console.table(projects);
};

export { jsonArrayFrom } from 'kysely/helpers/postgres';
export { type Api } from './api/index.js';
