import { Kysely } from 'kysely';
import type { Kit10Project } from '../index.ts';
export declare const resolveAllTokens: (db: Kysely<Kit10Project>) => Promise<
	(
		| {
				resolvedValue: string;
				id: string;
				name: string | null;
		  }
		| {
				resolvedValue: string;
		  }
	)[]
>;
export declare const getTokensWithDeps: (db: Kysely<Kit10Project>) => Promise<any>;
export declare const getDependencyGraph: (
	db: Kysely<Kit10Project>,
	tokenName: string
) => Promise<
	{
		name: any;
		depth: any;
		token_id: unknown;
	}[]
>;
