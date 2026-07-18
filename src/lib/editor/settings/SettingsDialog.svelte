<script lang="ts">
	import type { Api } from 'manager';
	import type { PluginManager } from '$lib/plugins/manager.svelte.js';
	import { SETTINGS_TABS } from './tabs.js';
	import type { SettingsContext, EditorActivity } from './context.js';

	let {
		open = $bindable(),
		api,
		editorActivity,
		pluginManager
	}: {
		open: boolean;
		api: Api;
		editorActivity: EditorActivity;
		pluginManager: PluginManager | null;
	} = $props();

	let dialog: HTMLDialogElement | undefined = $state();
	let activeTabId = $state(SETTINGS_TABS[0].id);

	$effect(() => {
		if (!dialog) return;
		if (open && !dialog.open) dialog.showModal();
		else if (!open && dialog.open) dialog.close();
	});

	const activeTab = $derived(SETTINGS_TABS.find((t) => t.id === activeTabId) ?? SETTINGS_TABS[0]);
	const ActiveComponent = $derived(activeTab.component);

	// Sidebar sections in first-seen order, each with its tabs.
	const sections = $derived.by(() => {
		const map = new Map<string, typeof SETTINGS_TABS>();
		for (const t of SETTINGS_TABS) {
			const list = map.get(t.section) ?? [];
			list.push(t);
			map.set(t.section, list);
		}
		return [...map.entries()];
	});

	const ctx: SettingsContext = $derived({
		api,
		editorActivity,
		pluginManager,
		close: () => (open = false)
	});
</script>

<dialog
	bind:this={dialog}
	class="settings"
	onclose={() => (open = false)}
	onclick={(e) => {
		if (e.target === dialog) open = false;
	}}
>
	<div class="shell">
		<nav class="sidebar">
			<div class="side-head">Settings</div>
			{#each sections as [sectionName, tabs] (sectionName)}
				<div class="section">
					<div class="section-label">{sectionName}</div>
					{#each tabs as tab (tab.id)}
						<button
							class="tab-btn"
							class:active={tab.id === activeTabId}
							onclick={() => (activeTabId = tab.id)}
						>
							<i class={tab.icon}></i>
							<span>{tab.label}</span>
						</button>
					{/each}
				</div>
			{/each}
		</nav>

		<div class="content">
			<header>
				<h2>{activeTab.label}</h2>
				<button class="close" title="Close" onclick={() => (open = false)}>
					<i class="fa-solid fa-xmark"></i>
				</button>
			</header>
			<div class="pane">
				<ActiveComponent {ctx} />
			</div>
		</div>
	</div>
</dialog>

<style lang="scss">
	@use '_index' as *;

	.settings {
		// The app's global `* { margin: 0 }` clobbers the UA `margin: auto` that centers a modal
		// <dialog>, pinning it top-left -- restore it explicitly.
		margin: auto;
		padding: 0;
		border: 1px solid var(--color-bg);
		border-radius: $x-space-xs;
		background: var(--color-panel-header-fill);
		color: var(--color-pure-alt);
		width: min(880px, 92vw);
		height: min(620px, 88vh);
		overflow: hidden;

		&::backdrop {
			background: rgba(0, 0, 0, 0.45);
		}
	}

	.shell {
		display: grid;
		grid-template-columns: minmax(160px, 220px) 1fr;
		height: 100%;
	}

	.sidebar {
		background: var(--color-surface);
		border-right: 1px solid var(--color-bg);
		overflow-y: auto;
		padding-bottom: $x-space-md;

		.side-head {
			@include fonts-stack('Satoshi-Regular', sans);
			font-weight: 600;
			letter-spacing: 1px;
			color: var(--color-text);
			padding: $x-space-sm;
			border-bottom: 1px solid var(--color-bg);
		}

		.section {
			padding: $x-space-xs 0;

			.section-label {
				font-size: $x-font-size-sm;
				color: var(--color-text-muted);
				text-transform: uppercase;
				letter-spacing: 1px;
				padding: $x-space-xs $x-space-sm calc($x-space-xs / 2);
				@include fonts-stack('Satoshi-Light', sans);
			}
		}

		.tab-btn {
			display: flex;
			align-items: center;
			gap: $x-space-xs;
			width: 100%;
			border: unset;
			background: transparent;
			text-align: left;
			padding: calc($x-space-xs / 2) $x-space-sm;
			color: var(--color-text);
			font-size: $x-font-size-md;
			@include fonts-stack('Satoshi-Regular', sans);
			cursor: pointer;

			i {
				width: 1.2em;
				text-align: center;
				color: var(--color-text-muted);
			}

			&:hover {
				color: var(--color-primary);
			}

			&.active {
				background: var(--color-surface-alt);
				color: var(--color-primary);

				i {
					color: var(--color-primary);
				}
			}
		}
	}

	.content {
		display: flex;
		flex-direction: column;
		min-width: 0;
		min-height: 0;

		header {
			display: flex;
			align-items: center;
			justify-content: space-between;
			padding: $x-space-sm;
			border-bottom: 1px solid var(--color-bg);

			h2 {
				@include fonts-stack('Satoshi-Regular', sans);
				font-weight: 600;
				color: var(--color-text);
				font-size: $x-font-size-lg;
			}

			.close {
				border: unset;
				background: transparent;
				color: var(--color-text-muted);
				cursor: pointer;
				padding: $x-space-xs;

				&:hover {
					color: var(--color-primary);
				}
			}
		}

		.pane {
			padding: $x-space-md;
			overflow-y: auto;
			flex: 1;
		}
	}
</style>
