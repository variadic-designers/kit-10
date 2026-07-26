import { describe, it, expect } from 'vitest';
import { resolveDownloadFiles } from './download.js';

describe('resolveDownloadFiles', () => {
	it('returns the single fallback-named file untouched when multiFile is not set', () => {
		const files = resolveDownloadFiles('raw text content', undefined, 'project.yaml', 'text/yaml');
		expect(files).toEqual([{ filename: 'project.yaml', mimeType: 'text/yaml', content: 'raw text content' }]);
	});

	it('returns the single fallback-named file untouched when multiFile is false', () => {
		const files = resolveDownloadFiles('raw text content', false, 'project.yaml', 'text/yaml');
		expect(files).toEqual([{ filename: 'project.yaml', mimeType: 'text/yaml', content: 'raw text content' }]);
	});

	it('parses a real {files:[...]} envelope verbatim when multiFile is true', () => {
		const envelope = JSON.stringify({
			files: [{ filename: 'index.html', mimeType: 'text/html', content: '<html></html>' }]
		});
		const files = resolveDownloadFiles(envelope, true, 'project.html', 'text/html');
		expect(files).toEqual([{ filename: 'index.html', mimeType: 'text/html', content: '<html></html>' }]);
	});

	it('preserves every file in a multi-file envelope exactly', () => {
		const envelope = JSON.stringify({
			files: [
				{ filename: 'index.html', mimeType: 'text/html', content: '<html></html>' },
				{ filename: 'styles.css', mimeType: 'text/css', content: 'body {}' }
			]
		});
		const files = resolveDownloadFiles(envelope, true, 'project.html', 'text/html');
		expect(files).toEqual([
			{ filename: 'index.html', mimeType: 'text/html', content: '<html></html>' },
			{ filename: 'styles.css', mimeType: 'text/css', content: 'body {}' }
		]);
	});
});
