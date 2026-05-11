import type { Generated, Insertable, Updateable, Selectable } from 'kysely';
import { sql } from 'kysely';
import type { EditorDialect } from './index.js';

export type View = Selectable<ViewsTable>;
export type NewView = Insertable<ViewsTable>;
export type UpdateView = Updateable<ViewsTable>;

export interface ViewsTable {
	id: Generated<string>; // UUIDv7
	name: string;
	last_modified: Generated<Date>;
	project_id: string;

	lock: boolean;
	hide: boolean;
}

export const createViewByProject = async (db: EditorDialect, project_id: string, name: string) => {
	await db.insertInto('views').values({ name, project_id, hide: false, lock: false }).execute();
};

export const createViewsTable = async (db: EditorDialect) => {
	// Create table
	await db.schema
		.createTable('views')
		.ifNotExists()
		.addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuid_generate_v7()`))
		.addColumn('name', 'varchar(255)', (col) => col.notNull())
		.addColumn('last_modified', 'timestamptz', (col) => col.notNull().defaultTo(sql<Date>`now()`))
		.addColumn('project_id', 'uuid', (col) => col.references('projects.id').onDelete('restrict'))
		.addColumn('lock', 'boolean', (col) => col.notNull().defaultTo(sql<boolean>`false`))
		.addColumn('hide', 'boolean', (col) => col.notNull().defaultTo(sql<boolean>`false`))
		.execute();
};
