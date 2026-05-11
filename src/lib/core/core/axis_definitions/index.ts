import { type Kysely, type Generated, sql } from 'kysely';

import type { Kit10Project } from '../../index.js';

import { JSONColumnType } from 'kysely';

// 1. Define individual config shapes
interface DiscreteConfig {
	options: string[];
	defaultValue: string;
}

interface RangeConfig {
	unit: 'px' | 'rem' | 'em' | 'vh' | 'vw';
	steps: Record<string, number>; // e.g., { sm: 0, md: 768 }
	inclusive: boolean;
}

interface RelationalConfig {
	predicate: 'childOf' | 'parentOf' | 'siblingOf' | 'decendantOf';
	targetKit: string;
}

interface ContinuousConfig {
	unit: string;
	min: number;
	max: number;
	step: number;
}

export type AxisConfig =
	| ({ type: 'discrete' } & DiscreteConfig)
	| ({ type: 'range' } & RangeConfig)
	| ({ type: 'relational' } & RelationalConfig)
	| ({ type: 'continuous' } & ContinuousConfig);

export interface AxisDefinitionsTable {
	id: Generated<string>;
	name: string;
	slug: string; // e.g., 'viewport-width'
	// config holds the specific rules: units, steps, or relationship targets
	config: JSONColumnType<AxisConfig>;
	last_modified: Generated<Date>;
}

export const createViewsTable = async (db: Kysely<Kit10Project>) => {
	await db.schema
		.createTable('axis_definitions')
		.ifNotExists()
		.addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuid_generate_v7()`))
		.addColumn('slug', 'varchar(100)', (col) => col.notNull().unique())
		.addColumn('name', 'varchar(255)', (col) => col.notNull())
		.addColumn('type', 'varchar(50)', (col) => col.notNull()) // discrete, range, etc.
		.addColumn('config', 'jsonb', (col) => col.notNull().defaultTo(sql`'{}'::jsonb`))
		.addColumn('last_modified', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
		.addCheckConstraint(
			'config_type_check',
			sql`
      (type = 'discrete' AND config ? 'options' AND config ? 'defaultValue') OR
      (type = 'range' AND config ? 'unit' AND config ? 'steps')
    `
		)
		.execute();

	// json search
	await db.schema
		.createIndex('axis_config_gin_idx')
		.ifNotExists()
		.on('axis_definitions')
		.using('gin')
		.column('config')
		.execute();
};
