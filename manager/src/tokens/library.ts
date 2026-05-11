import { Kysely, sql } from 'kysely';
import type { Generated, Selectable, Insertable, Updateable } from 'kysely';
import type { Kit10Project } from '../index.ts';

export type Library = Selectable<LibraryTable>;
export type NewLibrary = Insertable<LibraryTable>;
export type LibraryUpdate = Updateable<LibraryTable>;

export interface LibraryTable {
	id: Generated<string>; // UUIDv7
	last_modified: Generated<Date>;
	name: string;
	description: string | null;

	project_id: string | null; // Self-reference for nested libraries
	library_id: string | null; // Self-reference for nested libraries
	kit_id: string | null; // Self-reference for nested libraries
	view_id: string | null; // Self-reference for nested libraries

	parent_index: number; // Order in the parent library / project

	directory_id: string;
}

export const createTokensLibraryTable = async (db: Kysely<Kit10Project>) => {
	// Create table
	await db.schema
		.createTable('token_libraries')
		.ifNotExists()
		.addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuid_generate_v7()`))
		.addColumn('parent_index', 'integer', (col) => col.notNull())
		.addColumn('name', 'varchar(255)', (col) => col.notNull())
		.addColumn('description', 'text')
		.addColumn('last_modified', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
		.addColumn('directory_id', 'uuid', (col) => col.notNull())

		// parent
		.addColumn('project_id', 'uuid')
		.addColumn('library_id', 'uuid')
		.addColumn('kit_id', 'uuid')
		.addColumn('view_id', 'uuid')

		// either-or check for being top-level or child of library or kit or view
		.addCheckConstraint(
			'child_of_project_or_library_or_kit_or_view',
			sql`
        (project_id IS NOT NULL AND library_id IS NULL AND kit_id IS NULL AND view_id IS NULL) OR -- CHILD OF PROJECT
        (project_id IS NULL AND library_id IS NOT NULL AND kit_id IS NULL AND view_id IS NULL) OR -- CHILD OF LIBRARY
        (project_id IS NULL AND library_id IS NULL AND kit_id IS NOT NULL AND view_id IS NULL) OR -- CHILD OF KIT
        (project_id IS NULL AND library_id IS NULL AND kit_id IS NULL AND view_id IS NOT NULL) -- CHILD OF VIEW
    `
		)
		// make containing parent index unique
		.addUniqueConstraint('unique_index_in_project', ['project_id', 'parent_index'])
		.addUniqueConstraint('unique_index_in_library', ['library_id', 'parent_index'])
		.addUniqueConstraint('unique_index_in_kit', ['kit_id', 'parent_index'])
		.addUniqueConstraint('unique_index_in_view', ['view_id', 'parent_index'])
		.execute();

	await setupDesignTokenLibraries(db);
};

const setupDesignTokenLibraries = async (db: Kysely<Kit10Project>) => {
	const statements = [...autogen_on_new_project, ...library_parent_index];

	for (const statement of statements) {
		// Using sql.raw to bypass Kysely's parameter binding for DDL
		await sql.raw(statement).execute(db);
	}
};

const library_parent_index = [
	`CREATE OR REPLACE FUNCTION set_library_parent_index()
RETURNS TRIGGER AS $$
DECLARE
  max_index NUMERIC;
BEGIN
  IF NEW.parent_index IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT MAX(parent_index)
  INTO max_index
  FROM token_libraries
  WHERE
    library_id IS NOT DISTINCT FROM NEW.library_id AND
    project_id IS NOT DISTINCT FROM NEW.project_id;

  IF max_index IS NULL THEN
    NEW.parent_index := 1000;
  ELSE
    NEW.parent_index := max_index + 1000;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;`,

	`CREATE OR REPLACE FUNCTION set_library_parent_index()
RETURNS TRIGGER AS $$
DECLARE
  max_index NUMERIC;
BEGIN
  IF NEW.parent_index IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT MAX(parent_index)
  INTO max_index
  FROM token_libraries
  WHERE
    library_id IS NOT DISTINCT FROM NEW.library_id AND
    project_id IS NOT DISTINCT FROM NEW.project_id;

  IF max_index IS NULL THEN
    NEW.parent_index := 0;
  ELSE
    NEW.parent_index := max_index + 1000;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;`,

	`DROP TRIGGER IF EXISTS library_set_parent_index ON token_libraries;`,

	`CREATE TRIGGER library_set_parent_index
BEFORE INSERT ON token_libraries
FOR EACH ROW
EXECUTE FUNCTION set_library_parent_index();`
];

const autogen_on_new_project = [
	// generate a new library function
	`CREATE OR REPLACE FUNCTION create_project_library()
RETURNS TRIGGER
AS $$
DECLARE
  new_directory_id UUID;
BEGIN
  -- 1. Reserve the spot in the tree first
  -- parent_id is NULL (it's a root folder)
  -- parent_index is handled by our existing set_directory_index trigger
  INSERT INTO directories (parent_id, forbid_children)
  VALUES (NULL, false)
  RETURNING id INTO new_directory_id;

  -- 2. Create the library using the new directory ID
  INSERT INTO token_libraries (directory_id, name, project_id, description)
  VALUES (new_directory_id, NEW.name, NEW.id, 'Please Describe Library');

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;`,

	`DROP TRIGGER IF EXISTS create_library_after_project ON projects;`,

	// call new library on new project using trigger
	`CREATE TRIGGER create_library_after_project
AFTER INSERT ON projects
FOR EACH ROW
EXECUTE FUNCTION create_project_library();`
];

// const _autogen_on_new_project = [
// 	// generate a new library function
// 	`CREATE OR REPLACE FUNCTION create_project_library()
// RETURNS TRIGGER
// AS $$
// BEGIN
//   INSERT INTO token_libraries (name, project_id, description)
//   VALUES (NEW.name, NEW.id, 'Please Describe Library');
//
//   RETURN NEW;
// END;
// $$ LANGUAGE plpgsql;`,
//
// 	`DROP TRIGGER IF EXISTS create_library_after_project ON projects;`,
//
// 	// call new library on new project using trigger
// 	`CREATE TRIGGER create_library_after_project
// AFTER INSERT ON projects
// FOR EACH ROW
// EXECUTE FUNCTION create_project_library();`
// ];
