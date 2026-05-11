import { Generated } from 'kysely';
import { type EditorDialect } from '../../index.js';
export interface AxisSetsTable {
    id: Generated<string>;
    name: string | null;
    last_modified: Generated<Date>;
    layer_id: string;
}
export declare const createAxisSetsTable: (db: EditorDialect) => Promise<void>;
