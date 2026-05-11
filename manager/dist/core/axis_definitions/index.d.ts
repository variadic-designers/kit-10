import { Kysely, Generated } from 'kysely';
import type { Kit10Project } from '../../index.js';
import { JSONColumnType } from 'kysely';
interface DiscreteConfig {
    options: string[];
    defaultValue: string;
}
interface RangeConfig {
    unit: 'px' | 'rem' | 'em' | 'vh' | 'vw';
    steps: Record<string, number>;
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
export type AxisConfig = ({
    type: 'discrete';
} & DiscreteConfig) | ({
    type: 'range';
} & RangeConfig) | ({
    type: 'relational';
} & RelationalConfig) | ({
    type: 'continuous';
} & ContinuousConfig);
export interface AxisDefinitionsTable {
    id: Generated<string>;
    name: string;
    slug: string;
    config: JSONColumnType<AxisConfig>;
    last_modified: Generated<Date>;
}
export declare const createAxisDefinitionsTable: (db: Kysely<Kit10Project>) => Promise<void>;
export {};
