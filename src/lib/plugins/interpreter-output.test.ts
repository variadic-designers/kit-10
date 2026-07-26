import { describe, it, expect } from 'vitest';
import { buildInterpreterOutputPayload } from './interpreter-output.js';

describe('buildInterpreterOutputPayload', () => {
	it('returns the full payload when only the JSON form is cached', () => {
		const payload = buildInterpreterOutputPayload(
			'[{"type":"box"}]',
			null,
			['view1'],
			[{ category: 'layout', fields: [] } as any],
			[{ family: 'Satoshi', weight: 400, style: 'Normal' } as any]
		);

		expect(payload).toEqual({
			available: true,
			viewport_data: [{ type: 'box' }],
			node_view_ids: ['view1'],
			categories: [{ category: 'layout', fields: [] }],
			font_requests: [{ family: 'Satoshi', weight: 400, style: 'Normal' }]
		});
	});

	it('returns unavailable/binary-only when the binary form is cached, regardless of viewportData', () => {
		const payload = buildInterpreterOutputPayload(
			'[{"type":"box"}]',
			new Uint8Array([1, 2, 3]),
			['view1'],
			[],
			[]
		);

		expect(payload).toEqual({ available: false, reason: 'binary-only' });
	});

	it('treats the never-resolved/empty-project default as a legitimate empty payload', () => {
		const payload = buildInterpreterOutputPayload('[]', null, [], [], []);

		expect(payload).toEqual({
			available: true,
			viewport_data: [],
			node_view_ids: [],
			categories: [],
			font_requests: []
		});
	});
});
