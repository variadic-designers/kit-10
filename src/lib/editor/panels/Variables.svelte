<script lang="ts" module>
	export type TokenValueKind = 'string' | 'number' | 'range' | TokenValueKind[];

	export type ResolutionType = 'expression' | 'upstream';

	export type SemVer = {
		major: number;
		minor?: number;
		patch?: number;
	};

	export type Schema = {
		meta: {
			name: string;
			description: string;
			version: SemVer;
		};
		definitions: {
			[ident: string]: TokenValueKind;
		};
	};

	const axisSchema: Schema = {
		meta: {
			name: 'Axis',
			description: 'The required shape for an Axis',
			version: { major: 0 }
		},
		definitions: {
			name: 'string',
			id: 'string',
			description: 'string'
		}
	};

	export type TokenValueBare = string;

	export type TokenValueResolveSimple = {
		resolve: string;
	};

	export type TokenValueResolveFormat = {
		fmt?: (number | string)[];
		resolve: string[];
	};

	export type TokenIdent = {
		name: string;
		displayName: string;
	};

	export interface Token extends TokenIdent {
		value: TokenValueBare | TokenValueResolveSimple | TokenValueResolveFormat;
		semantic?: false;
		description?: string;
		type?: string;
	}

	const ICONS: Record<string, string> = {
		color: 'fa-square-full',
		spacing: 'fa-arrows-left-right-to-line'
	};

	export const tokenIcon = (type?: string): string => ICONS[type ?? ''] || 'fa-question';

	export type TokenLibraryNode = {
		displayName?: string;
		description?: string;
		name: string;
		tokens?: Token[];
		schema?: Schema;
		children?: { [namespace: string]: TokenLibraryNode };
	};

	export type TokenLibrary = { [namespace: string]: TokenLibraryNode };

	export type TokenResolutionResult =
		| {
				kind: 'success';
				result: Token;
		  }
		| {
				kind: 'failed';
		  };

	export type TokenResolution = {
		evaluation?: string;
		trace: (Token | 'failed resolution')[];
	};

	import type { ComponentFlat, ComponentView } from '../Component.svelte';

	export type TokenPanelProps = {
		tokens: Token[];
		tokenLibraries: TokenLibrary;

		/*
		selectedKit?: ComponentView;
		kitViews: ComponentView[];
		kits: ComponentFlat[];
    */
	};
</script>

<script lang="ts">
	import DarkModeToggle from '$lib/components/DarkModeToggle.svelte';
	import { contextMenu } from '../contextMenu';
	import type { ContextMenuContent } from '../contextMenuStore';
	import Panel from '../Panel.svelte';

	function findTokenByPath(library: TokenLibrary, path: string): Token | undefined {
		const segments = path.split('/');
		let current: TokenLibraryNode | undefined = library[segments[0]];

		if (!current) return undefined;

		// walk down children except last segment
		for (let i = 1; i < segments.length - 1; i++) {
			const seg = segments[i];
			current = current.children?.[seg];
			if (!current) return undefined;
		}

		// final segment: look inside tokens[]
		const final = segments[segments.length - 1];
		const tokens = current.tokens;

		if (!tokens) return undefined;

		return tokens.find((t) => t.name === final);
	}

	function trace(token: Token, tokenLibraries: TokenLibrary): (Token | 'failed resolution')[] {
		const chain: (Token | 'failed resolution')[] = [token];

		if (token.value.kind === 'bare') {
			return chain;
		} else if (token.value.kind === 'simple') {
			const ref = token.value.resolve;
			const next = findTokenByPath(tokenLibraries, ref);

			if (!next) {
				chain.push('failed resolution');
				return chain;
			}

			return [...chain, ...trace(next, tokenLibraries)];
		}

		return [...chain, 'failed resolution'];
	}

	function resolveValue(token: Token, tokenLibraries: TokenLibrary): TokenResolution {
		const tr = trace(token, tokenLibraries);
		const last = tr[tr.length - 1];

		const evaluation =
			last === 'failed resolution'
				? undefined
				: typeof last.value === 'string'
					? last.value
					: undefined; // should not happen if definitions are correct

		let result: TokenResolution = { trace: tr };

		if (last !== 'failed resolution') {
			if (last.value.kind === 'bare') {
				result = { ...result, evaluation: last.value.raw };
			}
		}

		return result;
	}

	const { tokens = $bindable(), tokenLibraries = $bindable() }: TokenPanelProps = $props();

	let tokenPanelContextMenu: ContextMenuContent = () => [
		{
			name: 'add',
			displayText: 'Import',
			icon: 'fa-solid fa-download',
			onClick: () => console.log('Add')
		},
		'hr',
		{
			name: 'add',
			displayText: 'Text',
			icon: 'fa-solid fa-italic',
			onClick: () => console.log('Add')
		},
		{
			name: 'add',
			displayText: 'Number',
			icon: 'fa-solid fa-list-ol',
			onClick: () => console.log('Add')
		},
		{
			name: 'add',
			displayText: 'Colour',
			icon: 'fa-solid fa-palette',
			onClick: () => console.log('Add')
		},
		'hr',
		{
			name: 'add',
			displayText: 'Content Flow',
			icon: 'fa-solid fa-table-cells-large',
			onClick: () => console.log('Add')
		},
		'hr',
		// Static editor evaluation
		{
			name: 'add',
			displayText: 'Derivation',
			icon: 'fa-solid fa-calculator',
			onClick: () => console.log('Add')
		},
		// Dynamic evaluation
		{
			name: 'add',
			displayText: 'Library',
			icon: 'fa-solid fa-book',
			onClick: () => console.log('Add')
		},
		{
			name: 'add',
			displayText: 'Schema',
			icon: 'fa-solid fa-microchip',
			onClick: () => console.log('Add')
		}
	];

	let tokenContextMenu: ContextMenuContent = () => {
		return [
			{
				name: 'add',
				displayText: 'Rename',
				icon: 'fa-solid fa-italic',
				onClick: () => console.log('Add')
			},

			{
				name: 'add',
				displayText: 'To New',
				icon: 'fa-solid fa-arrow-up-right-from-square',
				onClick: () => console.log('Add')
			},
			{
				name: 'add',
				displayText: 'Pin',
				icon: 'fa-solid fa-thumbtack',
				onClick: () => console.log('Add')
			},
			'hr',
			{
				name: 'trash',
				displayText: 'Copy',
				icon: 'fa-solid fa-copy',
				onClick: () => console.log('Remove')
			},
			{
				name: 'trash',
				displayText: 'Paste',
				disabled: true,
				icon: 'fa-solid fa-clipboard',
				onClick: () => console.log('Remove')
			},
			'hr',
			{
				name: 'trash',
				displayText: 'Delete',
				tone: 'destructive',
				icon: 'fa-solid fa-trash-can',
				onClick: () => console.log('Remove')
			}
		];
	};

	import { drag } from '../dragDrop.ts';
	const tokenDrag = drag<Token>();
</script>

{#snippet tokenEnumeration(tokens: Token[])}
	{#each tokens as token}
		<li class="tokens-used__item">
			{#each resolveValue(token, tokenLibraries).trace as t, i}
				<button class:token--top={i === 0} class:token--pathing={i !== 0} class="token">
					{#if i === 0}
						<i class="fa-solid fa-arrows-left-right-to-line"></i>
					{/if}

					<span>
						{#if t}
							t.displayName ?? t.name ?? 'Unnamed'
						{:else}
							'Not Found'
						{/if}
					</span>
				</button>
				<i class="fa-solid fa-angle-left"></i>
			{/each}
			<button class="token token--resolved"
				>{resolveValue(token, tokenLibraries).evaluation ?? '??'}</button
			>
		</li>
	{/each}
{/snippet}

<Panel
	contextMenuContent={tokenPanelContextMenu}
	name="Tokens"
	tooltip="Design tokens in use and Libraries"
>
	{#snippet content()}
		<div class="token-section">
			<ul class="tokens-library">
				{#snippet renderLibrary(lib: TokenLibrary, level: number)}
					{#each Object.entries(lib) as [namespace, node]}
						<details class="token token-namespace" open>
							<summary
								class="token-namespace__header"
								style="--level: {level};"
								title={node.description}
								use:contextMenu={tokenContextMenu}
							>
								<span>
									<i class="fa-solid fa-book"></i>

									<span>
										{node.displayName}
									</span>
								</span>

								<i class="fa-solid fa-angle-down"></i>
							</summary>

							<div class="token--module">
								<!-- Render tokens inside this namespace -->
								{#if node.tokens}
									{#each node.tokens as t, i}
										{@const icon = t.type === 'color' ? 'square-full' : 'arrows-left-right-to-line'}

										<button
											class="token token--resolved token-leaf"
											style="--level: {level + 1}; --color-icon: {t.value}"
											title={JSON.stringify(t.value, null, 2)}
											use:contextMenu={tokenContextMenu}
											id={`token-{i}`}
											use:tokenDrag={{ className: 'token--dragged', payload: t }}
										>
											<!-- <i class="fa-solid fa-palette"></i> -->
											<span class="token__name">
												<i class="fa-solid fa-{icon}"></i>
												{t.displayName ?? t.name}
											</span>
										</button>
									{/each}
								{/if}

								<!-- Render nested children -->
								{#if node.children}
									{@render renderLibrary(node.children, level + 1)}
								{/if}
							</div>
						</details>
					{/each}
				{/snippet}

				{@render renderLibrary(tokenLibraries, 0)}
			</ul>
		</div>
	{/snippet}
</Panel>

<style lang="scss" global>
	@use '_index' as *;

	.token-namespace {
		@include layout-flex-column();

		summary {
			all: unset;
			list-style: none;
			display: flex;

			width: 100%;
			padding-block: calc($x-space-xs / 4);

			span {
				flex-grow: 1;
			}

			i.fa-angle-down {
				transition: rotate 200ms ease-out;
			}
		}

		&[open] {
			summary {
				padding-bottom: calc($x-space-xs / 2);
				align-items: center;

				i.fa-angle-down {
					rotate: 180deg;
				}
			}
		}

		width: 100%;
	}

	.token--module {
		@include layout-flex-column();
		overflow-y: auto;
		max-height: 16vh;
		scrollbar-width: thin;
		padding: $x-space-xs 0 0 $x-space-sm;
	}

	.tokens-library {
		@include layout-flex-column();
		gap: 2px;
	}

	.token {
		// all: unset;
		color: var(--color-text);
		user-select: none;
		border: unset;

		&__name {
			border: 2px solid transparent;
			padding-inline: $x-space-xs;
		}

		&:nth-of-type(even) {
			background: var(--color-pure);
			background:
				radial-gradient(closest-side, var(--color-surface) 90%, transparent 100%) 0 0 / 3px 3px,
				var(--color-surface-alt);
		}

		&:nth-of-type(odd) {
			background: var(--color-surface);
		}

		.token.token--dragged {
			.token__name {
				color: var(--color-primary);
			}
			max-width: max-content;
		}

		padding-block: calc($x-space-xs * 0.5);
		text-align: left;

		@include fonts-stack('Satoshi-Regular', sans);
		font-weight: 600;
		font-size: $x-font-size-sm;
		letter-spacing: 1px;

		&:hover {
			// border-left-color: var(--color-primary);
			// color: var(--color-icon, var(--color-primary));
			color: var(--color-primary);
		}

		i.fa-square-full,
		i.fa-cube {
			-webkit-text-stroke: 1px black;
			color: var(--color-icon, var(--color-text));
		}
	}
</style>
