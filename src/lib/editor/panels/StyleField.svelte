<script lang="ts">
	import { tick } from 'svelte';

	type StyleFieldProps = {
		key: string;
		displayText: string;
		sourceLayerId?: string | null;
		isToken?: boolean;
		tokenAlias?: string | null;
		value?: string | null;
		highlighted?: boolean;
		position?: 'top' | 'bottom' | 'mid';
	};

	let {
		key,
		displayText,
		sourceLayerId,
		isToken,
		tokenAlias,
		value,
		highlighted = $bindable(false),
		position = 'mid'
	}: StyleFieldProps = $props();

	import { contextMenu } from '$lib/components/contextMenu';

	function tokenIcon(v: string | null | undefined): string {
		if (!v) return 'fa-question';
		if (v.startsWith('#') || v.startsWith('rgb') || v.startsWith('hsl')) return 'fa-square-full';
		if (/^\d/.test(v) && (v.includes('px') || v.includes('rem') || v.includes('em') || v.includes('%'))) return 'fa-arrows-left-right-to-line';
		return 'fa-circle';
	}

	function isColorValue(v: string | null | undefined): boolean {
		if (!v) return false;
		return v.startsWith('#') || v.startsWith('rgb') || v.startsWith('hsl');
	}

	const menu = () => {
		return [
			{
				name: 'tokenize',
				description: 'Save as Token',
				displayText: 'Tokenize',
				icon: 'fa-solid fa-square-binary',
				disabled: !!isToken
			},
			{
				name: 'unwrap',
				description: '',
				displayText: 'Unwrap',
				icon: 'fa-solid fa-box-open',
				disabled: true
			},
			'hr',
			{
				name: 'remove',
				description: 'Remove entry',
				displayText: 'Remove',
				icon: 'fa-solid fa-trash',
				destructive: true
			}
		];
	};

	const editValue = $state({
		now: false,
		content: ''
	});

	let inputRef: HTMLInputElement | undefined = $state();

	async function startEditing() {
		editValue.now = true;
		editValue.content = '';

		await tick();

		if (inputRef) {
			inputRef.focus();
			inputRef.select();
		}
	}

	function cancelEditing() {
		editValue.now = false;
		editValue.content = '';
	}

	function confirmUpdateStyle() {
		editValue.now = false;
		console.log(`Update ${key}: ${editValue.content} on layer ${sourceLayerId}`);
	}
</script>

<div
	class="option124"
	class:option124--top={position === 'top'}
	class:option124--bottom={position === 'bottom'}
	class:option124--mid={position !== 'top' && position !== 'bottom'}
>
	<button
		class="option124__style-name"
		class:option124__style-name--highlighted={highlighted}
		use:contextMenu={menu}
		onclick={() => {
			highlighted = !highlighted;
		}}
		draggable={highlighted}
	>
		{displayText ?? key}
	</button>

	{#if isToken}
		<button
			class="option124__track option124__track--token"
			aria-label="Tokenized property"
			title="{tokenAlias ?? 'token'}"
			type="button"
		>
			<i class="fa-solid fa-diamond" style="font-size: 0.6em;"></i>
		</button>
	{:else}
		<button
			class="option124__track"
			aria-label="Literal property"
			title="literal"
			type="button"
		>
			<i class="fa-solid fa-minus"></i>
		</button>
	{/if}

	{#if editValue.now}
		<input
			type="text"
			title="Edit Value"
			bind:this={inputRef}
			bind:value={editValue.content}
			placeholder={value ?? ''}
			class="option124__value option124__value--edit"
			onblur={() => cancelEditing()}
			onkeydown={(e: KeyboardEvent) => {
				if (e.key === 'Enter') {
					confirmUpdateStyle();
				} else if (e.key === 'Escape') {
					cancelEditing();
				}
			}}
			use:contextMenu={menu}
		/>
	{:else}
		<button
			title={isToken ? `Token: ${tokenAlias}` : (value ?? 'Add value')}
			class="option124__value"
			class:option124__value--new={!value}
			class:option124__value--token={isToken}
			onclick={() => startEditing()}
			use:contextMenu={menu}
		>
			{#if isToken}
				<span class="token-pill" style="--color-icon: {value ?? 'transparent'}">
					<i class="fa-solid {tokenIcon(value)} token-pill__icon" class:token-pill__icon--color={isColorValue(value)}></i>
					{tokenAlias ?? 'token'}
				</span>
			{:else if value}
				<span>{value}</span>
			{:else}
				+
			{/if}
		</button>
	{/if}
</div>

<style lang="scss">
	@use '_index' as *;

	button,
	input {
		all: unset;
	}

	.option124 {
		display: flex;
		justify-content: space-between;
		align-items: center;
		user-select: none;
		display: flex;
		align-items: stretch;
		font-weight: 600;
		padding-inline: $x-space-sm;

		@include layout-respond('md') {
			font-size: $x-font-size-sm;
			letter-spacing: 1px;
			gap: $x-space-xs;
		}

		@include layout-respond-max('xl') {
			font-size: $x-font-size-sm;
		}

		&__track {
			text-align: center;
			font-size: $x-font-size-md;
			-webkit-text-stroke-width: 2px;
			color: var(--color-diamond-color--tracked);
			-webkit-text-stroke-color: var(--color-diamond-border--tracked);

			&:focus {
				filter: saturate(1.2);
			}

			&--token {
				color: var(--color-primary);
				-webkit-text-stroke-color: var(--color-primary);
			}

			&--tracked--empty {
				rotate: 45deg;
			}

			@include layout-respond-max('lg') {
				font-size: $x-font-size-md;
			}
		}

		&__style-name {
			flex-grow: 1;
			padding-inline: calc($x-space-xs / 2);
			text-align: justify;
			text-transform: capitalize;

			@include layout-respond('lg') {
				padding-left: $x-space-xs;
			}

			&:hover {
				background: var(--color-panel-header-fill);
			}

			&--highlighted {
				background: var(--color-surface-alt);
			}
		}

		&__value {
			all: unset;
			padding: calc($x-space-xs / 2);
			text-align: center;
			flex-basis: 60%;
			flex-shrink: 1;
			position: relative;
			border-radius: 1px;
			color: var(--color-add-var-text);
			font-size: $x-font-size-sm;
			background:
				radial-gradient(closest-side, var(--color-panel-header-fill) 90%, transparent 100%) 0 0/ 3px
					3px,
				var(--color-panel-header-border);
			background: var(--color-panel-header-fill);

			&:has(span.token-pill) {
				background: var(--color-surface-alt);
			}

			span.token-pill {
				color: var(--color-primary);
				display: inline-flex;
				align-items: center;
				gap: $x-space-xs;
			}

			.token-pill__icon {
				font-size: $x-font-size-sm;
			}

			.token-pill__icon--color {
				-webkit-text-stroke: 1px black;
				color: var(--color-icon, var(--color-text));
			}

			&--token {
				color: var(--color-primary);
			}

			&--dragged-over {
				background: var(--color-surface-alt);

				&:has(span.token-pill) {
					background: var(--color-pure);
				}
			}

			&::placeholder {
				font-size: $x-font-size-md;
			}

			&--new {
				cursor: pointer;
			}

			&:hover {
				background: var(--color-surface-alt);
				color: var(--color-text);
			}

			&--edit {
				background: var(--color-pure);

				&:hover {
					background: var(--color-pure);
					color: var(--color-primary);
				}
			}
		}

		$border-rad: calc($x-space-xs / 2);

		&--top > * {
			border-radius: $border-rad $border-rad 0 0;
		}
		&--bottom > * {
			border-radius: 0 0 $border-rad $border-rad;
		}

		&--top > *,
		&--mid > * {
			border-bottom: unset;
		}
	}
</style>