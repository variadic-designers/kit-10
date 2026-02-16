import { error } from '@sveltejs/kit';
import type { PageLoad } from './$types';

import { builtinAxes } from '$lib/axesBuiltIn';

import Colours from '$lib/libraries/colours.ts';

import type { Kit10Project } from '$lib/types';

const projects: Kit10Project[] = [
	{
		title: 'Meowzer',
		description: 'Engineered for meowing',
		viewPortFocus: { x: 200, y: 400 },
		tokens: [
			{
				name: 'x-space-xl',
				displayName: 'Space SM',
				value: { resolve: 'gaps-linear-4/space-1' }
			},
			{
				name: 'x-space-md',
				displayName: 'Space MD',
				value: { resolve: 'gaps-linear-4/space-2' }
			},
			{
				name: 'x-space-lg',
				displayName: 'Space LG',
				value: { resolve: 'gaps-linear-4/space-5' }
			},
			{
				name: 'color-primary',
				displayName: 'Primary',
				type: 'color',
				value: { resolve: 'colours-of-css/light-coral' }
			},
			{
				name: 'color-secondary',
				displayName: 'Secondary',
				type: 'color',
				value: { resolve: 'colours-of-css/alice-blue' }
			}
		],
		tokenLibraries: {
			'colours-of-css': {
				displayName: 'Colours of CSS',
				tokens: Colours.tokens
			},

			'gaps-linear-4': {
				displayName: 'Gaps Linear 4',
				tokens: [
					{ name: 'space-0', displayName: 'Space 0', value: '0' },
					{ name: 'space-1', displayName: 'Space 1', value: '0.25rem' }, // 4px
					{ name: 'space-2', displayName: 'Space 2', value: '0.5rem' }, // 8px
					{ name: 'space-3', displayName: 'Space 3', value: '0.75rem' }, // 12px
					{ name: 'space-4', displayName: 'Space 4', value: '1rem' }, // 16px
					{ name: 'space-5', displayName: 'Space 5', value: '1.25rem' }, // 20px
					{ name: 'space-6', displayName: 'Space 6', value: '1.5rem' }, // 24px
					{ name: 'space-8', displayName: 'Space 8', value: '2rem' }, // 32px
					{ name: 'space-10', displayName: 'Space 10', value: '2.5rem' }, // 40px
					{ name: 'space-12', displayName: 'Space 12', value: '3rem' }, // 48px
					{ name: 'space-16', displayName: 'Space 16', value: '4rem' }, // 64px
					{ name: 'space-20', displayName: 'Space 20', value: '5rem' }, // 80px
					{ name: 'space-24', displayName: 'Space 24', value: '6rem' }, // 96px
					{ name: 'space-28', displayName: 'Space 28', value: '7rem' }, // 112px
					{ name: 'space-32', displayName: 'Space 32', value: '8rem' }, // 128px
					{ name: 'space-36', displayName: 'Space 36', value: '9rem' }, // 144px
					{ name: 'space-40', displayName: 'Space 40', value: '10rem' }, // 160px
					{ name: 'space-44', displayName: 'Space 44', value: '11rem' }, // 176px
					{ name: 'space-48', displayName: 'Space 48', value: '12rem' }, // 192px
					{ name: 'space-52', displayName: 'Space 52', value: '13rem' }, // 208px
					{ name: 'space-56', displayName: 'Space 56', value: '14rem' }, // 224px
					{ name: 'space-60', displayName: 'Space 60', value: '15rem' }, // 240px
					{ name: 'space-64', displayName: 'Space 64', value: '16rem' }, // 256px
					{ name: 'space-72', displayName: 'Space 72', value: '18rem' }, // 288px
					{ name: 'space-80', displayName: 'Space 80', value: '20rem' }, // 320px
					{ name: 'space-96', displayName: 'Space 96', value: '24rem' } // 384px
				]
			}
		},
		kits: [
			{
				name: 'Button',
				discriminator: 0,
				sets: {
					axisRank: [0, 1, 5, 6].map((i) => {
						const axis = builtinAxes[i];
						if (!axis) throw new Error(`Missing builtin axis ${i}`);
						return axis;
					}),
					layers: [
						{
							axes: {},
							style: {
								padding: '0.5rem 1.5rem',
								color: '#222',
								width: 'max-content',
								height: 'max-content',
								'border-radius': '0.5rem',
								'font-size': '1rem',

								background: 'inherit'
							},
							specificity: 0
						},

						{
							axes: {
								'@builtin-interaction': 'default'
							},
							style: {
								'text-align': 'center'
							},
							specificity: 1
						},

						{
							axes: {
								'@builtin-btn-emphasis': 'secondary'
							},
							style: {
								'font-weight': '800'
							},
							specificity: 1
						},

						{
							axes: {
								'@builtin-btn-emphasis': 'tertiary'
							},
							style: {
								'font-weight': '800'
							},
							specificity: 1
						},

						{
							axes: {
								'@builtin-btn-emphasis': 'primary',
								'@builtin-btn-tone': 'neutral',
								'@builtin-darkmode': 'light'
							},
							style: {
								background: '#EEE',
								color: '#222'
							},
							specificity: 1
						},

						{
							axes: {
								'@builtin-btn-emphasis': 'secondary',
								'@builtin-btn-tone': 'neutral',
								'@builtin-darkmode': 'light'
							},
							style: {
								border: '2px solid #222',
								color: '#222'
							},
							specificity: 1
						},

						{
							axes: {
								'@builtin-btn-emphasis': 'secondary',
								'@builtin-btn-tone': 'destructive',
								'@builtin-darkmode': 'light'
							},
							style: {
								border: '2px solid #E33',
								color: '#E33'
							},
							specificity: 1
						},

						{
							axes: {
								'@builtin-btn-emphasis': 'secondary',
								'@builtin-btn-tone': 'confirmative',
								'@builtin-darkmode': 'light'
							},
							style: {
								border: '2px solid #3E3',
								color: '#3E3'
							},
							specificity: 1
						},

						{
							axes: {
								'@builtin-btn-emphasis': 'primary',
								'@builtin-btn-tone': 'neutral',
								'@builtin-darkmode': 'dark'
							},
							style: {
								background: '#222',
								color: '#EEE'
							},
							specificity: 1
						},

						{
							axes: {
								'@builtin-btn-emphasis': 'secondary',
								'@builtin-btn-tone': 'neutral',
								'@builtin-darkmode': 'dark'
							},
							style: {
								border: '2px solid #EEE',
								color: '#EEE',
								'--oklab-name': '#420'
							},
							specificity: 1
						},

						{
							axes: {
								'@builtin-btn-emphasis': 'secondary',
								'@builtin-btn-tone': 'destructive',
								'@builtin-darkmode': 'dark'
							},
							style: {
								border: '2px solid #E22',
								color: '#E22'
							},
							specificity: 1
						},

						{
							axes: {
								'@builtin-btn-emphasis': 'secondary',
								'@builtin-btn-tone': 'confirmative',
								'@builtin-darkmode': 'dark'
							},
							style: {
								border: '2px solid #2E2',
								color: '#2E2'
							},
							specificity: 1
						}
					]
				}
			},
			{
				name: 'Screenie',
				discriminator: 1,
				sets: {
					axisRank: [builtinAxes[0]],
					layers: [
						{
							axes: {},
							style: {
								width: '1366px',
								height: '768px',
								'overflow-y': 'auto'
							},
							specificity: 0
						},
						{
							axes: { '@builtin-darkmode': 'light' },
							style: {
								background: '#FFF'
							},
							specificity: 1
						},
						{
							axes: { '@builtin-darkmode': 'dark' },
							style: {
								background: '#333'
							},
							specificity: 1
						}
					]
				}
			},
			{
				name: 'Page Section',
				discriminator: 1,
				sets: {
					axisRank: [builtinAxes[0]],
					layers: [
						{
							axes: {},
							style: {
								width: '100%',
								height: '20rem',
								'overflow-y': 'auto',
								border: '2px solid #111'
							},
							specificity: 0
						},
						{
							axes: { '@builtin-darkmode': 'light' },
							style: {
								background: '#FFF'
							},
							specificity: 1
						},
						{
							axes: { '@builtin-darkmode': 'dark' },
							style: {
								background: '#333'
							},
							specificity: 2
						},
						{
							axes: { sticky: 'true' },
							style: {
								// position: 'sticky',
								// top: '0'
							},
							specificity: 3
						}
					]
				}
			}
		],
		kitViews: [
			{
				rootPosition: { x: -300, y: 20 },
				name: 'CTA - Primary',
				resolve: [
					{
						source_index: 0,
						params: {
							'@builtin-darkmode': 'dark',
							'@builtin-btn-emphasis': 'secondary',
							'@builtin-btn-tone': 'confirmative'
						}
					}
				],
				discriminator: 1,
				primitive: {
					kind: 'text',
					text: 'Approve Request'
				}
			},
			{
				rootPosition: { x: 100, y: 20 },
				resolve: [
					{
						source_index: 0,
						params: {
							'@builtin-darkmode': 'light',
							'@builtin-btn-emphasis': 'secondary',
							'@builtin-btn-tone': 'destructive'
						}
					}
				],
				name: 'CTA - Secondary',
				discriminator: 0,
				primitive: {
					kind: 'text',
					text: 'Deny Request'
				}
			},
			{
				rootPosition: { x: 100, y: 220 },
				resolve: [
					{
						source_index: 1,
						params: { '@builtin-darkmode': 'dark' }
					}
				],
				name: 'Responsive Screen',
				discriminator: 1,
				primitive: {
					kind: 'container',
					children: [
						{
							resolve: [
								{
									source_index: 2,
									params: {
										'@builtin-darkmode': 'light',
										'@builtin-btn-emphasis': 'secondary',
										'@builtin-btn-tone': 'confirmative',
										sticky: 'true'
									}
								}
							],
							name: 'Nav',
							discriminator: 3
						},
						{
							resolve: [
								{
									source_index: 2,
									params: {
										'@builtin-darkmode': 'dark',
										'@builtin-btn-emphasis': 'secondary',
										'@builtin-btn-tone': 'confirmative'
									}
								}
							],
							name: 'Hero',
							discriminator: 3
						},
						{
							resolve: [
								{
									source_index: 2,
									params: {
										'@builtin-darkmode': 'dark',
										'@builtin-btn-emphasis': 'secondary',
										'@builtin-btn-tone': 'confirmative'
									}
								}
							],
							name: 'First section',
							discriminator: 4,
							primitive: {
								kind: 'container',
								children: [
									{
										resolve: [
											{
												source_index: 0,
												params: {
													'@builtin-darkmode': 'dark',
													'@builtin-btn-emphasis': 'tertiary'
												}
											}
										],
										name: 'CTA - Primary',
										discriminator: 0,
										primitive: {
											kind: 'text',
											text: 'Belay Request'
										}
									}
								]
							}
						},
						{
							resolve: [
								{
									source_index: 2,
									params: {
										'@builtin-darkmode': 'dark',
										'@builtin-btn-emphasis': 'secondary',
										'@builtin-btn-tone': 'confirmative'
									}
								}
							],
							name: 'Second section',
							discriminator: 5
						},
						{
							resolve: [
								{
									source_index: 2,
									params: {
										'@builtin-darkmode': 'dark',
										'@builtin-btn-emphasis': 'secondary',
										'@builtin-btn-tone': 'confirmative'
									}
								}
							],
							name: 'Third section',
							discriminator: 6
						}
					]
				}
			}
		]
	},
	{
		title: 'Doggone',
		description: 'Designed for dawgs',
		tokens: [],
		tokenLibraries: [],
		kits: [],
		kitViews: []
	},
	{
		title: 'Ferret',
		description: 'Architectural plans for ferrets, by ferrets',
		tokens: [],
		tokenLibraries: [],
		kits: [],
		kitViews: []
	}
];

// Helper to create slugs
const slugify = (str: string) =>
	str
		.toLowerCase()
		.replace(/\s+/g, '-')
		.replace(/[^\w-]/g, '');

export const load: PageLoad = ({ params }) => {
	// Map projects into { [slug]: Kit10Project }
	const slugs: { [slug: string]: Kit10Project } = projects.reduce(
		(acc, project) => {
			acc[slugify(project.title)] = project;
			return acc;
		},
		{} as { [slug: string]: Kit10Project }
	);

	if (params.title in slugs) {
		return slugs[params.title];
	}

	error(404, 'Not found');
};
