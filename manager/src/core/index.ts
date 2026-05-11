// import { type RenderSnippetTable, type RenderSnippetItemTable,  createRenderSnippetTable, createRenderSnippetItemTable } from './render_snippets/index.js';

// import { createAxesRenderLayersTable, type AxesRenderLayersTable } from './axes_render_layers/index.js';

import { type EditorDialect } from '../index.js';

export interface CoreTables {
	// render_snippets: RenderSnippetTable;
	// render_snippet_items: RenderSnippetItemTable;
	// axes_render_layers: AxesRenderLayersTable;
}

export const initializeCore = async (db: EditorDialect) => {
	// await createRenderSnippetTable(db);
	// await createRenderSnippetItemTable(db);
	// await createAxesRenderLayersTable(db);
};

// export type { RenderSnippetTable, RenderSnippetItemTable };
