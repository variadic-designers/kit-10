import { describe, it, expect } from 'vitest';
import { base64ToBytes, bytesToBase64 } from './base64.js';

describe('base64ToBytes / bytesToBase64', () => {
	it('round-trips arbitrary bytes', () => {
		const original = new Uint8Array([0, 1, 2, 253, 254, 255, 42, 128]);
		expect(base64ToBytes(bytesToBase64(original))).toEqual(original);
	});

	it('round-trips a large payload spanning multiple chunks', () => {
		// Bigger than bytesToBase64's internal chunk size, to exercise the multi-chunk loop.
		const original = new Uint8Array(0x8000 * 3 + 17);
		for (let i = 0; i < original.length; i++) original[i] = i % 256;
		expect(base64ToBytes(bytesToBase64(original))).toEqual(original);
	});

	it('round-trips an empty payload', () => {
		expect(base64ToBytes(bytesToBase64(new Uint8Array(0)))).toEqual(new Uint8Array(0));
	});
});
