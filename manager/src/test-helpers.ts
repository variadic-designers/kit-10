import { PGlite } from '@electric-sql/pglite';
import { pg_uuidv7 } from '@electric-sql/pglite/pg_uuidv7';
import { Kysely, sql } from 'kysely';
import { PgliteDialect } from '@soapbox/kysely-pglite';
import { up } from './migrations/2026-04-21/index.js';
import { queryBuilder, type Api } from './api/index.js';
import type { SchemaDialect } from './schema.js';

export interface TestContext {
	db: SchemaDialect;
	api: Api;
	pg: PGlite;
}

export async function createTestDb(): Promise<TestContext> {
	const pg = await PGlite.create({ extensions: { pg_uuidv7 } });
	const db = new Kysely({
		dialect: new PgliteDialect({ database: pg })
	}) as unknown as SchemaDialect;
	await sql`CREATE EXTENSION IF NOT EXISTS pg_uuidv7`.execute(db);
	await up(db as any);
	const workspaces = await db.selectFrom('workspaces').selectAll().executeTakeFirst();
	if (!workspaces) {
		await db.insertInto('workspaces').values({ name: 'Default' }).execute();
	}
	return { db, api: queryBuilder(db), pg };
}
