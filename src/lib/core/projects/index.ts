import { type Kysely, type Generated, sql } from 'kysely';
import type { Kit10Project } from '../index.ts';

export interface ProjectsTable {
	id: Generated<string>; // UUIDv7
	name: string;
	description: string | null;
	last_modified: Generated<Date>;
	license: string;
	author: string;
}

export const createProjectsTable = async (db: Kysely<Kit10Project>) => {
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
		.execute();
};

export const createDefaultProject = async (db: Kysely<Kit10Project>) => {
	const project = await db
		.selectFrom('projects')
		.select((eb) => eb.fn.count('id').as('count'))
		.executeTakeFirst();

	if (!project?.count) {
		await db
			.insertInto('projects')
			.values({
				name: 'Awesome Start Kit',
				description: 'Please Describe Project',
				author: '@me',
				license: 'mplv2'
			})
			.execute();
	}
};
