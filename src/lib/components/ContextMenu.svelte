<script lang="ts">
	import { contextMenuState, closeContextMenu, type MenuItem } from './contextMenuStore';

	let menuRef: HTMLElement | undefined = $state();

	function handleWindowClick(e: MouseEvent) {
		if (menuRef && !menuRef.contains(e.target as Node)) closeContextMenu();
	}

	function handleAction(item: MenuItem) {
		item.onClick?.($contextMenuState.target);
		closeContextMenu();
	}

	function handleMenuKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			closeContextMenu();
		}
	}
</script>

<svelte:window on:click={handleWindowClick} />

{#if $contextMenuState.show}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="context-menu"
		bind:this={menuRef}
		style="top: {$contextMenuState.pos.y}px; left: {$contextMenuState.pos.x}px"
		role="menu"
		onkeydown={handleMenuKeydown}
	>
		<ul>
			{#each $contextMenuState.options as item}
				{#if item === 'hr'}
					<hr />
				{:else}
					<li role="menuitem">
						<button
							title={item.description}
							class="menu-btn"
							class:menu-btn--destructive={item.tone === 'destructive'}
							disabled={item.disabled}
							onclick={() => handleAction(item)}
						>
							{#if item.icon}
								<i class={item.icon}></i>
							{/if}
							<span>{item.displayText ?? item.name}</span>
						</button>
					</li>
				{/if}
			{/each}
		</ul>
	</div>
{/if}

<style lang="scss">
	@use '_index' as *;

	.context-menu {
		position: absolute;
		background: var(--color-pure);
		border: 1px solid var(--color-surface);
		border-radius: 0 $x-space-xs $x-space-xs $x-space-xs;
		box-shadow: 0px 0px $x-space-xs var(--color-bg);
		z-index: 9999;
		padding: 2px;
		min-width: $x-space-xxxl;
	}

	.context-menu ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.context-menu li {
		display: block;
	}

	.menu-btn {
		width: 100%;
		text-align: left;
		padding: $x-space-xs calc($x-space-xs / 2);
		background: transparent;
		border: none;
		display: flex;
		align-items: center;
		gap: $x-space-xs;
		color: var(--color-text);
		cursor: pointer;
		font-size: $x-font-size-sm;
		font-weight: 600;
		@include fonts-stack('Satoshi-Regular', sans-serif);
		letter-spacing: 1px;
		border-inline: 2px solid var(--color-pure);

		i {
			flex-basis: $x-space-md;
		}

		&:disabled {
			cursor: not-allowed;
			text-decoration: line-through;
			text-decoration-color: var(--color-pure);
			color: var(--color-text-muted);
		}

		&:hover:not(&:disabled) {
			color: var(--color-primary);
			background: var(--color-surface-alt);
			border-left: 2px solid var(--color-primary);
		}

		&--destructive {
			&:hover:not(&:disabled) {
				color: var(--color-danger);
				border-left: 2px solid var(--color-danger);
			}
			i {
				color: var(--color-danger);
			}
		}
	}

	hr {
		border: none;
		border-bottom: 1px solid var(--color-surface);
		margin: calc($x-space-xs / 2) 0;
	}
</style>
