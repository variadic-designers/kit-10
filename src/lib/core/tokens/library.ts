import { type Kysely, type Generated, sql } from 'kysely';
import type { Kit10Project } from '../index.ts';

export interface LibraryTable {
	id: Generated<string>; // UUIDv7
	last_modified: Generated<Date>;
	name: string;
	description: string | null;

	project_id: string | null; // Self-reference for nested libraries
	parent_library_id: string | null; // Self-reference for nested libraries
}

export const createTokensLibraryTable = async (db: Kysely<Kit10Project>) => {
	// Create table
	await db.schema
		.createTable('token_libraries')
		.ifNotExists()
		.addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuid_generate_v7()`))
		.addColumn('name', 'varchar(255)', (col) => col.notNull())
		.addColumn('description', 'text')
		.addColumn('last_modified', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
		.addColumn('project_id', 'uuid')
		.addColumn('parent_library_id', 'uuid')
		.addCheckConstraint(
			'parent_library_or_project',
			sql`
        (parent_library_id IS NOT NULL AND project_id IS NULL) OR  -- CHILD OF LIBRARY
        (parent_library_id IS NULL AND project_id IS NOT NULL)  -- CHILD OF PROJECT
    `
		)
		.execute();

	await sql`CREATE OR REPLACE FUNCTION create_project_library()
RETURNS TRIGGER
AS $$
BEGIN
  INSERT INTO token_libraries (name, project_id, description)
  VALUES (NEW.name, NEW.id, 'Please Describe Library');

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;`.execute(db);

	await sql`DROP TRIGGER IF EXISTS create_library_after_project ON projects;`.execute(db);
	await sql`CREATE TRIGGER create_library_after_project
AFTER INSERT ON projects
FOR EACH ROW
EXECUTE FUNCTION create_project_library();`.execute(db);
};

// export const createDefaultTokensLibrary = async (db: Kysely<Kit10Project>) => {
// 	const project = await db.selectFrom('projects').select(['id', 'name']).executeTakeFirst();
//
// 	const library = await db
// 		.selectFrom('token_libraries')
// 		.select((eb) => eb.fn.count('id').as('count'))
// 		.executeTakeFirst();
//
// 	if (project && !library?.count) {
// 		await db
// 			.insertInto('token_libraries')
// 			.values({
// 				name: project.name,
// 				description: 'Please Describe Library',
// 				project_id: project.id
// 			})
// 			.execute();
// 	}
// };
