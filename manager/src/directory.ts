import { sql } from 'kysely';
import type { Generated, Insertable, Updateable, Selectable } from 'kysely';
import type { EditorDialect, Kit10Project } from './index.js';

export type Directory = Selectable<DirectoriesTable>;
export type NewDirectory = Insertable<DirectoriesTable>;
export type DirectoryUpdate = Updateable<DirectoriesTable>;

export interface DirectoriesTable {
	id: Generated<string>; // UUIDv7
	parent_id: string | null;
	parent_index: Generated<number>;
	forbid_children: boolean;
}

export const createDirectoriesTable = async (db: EditorDialect) => {
	await db.schema
		.createTable('directories')
		.ifNotExists()
		.addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuid_generate_v7()`))
		.addColumn('parent_id', 'uuid', (col) => col.references('directories.id').onDelete('cascade'))
		.addColumn('parent_index', 'integer')
		.addCheckConstraint(
			'no_parent_no_index_vice_versa',
			sql`(parent_id IS NULL) = (parent_index IS NULL)`
		)
		// Ensure uniqueness within the same parent
		.addUniqueConstraint('unique_index_in_parent', ['parent_id', 'parent_index'], (cb) =>
			cb.nullsNotDistinct()
		)
		.addColumn('forbid_children', 'boolean', (col) => col.notNull().defaultTo(false))
		.execute();

	const statements = [assert_can_have_children, ...set_directory_parent, ...set_directory_index];

	for (const statement of statements) {
		await sql.raw(statement).execute(db);
	}
};

const assert_can_have_children = `CREATE OR REPLACE FUNCTION assert_can_have_children(dir_id UUID)
RETURNS VOID AS $$
BEGIN
  IF dir_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM directories
    WHERE id = dir_id AND forbid_children
  ) THEN
    RAISE EXCEPTION 'Parent directory forbids children';
  END IF;
END;
$$ LANGUAGE plpgsql;`;

const set_directory_parent = [
	`CREATE OR REPLACE FUNCTION set_directory_parent()
RETURNS TRIGGER AS $$
DECLARE
  ctx_parent UUID;
BEGIN
  -- If explicitly provided, respect it
  IF NEW.parent_id IS NOT NULL THEN
    PERFORM assert_can_have_children(NEW.parent_id);
    RETURN NEW;
  END IF;

  -- Pull from session
  ctx_parent := NULLIF(current_setting('app.current_parent_id', true), '')::UUID;

  -- If no context → root node
  IF ctx_parent IS NULL THEN
    NEW.parent_id := NULL;
    RETURN NEW;
  END IF;

  -- enforce forbid_children
  PERFORM assert_can_have_children(ctx_parent);

  NEW.parent_id := ctx_parent;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;`,
	`DROP TRIGGER IF EXISTS a_set_parent_id ON directories;`,

	`CREATE TRIGGER a_set_parent_id
BEFORE INSERT ON directories
FOR EACH ROW
EXECUTE FUNCTION set_directory_parent();`
];

const set_directory_index = [
	`CREATE OR REPLACE FUNCTION set_directory_index()
RETURNS TRIGGER AS $$
DECLARE
  max_idx INTEGER;
BEGIN
  -- enforce forbid_children if there's a parent
  IF NEW.parent_id IS NOT NULL THEN
    PERFORM assert_can_have_children(NEW.parent_id);
  END IF;

  -- Only auto-assign if the user didn't provide one
  IF NEW.parent_index IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.parent_id IS NULL THEN
    -- Root directories always have NULL index
    NEW.parent_index := NULL;
  ELSE
    -- Child directories: assign next available index
    SELECT COALESCE(MAX(parent_index), -1000)
    INTO max_idx
    FROM directories
    WHERE parent_id = NEW.parent_id;

    NEW.parent_index := max_idx + 1000;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;`,

	`DROP TRIGGER IF EXISTS b_set_parent_index ON directories;`,

	`CREATE TRIGGER b_set_parent_index
BEFORE INSERT ON directories
FOR EACH ROW
EXECUTE FUNCTION set_directory_index();`
];

export const createDirectoryTriggerForTable = <TTable extends keyof Kit10Project>(
	tableName: TTable,
	options: { forbidChildren?: boolean; forceRoot?: boolean } = {}
) => {
	const { forbidChildren = false, forceRoot = false } = options;

	return [
		`CREATE OR REPLACE FUNCTION create_${String(tableName)}_directory()
RETURNS TRIGGER AS $$
DECLARE
  parent_dir_id UUID;
  max_idx INTEGER;
BEGIN
  -- Auto-generate directory_id if missing
  IF NEW.directory_id IS NULL THEN

    -- Decide parent based on forceRoot
    IF ${forceRoot} THEN
      parent_dir_id := NULL;
    ELSE
      parent_dir_id := NULLIF(current_setting('app.current_parent_id', true), '')::UUID;
    END IF;

    -- Check forbid_children
    PERFORM assert_can_have_children(parent_dir_id);

    IF parent_dir_id IS NULL THEN
        -- root directory: index is NULL
        INSERT INTO directories (parent_id, parent_index, forbid_children)
        VALUES (NULL, NULL, ${forbidChildren ? 'TRUE' : 'FALSE'})
        RETURNING id INTO NEW.directory_id;
    ELSE
        -- assign next available index under parent
        SELECT COALESCE(MAX(parent_index), -1000) INTO max_idx
        FROM directories
        WHERE parent_id = parent_dir_id;

        INSERT INTO directories (parent_id, parent_index, forbid_children)
        VALUES (parent_dir_id, max_idx + 1000, ${forbidChildren ? 'TRUE' : 'FALSE'})
        RETURNING id INTO NEW.directory_id;
    END IF;

  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;`,

		`DROP TRIGGER IF EXISTS set_${String(tableName)}_directory ON ${String(tableName)};`,

		`CREATE TRIGGER set_${String(tableName)}_directory
BEFORE INSERT ON ${String(tableName)}
FOR EACH ROW
EXECUTE FUNCTION create_${String(tableName)}_directory();`
	];
};
