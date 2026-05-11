import { Kysely, type SelectQueryBuilder, type Transaction } from 'kysely';
import type { D2026_04_21, DB2026_04_21 } from './migrations/2026-04-21/index.js';

// Current version of db
export type SchemaTS = D2026_04_21;
export type Schema = DB2026_04_21;
export type SchemaDialect = Kysely<Schema>;

export type SchemaQueryBuilder<O, Tb extends keyof Schema = keyof Schema> = SelectQueryBuilder<
	Schema,
	Tb,
	O
>;

export type SchemaTransaction = Transaction<Schema>;
