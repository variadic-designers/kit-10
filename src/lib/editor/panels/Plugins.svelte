<script lang="ts">
	import type { ContextMenuContent, ContextMenuContentGenerator } from '$lib/components/contextMenu.js';
	import { openContextMenu } from '$lib/components/contextMenuStore.js';
	import Panel from '../Panel.svelte';
	import type { PluginManager } from '$lib/plugins/manager.svelte.js';
	import type { Api, PluginRow, PluginManifest, PluginKind, PluginActivation } from 'manager';
	import { resolvePluginRelationships } from '$lib/plugins/plugin-relationships.js';

	let {
		manager,
		api,
		pendingInstall = null,
		onInstallHandled
	}: {
		manager: PluginManager | null;
		api: Api;
		// /store's Install button hands off here (see Editor.svelte) rather than performing the
		// registration itself -- /store has no DB access. Pre-fills the form below and is
		// consumed exactly once via onInstallHandled so a later prop change doesn't re-open it.
		pendingInstall?: { name: string; kind: PluginKind } | null;
		onInstallHandled?: () => void;
	} = $props();

	// The DB-backed registry -- the source of truth for what's *installed*, independent of
	// whether anything has actually loaded it yet this session (a lazy utility plugin, or a
	// freshly registered interpreter with no project selecting it, are both real rows here long
	// before manager.plugins ever mentions their name). Refetched on mount and after a
	// successful install; there's no live query for this table yet (see Project.svelte's
	// identical one-shot listPlugins() posture for export/import providers).
	let catalogue: PluginRow[] = $state([]);

	async function refreshCatalogue() {
		catalogue = await api.listPlugins();
	}

	$effect(() => {
		refreshCatalogue();
	});

	// --- Install form ---------------------------------------------------------------------

	let installing = $state(false);
	let formName = $state('');
	let formKind: PluginKind = $state('utility');
	let formActivation: PluginActivation = $state('lazy');
	let formWasmUrl = $state('');
	let formManifestJson = $state('');
	let formError: string | null = $state(null);

	$effect(() => {
		if (!pendingInstall) return;
		formName = pendingInstall.name;
		formKind = pendingInstall.kind;
		installing = true;
		onInstallHandled?.();
	});

	function resetForm() {
		installing = false;
		formName = '';
		formKind = 'utility';
		formActivation = 'lazy';
		formWasmUrl = '';
		formManifestJson = '';
		formError = null;
	}

	// The one thing that's genuinely project-scoped is an interpreter's automated, reactive
	// role: a project's on_resolve loop runs continuously against whatever plugin sits in its
	// interpreter_plugin_id, unlike a utility plugin (install-level, invoked on demand). This
	// is the workspace -> project cascading menu (same ContextMenuContent + submenu machinery
	// Views.svelte/Project.svelte already use for their own context menus, just opened
	// programmatically here instead of from a right-click) that lets a newly- or
	// previously-registered interpreter actually be assigned to a project via
	// setProjectInterpreter -- there was no UI reaching that call at all before this.
	async function openInterpreterAssignMenu(pluginId: string, target: HTMLElement) {
		const projects = await api.getAllProjects().execute();

		const byWorkspace = new Map<string, typeof projects>();
		for (const p of projects) {
			const list = byWorkspace.get(p.workspaceName) ?? [];
			list.push(p);
			byWorkspace.set(p.workspaceName, list);
		}

		const content: ContextMenuContent =
			byWorkspace.size === 0
				? [
						{
							name: 'no_projects',
							displayText: 'No projects yet',
							icon: 'fa-solid fa-folder',
							disabled: true
						}
					]
				: [...byWorkspace.entries()].map(([workspaceName, workspaceProjects]) => ({
						name: `assign_workspace_${workspaceName}`,
						displayText: workspaceName,
						icon: 'fa-solid fa-folder',
						submenu: workspaceProjects.map((p) => ({
							name: `assign_project_${p.projectId}`,
							displayText: p.projectName,
							icon: 'fa-regular fa-window-maximize',
							onClick: () => api.setProjectInterpreter(p.projectId, pluginId)
						}))
					}));

		const rect = target.getBoundingClientRect();
		openContextMenu(rect.left, rect.bottom, target, content);
	}

	// Builds the manifest from either the simple Wasm-URL field or the advanced JSON textarea
	// (whichever the user actually filled in), then calls the same registerPlugin upsert-by-name
	// primitive registerBuiltinPlugins already uses at boot (manager/src/plugins-bootstrap.ts) --
	// this panel is just the first UI path to reach it. Refuses to overwrite an existing name
	// rather than silently upserting over it (a real risk here: upsert-by-name is exactly right
	// for re-registering a known built-in at boot, but the wrong default for a user-typed name
	// that might collide with charter/fontavious/tenner or another install).
	async function handleRegister(submitter: HTMLElement | null) {
		formError = null;
		const name = formName.trim();
		if (!name) {
			formError = 'Name is required.';
			return;
		}
		if (catalogue.some((p) => p.name === name)) {
			formError = `A plugin named "${name}" is already registered.`;
			return;
		}

		const wasmUrl = formWasmUrl.trim();
		const rawManifest = formManifestJson.trim();
		let manifest: PluginManifest;

		if (rawManifest) {
			try {
				manifest = JSON.parse(rawManifest);
			} catch {
				formError = 'Manifest JSON is not valid JSON.';
				return;
			}
			if (!Array.isArray(manifest.wasm) || manifest.wasm.length === 0) {
				if (!wasmUrl) {
					formError = 'Provide a Wasm URL, or include a "wasm" array in the manifest JSON.';
					return;
				}
				manifest.wasm = [{ url: wasmUrl }];
			}
		} else {
			if (!wasmUrl) {
				formError = 'Wasm URL is required.';
				return;
			}
			manifest = { wasm: [{ url: wasmUrl }] };
		}

		const activation = formKind === 'utility' ? formActivation : null;
		const row = await api.registerPlugin({ name, kind: formKind, activation, manifest });
		if (!row) {
			formError = 'Registration failed.';
			return;
		}

		// Eager utility plugins are meant to be loaded once, unconditionally, at editor boot
		// (see PluginActivation) -- since this one didn't exist at boot, load it right now so
		// it's usable immediately instead of only after the next full reload. Lazy utility
		// plugins load themselves on first actual use (callUtilityPlugin).
		if (formKind === 'utility' && activation === 'eager') {
			await manager?.loadUtilityPlugin(manifest, name, undefined, manifest.capabilities?.hostFns);
		}

		await refreshCatalogue();
		resetForm();

		// A freshly registered interpreter isn't usable by anything until some project actually
		// adopts it (projects.interpreter_plugin_id) -- prompt for that right away instead of
		// leaving the user to find the per-row "assign" action on their own.
		if (formKind === 'interpreter' && submitter) {
			await openInterpreterAssignMenu(row.id, submitter);
		}
	}

	const pluginPanelContextMenu: ContextMenuContentGenerator = () => {
		return [
			{
				name: 'import_plugin',
				displayText: 'Import Plugin',
				icon: 'fa-solid fa-microchip',
				onClick: () => {
					installing = true;
				}
			}
		];
	};

	function statusIcon(status: string): string {
		switch (status) {
			case 'loading':
				return 'fa-solid fa-spinner fa-spin';
			case 'ready':
				return 'fa-solid fa-circle-check';
			case 'error':
				return 'fa-solid fa-circle-exclamation';
			case 'disabled':
				return 'fa-solid fa-circle-minus';
			default:
				return 'fa-solid fa-circle';
		}
	}

	function statusColor(status: string): string {
		switch (status) {
			case 'ready':
				return 'var(--color-success)';
			case 'error':
				return 'var(--color-danger)';
			default:
				return 'var(--color-text-muted)';
		}
	}

	// Merges the registry (what's installed) with this session's runtime load status (what's
	// actually loaded) by name -- a row with no runtime match just reads as "not loaded" via the
	// existing status-icon/color default case, no separate status value needed.
	let rows = $derived(
		catalogue.map((row) => {
			const loaded = manager?.plugins.find((p) => p.name === row.name);
			return { row, status: loaded?.status ?? '', error: loaded?.error };
		})
	);

	// "Support for" (a plugin's own declared compatibility target, e.g. WebCodium -> Charter)
	// and "dependency of" (the derived reverse view) -- see plugin-relationships.ts. Informational
	// only: nothing here reacts to an unsatisfied (not-installed) support entry.
	let relationships = $derived(resolvePluginRelationships(catalogue));
</script>

<Panel name="Plugins" tooltip="Plugins" contextMenuContent={pluginPanelContextMenu}>
	{#snippet content()}
		{#if rows.length === 0}
			<p class="empty">No plugins registered</p>
		{:else}
			<ul class="plugin-list">
				{#each rows as { row, status, error } (row.name)}
					{@const relationship = relationships.find((r) => r.name === row.name)}
					<li class="plugin-item">
						<div class="plugin-item__main">
							<i class={statusIcon(status)} style={`color: ${statusColor(status)}`}></i>
							<span class="plugin-name">{row.name}</span>
							<span class="plugin-kind"
								>{row.kind}{row.activation ? ` · ${row.activation}` : ''}</span
							>
							{#if error}
								<span class="plugin-error" title={error}>error</span>
							{/if}
							{#if row.kind === 'interpreter'}
								<button
									type="button"
									class="plugin-assign"
									title="Assign to a project"
									onclick={(e) => openInterpreterAssignMenu(row.id, e.currentTarget)}
								>
									<i class="fa-solid fa-diagram-project"></i>
								</button>
							{/if}
						</div>
						{#if relationship && (relationship.supports.length > 0 || relationship.dependencyOf.length > 0)}
							<div class="plugin-relationships">
								{#if relationship.supports.length > 0}
									<span>Supports: {relationship.supports.map((s) => s.name).join(', ')}</span>
								{/if}
								{#if relationship.dependencyOf.length > 0}
									<span>Dependency of: {relationship.dependencyOf.join(', ')}</span>
								{/if}
							</div>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}

		{#if installing}
			<form
				class="plugin-install"
				onsubmit={(e) => {
					e.preventDefault();
					handleRegister((e as SubmitEvent).submitter as HTMLElement | null);
				}}
			>
				<input
					type="text"
					bind:value={formName}
					placeholder="name"
					class="plugin-install__input"
				/>
				<select bind:value={formKind} class="plugin-install__select">
					<option value="utility">Utility</option>
					<option value="interpreter">Interpreter</option>
				</select>
				{#if formKind === 'utility'}
					<select bind:value={formActivation} class="plugin-install__select">
						<option value="lazy">Lazy</option>
						<option value="eager">Eager</option>
					</select>
				{/if}
				<input
					type="text"
					bind:value={formWasmUrl}
					placeholder="wasm URL"
					class="plugin-install__input plugin-install__input--wide"
				/>
				<details class="plugin-install__advanced">
					<summary>Advanced: manifest JSON</summary>
					<textarea
						bind:value={formManifestJson}
						placeholder={'{ "wasm": [{ "url": "..." }], "provides": {...}, "capabilities": {...} }'}
						class="plugin-install__json"
					></textarea>
				</details>
				{#if formError}
					<div class="plugin-install__error">{formError}</div>
				{/if}
				<div class="plugin-install__actions">
					<button type="submit" class="plugin-install__btn">Register</button>
					<button
						type="button"
						onclick={resetForm}
						class="plugin-install__btn plugin-install__btn--cancel">✕</button
					>
				</div>
			</form>
		{/if}
	{/snippet}
</Panel>

<style lang="scss">
	@use '_index' as *;

	.empty {
		padding: $x-space-sm;
		color: var(--color-text-muted);
		@include fonts-stack('Satoshi-Light', sans);
		font-size: $x-font-size-xs;
	}

	.plugin-list {
		list-style: none;
		padding: 0;
		margin: 0;
	}

	.plugin-item {
		display: flex;
		flex-direction: column;
		padding: $x-space-xs $x-space-sm;
		cursor: pointer;

		&:hover {
			background: var(--color-surface-alt);
		}

		.plugin-item__main {
			display: flex;
			align-items: center;
			gap: $x-space-xs;
		}

		.plugin-name {
			@include fonts-stack('Satoshi-Regular', sans);
			font-size: $x-font-size-xs;
			color: var(--color-text);
		}

		.plugin-kind {
			@include fonts-stack('Satoshi-Light', sans);
			font-size: $x-font-size-xs;
			color: var(--color-text-muted);
		}

		.plugin-error {
			margin-left: auto;
			font-size: $x-font-size-xs;
			color: var(--color-danger);
		}

		.plugin-assign {
			margin-left: auto;
			padding: 2px 4px;
			border: none;
			background: transparent;
			color: var(--color-text-muted);
			cursor: pointer;
			font-size: $x-font-size-xs;

			&:hover {
				color: var(--color-primary);
			}
		}

		.plugin-relationships {
			display: flex;
			flex-direction: column;
			gap: 2px;
			margin-top: 2px;
			padding-left: calc($x-font-size-lg + $x-space-xs);
			@include fonts-stack('Satoshi-Light', sans);
			font-size: $x-font-size-xs;
			color: var(--color-text-muted);
		}
	}

	.plugin-install {
		display: flex;
		flex-wrap: wrap;
		gap: calc($x-space-xs / 2);
		padding: $x-space-xs;
		align-items: center;
		border-top: 1px solid var(--color-panel-header-border);

		&__input {
			font-size: $x-font-size-xs;
			padding: 2px 4px;
			width: 10ch;
			min-width: 0;

			&--wide {
				width: 16ch;
				flex: 1 1 auto;
			}
		}

		&__select {
			font-size: $x-font-size-xs;
			padding: 2px 4px;
		}

		&__advanced {
			flex: 1 1 100%;
			order: 10;
			font-size: $x-font-size-xs;
			color: var(--color-text-muted);

			summary {
				cursor: pointer;
			}
		}

		&__json {
			width: 100%;
			min-height: 4rem;
			font-size: $x-font-size-xs;
			font-family: monospace;
			margin-top: calc($x-space-xs / 2);
		}

		&__error {
			flex: 1 1 100%;
			order: 11;
			font-size: $x-font-size-xs;
			color: var(--color-danger);
		}

		&__actions {
			display: flex;
			gap: calc($x-space-xs / 2);
			order: 12;
		}

		&__btn {
			font-size: $x-font-size-xs;
			padding: 2px 6px;
			border: 1px solid var(--color-text-muted);
			background: var(--color-pure);
			color: var(--color-text);
			cursor: pointer;

			&--cancel {
				border-color: transparent;
			}
		}
	}
</style>
