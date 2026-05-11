import { Generated } from 'kysely';
import { type EditorDialect } from '../../index.js';
export interface RenderSnippetTable {
    id: Generated<string>;
    name: string | null;
    last_modified: Generated<Date>;
    layer_id: string;
}
export declare const createRenderSnippetTable: (db: EditorDialect) => Promise<void>;
export interface RenderSnippetItemTable {
    id: Generated<string>;
    name: string;
    value: string;
    last_modified: Generated<Date>;
    snippet_id: string;
}
export declare const createRenderSnippetItemTable: (db: EditorDialect) => Promise<void>;
