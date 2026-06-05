import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		globals: false,
		exclude: ['dist/**', 'node_modules/**']
	},
	resolve: {
		extensions: ['.ts', '.js', '.mjs', '.cjs', '.json']
	}
});
