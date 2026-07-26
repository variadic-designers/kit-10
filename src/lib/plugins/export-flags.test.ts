import { describe, it, expect } from 'vitest';
import { isFlaggedForExport, buildExportFlagHints } from './export-flags.js';

describe('isFlaggedForExport', () => {
	it('is false when hints is null/undefined', () => {
		expect(isFlaggedForExport(null, 'webcodium')).toBe(false);
		expect(isFlaggedForExport(undefined, 'webcodium')).toBe(false);
	});

	it('is false when the provider has no namespace yet', () => {
		expect(isFlaggedForExport({}, 'webcodium')).toBe(false);
	});

	it('is false when export is explicitly false', () => {
		expect(isFlaggedForExport({ webcodium: { export: false } }, 'webcodium')).toBe(false);
	});

	it('is true only when export is exactly true', () => {
		expect(isFlaggedForExport({ webcodium: { export: true } }, 'webcodium')).toBe(true);
	});

	it('is scoped to the given provider id, never a hardcoded name', () => {
		const hints = { webcodium: { export: true } };
		expect(isFlaggedForExport(hints, 'tenner')).toBe(false);
	});
});

describe('buildExportFlagHints', () => {
	it('creates a fresh namespace when none exists', () => {
		expect(buildExportFlagHints(null, 'webcodium', true)).toEqual({
			webcodium: { export: true }
		});
	});

	it('preserves other keys already in that provider namespace', () => {
		const current = { webcodium: { export: false, someOtherFlag: 'x' } };
		expect(buildExportFlagHints(current, 'webcodium', true)).toEqual({
			webcodium: { export: true, someOtherFlag: 'x' }
		});
	});

	it('does not touch a different provider namespace', () => {
		const current = { tenner: { export: true } };
		const next = buildExportFlagHints(current, 'webcodium', true);
		expect(next).toEqual({ webcodium: { export: true } });
		// Caller is responsible for spreading `current` back in when writing via updateViewHints
		// (shallow top-level merge) -- this function only builds the changed namespace's value.
		expect(current.tenner).toEqual({ export: true });
	});
});
