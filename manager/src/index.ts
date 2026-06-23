import type { PGliteInterfaceExtensions } from '@electric-sql/pglite';
import { PGliteWorker } from '@electric-sql/pglite/worker';
import { live } from '@electric-sql/pglite/live';

import { Kysely, sql } from 'kysely';
// The actual exported member is PgliteDialect
import { PgliteDialect } from '@soapbox/kysely-pglite';

import type { SchemaDialect, SchemaTS } from './schema.js';
import type { SelectQueryBuilder } from 'kysely';

export type EditorDialect = SchemaDialect;
export type EditorQueryBuilder<O> = SelectQueryBuilder<any, any, O>;

export { queryBuilder } from './api/index.js';

export interface EditorState {
	core: EditorCore;
	dialect: SchemaTS;
}

export type EditorCore = PGliteWorker & PGliteInterfaceExtensions<{ live: typeof live }>;

let currentEditorState: EditorState | undefined;

export const initializeEditorState: () => Promise<EditorState | undefined> = async () => {
	try {
		if (currentEditorState) {
			await currentEditorState.core.close();
		}

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

		currentEditorState = { core: pgWorker, dialect };
		return currentEditorState;
	} catch (e) {
		console.error('Handshake failed: ', e);
	}
};

import { up } from './migrations/2026-04-21/index.js';
import { seedDemoProject } from './seed.js';

export const initEditorDB: (dialect: SchemaDialect) => Promise<void> = async (dialect) => {
	await sql`CREATE EXTENSION IF NOT EXISTS pg_uuidv7`.execute(dialect);

	await up(dialect as any);

	const workspaces = await dialect.selectFrom('workspaces').selectAll().executeTakeFirst();

	if (!workspaces) {
		await dialect.insertInto('workspaces').values({ name: 'Default' }).execute();
		await seedDemoProject(dialect);
	}

	console.log('-------- Workspaces --------');
	console.table(workspaces);

	console.log('-------- Projects --------');
	const projects = await dialect.selectFrom('projects').selectAll().execute();
	console.table(projects);
};

export { jsonArrayFrom } from 'kysely/helpers/postgres';
export { type Api } from './api/index.js';
export { resolve, resolveMany, flattenKitResults, matchesArg, type ResolvedProperty, type ResolvedKit } from './resolve/resolve.js';
