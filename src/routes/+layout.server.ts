import type { LayoutServerLoad } from './$types.js';
import { parse } from 'cookie';

import { type Theme, themeOptions } from '$lib/theming.js';
import { type ReducedMotion, reducedMotionOptions } from '$lib/reduced-motion.js';

import type { LayoutData } from '$lib/types/layoutdata.js';

export const load: LayoutServerLoad = async ({ request }): Promise<LayoutData> => {
	const cookies = parse(request.headers.get('cookie') ?? '');

	const rawTheme = cookies.theme;
	const theme: Theme = themeOptions.includes(rawTheme as Theme) ? (rawTheme as Theme) : 'auto';

	const rawReducedMotion = cookies['reduced-motion'];
	const reducedMotion: ReducedMotion = reducedMotionOptions.includes(
		rawReducedMotion as ReducedMotion
	)
		? (rawReducedMotion as ReducedMotion)
		: 'auto';

	return { theme, reducedMotion };
};
