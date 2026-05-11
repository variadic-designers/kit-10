export {};
// import type { EditorDialect, EditorTransaction } from '../index.js';
// import { type NewToken } from '../tokens/table.js';
//
// import { sql } from 'kysely';
//
// export const getFullHierarchy = (db: EditorDialect) => {
// 	return (
// 		db
// 			.withRecursive('tree', (db) =>
// 				db
// 					.selectFrom('directories')
// 					// needed for the filter
// 					.innerJoin('token_libraries', 'token_libraries.directory_id', 'directories.id')
// 					.innerJoin('projects', 'projects.id', 'token_libraries.project_id')
// 					.select([
// 						'directories.id',
// 						'directories.parent_id',
// 						'directories.parent_index',
// 						'directories.forbid_children',
// 						sql<number>`1`.as('depth') // Track nesting level
// 					])
// 					.where('directories.parent_id', 'is', null) // Start at roots
// 					// selected filter
// 					// .where('projects.selected', '=', 'primary')
// 					.unionAll(
// 						db
// 							.selectFrom('directories')
// 							.innerJoin('tree', 'tree.id', 'directories.parent_id')
// 							.select([
// 								'directories.id',
// 								'directories.parent_id',
// 								'directories.parent_index',
// 								'directories.forbid_children',
// 								sql<number>`tree.depth + 1`.as('depth')
// 							])
// 					)
// 			)
// 			.selectFrom('tree')
// 			// Join your content tables here
// 			.leftJoin('token_libraries', 'token_libraries.directory_id', 'tree.id')
// 			.leftJoin('tokens', 'tokens.directory_id', 'tree.id')
// 			.select([
// 				'tree.id',
// 				'tree.parent_id',
// 				'tree.parent_index',
// 				'tree.forbid_children',
// 				'tree.depth',
// 				'token_libraries.name as library_name',
// 				'tokens.name as token_name',
// 				'tokens.value as token_value'
// 			])
// 			.orderBy('tree.depth', 'asc')
// 			.orderBy('tree.parent_index', 'asc')
// 	);
// };
//
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
