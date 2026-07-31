import { describe, it, expect } from 'vitest';
import { buildInterpreterOutputPayload } from './interpreter-output.js';

describe('buildInterpreterOutputPayload', () => {
	it('returns the full payload from the current viewportData', () => {
		const payload = buildInterpreterOutputPayload(
			'[{"type":"box"}]',
			['view1'],
			['kit1'],
			['view1'],
			[{ category: 'layout', fields: [] } as any],
			[{ family: 'Satoshi', weight: 400, style: 'Normal' } as any]
		);

		expect(payload).toEqual({
			available: true,
			viewport_data: [{ type: 'box' }],
			node_view_ids: ['view1'],
			node_kit_ids: ['kit1'],
			node_occurrence_ids: ['view1'],
			categories: [{ category: 'layout', fields: [] }],
			font_requests: [{ family: 'Satoshi', weight: 400, style: 'Normal' }]
		});
	});

	it('treats the never-resolved/empty-project default as a legitimate empty payload', () => {
		const payload = buildInterpreterOutputPayload('[]', [], [], [], [], []);

		expect(payload).toEqual({
			available: true,
			viewport_data: [],
			node_view_ids: [],
			node_kit_ids: [],
			node_occurrence_ids: [],
			categories: [],
			font_requests: []
		});
	});
});
