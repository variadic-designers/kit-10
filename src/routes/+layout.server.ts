import type { LayoutServerLoad } from './$types';
import { parse } from 'cookie';

import { type Theme, themeOptions } from '$lib/theming';
import { type ReducedMotion, reducedMotionOptions } from '$lib/reduced-motion';

import type { LayoutData } from '$lib/types/layoutdata';

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
