import { Generated } from 'kysely';
import type { EditorDialect } from './index.js';
export interface CompositionsTable {
    id: Generated<string>;
    name: string;
    last_modified: Generated<Date>;
    kit_id: string;
    kit_index: number;
    kit_hide: boolean;
    view_id: string;
}
export declare const createCompositionsTable: (db: EditorDialect) => Promise<void>;
