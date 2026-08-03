<script lang="ts">
	// The one shared "this value is a token" chip for the Render panel. Written once and reused by
	// StyleField + every composite field (Color/Weight/Arrange/Resize) so the token/literal
	// distinction reads identically everywhere, instead of each inputType branch inventing its own
	// chrome (today only StyleField's plain-text fallback showed anything at all). Reuses the same
	// icon-swatch + alias grammar the Tokens panel (Variables.svelte) and StyleField's old
	// `token-pill` already established: a shape/color icon tinted by the resolved scalar, the alias
	// as the label, and - when detachable - a click-to-detach affordance.
	import { iconFromResolvedScalar, isColorScalar } from './token-utils.ts';

	type TokenBadgeProps = {
		alias: string | null;
		// The token's resolved scalar (e.g. "oklch(...)" / "16px"), used only to tint the icon.
		value?: string | null;
		// When provided, renders a detach button. Omit for a read-only badge.
		onDetach?: () => void;
	};

	let { alias, value, onDetach }: TokenBadgeProps = $props();
</script>

<span
	class="token-badge"
	style="--color-icon: {value ?? 'transparent'}"
	title="Token: {alias ?? 'token'} - editing changes every use of this token"
>
	<i
		class="fa-solid {iconFromResolvedScalar(value)} token-badge__icon"
		class:token-badge__icon--color={isColorScalar(value)}
	></i>
	<span class="token-badge__alias">{alias ?? 'token'}</span>
	{#if onDetach}
		<button
			type="button"
			class="token-badge__detach"
			title="Detach to a literal value (leaves the token untouched)"
			onclick={(e) => {
				e.stopPropagation();
				onDetach?.();
			}}
		>
			<i class="fa-solid fa-link-slash"></i>
		</button>
	{/if}
</span>

<style lang="scss">
	@use '_index' as *;

	.token-badge {
		display: inline-flex;
		align-items: center;
		gap: $x-space-xs;
		min-width: 0;
		color: var(--color-primary);
		font-size: $x-font-size-sm;

		&__icon {
			flex-shrink: 0;

			&--color {
				-webkit-text-stroke: 1px black;
				color: var(--color-icon, var(--color-text));
			}
		}

		&__alias {
			min-width: 0;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		&__detach {
			all: unset;
			flex-shrink: 0;
			cursor: pointer;
			display: inline-flex;
			align-items: center;
			justify-content: center;
			padding: calc($x-space-xs / 2);
			border-radius: 2px;
			font-size: $x-font-size-xs;
			color: var(--color-add-var-text);

			&:hover {
				background: var(--color-surface-alt);
				color: var(--color-text);
			}
		}
	}
</style>
