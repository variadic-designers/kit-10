<script lang="ts" module>
	// The subset of Styles.svelte's track() result every field row needs to draw its indicator dot.
	export type FieldRowTrack = {
		kitIcon: string;
		keys: string[];
		conditionValues: { axisId: string; value: string }[];
	};
</script>

<script lang="ts">
	// Shared row primitive for every Render-panel field (StyleField/WeightField/RadiusField/
	// PositionField/ColorField/ArrangeField/GridTracksField/ChildViewField) - a per-row version of
	// Panel.svelte's header+collapsible-content shape. Fixes the label/track-dot/value alignment
	// drift that came from each field hand-rolling its own header: every row renders the exact
	// same header markup here (label -> optional TokenBadge -> track dot -> value), so the track
	// dot and value column land in the same place regardless of which field is being edited.
	//
	// A field with a `body` gets no separate chevron button - the value box itself becomes the
	// expand/collapse trigger (a chevron rides its own right edge), so the disclosure affordance
	// always reads from the same side the value column already occupies, never a separate column
	// before the label. A field with no `body` renders its valueSlot in a plain div instead (never
	// wrapped in a button), since that content is typically already interactive on its own
	// (an input, a segmented control) and nesting it inside another button is invalid HTML.
	import type { Snippet } from 'svelte';
	import { dropZone, type DragPayload } from '../dnd.svelte.ts';
	import { layerDotColor, trackTitle } from './layer-color.ts';
	import TokenBadge from './TokenBadge.svelte';

	type FieldRowProps = {
		label: string;
		// Overrides the plain-text label with custom interactive markup (StyleField's own
		// highlight/drag/context-menu button) - still occupies the same flex:1 slot.
		labelSnippet?: Snippet;
		track: FieldRowTrack;
		axisNameById?: Record<string, string>;
		// Defaults to "Tokenized property"/"Literal property"; a caller with more specific text
		// (e.g. "Weight source") can still override it.
		trackAriaLabel?: string;
		// StyleField-only: dims the track dot when the property has never been given a value.
		trackEmpty?: boolean;
		isToken?: boolean;
		tokenAlias?: string | null;
		tokenValue?: string | null;
		onDetachToken?: () => void;
		canDropToken?: (payload: DragPayload) => boolean;
		onDropToken?: (payload: DragPayload) => void;
		// Named valueSlot, not value - every caller has its own "value" prop/variable, and a
		// same-named snippet block shadows it (TDZ error: the snippet is a function binding in the
		// same scope as the rest of the component's script).
		valueSlot: Snippet;
		// A secondary, collapsible block for controls too big for the header (a segmented control,
		// a stepper, a picker, a list). Omit for a field that fits entirely in the header.
		body?: Snippet;
		expanded?: boolean;
	};

	let {
		label,
		labelSnippet,
		track,
		axisNameById = {},
		trackAriaLabel,
		trackEmpty = false,
		isToken = false,
		tokenAlias = null,
		tokenValue = null,
		onDetachToken,
		canDropToken,
		onDropToken,
		valueSlot,
		body,
		expanded = $bindable(true)
	}: FieldRowProps = $props();

	const trackColor = $derived(layerDotColor(track.keys, true));
	const title = $derived(trackTitle(track.conditionValues, axisNameById));
	const ariaLabel = $derived(
		trackAriaLabel ?? (isToken ? 'Tokenized property' : 'Literal property')
	);

	function toggleExpanded() {
		expanded = !expanded;
	}
</script>

<div class="field-row">
	<div
		class="field-row__header"
		use:dropZone={{
			accepts: 'token',
			canDrop: canDropToken ?? (() => false),
			onDrop: (p) => onDropToken?.(p)
		}}
	>
		{#if labelSnippet}
			{@render labelSnippet()}
		{:else}
			<span class="field-row__label">{label}</span>
		{/if}

		{#if isToken}
			<TokenBadge alias={tokenAlias} value={tokenValue} onDetach={onDetachToken} />
		{/if}

		<button
			class="field-row__track"
			class:field-row__track--empty={trackEmpty}
			style="--track-color: {trackColor}"
			aria-label={ariaLabel}
			{title}
			type="button"
		>
			<i class="fa-solid {track.kitIcon}"></i>
		</button>

		<!-- The value box itself is the expand/collapse trigger when there's a `body` to reveal -
		     no separate chevron button. A plain, non-interactive div otherwise, so a field with no
		     body (and whose valueSlot content is its own interactive control - an input, a
		     segmented control) never sits inside a redundant nested button. -->
		{#if body}
			<button
				type="button"
				class="field-row__value field-row__value--expander"
				aria-expanded={expanded}
				title={expanded ? 'Collapse' : 'Expand'}
				onclick={toggleExpanded}
			>
				<span class="field-row__value-content">{@render valueSlot()}</span>
				<i
					class="fa-solid fa-angle-right field-row__chevron"
					class:field-row__chevron--open={expanded}
				></i>
			</button>
		{:else}
			<div class="field-row__value">
				{@render valueSlot()}
			</div>
		{/if}
	</div>

	{#if body && expanded}
		<div class="field-row__body">
			{@render body()}
		</div>
	{/if}
</div>

<style lang="scss">
	@use '_index' as *;

	button {
		all: unset;
	}

	.field-row__header {
		&:global(.dnd-over) {
			outline: 1px dashed var(--color-primary);
			outline-offset: -1px;
		}

		display: flex;
		// Rows may wrap to a second line rather than cramming everything into one: a long label +
		// token badge + value control wraps gracefully instead of overflowing the panel, same as
		// the pre-unification .option124 behavior.
		flex-wrap: wrap;
		row-gap: 0;
		justify-content: space-between;
		align-items: center;
		gap: calc($x-space-xs / 2);
		padding: $x-space-xs $x-space-sm;
		font-weight: 600;
		user-select: none;

		@include layout-respond('md') {
			font-size: $x-font-size-sm;
			letter-spacing: 1px;
		}
	}

	.field-row__label {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		padding-inline: calc($x-space-xs / 2);
		text-transform: capitalize;
	}

	.field-row__track {
		flex: 0 0 auto;
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

	.field-row__value {
		flex-basis: 40%;
		flex-shrink: 1;
		min-width: 0;
	}

	// The value box doubling as the expand/collapse trigger: the chevron sits at ITS right edge
	// (not a separate button before the label), so every expandable row's disclosure affordance
	// reads from the same right-hand side the value column already occupies.
	.field-row__value--expander {
		all: unset;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: calc($x-space-xs / 2);
		flex-basis: 40%;
		flex-shrink: 1;
		min-width: 0;
		cursor: pointer;

		&:hover .field-row__chevron {
			color: var(--color-text);
		}
	}

	.field-row__value-content {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.field-row__chevron {
		flex: 0 0 auto;
		font-size: $x-font-size-xs;
		color: var(--color-text-muted);
		transition: rotate 150ms ease-out;

		&--open {
			rotate: 90deg;
		}
	}

	// One flat padding rhythm for the whole expanded body - sub-rows inside it (WeightField's
	// options, PositionField's mode row, RadiusField's stepper, ...) each carry their own
	// `padding-block: $x-space-xs` and rely on that shared rhythm for vertical spacing, rather
	// than a `gap`/`margin-top` per component, so every row (header or body) reads as the same
	// height regardless of which field is being edited.
	.field-row__body {
		padding-inline: $x-space-sm;
		padding-block-end: calc($x-space-xs / 2);
	}
</style>
