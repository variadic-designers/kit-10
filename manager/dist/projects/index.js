import { sql } from 'kysely';
export const createProjectsTable = async (db) => {
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
export const deleteProject = async (db, id) => {
	return await db
		.deleteFrom('projects')
		.where('projects.id', '=', id)
		.returning('id')
		.executeTakeFirst();
};
export const renameProject = async (db, project_id, newName) => {
	return await db
		.updateTable('projects')
		.set({
			name: newName,
			last_modified: sql`now()`
		})
		.where('projects.id', '=', project_id)
		.returningAll()
		.executeTakeFirst();
};
export const createProjectByWorkspace = async (db, workspaceId, name, author, description) => {
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
