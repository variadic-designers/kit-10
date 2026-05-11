import { sql } from 'kysely';
import type { Generated, Insertable, Updateable, Selectable } from 'kysely';
import type { EditorDialect } from './index.js';

export type Workspace = Selectable<WorkspacesTable>;
export type NewWorkspace = Insertable<WorkspacesTable>;
export type WorkspaceUpdate = Updateable<WorkspacesTable>;

export interface WorkspacesTable {
	id: Generated<string>; // UUIDv7
	name: string;
	description: string | null;
	last_active: Generated<Date>;
}

export const createWorkspacesTable = async (db: EditorDialect) => {
	await db.schema
		.createTable('workspaces')
		.ifNotExists()
		.addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql<string>`uuid_generate_v7()`))
		.addColumn('name', 'text', (col) => col.notNull())
		.addColumn('description', 'text', (col) => col.defaultTo(null))
		.addColumn('last_active', 'timestamptz', (col) => col.notNull().defaultTo(sql<Date>`now()`))
		.execute();
};

export const touchWorkspace = async (db: EditorDialect, id: string) => {
	const [workspace] = await db
		.updateTable('workspaces')
		.set({ last_active: sql<Date>`now()` })
		.where('id', '=', id)
		.returningAll()
		.execute();

	return workspace;
};

export const renameWorkspace = async (db: EditorDialect, workspace_id: string, newName: string) => {
	return await db
		.updateTable('workspaces')
		.set({
			name: newName,
			last_active: sql<Date>`now()`
		})
		.where('workspaces.id', '=', workspace_id)
		.returningAll()
		.executeTakeFirst();
};

export const createWorkspace = async (db: EditorDialect, name: string, description: string) => {
	const [workspace] = await db
		.insertInto('workspaces')
		.values({
			name,
			description
		})
		.returningAll()
		.execute();

	return workspace;
};
