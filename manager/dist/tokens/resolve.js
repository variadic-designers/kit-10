import { sql } from 'kysely';
export const resolveAllTokens = async (db) => {
	const rawTokens = await db.selectFrom('tokens').selectAll().execute();
	// Create a map for O(1) lookups
	const tokenMap = new Map(rawTokens.map((t) => [t.id, t]));
	const cache = new Map();
	function resolve(id) {
		if (cache.has(id)) return cache.get(id);
		const token = tokenMap.get(id);
		if (!token) return 'MISSING';
		let result = '';
		// 1. Resolve Alias
		if (token.alias_of) {
			result = resolve(token.alias_of);
		}
		// 2. Resolve Molecule (Interpolation)
		else if (token.refs && token.value) {
			result = token.value.replace(/{(\d+)}/g, (_, index) => {
				const refId = token.refs[parseInt(index)];
				return refId ? resolve(refId) : `{${index}}`;
			});
		}
		// 3. Resolve Atom
		else {
			result = token.value ?? '';
		}
		cache.set(id, result);
		return result;
	}
	return rawTokens.map((t) => ({
		...t,
		resolvedValue: resolve(t.id)
	}));
};
export const getTokensWithDeps = async (db) => {
	return await db
		.selectFrom('tokens as t')
		.select([
			't.id',
			't.name',
			't.value',
			't.alias_of',
			't.refs',
			// This subquery fetches the names of everything in the 'refs' array
			// so your UI can show "Depends on: Primary, Spacing-SM"
			sql`(
        SELECT array_agg(name) 
        FROM tokens 
        WHERE id = ANY(t.refs) OR id = t.alias_of
      )`.as('dependency_names')
		])
		.execute();
};
export const getDependencyGraph = async (db, tokenName) => {
	const result = await db
		.withRecursive('deps', (qb) =>
			qb
				// 1. Base Case: Start with the specific token you're curious about
				.selectFrom('tokens')
				.select(['id', 'name', 'alias_of', 'refs', sql`0`.as('depth')])
				.where('name', '=', tokenName)
				.unionAll(
					// 2. Recursive Step: Find tokens that are referenced by the current batch
					qb
						.selectFrom('tokens as child')
						.innerJoin('deps as parent', (join) => join.onTrue()) // We'll filter in the WHERE
						.select([
							'child.id',
							'child.name',
							'child.alias_of',
							'child.refs',
							sql`parent.depth + 1`.as('depth')
						])
						.where((eb) =>
							eb.or([
								// Match if it's a simple alias
								eb('child.id', '=', eb.ref('parent.alias_of')),
								// Match if the child ID is inside the parent's refs array
								sql`child.id = ANY(parent.refs)`
							])
						)
				)
		)
		.selectFrom('deps')
		.select(['name', 'depth', sql`id`.as('token_id')])
		.orderBy('depth', 'asc')
		.execute();
	return result;
};
