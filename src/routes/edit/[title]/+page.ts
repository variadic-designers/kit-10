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
		children: {
			'builtin-axes': {
				name: '%key',
				displayName: 'BuiltIn Axes',
				children: {
					'@builtin-darkmode': {
						//  schema: {},
						displayName: 'Dark Mode',
						name: '%key',
						tokens: [
							{
								name: 'id',
								value: '%key'
							},
							{
								name: 'name',
								value: '%here.displayName'
							},
							{
								name: 'description',
								value: 'Support for light and dark mode theming'
							},
							{
								name: 'axesKind',
								value: 'exclusive'
							}
						],
						children: {
							variants: {
								name: '%key',
								displayName: 'Variants',
								children: {
									light: {
										name: '%key',
										displayName: 'Light'
									},
									dark: {
										name: '%key',
										displayName: 'Dark'
									}
								}
							}
						}
					}
				}
			}
		},
		tokenLibraries: {
			meowzer: {
				displayName: 'Meowzer',
				description: 'Project level token library',
				tokens: [
					{
						name: 'button--padding',
						displayName: 'Button Padding',
						type: 'spacing',
						value: {
							kind: 'format',
							fmt: [0, ' ', 1],
							resolve: ['gaps-linear-4/space-1', 'gaps-linear-4/space-6']
						}
					},
					{
						name: 'x-space-xl',
						displayName: 'Space SM',
						type: 'spacing',
						value: { kind: 'simple', resolve: 'gaps-linear-4/space-1' }
					},
					{
						name: 'x-space-md',
						displayName: 'Space MD',
						type: 'spacing',
						value: { resolve: 'gaps-linear-4/space-2' }
					},
					{
						name: 'x-space-lg',
						displayName: 'Space LG',
						type: 'spacing',
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
				]
			},

			'colours-of-css': {
				displayName: 'Colours of CSS',
				description: 'All named colours of css in oklab form',
				tokens: Colours.tokens
			},

			/*
			'web-basics-axes': {
				displayName: 'Colours of CSS',
        schema: ['00000000-0001-700-25e9-9ee9da6e39c'],
        tokenLibraries: {
          '@builtin-darkmode': {
            displayName: 'Dark Mode',
            tokens: {
              description: 'Support for Light and Dark mode states',
              kind: 'variant',
              variants: ['light', 'dark']
            },
          }

          '@builtin-interaction': {
            displayName: 'Interaction',
            tokens: {
              description: 'Response to user interaction',
              kind: 'variant',
              variants: ['hover', 'dark']
            },
          }
        }
			}
      */

			'gaps-linear-4': {
				displayName: 'Gaps Linear 4',
				description: 'Definitions of gaps in the scale of 4 in rem units',
				tokens: [
					{ name: 'space-0', type: 'spacing', displayName: 'Space 0', value: '0' },
					{ name: 'space-1', type: 'spacing', displayName: 'Space 1', value: '0.25rem' }, // 4px
					{ name: 'space-2', type: 'spacing', displayName: 'Space 2', value: '0.5rem' }, // 8px
					{ name: 'space-3', type: 'spacing', displayName: 'Space 3', value: '0.75rem' }, // 12px
					{ name: 'space-4', type: 'spacing', displayName: 'Space 4', value: '1rem' }, // 16px
					{ name: 'space-5', type: 'spacing', displayName: 'Space 5', value: '1.25rem' }, // 20px
					{ name: 'space-6', type: 'spacing', displayName: 'Space 6', value: '1.5rem' }, // 24px
					{ name: 'space-8', type: 'spacing', displayName: 'Space 8', value: '2rem' }, // 32px
					{ name: 'space-10', type: 'spacing', displayName: 'Space 10', value: '2.5rem' }, // 40px
					{ name: 'space-12', type: 'spacing', displayName: 'Space 12', value: '3rem' }, // 48px
					{ name: 'space-16', type: 'spacing', displayName: 'Space 16', value: '4rem' }, // 64px
					{ name: 'space-20', type: 'spacing', displayName: 'Space 20', value: '5rem' }, // 80px
					{ name: 'space-24', type: 'spacing', displayName: 'Space 24', value: '6rem' }, // 96px
					{ name: 'space-28', type: 'spacing', displayName: 'Space 28', value: '7rem' }, // 112px
					{ name: 'space-32', type: 'spacing', displayName: 'Space 32', value: '8rem' }, // 128px
					{ name: 'space-36', type: 'spacing', displayName: 'Space 36', value: '9rem' }, // 144px
					{ name: 'space-40', type: 'spacing', displayName: 'Space 40', value: '10rem' }, // 160px
					{ name: 'space-44', type: 'spacing', displayName: 'Space 44', value: '11rem' }, // 176px
					{ name: 'space-48', type: 'spacing', displayName: 'Space 48', value: '12rem' }, // 192px
					{ name: 'space-52', type: 'spacing', displayName: 'Space 52', value: '13rem' }, // 208px
					{ name: 'space-56', type: 'spacing', displayName: 'Space 56', value: '14rem' }, // 224px
					{ name: 'space-60', type: 'spacing', displayName: 'Space 60', value: '15rem' }, // 240px
					{ name: 'space-64', type: 'spacing', displayName: 'Space 64', value: '16rem' }, // 256px
					{ name: 'space-72', type: 'spacing', displayName: 'Space 72', value: '18rem' }, // 288px
					{ name: 'space-80', type: 'spacing', displayName: 'Space 80', value: '20rem' }, // 320px
					{ name: 'space-96', type: 'spacing', displayName: 'Space 96', value: '24rem' } // 384px
				]
			}
		},
		kitsPool: {
			'f47ac10b-58cc-4372-a567-0e02b2c3d479': {
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
								padding: { resolve: 'meowzer/button--padding' },
								color: '#222',
								width: 'max-content',
								height: 'max-content',
								'border-radius': '0.5rem',
								'font-size': '1rem'
							}
						},

						{
							axes: {
								'@builtin-interaction': 'default'
							},
							style: {
								'text-align': 'center'
							}
						},

						{
							axes: {
								'@builtin-btn-emphasis': 'secondary'
							},
							style: {
								'font-weight': '800'
							}
						},

						{
							axes: {
								'@builtin-btn-emphasis': 'tertiary'
							},
							style: {
								'font-weight': '800'
							}
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
							}
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
							}
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
							}
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
							}
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
							}
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
							}
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
							}
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
							}
						}
					]
				}
			},
			'9c858901-8a57-4791-81fe-4c455b099bc9': {
				name: 'Page',
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
							}
						},
						{
							axes: { '@builtin-darkmode': 'light' },
							style: {
								background: '#FFF'
							}
						},
						{
							axes: { '@builtin-darkmode': 'dark' },
							style: {
								background: '#333'
							}
						}
					]
				}
			},
			'2c1f7a6e-7a6d-4c2b-b4e2-9f7a1e5c8d3b': {
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
							}
						},
						{
							axes: { '@builtin-darkmode': 'light' },
							style: {
								background: '#FFF'
							}
						},
						{
							axes: { '@builtin-darkmode': 'dark' },
							style: {
								background: '#333'
							}
						},
						{
							axes: { sticky: 'true' },
							style: {
								position: 'sticky',
								top: '0'
							}
						}
					]
				}
			},
			'6fa459ea-ee8a-3ca4-894e-db77e160355e': {
				name: 'Chaos',
				discriminator: 0,
				sets: {
					axisRank: [builtinAxes[0]],
					layers: [
						{
							axes: {
								'@builtin-darkmode': 'light'
							},
							style: {
								'text-decoration': 'underline'
							}
						},
						{
							axes: {
								'@builtin-darkmode': 'dark'
							},
							style: {
								'text-decoration': 'line-through'
							}
						}
					]
				}
			}
		},
		viewsPool: {
			'3e5f1c2a-9b44-4f6e-8c7a-2c9e6b1d4f0a': {
				rootPosition: { x: -400, y: 20 },
				name: 'Nonny Burger',
				resolve: [],
				primitive: {
					kind: 'container',
					children: []
				}
			},
			'a8d7b4c9-2f3e-4a1d-9b65-71e2c4f8d0aa': {
				rootPosition: { x: -300, y: 20 },
				name: 'CTA - Primary',
				resolve: [
					{
						source_uuid: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
						params: {
							'@builtin-darkmode': 'dark',
							'@builtin-btn-emphasis': 'primary',
							'@builtin-btn-tone': 'neutral'
						}
					},
					{
						source_uuid: '6fa459ea-ee8a-3ca4-894e-db77e160355e',
						params: {
							'@builtin-darkmode': 'light'
						}
					}
				],
				discriminator: 1,
				primitive: {
					kind: 'text',
					text: 'Approve Request'
				}
			},
			'5b9e2f6d-8c14-4a77-b3e1-0d4f6c2a9e81': {
				rootPosition: { x: 100, y: 20 },
				resolve: [
					{
						source_uuid: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
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
			'd4c1a6e9-5b8f-4e72-9a30-2f7c8b1d6e54': {
				rootPosition: { x: 100, y: 220 },
				resolve: [
					{
						source_uuid: '9c858901-8a57-4791-81fe-4c455b099bc9',
						params: { '@builtin-darkmode': 'dark' }
					}
				],
				name: 'Responsive Screen',
				discriminator: 1,
				primitive: {
					kind: 'container',
					children: [
						// 5 children of view[3]
						'e4f1a2b3-7c6d-4e9f-8a12-3b5d6f7a8c9e',
						'9a1b2c3d-4e5f-6789-0abc-def123456789',
						'd2c3b4a5-6f7e-4891-8c2b-0d1e3f4a5b6c',
						'7f8e9d1c-2b3a-4c5e-9f0a-1b2c3d4e5f6a',
						'1a2b3c4d-5e6f-4789-8abc-0def12345678'
					]
				}
			},
			// 5 children of 'd4c1a6e9-5b8f-4e72-9a30-2f7c8b1d6e54'
			'e4f1a2b3-7c6d-4e9f-8a12-3b5d6f7a8c9e': {
				resolve: [
					{
						source_uuid: '2c1f7a6e-7a6d-4c2b-b4e2-9f7a1e5c8d3b',
						params: {
							'@builtin-darkmode': 'light',
							'@builtin-btn-emphasis': 'secondary',
							'@builtin-btn-tone': 'confirmative',
							sticky: 'true'
						}
					}
				],
				name: 'Nav',
				discriminator: 3,
				primitive: {
					kind: 'container',
					children: ['4a1b2c3d-4e5f-6789-0abc-def123456789']
				}
			},
			'9a1b2c3d-4e5f-6789-0abc-def123456789': {
				resolve: [
					{
						source_uuid: '2c1f7a6e-7a6d-4c2b-b4e2-9f7a1e5c8d3b',
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

			'd2c3b4a5-6f7e-4891-8c2b-0d1e3f4a5b6c': {
				resolve: [
					{
						source_uuid: '2c1f7a6e-7a6d-4c2b-b4e2-9f7a1e5c8d3b',
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
					children: ['4b7f2d9a-1c3e-4f6b-8a5d-9e2c1b7f0d3a']
				}
			},
			'7f8e9d1c-2b3a-4c5e-9f0a-1b2c3d4e5f6a': {
				resolve: [
					{
						source_uuid: '2c1f7a6e-7a6d-4c2b-b4e2-9f7a1e5c8d3b',
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
			'1a2b3c4d-5e6f-4789-8abc-0def12345678': {
				resolve: [
					{
						source_uuid: '2c1f7a6e-7a6d-4c2b-b4e2-9f7a1e5c8d3b',
						params: {
							'@builtin-darkmode': 'dark',
							'@builtin-btn-emphasis': 'secondary',
							'@builtin-btn-tone': 'confirmative'
						}
					}
				],
				name: 'Third section',
				discriminator: 6
			},
			'4b7f2d9a-1c3e-4f6b-8a5d-9e2c1b7f0d3a': {
				resolve: [
					{
						source_uuid: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
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
		},
		views: [
			// 4 Parents
			'3e5f1c2a-9b44-4f6e-8c7a-2c9e6b1d4f0a',
			'a8d7b4c9-2f3e-4a1d-9b65-71e2c4f8d0aa',
			'5b9e2f6d-8c14-4a77-b3e1-0d4f6c2a9e81',
			'd4c1a6e9-5b8f-4e72-9a30-2f7c8b1d6e54'
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
