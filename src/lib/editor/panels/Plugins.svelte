<script lang="ts">
	import type { ContextMenuContentGenerator } from '$lib/components/contextMenu.js';
	import Panel from '../Panel.svelte';
	import type { PluginManager } from '$lib/plugins/manager.svelte.js';

	let { manager }: { manager: PluginManager | null } = $props();

	const pluginPanelContextMenu: ContextMenuContentGenerator = () => {
		return [
			{
				name: 'import_plugin',
				displayText: 'Import Plugin',
				icon: 'fa-solid fa-microchip',
				onClick: () => {}
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
</script>

<Panel name="Plugins" tooltip="Plugins" contextMenuContent={pluginPanelContextMenu}>
	{#snippet content()}
		{#if !manager || manager.plugins.length === 0}
			<p class="empty">No plugins loaded</p>
		{:else}
			<ul class="plugin-list">
				{#each manager.plugins as plugin (plugin.name)}
					<li class="plugin-item">
						<i class={statusIcon(plugin.status)} style={`color: ${statusColor(plugin.status)}`}></i>
						<span class="plugin-name">{plugin.name}</span>
						{#if plugin.error}
							<span class="plugin-error" title={plugin.error}>error</span>
						{/if}
					</li>
				{/each}
			</ul>
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
		align-items: center;
		gap: $x-space-xs;
		padding: $x-space-xs $x-space-sm;
		cursor: pointer;

		&:hover {
			background: var(--color-surface-alt);
		}

		.plugin-name {
			@include fonts-stack('Satoshi-Regular', sans);
			font-size: $x-font-size-xs;
			color: var(--color-text);
		}

		.plugin-error {
			margin-left: auto;
			font-size: $x-font-size-xs;
			color: var(--color-danger);
		}
	}
</style>
