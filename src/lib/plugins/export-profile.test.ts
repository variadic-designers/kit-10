import { describe, it, expect } from 'vitest';
import {
	groupExportProvidersByTarget,
	resolveExportProfile,
	buildExportProfileHints
} from './export-profile.js';
import type { ProjectExportProvider } from './project-export-providers.js';

const provider = (overrides: Partial<ProjectExportProvider>): ProjectExportProvider => ({
	id: 'id',
	label: 'label',
	fn: 'fn',
	fileExtension: 'ext',
	mimeType: 'text/plain',
	...overrides
});

describe('groupExportProvidersByTarget', () => {
	it('groups by declared target, falling back to fileExtension when target is absent', () => {
		const tenner = provider({ id: 'tenner', fileExtension: 'yaml', target: 'yaml' });
		const legacy = provider({ id: 'legacy', fileExtension: 'yaml' });
		const webcodium = provider({ id: 'webcodium', fileExtension: 'html', target: 'html' });

		const groups = groupExportProvidersByTarget([tenner, legacy, webcodium]);

		expect([...groups.keys()]).toEqual(['yaml', 'html']);
		expect(groups.get('yaml')).toEqual([tenner, legacy]);
		expect(groups.get('html')).toEqual([webcodium]);
	});
});

describe('resolveExportProfile', () => {
	it('auto-resolves the sole provider for a target with no saved choice', () => {
		const tenner = provider({ id: 'tenner', target: 'yaml' });
		const [group] = resolveExportProfile([tenner], undefined);
		expect(group!.effective).toBe(tenner);
	});

	it('is ambiguous (null) when 2+ providers compete and nothing is saved', () => {
		const a = provider({ id: 'a', target: 'html' });
		const b = provider({ id: 'b', target: 'html' });
		const [group] = resolveExportProfile([a, b], undefined);
		expect(group!.effective).toBeNull();
	});

	it('honors a saved choice that is still a valid installed provider', () => {
		const a = provider({ id: 'a', target: 'html' });
		const b = provider({ id: 'b', target: 'html' });
		const [group] = resolveExportProfile([a, b], { html: 'b' });
		expect(group!.effective).toBe(b);
	});

	it('does not trust a saved choice pointing at a since-uninstalled plugin', () => {
		const a = provider({ id: 'a', target: 'html' });
		const b = provider({ id: 'b', target: 'html' });
		const [group] = resolveExportProfile([a, b], { html: 'c' });
		expect(group!.effective).toBeNull();
	});

	it('produces no group at all for a target with zero remaining providers', () => {
		const groups = resolveExportProfile([], { html: 'webcodium' });
		expect(groups).toEqual([]);
	});
});

describe('buildExportProfileHints', () => {
	it('overrides only the changed target, preserving other saved choices', () => {
		const next = buildExportProfileHints({ yaml: 'tenner' }, 'html', 'webcodium');
		expect(next).toEqual({ yaml: 'tenner', html: 'webcodium' });
	});

	it('starts a fresh profile when there is no current one', () => {
		const next = buildExportProfileHints(undefined, 'yaml', 'tenner');
		expect(next).toEqual({ yaml: 'tenner' });
	});
});
