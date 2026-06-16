<script lang="ts" module>
	export type TokenValueKind = 'string' | 'number' | 'range' | TokenValueKind[];

	export type TokenValueBare = {
		kind: 'raw';
		value: string;
	};

	export type TokenValueResolveSimple = {
		kind: 'simple';
		resolve: string;
	};

	export type TokenValueResolveFormat = {
		kind: 'format';
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

	export type TokenPanelProps = {
		tokens: Token[];
		tokenLibraries: { [namespace: string]: TokenLibraryNode };
	};

	export type TokenLibraryNode = {
		displayName?: string;
		description?: string;
		name: string;
		tokens?: Token[];
		children?: { [namespace: string]: TokenLibraryNode };
	};
</script>

<script lang="ts">
	import { contextMenu, type ContextMenuContent } from '$lib/components/contextMenu';
	import Renameable from '$lib/components/Renameable.svelte';
	import Panel from '../Panel.svelte';
	import { type Api, type EditorState } from 'manager';
	import { liveQuery, type EditorActivity } from '../Editor.svelte';

	type TokenRow = { tokenId: string; tokenAlias: string | null; tokenValue: string | null; tokenKitId: string | null; tokenViewId: string | null };

	type TokensPanelProps = {
		api: Api;
		editorReady: EditorState;
		editorActivity: EditorActivity;
	};

	let {
		api,
		editorReady,
		editorActivity = $bindable()
	}: TokensPanelProps = $props();

	const projectTokensQuery = liveQuery((api, activity) => {
		return api.getTokensByProjectId(activity.activeProjectId);
	});

	const kitTokensQuery = liveQuery((api, activity) => {
		return api.getTokensByKitId(activity.activeKitId);
	});

	const viewTokensQuery = liveQuery((api, activity) => {
		return api.getTokensByViewId(activity.activeViewId);
	});

	const activeViewQuery = liveQuery((api, activity) => {
		return api.getViewsByProjectId(activity.activeProjectId);
	});

	const activeKitQuery = liveQuery((api, activity) => {
		return api.getKitCompositionByViewId(activity.activeViewId);
	});

	let newTokenAlias = $state('');
	let newTokenValue = $state('');
	let addingScope = $state<'project' | 'kit' | 'view' | null>(null);
	let editingAlias = $state<Record<string, boolean>>({});
	let editingValue = $state<Record<string, boolean>>({});

	const viewName = $derived(
		activeViewQuery.rows.find((v) => v.viewId === editorActivity.activeViewId)?.viewName ?? 'View'
	);

	const kitName = $derived(
		activeKitQuery.rows.find((k) => k.kitId === editorActivity.activeKitId)?.kitName ?? 'Kit'
	);

	async function addToken(scope: 'project' | 'kit' | 'view') {
		if (!newTokenAlias || !newTokenValue) return;
		const projectId = editorActivity.activeProjectId;
		if (!projectId) return;

		const scopeObj = scope === 'kit' && editorActivity.activeKitId
			? { kitId: editorActivity.activeKitId }
			: scope === 'view' && editorActivity.activeViewId
				? { viewId: editorActivity.activeViewId }
				: undefined;

		await api.createToken(projectId, newTokenAlias, newTokenValue, scopeObj);
		newTokenAlias = '';
		newTokenValue = '';
		addingScope = null;
	}

	async function deleteToken(tokenId: string) {
		await api.deleteToken(tokenId);
	}

	async function renameToken(tokenId: string, alias: string) {
		await api.updateTokenAlias(tokenId, alias);
	}

	const tokenPanelContextMenu: ContextMenuContent = () => [
		{
			name: 'add',
			displayText: 'Add View Token',
			icon: 'fa-regular fa-window-maximize',
			onClick: () => { addingScope = 'view'; }
		},
		{
			name: 'add',
			displayText: 'Add Kit Token',
			icon: 'fa-solid fa-puzzle-piece',
			onClick: () => { addingScope = 'kit'; }
		},
		'hr',
		{
			name: 'add',
			displayText: 'Add Project Token',
			icon: 'fa-solid fa-diagram-project',
			onClick: () => { addingScope = 'project'; }
		}
	];

	function tokenIcon(value: string | null): string {
		if (!value) return 'fa-question';
		if (value.startsWith('#') || value.startsWith('rgb') || value.startsWith('hsl')) return 'fa-square-full';
		if (/^\d/.test(value) && (value.includes('px') || value.includes('rem') || value.includes('em') || value.includes('%'))) return 'fa-arrows-left-right-to-line';
		return 'fa-circle';
	}

	function isColorValue(value: string | null): boolean {
		if (!value) return false;
		return value.startsWith('#') || value.startsWith('rgb') || value.startsWith('hsl');
	}

	function tokenContextMenu(tokenId: string): ContextMenuContent {
		return () => [
			{
				name: 'rename',
				displayText: 'Rename',
				icon: 'fa-solid fa-i-cursor',
				onClick: () => { editingAlias[tokenId] = true; }
			},
			{
				name: 'editValue',
				displayText: 'Edit Value',
				icon: 'fa-solid fa-pencil',
				onClick: () => { editingValue[tokenId] = true; }
			},
			'hr',
			{
				name: 'delete',
				displayText: 'Delete',
				icon: 'fa-solid fa-trash-can',
				tone: 'destructive' as const,
				onClick: () => deleteToken(tokenId)
			}
		];
	}
</script>

<Panel
	contextMenuContent={tokenPanelContextMenu}
	name="Tokens"
	tooltip="Design tokens: Project, Kit, and View scoped"
>
	{#snippet content()}
		{#snippet tokenRow(token: TokenRow, scopeClass: string, showTrack: boolean, position: 'top' | 'mid' | 'bottom' | 'solo')}
			<li class="token-item" class:token-item--top={position === 'top'} class:token-item--bottom={position === 'bottom'} class:token-item--mid={position === 'mid'} class:token-item--solo={position === 'solo'}>
				<div
					class="token {scopeClass}"
					style="--color-icon: {token.tokenValue ?? 'transparent'}"
					use:contextMenu={tokenContextMenu(token.tokenId)}
				>
					<span class="token__name">
						<i class="fa-solid {tokenIcon(token.tokenValue)} token__icon" class:token__icon--color={isColorValue(token.tokenValue)}></i>
						<Renameable
							editing={editingAlias[token.tokenId] === true}
							value={token.tokenAlias ?? 'Unnamed'}
							onCommit={(name) => { renameToken(token.tokenId, name); editingAlias[token.tokenId] = false; }}
						>
							{token.tokenAlias ?? 'Unnamed'}
						</Renameable>
					</span>
					{#if showTrack}
						<button class="token__track" title="Token" type="button">
							<i class="fa-solid fa-circle-dot"></i>
						</button>
					{/if}
					{#if editingValue[token.tokenId] === true}
						<input
							class="token__value-input"
							type="text"
							value={token.tokenValue ?? ''}
							onblur={() => { editingValue[token.tokenId] = false; }}
							onkeydown={(e) => { if (e.key === 'Enter') { api.updateTokenValue(token.tokenId, (e.target as HTMLInputElement).value); editingValue[token.tokenId] = false; } }}
							oninput={(e) => { api.updateTokenValue(token.tokenId, (e.target as HTMLInputElement).value); }}
						/>
					{:else}
						<button
							class="token__value"
							class:token__value--new={!token.tokenValue}
							onclick={() => { editingValue[token.tokenId] = true; }}
						>
							{token.tokenValue ?? '+'}
						</button>
					{/if}
				</div>
			</li>
		{/snippet}

		<!-- View Tokens (only when a view is selected) -->
		{#if editorActivity.activeViewId}
			{@const viewRows = viewTokensQuery.rows as TokenRow[]}

			<details class="token-scope" open>
				<summary class="token-scope__header">
					<h3 class="token-scope__label">
						<i class="fa-regular fa-window-maximize"></i>
						{viewName}
					</h3>
					<i class="fa-solid fa-angle-down"></i>
				</summary>
				<div class="token-scope__tokens">
					{#if viewRows && viewRows.length > 0}
						<ul class="tokens-list">
							{#each viewRows as token, i (token.tokenId)}
								{@const pos = viewRows.length === 1 ? 'solo' : i === 0 ? 'top' : i === viewRows.length - 1 ? 'bottom' : 'mid'}
								{@render tokenRow(token, 'token--view', false, pos)}
							{/each}
						</ul>
					{:else}
						<span class="token-scope__empty">No view tokens</span>
					{/if}
				</div>
			</details>
		{/if}

		<!-- Kit Tokens (only when a kit is selected) -->
		{#if editorActivity.activeKitId}
			{@const kitRows = kitTokensQuery.rows as TokenRow[]}

			<details class="token-scope" open>
				<summary class="token-scope__header">
					<h3 class="token-scope__label">
						<i class="fa-solid fa-puzzle-piece"></i>
						{kitName}
					</h3>
					<i class="fa-solid fa-angle-down"></i>
				</summary>
				<div class="token-scope__tokens">
					{#if kitRows && kitRows.length > 0}
						<ul class="tokens-list">
							{#each kitRows as token, i (token.tokenId)}
								{@const pos = kitRows.length === 1 ? 'solo' : i === 0 ? 'top' : i === kitRows.length - 1 ? 'bottom' : 'mid'}
								{@render tokenRow(token, 'token--kit', true, pos)}
							{/each}
						</ul>
					{:else}
						<span class="token-scope__empty">No kit tokens</span>
					{/if}
				</div>
			</details>
		{/if}

		<!-- Project Tokens -->
		{@const projectRows = projectTokensQuery.rows as TokenRow[]}

		<details class="token-scope" open>
			<summary class="token-scope__header">
				<h3 class="token-scope__label">
					<i class="fa-solid fa-diagram-project"></i>
					{editorActivity.activeProjectName ?? 'Project'}
				</h3>
				<i class="fa-solid fa-angle-down"></i>
			</summary>
			<div class="token-scope__tokens">
				{#if projectRows && projectRows.length > 0}
					<ul class="tokens-list">
						{#each projectRows as token, i (token.tokenId)}
							{@const pos = projectRows.length === 1 ? 'solo' : i === 0 ? 'top' : i === projectRows.length - 1 ? 'bottom' : 'mid'}
							{@render tokenRow(token, 'token--project', false, pos)}
						{/each}
					</ul>
				{:else}
					<span class="token-scope__empty">No project tokens</span>
				{/if}
			</div>
		</details>

		<!-- Add token form -->
		{#if addingScope}
			<form class="token-add" onsubmit={(e) => { e.preventDefault(); addToken(addingScope!); }}>
				<select bind:value={addingScope} class="token-add__scope">
					{#if editorActivity.activeViewId}
						<option value="view">View</option>
					{/if}
					{#if editorActivity.activeKitId}
						<option value="kit">Kit</option>
					{/if}
					<option value="project">Project</option>
				</select>
				<input type="text" bind:value={newTokenAlias} placeholder="alias" class="token-add__input" />
				<input type="text" bind:value={newTokenValue} placeholder="value" class="token-add__input" />
				<button type="submit" disabled={!newTokenAlias || !newTokenValue} class="token-add__btn">Add</button>
				<button type="button" onclick={() => { addingScope = null; newTokenAlias = ''; newTokenValue = ''; }} class="token-add__btn token-add__btn--cancel">✕</button>
			</form>
		{/if}
	{/snippet}
</Panel>

<style lang="scss" global>
	@use '_index' as *;

.token-scope {
		@include layout-flex-column();

		summary {
			list-style: none;
			display: flex;
			padding-block: $x-space-xs;
			padding-inline: $x-space-sm;
			align-items: center;
			justify-content: space-between;
			cursor: pointer;
			user-select: none;
			font-size: $x-font-size-xs;
			text-transform: uppercase;
			@include fonts-stack('Satoshi-Bold', sans-serif);
			color: var(--color-text);

			&:hover {
				background: var(--color-surface-alt);
			}

			i.fa-angle-down {
				position: relative;
				right: $x-space-sm;
				transition: rotate 200ms ease-out;
			}
		}

		&[open] {
			summary {
				i.fa-angle-down {
					rotate: 180deg;
				}
			}
		}

		width: 100%;
	}

	.token-scope__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
	}

	.token-scope__label {
		display: flex;
		align-items: center;
		gap: $x-space-xs;
		margin: 0;
		color: var(--color-text);
	}

	.token-scope__tokens {
		padding-left: $x-space-sm;
		padding-bottom: $x-space-xs;
		overflow-y: auto;
		max-height: 16vh;
		scrollbar-width: thin;
	}

	.token-scope__empty {
		padding-left: $x-space-sm;
		padding-bottom: $x-space-xs;
		font-size: $x-font-size-xs;
		color: var(--color-text-muted);
		font-style: italic;
	}

	.tokens-list {
		@include layout-flex-column();
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.token-item {
		display: flex;

		$border-rad: calc($x-space-xs / 2);

		&--top > .token > .token__value,
		&--top > .token > .token__value-input {
			border-radius: $border-rad $border-rad 0 0;
		}

		&--bottom > .token > .token__value,
		&--bottom > .token > .token__value-input {
			border-radius: 0 0 $border-rad $border-rad;
		}

		&--mid > .token > .token__value,
		&--mid > .token > .token__value-input {
			border-radius: 0;
		}

		&--solo > .token > .token__value,
		&--solo > .token > .token__value-input {
			border-radius: $border-rad;
		}
	}

	.token {
		color: var(--color-text);
		user-select: none;
		background: var(--color-surface);
		padding-inline: $x-space-sm;
		text-align: left;
		@include fonts-stack('Satoshi-Light', sans-serif);
		font-weight: 600;
		font-size: $x-font-size-sm;
		letter-spacing: 1px;
		width: 100%;
		display: flex;
		align-items: center;
		cursor: pointer;

		&:nth-of-type(even) {
			background: var(--color-surface-alt);
		}

		&:hover {
			color: var(--color-primary);
		}

		&--project {
		}

		&--kit {
		}

		&--view {
		}
	}

	.token__icon {
		font-size: $x-font-size-md;
		padding-right: calc($x-space-xs / 2);
	}

	.token__icon--color {
		color: var(--color-icon, var(--color-text));
	}

	.token__track {
		all: unset;
		font-size: $x-font-size-sm;
		color: var(--color-text);
		padding-inline: calc($x-space-xs / 2);
		cursor: pointer;
	}

	.token__name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		padding-inline: calc($x-space-xs / 2);
	}

	.token__value {
		all: unset;
		flex-basis: 60%;
		flex-shrink: 1;
		text-align: center;
		padding: calc($x-space-xs / 2);
		cursor: pointer;
		color: var(--color-add-var-text);
		font-size: $x-font-size-sm;
		background: var(--color-panel-header-fill);
		border-radius: 1px;

		&:hover {
			background: var(--color-surface-alt);
			color: var(--color-text);
		}

		&--new {
			cursor: pointer;
		}
	}

	.token__value-input {
		all: unset;
		font-size: $x-font-size-sm;
		flex-basis: 60%;
		flex-shrink: 1;
		text-align: center;
		padding: calc($x-space-xs / 2);
		background: var(--color-pure);
		color: var(--color-text);
		border: 1px solid var(--color-primary);
		border-radius: 1px;
		outline: none;
	}

	.token-add {
		display: flex;
		gap: calc($x-space-xs / 2);
		padding: $x-space-xs;
		align-items: center;

		&__scope {
			font-size: $x-font-size-xs;
			padding: 2px 4px;
		}

		&__input {
			font-size: $x-font-size-xs;
			padding: 2px 4px;
			width: 6ch;
			min-width: 0;

			&:nth-of-type(2) {
				width: 10ch;
			}
		}

		&__btn {
			font-size: $x-font-size-xs;
			padding: 2px 6px;
			border: 1px solid var(--color-text-muted);
			background: var(--color-pure);
			color: var(--color-text);
			cursor: pointer;

			&:disabled {
				opacity: 0.4;
				cursor: not-allowed;
			}

			&--cancel {
				border-color: transparent;
			}
		}
	}
</style>