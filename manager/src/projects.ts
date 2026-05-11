import { sql } from 'kysely';
import type { Generated, Insertable, Updateable, Selectable } from 'kysely';
import type { EditorDialect } from './index.js';

export type Project = Selectable<ProjectsTable>;
export type NewProject = Insertable<ProjectsTable>;
export type ProjectUpdate = Updateable<ProjectsTable>;

export interface ProjectsTable {
	id: Generated<string>; // UUIDv7
	name: string;
	description: string | null;
	last_modified: Generated<Date>;
	license: Generated<string>;
	author: string;

	workspace_id: Generated<string>;
}

export const createProjectsTable = async (db: EditorDialect) => {
	// Create table
	await db.schema
		.createTable('projects')
		.ifNotExists()
		.addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuid_generate_v7()`))
		.addColumn('name', 'text', (col) => col.notNull())
		.addColumn('description', 'text')
		.addColumn('last_modified', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
		.addColumn('license', 'text', (col) => col.notNull().defaultTo(`mplv2`))
		.addColumn('author', 'text', (col) => col.notNull())
		.addColumn('workspace_id', 'uuid', (col) =>
			col.references('workspaces.id').onDelete('cascade').notNull()
		)
		.execute();
};

export const deleteProject = async (db: EditorDialect, id: string) => {
	return await db
		.deleteFrom('projects')
		.where('projects.id', '=', id)
		.returning('id')
		.executeTakeFirst();
};

export const renameProject = async (db: EditorDialect, project_id: string, newName: string) => {
	return await db
		.updateTable('projects')
		.set({
			name: newName,
			last_modified: sql<Date>`now()`
		})
		.where('projects.id', '=', project_id)
		.returningAll()
		.executeTakeFirst();
};

export const createProjectByWorkspace = async (
	db: EditorDialect,
	workspaceId: string,
	name: string,
	author: string,
	description: string | null
) => {
	// Insert the project; the trigger will auto-create a directory under the workspace
	const [project] = await db
		.insertInto('projects')
		.values({
			name,
			description: 'No Description',
			author,
			license: 'mplv2',
			workspace_id: workspaceId
		})
		.returningAll()
		.execute();

	return project;
};
