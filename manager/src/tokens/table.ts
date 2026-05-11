import { Kysely, sql } from 'kysely';
import type { Generated, Insertable, Updateable, Selectable } from 'kysely';
import type { Kit10Project, EditorTransaction, EditorDialect } from '../index.js';
// import { type NewDirectory } from '../directory.js'

export type Token = Selectable<TokenTable>;
export type NewToken = Insertable<TokenTable>;
export type TokenUpdate = Updateable<TokenTable>;

export interface TokenTable {
	id: Generated<string>; // UUIDv7
	name: string;

	// Value Resolution:
	// The content: raw value OR the template (e.g., "{0}px {1}px")
	value: string | null;
	// For 1:1 simple aliases
	alias_of: string | null;
	// For composite interpolation (array of UUIDs)
	refs: string[] | null;
	resolved_value: string | null;

	last_modified: Generated<Date>;

	// scoped where
	library_id: string | null;
	view_id: string | null;
	kit_id: string | null;

	// top level token / library
	project_id: string | null; // Self-reference for nested libraries

	// is library instead?
	is_library: string | null;
}

export const createTokensTable = async (db: EditorDialect) => {
	// Create table
	await db.schema
		.createTable('tokens')
		.ifNotExists()
		.addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuid_generate_v7()`))
		.addColumn('last_modified', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
		.addColumn('parent_index', 'integer', (col) => col.notNull())
		.addColumn('name', 'varchar(255)', (col) => col.notNull())
		.addColumn('kind', 'varchar(255)', (col) => col)
		// value type
		.addColumn('value', 'text')
		.addColumn('resolved_value', 'text')
		.addColumn('alias_of', 'uuid', (col) => col.references('tokens.id').onDelete('restrict'))
		.addColumn('refs', sql`uuid[]`)
		.addColumn('is_library', 'boolean')
		.addCheckConstraint(
			'value_or_alias_or_interpolation_or_library',
			sql`
        (value IS NOT NULL AND alias_of IS NULL AND refs IS NULL AND is_library IS NULL) OR  -- ATOM
        (value IS NULL AND alias_of IS NOT NULL AND refs IS NULL AND is_library IS NULL) OR  -- ALIAS
        (value IS NOT NULL AND alias_of IS NULL AND refs IS NOT NULL AND is_library IS NULL) OR -- MOLECULE
        (value IS NULL AND alias_of IS NULL AND refs IS NULL AND is_library IS NOT NULL) -- LIBRARY OR DERIVATION
    `
		)
		// project scoped
		.addColumn('project_id', 'uuid')
		// library scoped
		.addColumn('library_id', 'uuid')
		// kit scoped
		.addColumn('kit_id', 'uuid')
		// view scoped
		.addColumn('view_id', 'uuid')
		.addCheckConstraint(
			'project_scoped_or_library_scoped_or_kit_scoped_or_view_scoped',
			sql`
        (library_id IS NULL AND view_id IS NULL AND kit_id IS NULL AND project_id IS NOT NULL) OR  -- CHILD OF LIBRARY
        (library_id IS NOT NULL AND view_id IS NULL AND kit_id IS NULL AND project_id IS NULL) OR  -- CHILD OF LIBRARY
        (library_id IS NULL AND view_id IS NULL AND kit_id IS NOT NULL AND project_id IS NULL) OR  -- CHILD OF A KIT
        (library_id IS NULL AND view_id IS NOT NULL AND kit_id IS NULL AND project_id IS NULL)  -- CHILD OF A VIEW
    `
		)
		// TODO: For UI Filesystem view
		// .addColumn('directory_index', 'int', (col) => col.notNull())
		// .addUniqueConstraint('unique_library_index', ['library_id', 'directory_index'])
		.execute();

	await setupDesignTokens(db);
};

const setupDesignTokens = async (db: Kysely<Kit10Project>) => {
	const statements = [
		...cascade_token_updates
		// ...token_parent_index
		// ...autogen_library_on_new_project
	];

	for (const statement of statements) {
		// Using sql.raw to bypass Kysely's parameter binding for DDL
		await sql.raw(statement).execute(db);
	}
};

// export const createNewToken = async (
// 	db: EditorDialect,
// 	tokenName: string,
// 	tokenValue: string,
// 	targetParentId: string | null = null // The folder/library they dropped the token into
// ) => {
// 	return await db.transaction().execute(async (trx: EditorTransaction) => {
// 		// 1. Reserve the spot in the tree.
// 		// We don't pass `parent_index`. Our `directories` trigger will auto-assign it!
// 		// We set forbid_children: true because a token is a leaf node.
// 		const newDirectory = await trx
// 			.insertInto('directories')
// 			.values({
// 				parent_id: targetParentId,
// 				forbid_children: true
// 			})
// 			.returning('id')
// 			.executeTakeFirstOrThrow();
//
// 		// 2. Insert the actual token data, pointing to the reserved spot
// 		const newToken: NewToken = await trx
// 			.insertInto('tokens')
// 			.values({
// 				directory_id: newDirectory.id,
// 				name: tokenName,
// 				value: tokenValue
// 				// library_id, view_id, kit_id are ideally obsolete now
// 				// if your tree structure handles those dimensions!
// 			})
// 			.returningAll()
// 			.executeTakeFirstOrThrow();
//
// 		return {
// 			...newToken,
// 			directory_id: newDirectory.id
// 		};
// 	});
// };

// const token_parent_index = [
// 	`CREATE OR REPLACE FUNCTION set_token_parent_index()
// RETURNS TRIGGER AS $$
// DECLARE
//   max_index NUMERIC;
// BEGIN
//   -- only auto-assign if not provided
//   IF NEW.parent_index IS NOT NULL THEN
//     RETURN NEW;
//   END IF;
//
//   SELECT MAX(parent_index)
//   INTO max_index
//   FROM tokens
//   WHERE
//     library_id IS NOT DISTINCT FROM NEW.library_id AND
//     view_id IS NOT DISTINCT FROM NEW.view_id AND
//     kit_id IS NOT DISTINCT FROM NEW.kit_id;
//
//   IF max_index IS NULL THEN
//     NEW.parent_index := 1000;
//   ELSE
//     NEW.parent_index := max_index + 1000;
//   END IF;
//
//   RETURN NEW;
// END;
// $$ LANGUAGE plpgsql;`,
//
// 	`DROP TRIGGER IF EXISTS token_set_parent_index ON tokens`,
//
// 	`CREATE TRIGGER token_set_parent_index
// BEFORE INSERT ON tokens
// FOR EACH ROW
// EXECUTE FUNCTION set_token_parent_index();`
// ];

const cascade_token_updates = [
	// 1. Schema setup
	// `ALTER TABLE tokens ADD COLUMN IF NOT EXISTS resolved_value text`,

	// 2. The recursive resolver function
	`CREATE OR REPLACE FUNCTION get_resolved_value(target_id uuid, visited uuid[] DEFAULT '{}') 
     RETURNS text AS $$
     DECLARE
         t_row record;
         final_val text;
         ref_val text;
         i integer;
     BEGIN
         IF target_id = ANY(visited) THEN
             RAISE EXCEPTION 'Circular reference detected at token: %', target_id;
         END IF;
         visited := visited || target_id;
         SELECT alias_of, refs, value INTO t_row FROM tokens WHERE id = target_id;
         IF NOT FOUND THEN RETURN NULL; END IF;
         IF t_row.alias_of IS NOT NULL THEN
             RETURN get_resolved_value(t_row.alias_of, visited);
         ELSIF t_row.refs IS NOT NULL THEN
             final_val := t_row.value;
             FOR i IN 1..array_length(t_row.refs, 1) LOOP
                 ref_val := get_resolved_value(t_row.refs[i], visited);
                 final_val := replace(final_val, '{' || (i-1) || '}', COALESCE(ref_val, ''));
             END LOOP;
             RETURN final_val;
         ELSE
             RETURN t_row.value;
         END IF;
     END;
     $$ LANGUAGE plpgsql`,

	// 3. Current row cache function
	`CREATE OR REPLACE FUNCTION cache_token_value()
     RETURNS TRIGGER AS $$
     BEGIN
         NEW.resolved_value := get_resolved_value(NEW.id);
         RETURN NEW;
     END;
     $$ LANGUAGE plpgsql`,

	// 4. Cache trigger setup
	`DROP TRIGGER IF EXISTS trg_cache_token_value ON tokens`,
	`CREATE TRIGGER trg_cache_token_value
     BEFORE INSERT OR UPDATE OF value, alias_of, refs
     ON tokens
     FOR EACH ROW
     EXECUTE FUNCTION cache_token_value()`,

	// 5. Cascade update function
	`CREATE OR REPLACE FUNCTION cascade_token_updates()
     RETURNS TRIGGER AS $$
     BEGIN
         WITH RECURSIVE dependents AS (
             SELECT id FROM tokens 
             WHERE alias_of = NEW.id OR NEW.id = ANY(refs)
             UNION
             SELECT t.id FROM tokens t
             INNER JOIN dependents d ON t.alias_of = d.id OR d.id = ANY(t.refs)
         )
         UPDATE tokens SET resolved_value = resolved_value 
         WHERE id IN (SELECT id FROM dependents)
         AND id != NEW.id;
         RETURN NULL;
     END;
     $$ LANGUAGE plpgsql`,

	// 6. Cascade trigger setup
	`DROP TRIGGER IF EXISTS trg_cascade_token_updates ON tokens`,
	`CREATE TRIGGER trg_cascade_token_updates
     AFTER UPDATE OF value, alias_of, refs
     ON tokens
     FOR EACH ROW
     EXECUTE FUNCTION cascade_token_updates()`
];

/*
const autogen_library_on_new_project = [
	// generate a new library function
	`CREATE OR REPLACE FUNCTION create_project_library()
RETURNS TRIGGER
AS $$
BEGIN
  INSERT INTO tokens (name, project_id, is_library)
  VALUES (NEW.name, NEW.id, true);

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

*/
