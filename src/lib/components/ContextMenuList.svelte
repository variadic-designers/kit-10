<script lang="ts">
	import {
		closeContextMenu,
		resolveContent,
		type ContextMenuContent,
		type MenuItem
	} from './contextMenuStore.js';
	import ContextMenuBox from './ContextMenuBox.svelte';
	// Self-import for recursion (submenus of submenus) -- svelte:self is deprecated.
	import ContextMenuList from './ContextMenuList.svelte';

	let {
		options,
		target
	}: {
		options: ContextMenuContent;
		target: HTMLElement | null;
	} = $props();

	// Small gap between a trigger item and its popped-out submenu.
	const SUBMENU_GAP = 4;
	// Long enough that sweeping the mouse across the list on the way to a different item
	// doesn't pop open every submenu it passes over; short enough to still feel responsive.
	const SUBMENU_OPEN_DELAY = 150;
	// Grace period before actually closing -- covers the moment the mouse crosses the gap
	// between the trigger row and the submenu box (which is position:fixed, so geometrically
	// outside the trigger's <li>/<ul> even though it's a DOM descendant of it).
	const SUBMENU_CLOSE_DELAY = 200;

	let openIndex = $state<number | null>(null);
	let submenuPos = $state({ x: 0, y: 0 });
	let submenuOptions = $state<ContextMenuContent>([]);
	let openTimer: ReturnType<typeof setTimeout> | null = null;
	let closeTimer: ReturnType<typeof setTimeout> | null = null;

	function cancelClose() {
		if (closeTimer) {
			clearTimeout(closeTimer);
			closeTimer = null;
		}
	}

	function scheduleClose() {
		cancelClose();
		closeTimer = setTimeout(() => {
			openIndex = null;
		}, SUBMENU_CLOSE_DELAY);
	}

	function openSubmenu(index: number, item: MenuItem, el: HTMLElement) {
		const rect = el.getBoundingClientRect();
		submenuPos = { x: rect.right + SUBMENU_GAP, y: rect.top };
		submenuOptions = resolveContent(item.submenu!, target);
		openIndex = index;
	}

	function handleItemEnter(index: number, item: MenuItem, el: HTMLElement) {
		cancelClose();
		if (openTimer) {
			clearTimeout(openTimer);
			openTimer = null;
		}

		if (!item.submenu || item.disabled) {
			openIndex = null;
			return;
		}

		if (openIndex === index) return;

		openTimer = setTimeout(() => openSubmenu(index, item, el), SUBMENU_OPEN_DELAY);
	}

	function handleListLeave() {
		if (openTimer) {
			clearTimeout(openTimer);
			openTimer = null;
		}
		scheduleClose();
	}

	function handleAction(item: MenuItem) {
		const result = item.onClick?.(target);
		closeContextMenu();
		if (result && typeof result === 'object' && 'link' in result) {
			window.open(result.link, result.tab ?? '_blank');
		}
	}

	function handleItemClick(index: number, item: MenuItem, el: HTMLElement) {
		if (item.submenu) {
			if (openTimer) clearTimeout(openTimer);
			cancelClose();
			openSubmenu(index, item, el);
			return;
		}
		handleAction(item);
	}
</script>

<ul onmouseleave={handleListLeave}>
	{#each options as item, index}
		{#if item === 'hr'}
			<hr />
		{:else}
			<li role="none">
				<button
					title={item.description}
					class="menu-btn"
					class:menu-btn--destructive={item.tone === 'destructive'}
					disabled={item.disabled}
					role="menuitem"
					aria-haspopup={item.submenu ? 'menu' : undefined}
					aria-expanded={item.submenu ? openIndex === index : undefined}
					onmouseenter={(e) => handleItemEnter(index, item, e.currentTarget)}
					onclick={(e) => handleItemClick(index, item, e.currentTarget)}
				>
					{#if item.icon}
						<i class={item.icon}></i>
					{/if}
					<span>{item.displayText ?? item.name}</span>
					{#if item.submenu}
						<i class="fa-solid fa-chevron-right submenu-caret"></i>
					{/if}
				</button>

				{#if item.submenu && openIndex === index}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div class="submenu-anchor" onmouseenter={cancelClose} onmouseleave={scheduleClose}>
						<ContextMenuBox rawPos={submenuPos}>
							<ContextMenuList options={submenuOptions} {target} />
						</ContextMenuBox>
					</div>
				{/if}
			</li>
		{/if}
	{/each}
</ul>

<style lang="scss">
	@use '_index' as *;

	ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	li {
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
		@include fonts-stack('Satoshi-Regular', sans);
		letter-spacing: 1px;
		border-inline: 2px solid var(--color-pure);

		i {
			flex-basis: $x-space-md;
		}

		.submenu-caret {
			flex: 0 0 auto;
			margin-left: auto;
			font-size: 0.75em;
			opacity: 0.6;
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
