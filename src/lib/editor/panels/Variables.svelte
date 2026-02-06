<script lang="ts" module>
	/*
	export type TokenLibrary = {
		[namespace: string]: Token[] | TokenLibrary
	}*/

	export type TokenValue = string;

	export type Token = {
		name: string;
		displayName: string;
		value:
			| TokenValue
			| {
					resolve: string;
			  }
			| {
					alias: string;
			  };

		semantic?: false;
		description?: string;
		type?: string;
	};

	export type TokenLibraryNode = {
		tokens?: Token[];
		children?: { [namespace: string]: TokenLibraryNode };
	};

	export type TokenLibrary = { [namespace: string]: TokenLibraryNode };

	export type TokenResolution = {
		evaluation?: string;
		trace: (Token | 'failed resolution')[];
	};

	import type { ComponentFlat, ComponentView } from '../Component.svelte';

	export type TokenPanelProps = {
		tokens: Token[];
		tokenLibraries: TokenLibrary;

		selectedKit?: ComponentView;
		kitViews: ComponentView[];
		kits: ComponentFlat[];
	};
</script>

<script lang="ts">
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

		if (typeof token.value === 'string') {
			return chain;
		}

		const ref = token.value.resolve;
		const next = findTokenByPath(tokenLibraries, ref);

		if (!next) {
			chain.push('failed resolution');
			return chain;
		}

		return [...chain, ...trace(next, tokenLibraries)];
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

		return {
			trace: tr,
			evaluation
		};
	}

	const {
		tokens = $bindable(),
		tokenLibraries = $bindable(),
		selectedKit,
		kits = $bindable(),
		kitViews = $bindable()
	}: TokenPanelProps = $props();

	let tokenPanelContextMenu: ContextMenuContent = [
		{
			name: 'add',
			displayText: 'Import',
			icon: 'fa-solid fa-upload',
			onClick: () => console.log('Add')
		},
		'hr',
		{
			name: 'add',
			displayText: 'Text',
			icon: 'fa-solid fa-font',
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

	let tokenContextMenu: ContextMenuContent = [
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
</script>

<Panel
	contextMenuContent={tokenPanelContextMenu}
	name="Tokens"
	tooltip="Design tokens in use and Libraries"
>
	{#snippet content()}
		{#if selectedKit}
			<h3 class="token-heading">{kits[selectedKit.source_index].name}</h3>
			<button class="token token--top token--bottom">+</button>
		{/if}

		<h3 class="token-heading">Project</h3>
		<ul class="tokens-used">
			{#each tokens as token}
				<li class="tokens-used__item">
					{#each resolveValue(token, tokenLibraries).trace as t, i}
						<button class:token--top={i === 0} class:token--pathing={i !== 0} class="token">
							{#if i === 0}
								<!-- <i class="fa-solid fa-palette"></i> -->
								<i class="fa-solid fa-arrows-left-right-to-line"></i>
							{/if}
							{t?.displayName ?? t?.name ?? 'Not Found'}
						</button>
						<i class="fa-solid fa-angle-left"></i>
					{/each}
					<button class="token token--resolved"
						>{resolveValue(token, tokenLibraries).evaluation ?? '??'}</button
					>
				</li>
			{/each}
		</ul>

		<h3 class="token-heading">Libraries</h3>
		<ul class="tokens-library">
			{#snippet renderLibrary(lib: TokenLibrary, level: number)}
				{#each Object.entries(lib) as [namespace, node]}
					<details open>
						<summary
							class="token token--resolved token--namespace"
							style="--level: {level};"
							use:contextMenu={tokenContextMenu}
						>
							<i class="fa-solid fa-book"></i>
							{namespace}
						</summary>

						<div class="token--module">
							<!-- Render tokens inside this namespace -->
							{#if node.tokens}
								{#each node.tokens as t}
									{@const icon = t.type === 'color' ? 'square-full' : 'arrows-left-right-to-line'}

									<button
										class="token token--resolved token-leaf"
										style="--level: {level + 1}; --color-icon: {t.value}"
										use:contextMenu={tokenContextMenu}
										title={t.value}
									>
										<!-- <i class="fa-solid fa-palette"></i> -->
										<i class="fa-solid fa-{icon}"></i>
										{t.displayName}
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
	{/snippet}
</Panel>

<style lang="scss">
	@use '_index' as *;

	.token-heading {
		@include fonts-stack('Satoshi-Bold', sans);
		font-size: $x-font-size-sm;
		text-transform: uppercase;
		letter-spacing: 1px;

		padding: $x-space-xs 0 0 $x-space-sm;
	}

	.tokens-library,
	.tokens-used,
	.token--module {
		padding: $x-space-sm 0 $x-space-xs $x-space-sm;
	}

	.tokens-library {
		@include layout-flex-column();
		gap: $x-space-xs;
		background: inherit;
	}

	.token--module {
		@include layout-flex-column();
		gap: calc($x-space-xs / 2);
		overflow-y: auto;
		max-height: 16vh;
		scrollbar-width: thin;
		margin-top: $x-space-xs;
	}

	.tokens-used {
		@include layout-flex-column();
		// gap: calc($x-space-xs / 2);
		padding-bottom: $x-space-sm;
		margin-bottom: $x-space-sm;
		overflow-x: auto;
		scrollbar-width: thin;

		&__item {
			display: flex;
			align-items: center;
			width: max-content;

			position: sticky;

			> i {
				font-size: $x-font-size-sm;
				color: var(--color-icon, --color-text-muted);
			}
		}
	}

	.token {
		background: var(--color-bg);
		color: var(--color-text);
		border: unset;
		padding-block: calc($x-space-xs * 0.5);
		padding-inline: $x-space-xs;
		border: 1px solid var(--color-bg);
		border-radius: 2px;
		text-align: left;
		margin-left: calc(var(--level) * $x-space-xs);
		width: max-content;

		// outline for colors
		.fa-square-full {
			-webkit-text-stroke: 1px black;
			rotate: 180deg;
		}

		&--top {
			position: sticky;
			left: 0;
			min-width: 13ch;
			overflow-x: auto;

			border-bottom: 1px solid var(--color-surface);
		}

		&:not(&--top) {
			min-width: 12ch;
		}

		&--resolved,
		&--pathing {
			background: inherit;
			border: 1px solid var(--color-bg);
			cursor: zoom-in;
		}

		// margin-left: calc($x-space-md * (0.5 + var(--level)));
		@include fonts-stack('Satoshi-Regular', sans);
		font-weight: 600;
		font-size: $x-font-size-sm;
		letter-spacing: 1px;

		cursor: pointer;

		i {
			color: var(--color-icon, --color-text-muted);
			font-size: $x-font-size-md;
			padding-right: calc($x-space-xs * 0.5);
		}

		&:hover {
			// border-left-color: var(--color-primary);
			color: var(--color-primary);

			i {
				color: var(--color-primary);
			}
		}
	}
</style>
