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
	import { contextMenu, type ContextMenuContentGenerator } from '$lib/components/contextMenu.js';
	import Renameable from '$lib/components/Renameable.svelte';
	import Panel from '../Panel.svelte';
	import { type Api, type EditorState, type TokenValue } from 'manager';
	import { liveQuery, type EditorActivity } from '../Editor.svelte';
	import { tokenIcon, isColorValue, tokenStr } from './token-utils.ts';
	import { draggable, dropZone, type DragPayload } from '../dnd.svelte.ts';

	type TokenRow = {
		tokenId: string;
		tokenAlias: string | null;
		tokenValue: TokenValue | null;
		tokenKitId: string | null;
		tokenViewId: string | null;
	};

	type TokensPanelProps = {
		api: Api;
		editorReady: EditorState;
		editorActivity: EditorActivity;
	};

	let { api, editorReady, editorActivity = $bindable() }: TokensPanelProps = $props();

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
	let newTokenValueType = $state<'scalar' | 'view-list'>('scalar');
	let newTokenViewIds = $state<string[]>([]);
	let addingScope = $state<'project' | 'kit' | 'view' | null>(null);
	let editingAlias = $state<Record<string, boolean>>({});
	let editingValue = $state<Record<string, boolean>>({});
	let draftValue = $state<Record<string, string>>({});

	const viewName = $derived(
		activeViewQuery.rows.find((v) => v.viewId === editorActivity.activeViewId)?.viewName ?? 'View'
	);

	const kitName = $derived(
		activeKitQuery.rows.find((k) => k.kitId === editorActivity.activeKitId)?.kitName ?? 'Kit'
	);

	const viewNameById = $derived(
		new Map(activeViewQuery.rows.map((v) => [v.viewId, v.viewName] as const))
	);

	function toggleNewTokenViewId(viewId: string) {
		newTokenViewIds = newTokenViewIds.includes(viewId)
			? newTokenViewIds.filter((id) => id !== viewId)
			: [...newTokenViewIds, viewId];
	}

	async function addToken(scope: 'project' | 'kit' | 'view') {
		if (!newTokenAlias) return;
		if (newTokenValueType === 'scalar' && !newTokenValue) return;
		if (newTokenValueType === 'view-list' && newTokenViewIds.length === 0) return;
		const projectId = editorActivity.activeProjectId;
		if (!projectId) return;

		const scopeObj =
			scope === 'kit' && editorActivity.activeKitId
				? { kitId: editorActivity.activeKitId }
				: scope === 'view' && editorActivity.activeViewId
					? { viewId: editorActivity.activeViewId }
					: undefined;

		const value: TokenValue =
			newTokenValueType === 'scalar'
				? { type: 'scalar', value: newTokenValue }
				: { type: 'view-list', view_ids: newTokenViewIds };

		await api.createToken(projectId, newTokenAlias, value, scopeObj);
		newTokenAlias = '';
		newTokenValue = '';
		newTokenViewIds = [];
		newTokenValueType = 'scalar';
		addingScope = null;
	}

	async function deleteToken(tokenId: string) {
		await api.deleteToken(tokenId);
	}

	async function renameToken(tokenId: string, alias: string) {
		await api.updateTokenAlias(tokenId, alias);
	}

	type TokenScope = 'project' | 'kit' | 'view';

	function tokenCurrentScope(tokenId: string): TokenScope | null {
		if ((projectTokensQuery.rows as TokenRow[]).some((t) => t.tokenId === tokenId)) return 'project';
		if ((kitTokensQuery.rows as TokenRow[]).some((t) => t.tokenId === tokenId)) return 'kit';
		if ((viewTokensQuery.rows as TokenRow[]).some((t) => t.tokenId === tokenId)) return 'view';
		return null;
	}

	let moveError = $state<string | null>(null);
	let moveErrorTimer: ReturnType<typeof setTimeout> | null = null;

	function flashMoveError(message: string) {
		moveError = message;
		if (moveErrorTimer) clearTimeout(moveErrorTimer);
		moveErrorTimer = setTimeout(() => (moveError = null), 3500);
	}

	// Real move (same row/id) via api.moveTokenScope -- never a copy. Blocks with an inline error
	// on an alias collision at the target scope rather than auto-renaming; the caller resolves it.
	async function moveTokenToScope(tokenId: string, target: TokenScope) {
		if (tokenCurrentScope(tokenId) === target) return;
		const newScope =
			target === 'project'
				? { projectOnly: true as const }
				: target === 'kit'
					? { kitId: editorActivity.activeKitId! }
					: { viewId: editorActivity.activeViewId! };
		const result = await api.moveTokenScope(tokenId, newScope);
		if (!result.ok) {
			flashMoveError(`This alias already exists in ${target} scope`);
		}
	}

	function tokenDropCanDrop(target: TokenScope) {
		return (payload: DragPayload) => {
			if (payload.kind !== 'token') return false;
			if (target === 'kit' && !editorActivity.activeKitId) return false;
			if (target === 'view' && !editorActivity.activeViewId) return false;
			return tokenCurrentScope(payload.tokenId) !== target;
		};
	}

	function tokenDropOnDrop(target: TokenScope) {
		return (payload: DragPayload) => {
			if (payload.kind !== 'token') return;
			moveTokenToScope(payload.tokenId, target);
		};
	}

	const tokenPanelContextMenu: ContextMenuContentGenerator = () => [
		{
			name: 'add',
			displayText: 'Add View Token',
			icon: 'fa-regular fa-window-maximize',
			onClick: () => {
				addingScope = 'view';
			}
		},
		{
			name: 'add',
			displayText: 'Add Kit Token',
			icon: 'fa-solid fa-puzzle-piece',
			onClick: () => {
				addingScope = 'kit';
			}
		},
		'hr',
		{
			name: 'add',
			displayText: 'Add Project Token',
			icon: 'fa-solid fa-diagram-project',
			onClick: () => {
				addingScope = 'project';
			}
		}
	];

	function tokenContextMenu(tokenId: string): ContextMenuContentGenerator {
		return () => {
			const token = [...projectTokensQuery.rows, ...kitTokensQuery.rows, ...viewTokensQuery.rows].find(
				(t: TokenRow) => t.tokenId === tokenId
			);
			// view-list tokens aren't editable via the plain-text value input (see the readonly
			// branch in tokenRow below) -- committing that input always writes back a scalar,
			// which would silently downgrade this token's type. No inline view-list editor yet.
			const isViewList = token?.tokenValue?.type === 'view-list';

			return [
				{
					name: 'rename',
					displayText: 'Rename',
					icon: 'fa-solid fa-i-cursor',
					onClick: () => {
						editingAlias[tokenId] = true;
					}
				},
				{
					name: 'editValue',
					displayText: 'Edit Value',
					icon: 'fa-solid fa-pencil',
					disabled: isViewList,
					onClick: () => {
						draftValue[tokenId] = tokenStr(token?.tokenValue) ?? '';
						editingValue[tokenId] = true;
					}
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
		};
	}
</script>

<Panel
	contextMenuContent={tokenPanelContextMenu}
	name="Tokens"
	tooltip="Design tokens: Project, Kit, and View scoped"
>
	{#snippet content()}
		{#snippet tokenRow(
			token: TokenRow,
			scopeClass: string,
			showTrack: boolean,
			position: 'top' | 'mid' | 'bottom' | 'solo',
			scopeLabel: string
		)}
			<li
				class="token-item"
				class:token-item--top={position === 'top'}
				class:token-item--bottom={position === 'bottom'}
				class:token-item--mid={position === 'mid'}
				class:token-item--solo={position === 'solo'}
			>
				<div
					class="token {scopeClass}"
					class:token--view-list={token.tokenValue?.type === 'view-list'}
					style="--color-icon: {tokenStr(token.tokenValue) ?? 'transparent'}"
					use:contextMenu={tokenContextMenu(token.tokenId)}
				>
					<span
						class="token__name"
						use:draggable={{
							disabled: editingAlias[token.tokenId] === true,
							preview: token.tokenAlias ?? 'token',
							payload: () => ({
								kind: 'token',
								tokenId: token.tokenId,
								alias: token.tokenAlias ?? 'token',
								valueType: token.tokenValue?.type
							})
						}}
					>
						<i
							class="fa-solid {tokenIcon(token.tokenValue)} token__icon"
							class:token__icon--color={isColorValue(token.tokenValue)}
						></i>
						<Renameable
							editing={editingAlias[token.tokenId] === true}
							value={token.tokenAlias ?? 'Unnamed'}
							onCommit={(name) => {
								renameToken(token.tokenId, name);
								editingAlias[token.tokenId] = false;
							}}
						>
							{token.tokenAlias ?? 'Unnamed'}
						</Renameable>
					</span>
					{#if showTrack}
						<button
							class="token__track"
							title="{scopeLabel}-scoped token · a same-alias View-scoped token would override this"
							type="button"
						>
							<i class="fa-solid fa-circle-dot"></i>
						</button>
					{/if}
					{#if editingValue[token.tokenId] === true}
						<input
							class="token__value-input"
							type="text"
							bind:value={draftValue[token.tokenId]}
							onblur={() => {
								const draft = draftValue[token.tokenId];
								if (draft !== undefined && draft !== tokenStr(token.tokenValue)) {
									api.updateTokenValue(token.tokenId, { type: 'scalar', value: draft });
								}
								editingValue[token.tokenId] = false;
							}}
							onkeydown={(e) => {
								if (e.key === 'Enter') {
									const draft = draftValue[token.tokenId];
									if (draft !== undefined && draft !== tokenStr(token.tokenValue)) {
										api.updateTokenValue(token.tokenId, { type: 'scalar', value: draft });
									}
									editingValue[token.tokenId] = false;
								} else if (e.key === 'Escape') {
									draftValue[token.tokenId] = tokenStr(token.tokenValue) ?? '';
									editingValue[token.tokenId] = false;
								}
							}}
						/>
					{:else if token.tokenValue?.type === 'view-list'}
						<!-- Read-only mirror of the same view set the Render panel's Content.Children field
						     edits and the Views panel nests (one source of truth -- see the children
						     invariant). One row per referenced view instead of a compact bracketed line. -->
						<div class="token__view-list-display" title="Edit via the field's picker in the Render panel">
							{#if token.tokenValue.view_ids.length === 0}
								<span class="token__view-list-empty">empty</span>
							{:else}
								{#each [...new Set(token.tokenValue.view_ids)] as vid (vid)}
									<span class="token__view-list-item">
										<i class="fa-regular fa-window-maximize"></i>
										<span class="token__view-list-name">{viewNameById.get(vid) ?? '?'}</span>
									</span>
								{/each}
							{/if}
						</div>
					{:else}
						<button
							class="token__value"
							class:token__value--new={!token.tokenValue}
							onclick={() => {
								draftValue[token.tokenId] = tokenStr(token.tokenValue) ?? '';
								editingValue[token.tokenId] = true;
							}}
						>
							{tokenStr(token.tokenValue) ?? '+'}
						</button>
					{/if}
				</div>
			</li>
		{/snippet}

		{#if moveError}
			<div class="token-move-error">{moveError}</div>
		{/if}

		<!-- View Tokens (only when a view is selected) -->
		{#if editorActivity.activeViewId}
			{@const viewRows = viewTokensQuery.rows as TokenRow[]}

			<details
				class="token-scope"
				open
				use:dropZone={{ accepts: 'token', canDrop: tokenDropCanDrop('view'), onDrop: tokenDropOnDrop('view') }}
			>
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
								{@const pos =
									viewRows.length === 1
										? 'solo'
										: i === 0
											? 'top'
											: i === viewRows.length - 1
												? 'bottom'
												: 'mid'}
								{@render tokenRow(token, 'token--view', false, pos, 'View')}
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

			<details
				class="token-scope"
				open
				use:dropZone={{ accepts: 'token', canDrop: tokenDropCanDrop('kit'), onDrop: tokenDropOnDrop('kit') }}
			>
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
								{@const pos =
									kitRows.length === 1
										? 'solo'
										: i === 0
											? 'top'
											: i === kitRows.length - 1
												? 'bottom'
												: 'mid'}
								{@render tokenRow(token, 'token--kit', true, pos, 'Kit')}
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

		<details
			class="token-scope"
			open
			use:dropZone={{
				accepts: 'token',
				canDrop: tokenDropCanDrop('project'),
				onDrop: tokenDropOnDrop('project')
			}}
		>
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
							{@const pos =
								projectRows.length === 1
									? 'solo'
									: i === 0
										? 'top'
										: i === projectRows.length - 1
											? 'bottom'
											: 'mid'}
							{@render tokenRow(token, 'token--project', false, pos, 'Project')}
						{/each}
					</ul>
				{:else}
					<span class="token-scope__empty">No project tokens</span>
				{/if}
			</div>
		</details>

		<!-- Add token form -->
		{#if addingScope}
			<form
				class="token-add"
				onsubmit={(e) => {
					e.preventDefault();
					addToken(addingScope!);
				}}
			>
				<select bind:value={newTokenValueType} class="token-add__scope">
					<option value="scalar">Scalar</option>
					<option value="view-list">View List</option>
				</select>
				<select bind:value={addingScope} class="token-add__scope">
					{#if editorActivity.activeViewId}
						<option value="view">View</option>
					{/if}
					{#if editorActivity.activeKitId}
						<option value="kit">Kit</option>
					{/if}
					<option value="project">Project</option>
				</select>
				<input
					type="text"
					bind:value={newTokenAlias}
					placeholder="alias"
					class="token-add__input"
				/>
				{#if newTokenValueType === 'scalar'}
					<input
						type="text"
						bind:value={newTokenValue}
						placeholder="value"
						class="token-add__input"
					/>
				{:else}
					<div class="token-add__view-list">
						{#each activeViewQuery.rows as view (view.viewId)}
							<label class="token-add__view-list-row">
								<input
									type="checkbox"
									checked={newTokenViewIds.includes(view.viewId)}
									onchange={() => toggleNewTokenViewId(view.viewId)}
								/>
								{view.viewName}
							</label>
						{/each}
					</div>
				{/if}
				<button
					type="submit"
					disabled={!newTokenAlias ||
						(newTokenValueType === 'scalar' ? !newTokenValue : newTokenViewIds.length === 0)}
					class="token-add__btn">Add</button
				>
				<button
					type="button"
					onclick={() => {
						addingScope = null;
						newTokenAlias = '';
						newTokenValue = '';
						newTokenViewIds = [];
						newTokenValueType = 'scalar';
					}}
					class="token-add__btn token-add__btn--cancel">✕</button
				>
			</form>
		{/if}
	{/snippet}
</Panel>

<style lang="scss" global>
	@use '_index' as *;

	.token-move-error {
		margin: $x-space-xs;
		padding: calc($x-space-xs / 2) $x-space-sm;
		border-radius: 4px;
		background: var(--color-error, oklch(58% 0.22 25));
		color: var(--color-error-text, oklch(98% 0 0));
		font-size: $x-font-size-xs;
	}

	.token-scope {
		@include layout-flex-column();

		&.dnd-over {
			outline: 2px solid var(--color-primary);
			outline-offset: -2px;
		}

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
			@include fonts-stack('Satoshi-Bold', sans);
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
		padding-inline: $x-space-sm;
		text-align: left;
		@include fonts-stack('Satoshi-Regular', sans);
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

		// A view-list token can't fit its rows on the single value line, so let it wrap: the
		// name/track stay on the first line, the referenced-view rows drop to a full-width block
		// below (see token__view-list-display).
		&--view-list {
			flex-wrap: wrap;
			align-items: center;
		}
	}

	.token__view-list-display {
		flex: 1 0 100%;
		display: flex;
		flex-direction: column;
		gap: 1px;
		padding: calc($x-space-xs / 2) 0 calc($x-space-xs / 2) $x-space-md;
		cursor: default;
	}

	.token__view-list-item {
		display: flex;
		align-items: center;
		gap: $x-space-xs;
		min-width: 0;
		padding: calc($x-space-xs / 2) $x-space-xs;
		border-radius: 1px;
		background: var(--color-panel-header-fill);
		font-size: $x-font-size-sm;

		i {
			flex: 0 0 auto;
			font-size: $x-font-size-xs;
			opacity: 0.6;
		}
	}

	.token__view-list-name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.token__view-list-empty {
		flex: 1 0 100%;
		padding: calc($x-space-xs / 2) 0 calc($x-space-xs / 2) $x-space-md;
		font-size: $x-font-size-xs;
		color: var(--color-text-muted);
		font-style: italic;
	}

	.token__icon {
		padding-right: calc($x-space-xs / 2);
	}

	.token__icon--color {
		-webkit-text-stroke: 1px black;
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

		// Draggable (onto a Render field), but hover keeps the normal cursor -- only an in-flight
		// drag reads as grabbing.
		&.dnd-dragging {
			opacity: 0.4;
			cursor: grabbing;
		}
	}

	.token__value {
		all: unset;
		flex-basis: 40%;
		flex-shrink: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		text-align: left;
		padding: calc($x-space-xs / 2) $x-space-sm;
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
			text-align: center;
		}

		&--readonly {
			cursor: default;
			opacity: 0.75;
		}
	}

	.token__value-input {
		all: unset;
		font-size: $x-font-size-sm;
		flex-basis: 40%;
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
		flex-wrap: wrap;
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

		&__view-list {
			display: flex;
			flex-direction: column;
			gap: 2px;
			flex: 1 1 100%;
			order: 10;
			max-height: 8rem;
			overflow-y: auto;
			border: 1px solid var(--color-panel-header-border);
			padding: calc($x-space-xs / 2);
		}

		&__view-list-row {
			display: flex;
			align-items: center;
			gap: calc($x-space-xs / 2);
			font-size: $x-font-size-xs;
			cursor: pointer;

			input[type='checkbox'] {
				all: revert;
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
