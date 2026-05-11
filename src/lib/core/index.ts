import { PGlite } from '@electric-sql/pglite';
import { PGliteWorker } from '@electric-sql/pglite/worker';
import { live } from '@electric-sql/pglite/live';
import { pg_uuidv7 } from '@electric-sql/pglite/pg_uuidv7';

import { Kysely, type Generated, sql } from 'kysely';
// The actual exported member is PgliteDialect
import { PgliteDialect } from '@soapbox/kysely-pglite';

import { type TokenTable, createTokensTable } from './tokens/table.js';
import { type LibraryTable, createTokensLibraryTable } from './tokens/library.js';

import { type ProjectsTable, createProjectsTable, createDefaultProject } from './projects/index.js';
import { type CompositionsTable, createCompositionsTable } from './compositions/index.js';
import { resolveAllTokens, getTokensWithDeps } from './tokens/resolve.js';

export interface Kit10ProjectState {
	projects: ProjectsTable;
	token_libraries: LibraryTable;
	tokens: TokenTable;
	compositions: CompositionsTable;
}

export type DbDialect = Kysely<Kit10ProjectState>;

export const indexDBPath = 'idb://my-projects-kit10';

import { type Writable, writable } from 'svelte/store';

export const initEditorDB: (dialect: DbDialect) => Promise<void> = async (dialect) => {
	// Enable plugins
	await sql`CREATE EXTENSION IF NOT EXISTS pg_uuidv7`.execute(dialect);
	// TODO: Might work in kysely-pglite's worker pattern
	// await sql`CREATE EXTENSION IF NOT EXISTS live`.execute(dialect);

	// Create tables
	await createProjectsTable(dialect);

	await createTokensTable(dialect);
	await createTokensLibraryTable(dialect);
	await createDefaultProject(dialect);
	// await createDefaultTokensLibrary(dialect);

	console.log('-------- Projects --------');
	const projects = await dialect.selectFrom('projects').selectAll().execute();
	console.table(projects);

	console.log('-------- Token Libraries --------');
	const library = await dialect.selectFrom('token_libraries').selectAll().execute();
	console.table(library);

	console.log('-------- Tokens --------');
	const tokens = await dialect.selectFrom('tokens').selectAll().execute();
	console.table(tokens);
};

// export const DbSpeak = async () => {
// 	const { dialect, db } = await initEditorDB();
//
// 	const library = await dialect.selectFrom('token_libraries').select('id').executeTakeFirst();
//
// 	if (library) {
// 		// Insert data
// 		await dialect
// 			.insertInto('tokens')
// 			.values(
// 				[
// 					{ name: 'Alice Blue', value: '#AAAAFF' },
// 					{ name: 'Background', value: '#EEEEFF' },
// 					{ name: 'Primary', value: '#07AEFF' },
// 					{ name: 'Padding', value: '2rem' },
// 					{ name: 'Margin', value: '1rem' }
// 				].map((v) => ({ library_id: library.id, ...v })) // ← parentheses here
// 			)
// 			.execute();
//
// 		// 1. First, let's get the ID of a base token (the "Source")
// 		const baseToken = await dialect
// 			.insertInto('tokens')
// 			.values({
// 				name: 'colors.blue.500',
// 				value: '#3b82f6',
// 				alias_of: null, // This is a root value
// 				library_id: library.id
// 			})
// 			.returning('id')
// 			.executeTakeFirstOrThrow();
//
// 		// 2. Now, create the Alias pointing to that ID
// 		await dialect
// 			.insertInto('tokens')
// 			.values({
// 				name: 'brand.primary',
// 				value: null, // No raw value here
// 				alias_of: baseToken.id, // Points to colors.blue.500
// 				library_id: library.id
// 			})
// 			.execute();
//
// 		const padding = await dialect
// 			.selectFrom('tokens')
// 			.select('tokens.id')
// 			.where('tokens.name', '=', 'Padding')
// 			.executeTakeFirst();
//
// 		const margin = await dialect
// 			.selectFrom('tokens')
// 			.select('tokens.id')
// 			.where('tokens.name', '=', 'Margin')
// 			.executeTakeFirst();
//
// 		if (padding && margin) {
// 			await dialect
// 				.insertInto('tokens')
// 				.values({
// 					name: 'layout.combined',
// 					value: '{0} {1}',
// 					// Use the IDs of 'Padding' and 'Margin' you created earlier
// 					refs: [padding.id, margin.id],
// 					alias_of: null,
// 					library_id: library.id
// 				})
// 				.execute();
// 		}
// 	}
//
// 	const resolution = await resolveAllTokens(dialect);
// 	const deps = await getTokensWithDeps(dialect);
//
// 	console.log('-------- Resolution --------');
// 	console.table(resolution);
// 	console.log('-------- Dependency Graph --------');
// 	console.table(deps);
//
// 	// required backfill
// 	await sql.raw(`UPDATE tokens SET resolved_value = get_resolved_value(id)`).execute(dialect);
// 	console.log('-------- New Resolver --------');
// 	const show = await dialect.selectFrom('tokens').selectAll().execute();
// 	console.table(show);
//
// 	console.log('-------- Token Libraries --------');
// 	const tokensWithLibrary = await dialect
// 		.selectFrom('tokens')
// 		.innerJoin('token_libraries', 'token_libraries.id', 'tokens.library_id')
// 		.select([
// 			dialect.selectFrom('token_libraries').select('name').as('library'),
// 			'tokens.name',
// 			'tokens.resolved_value'
// 		])
// 		.execute();
//
// 	console.table(tokensWithLibrary);
// };

export const server = () => {
	// console.table(await getDependencyGraph(db, 'layout.combined'));
	//
	// Start Postgres-compatible server
	// const server = new PGLiteSocketServer({
	// 	db: raw,
	// 	port: 5432,
	// 	host: '127.0.0.1'
	// });
	//
	// await server.start();
	// console.log('🚀 PGlite server running on postgres://localhost:5432');
};
