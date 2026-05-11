import { Kysely } from 'kysely';
import type { Generated } from 'kysely';
export type DAny = Kysely<any>;
export type D2026_04_21 = Kysely<DB2026_04_21>;
export interface DB2026_04_21 {
    workspaces: WorkspacesTable;
    projects: ProjectsTable;
    views: ViewsTable;
    compositions: CompositionsTable;
    kits: KitsTable;
    axis_args: AxisArgsTable;
    axes_consumed: AxesConsumedTable;
    axes: AxisTable;
    axis_sets: never;
    render_snippets: never;
    design_tokens: never;
}
export interface WorkspacesTable {
    id: Generated<string>;
    name: string;
    description: string | null;
    last_active: Generated<Date>;
}
export interface ProjectsTable {
    id: Generated<string>;
    name: string;
    description: string | null;
    last_modified: Generated<Date>;
    license: Generated<string>;
    author: string;
    workspace_id: Generated<string>;
}
export interface ViewsTable {
    id: Generated<string>;
    name: string;
    last_modified: Generated<Date>;
    project_id: string;
    lock: boolean;
    hide: boolean;
}
export interface CompositionsTable {
    priority_index: number;
    kit_id: string;
    view_id: string;
}
export interface KitsTable {
    id: Generated<string>;
    name: string;
    project_id: string;
    last_modified: Generated<Date>;
}
export interface AxesConsumedTable {
    kit_id: string;
    axis_id: string;
    priority_index: number;
}
import { JSONColumnType } from 'kysely';
interface ValueType {
    type: 'literal' | 'range';
}
interface Literal extends ValueType {
    type: 'literal';
    value: string;
}
interface Range extends ValueType {
    type: 'range';
    min: number;
    max: number;
}
type Value = Literal | Range;
export interface AxisArgsTable {
    value: JSONColumnType<Value> | null;
    axis_id: string;
    kit_id: string;
    view_id: string;
}
export interface AxisTable {
    id: Generated<string>;
    project_id: string;
}
export declare function up(dialect: D2026_04_21): Promise<void>;
export declare function down(dialect: DAny): Promise<void>;
export {};
