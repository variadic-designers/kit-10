import type { Generated, Insertable, Updateable, Selectable } from 'kysely';
import type { EditorDialect } from './index.js';
export type Profiles = Selectable<ProfilesTable>;
export type NewProfile = Insertable<ProfilesTable>;
export type ProfileUpdate = Updateable<ProfilesTable>;
export interface ProfilesTable {
	id: Generated<string>;
	directory_id: string;
}
export declare const createProfilesTable: (db: EditorDialect) => Promise<void>;
