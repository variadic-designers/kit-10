import { Generated } from 'kysely';
import { type EditorDialect } from '../../index.js';
export interface AxesRenderLayersTable {
    id: Generated<string>;
    name: string | null;
    last_modified: Generated<Date>;
    kit_id: string;
    axis_magnitude: number | null;
    render_length: number | null;
}
export declare const createAxesRenderLayersTable: (db: EditorDialect) => Promise<void>;
