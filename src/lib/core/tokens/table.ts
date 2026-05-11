import { type Kysely, type Generated, sql } from 'kysely';
import type { Kit10Project } from '../index.ts';

export interface TokenTable {
	id: Generated<string>; // UUIDv7
	name: string;

	// The content: raw value OR the template (e.g., "{0}px {1}px")
	value: string | null;

	// For 1:1 simple aliases
	alias_of: string | null;

	// For composite interpolation (array of UUIDs)
	refs: string[] | null;

	resolved_value: string | null;

	last_modified: Generated<Date>;

	library_id: string | null;
	view_id: string | null;
}

export const createTokensTable = async (db: Kysely<Kit10Project>) => {
	// Create table
	await db.schema
		.createTable('tokens')
		.ifNotExists()
		.addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuid_generate_v7()`))
		.addColumn('last_modified', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
		.addColumn('name', 'varchar(255)', (col) => col.notNull())
		.addColumn('kind', 'varchar(255)', (col) => col)
		.addColumn('value', 'text')
		.addColumn('resolved_value', 'text')
		.addColumn('alias_of', 'uuid', (col) => col.references('tokens.id').onDelete('restrict'))
		.addColumn('refs', sql`uuid[]`)
		.addCheckConstraint(
			'value_or_alias',
			sql`
        (value IS NOT NULL AND alias_of IS NULL AND refs IS NULL) OR  -- ATOM
        (value IS NULL AND alias_of IS NOT NULL AND refs IS NULL) OR  -- ALIAS
        (value IS NOT NULL AND alias_of IS NULL AND refs IS NOT NULL) -- MOLECULE
    `
		)
		// library scoped
		.addColumn('library_id', 'uuid')
		// view scoped
		.addColumn('view_id', 'uuid')
		.addCheckConstraint(
			'library_scoped_or_view_scoped',
			sql`
        (library_id IS NOT NULL AND view_id IS NULL) OR  -- CHILD OF LIBRARY
        (library_id IS NULL AND view_id IS NOT NULL)  -- CHILD OF A VIEW
    `
		)
		// TODO: For UI Filesystem view
		// .addColumn('directory_index', 'int', (col) => col.notNull())
		// .addUniqueConstraint('unique_library_index', ['library_id', 'directory_index'])
		.execute();

	const setupDesignTokens = async (db: Kysely<Kit10Project>) => {
		const statements = [
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

		for (const statement of statements) {
			// Using sql.raw to bypass Kysely's parameter binding for DDL
			await sql.raw(statement).execute(db);
		}
	};

	await setupDesignTokens(db);
};
