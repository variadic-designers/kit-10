<script lang="ts">
	import { tick } from 'svelte';
	import { contextMenu } from '$lib/components/contextMenu';
	import { tokenIcon, isColorValue } from './token-utils.ts';
	import type { FieldUpdate } from '$lib/plugins/types.js';

	type StyleFieldProps = {
		key: string;
		displayText: string;
		sourceLayerId?: string | null;
		kitId?: string | null;
		kitIcon?: string;
		conditionCount?: number;
		isToken?: boolean;
		tokenAlias?: string | null;
		value?: string | null;
		highlighted?: boolean;
		position?: 'top' | 'bottom' | 'mid';
		onFieldUpdate?: (update: FieldUpdate) => void;
	};

	let {
		key,
		displayText,
		sourceLayerId,
		kitId,
		kitIcon = 'fa-circle',
		conditionCount = 0,
		isToken,
		tokenAlias,
		value,
		highlighted = $bindable(false),
		position = 'mid',
		onFieldUpdate
	}: StyleFieldProps = $props();

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

	function conditionColor(count: number): string {
		if (count === 0) return 'var(--color-text-muted)';
		const max = 5;
		const t = Math.min(count / max, 1);
		const L = 0.65;
		const C = 0.13;
		const hue = 250 - 250 * t;
		return `oklch(${L} ${C} ${hue})`;
	}

	const editValue = $state({
		now: false,
		content: ''
	});

	let inputRef: HTMLInputElement | undefined = $state();

	async function startEditing() {
		editValue.now = true;
		editValue.content = value ?? '';

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
		const trimmed = editValue.content.trim();

		if (!onFieldUpdate) {
			console.log(`Update ${key}: ${trimmed} on layer ${sourceLayerId} (no callback)`);
			return;
		}

		if (!sourceLayerId) {
			console.warn(`Cannot update ${key}: no source layer`);
			return;
		}

		if (trimmed !== value) {
			onFieldUpdate({
				layerId: sourceLayerId,
				property: key,
				value: trimmed
			});
		}
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
			class="option124__track"
			style="--track-color: {conditionColor(conditionCount)}"
			aria-label="Tokenized property"
			title={tokenAlias ?? 'token'}
			type="button"
		>
			<i class="fa-solid {kitIcon}"></i>
		</button>
	{:else}
		<button
			class="option124__track"
			style="--track-color: {conditionColor(conditionCount)}"
			class:option124__track--empty={!value}
			aria-label="Literal property"
			title="literal"
			type="button"
		>
			<i class="fa-solid {kitIcon}"></i>
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
					<i
						class="fa-solid {tokenIcon(value)} token-pill__icon"
						class:token-pill__icon--color={isColorValue(value)}
					></i>
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
			font-size: $x-font-size-sm;
			color: var(--track-color, var(--color-text));

			&:focus {
				filter: saturate(1.2);
			}

			&--empty {
				color: var(--color-surface-alt);
			}

			@include layout-respond-max('lg') {
				font-size: $x-font-size-md;
			}
		}

		&__style-name {
			flex: 1;
			min-width: 0;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
			padding-inline: calc($x-space-xs / 2);
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
			padding: calc($x-space-xs / 2) $x-space-sm;
			text-align: left;
			flex-basis: 40%;
			flex-shrink: 1;
			min-width: 0;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
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

			.token-pill__icon--color {
				-webkit-text-stroke: 1px black;
				color: var(--color-icon, var(--color-text));
			}

			&--token {
				color: var(--color-primary);
			}

			&--dragged-over {
				background: var(--color-surface-alt);
			}

			&::placeholder {
				font-size: $x-font-size-md;
			}

			&--new {
				cursor: pointer;
				text-align: center;
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
