<script lang="ts">
	import { contextMenuState, closeContextMenu } from './contextMenuStore';

	type Link = { link: string; tab?: '_blank' };

	type MenuItem = {
		name: string;
		displayText?: string;
		icon?: string;
		onClick?: (target: HTMLElement | null) => void | Link;
	};

	let menuRef: HTMLElement | undefined = $state();
	let menu = $state({ w: 0, h: 0 });
	let browser = $state({ w: 0, h: 0 });

	// Automatically close when clicking outside
	function handleWindowClick(e: MouseEvent) {
		if (menuRef && !menuRef.contains(e.target as Node)) closeContextMenu();
	}

	function handleAction(item: MenuItem) {
		const result = item.onClick?.($contextMenuState.target);

		if (result && 'link' in result) {
			window.open(result.link, result.tab ?? '_self');
		}

		closeContextMenu();
	}
</script>

{#if $contextMenuState.show}
	<div
		class="context-menu"
		bind:this={menuRef}
		style="top: {$contextMenuState.pos.y}px; left: {$contextMenuState.pos.x}px"
		role="menu"
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
							class:menu-btn--disabled={item.disabled}
							disabled={item.disabled}
							class:menu-btn--destructive={item.tone === 'destructive'}
							onclick={() => handleAction(item)}
						>
							<i class={item.icon}></i>
							{item.displayText}
						</button>
					</li>
				{/if}
			{/each}
		</ul>
	</div>
{/if}

<svelte:window on:click={handleWindowClick} />

<style lang="scss">
	@use '_index' as *;

	.context-menu {
		position: absolute;
		background: var(--color-surface);
		border: 1px solid var(--color-bg);
		border-radius: 0 $x-space-xs $x-space-xs $x-space-xs;
		box-shadow: 0px 0px $x-space-xs var(--color-bg);
		z-index: 999;
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
		padding: $x-space-xs $x-space-sm;
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
		border-left: 2px solid var(--color-surface);
		border-right: 1px solid var(--color-surface);

		display: flex;

		i {
			flex-basis: $x-space-md;
		}

		&:disabled {
			cursor: not-allowed;
		}

		&:hover:not(&:disabled) {
			color: var(--color-primary);
		}
		&--destructive {
			&:hover {
				color: var(--color-danger);
			}
			i {
				color: var(--color-danger);
			}
		}

		&:not(&:disabled):active {
			background: var(--color-surface-alt);
			border-left: 2px solid var(--color-primary);
		}

		&--destructive:active {
			border-left: 2px solid var(--color-danger);
		}

		&:disabled {
			color: var(--color-text-muted);
		}
	}

	hr {
		border: none;
		border-bottom: 1px solid var(--color-bg);
		margin: calc($x-space-xs / 2) 0;
	}
</style>
