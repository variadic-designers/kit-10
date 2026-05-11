import { sql } from 'kysely';
export const createWorkspacesTable = async (db) => {
    await db.schema
        .createTable('workspaces')
        .ifNotExists()
        .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql `uuid_generate_v7()`))
        .addColumn('name', 'text', (col) => col.notNull())
        .addColumn('description', 'text', (col) => col.defaultTo(null))
        .addColumn('last_active', 'timestamptz', (col) => col.notNull().defaultTo(sql `now()`))
        .execute();
};
export const touchWorkspace = async (db, id) => {
    const [workspace] = await db
        .updateTable('workspaces')
        .set({ last_active: sql `now()` })
        .where('id', '=', id)
        .returningAll()
        .execute();
    return workspace;
};
export const renameWorkspace = async (db, workspace_id, newName) => {
    return await db
        .updateTable('workspaces')
        .set({
        name: newName,
        last_active: sql `now()`
    })
        .where('workspaces.id', '=', workspace_id)
        .returningAll()
        .executeTakeFirst();
};
export const createWorkspace = async (db, name, description) => {
    const [workspace] = await db
        .insertInto('workspaces')
        .values({
        name,
        description
    })
        .returningAll()
        .execute();
    return workspace;
};
