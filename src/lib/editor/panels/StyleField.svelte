<script lang="ts">
	import { tick } from 'svelte';
	import { contextMenu } from '$lib/components/contextMenu';
	import { iconFromResolvedScalar, isColorScalar } from './token-utils.ts';
	import { layerDotColor } from './layer-color.ts';
	import SuggestField from '$lib/components/SuggestField.svelte';
	import { dropZone } from '../dnd.svelte.ts';
	import { getVellumInstance, requestVellumRender } from '../vellum-instance.js';
	import { assetRegister } from '../assetStore.ts';
	import type { Api } from 'manager';
	import type { FieldUpdate, InputType, SuggestionSource } from '$lib/plugins/types.js';

	type StyleFieldProps = {
		key: string;
		displayText: string;
		sourceLayerId?: string | null;
		kitId?: string | null;
		kitIcon?: string;
		keys?: string[];
		conditionValues?: { axisId: string; value: string }[];
		isToken?: boolean;
		tokenAlias?: string | null;
		value?: string | null;
		highlighted?: boolean;
		position?: 'top' | 'bottom' | 'mid';
		axisNameById?: Record<string, string>;
		inputType?: InputType;
		suggestionsFrom?: SuggestionSource;
		spacingMode?: 'scalar' | 'box';
		// Optional hover explanation for the label button, e.g. ArrangeField's Gap/Cell Min
		// follow-ons -- distinct from the track dot's title, which explains the value's SOURCE
		// layer/condition rather than what the field itself does.
		labelTooltip?: string;
		api?: Api;
		projectId?: string | null;
		onFieldUpdate?: (update: FieldUpdate) => void;
		callUtilityPlugin?: (name: string, fn: string, payload: string) => Promise<unknown>;
	};

	let {
		key,
		displayText,
		sourceLayerId,
		kitId,
		kitIcon = 'fa-circle',
		keys = [],
		conditionValues = [],
		isToken,
		tokenAlias,
		value,
		highlighted = $bindable(false),
		position = 'mid',
		axisNameById = {},
		inputType,
		suggestionsFrom,
		spacingMode,
		labelTooltip,
		api,
		projectId,
		onFieldUpdate,
		callUtilityPlugin
	}: StyleFieldProps = $props();

	const menu = () => {
		return [
			{
				name: 'tokenize',
				description: 'Save as Token',
				displayText: 'Tokenize',
				icon: 'fa-solid fa-square-binary',
				disabled: !!isToken,
				onClick: () => startTokenizing()
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

	// Matches the Axes panel's layer-combo coloring: same axis key-set, same hue. A property is
	// always shown here as the currently winning value, so it's always "active".
	function trackColor(axisIds: string[]): string {
		return layerDotColor(axisIds, true);
	}

	// Describes which Layer this property is sourced from — same axis key-set the Axes panel's
	// combo dot for this Layer would show, with the actual matched value per axis (not just which
	// axes), so hovering here tells you exactly what to go look for there.
	function trackTitle(conditions: { axisId: string; value: string }[]): string {
		if (conditions.length === 0) return 'Base layer · always applies';
		const parts = conditions
			.map((c) => `${axisNameById[c.axisId] ?? c.axisId}: ${c.value}`)
			.join(', ');
		return `${parts} · ${conditions.length} condition${conditions.length === 1 ? '' : 's'}`;
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

	// Same inline-edit-input pattern as editValue above, but prompts for an alias instead of a
	// value: the property's current `value` becomes the new project-scoped token's value, and the
	// render entry is repointed at the new token via tokenId (see confirmTokenize).
	const tokenizeState = $state({
		now: false,
		alias: ''
	});

	let tokenizeInputRef: HTMLInputElement | undefined = $state();

	async function startTokenizing() {
		tokenizeState.now = true;
		tokenizeState.alias = '';

		await tick();

		if (tokenizeInputRef) {
			tokenizeInputRef.focus();
		}
	}

	function cancelTokenizing() {
		tokenizeState.now = false;
		tokenizeState.alias = '';
	}

	async function confirmTokenize() {
		tokenizeState.now = false;
		const alias = tokenizeState.alias.trim();
		tokenizeState.alias = '';

		if (!alias) return;
		if (!api || !projectId) {
			console.warn(`Cannot tokenize ${key}: no project context`);
			return;
		}
		if (!onFieldUpdate || !sourceLayerId) {
			console.warn(`Cannot tokenize ${key}: no source layer`);
			return;
		}

		const token = await api.createToken(projectId, alias, { type: 'scalar', value: value ?? '' });
		if (!token) return;

		onFieldUpdate({ layerId: sourceLayerId, property: key, tokenId: token.id });
	}

	function confirmUpdateStyle() {
		editValue.now = false;
		const trimmed = editValue.content.trim();

		if (!onFieldUpdate) return;

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

	// Drop a token (from the Tokens panel) onto this row to point its render entry at that token.
	// view-list tokens are rejected -- those are the `children` field's concern (ChildViewField),
	// not a scalar style property. Needs a source layer to write to (the null layer when the
	// property has never been set), same precondition as an inline edit.
	function canDropToken(payload: { kind: string; valueType?: string }): boolean {
		return (
			payload.kind === 'token' &&
			payload.valueType !== 'view-list' &&
			!!sourceLayerId &&
			!!onFieldUpdate
		);
	}

	function handleTokenDrop(payload: { kind: string; tokenId?: string }) {
		if (payload.kind !== 'token' || !payload.tokenId) return;
		if (!onFieldUpdate || !sourceLayerId) return;
		onFieldUpdate({ layerId: sourceLayerId, property: key, tokenId: payload.tokenId });
	}

	function confirmSuggestionPick(picked: string, fetched?: Uint8Array) {
		// inputType-specific: "font" means the fetched bytes are a font file to register with
		// Vellum before persisting the value. A different inputType could interpret `fetched`
		// differently -- SuggestField itself has no opinion, it just passes bytes through.
		if (inputType === 'font' && fetched) {
			getVellumInstance()?.load_font(fetched);
			requestVellumRender();
		}

		if (!onFieldUpdate) return;
		if (!sourceLayerId) {
			console.warn(`Cannot update ${key}: no source layer`);
			return;
		}
		if (picked !== value) {
			onFieldUpdate({ layerId: sourceLayerId, property: key, value: picked });
		}
	}

	// --- Resize control (inputType === 'resize'): Figma-style Fixed / Hug / Fill ---
	// The stored value IS the CSS-ish keyword Charter compiles: `fill` / `hug` / a length. Absent
	// or `auto` reads as Hug in the UI (content-sized); only an explicit length reads as Fixed.
	type ResizeMode = 'fixed' | 'hug' | 'fill';
	const resizeMode = $derived<ResizeMode>(
		value === 'fill' ? 'fill' : value === 'hug' || !value || value === 'auto' ? 'hug' : 'fixed'
	);

	function writeValue(v: string) {
		if (!onFieldUpdate) return;
		if (!sourceLayerId) {
			console.warn(`Cannot update ${key}: no source layer`);
			return;
		}
		if (v !== value) onFieldUpdate({ layerId: sourceLayerId, property: key, value: v });
	}

	// Picking "Fixed" opens the inline number/length editor (reusing editValue/inputRef). Seed it
	// with the current length if already fixed, else blank so the placeholder guides a fresh entry.
	async function selectFixed() {
		editValue.now = true;
		editValue.content = resizeMode === 'fixed' ? (value ?? '') : '';
		await tick();
		if (inputRef) {
			inputRef.focus();
			inputRef.select();
		}
	}

	// --- Spacing control (inputType === 'spacing'): numeric stepper, with a 1<->4-value
	// expand/collapse affordance for `spacingMode === 'box'` (padding's CSS shorthand). The
	// stored value IS the shorthand string Charter's parse_padding_shorthand understands ("12" or
	// "8 16" / "4 8 12" / "1 2 3 4"). Whether the widget shows one stepper or four is DERIVED from
	// the value itself (how many space-separated numbers it currently holds), not separate
	// component state -- so a value written elsewhere (Advanced, another session) always renders
	// correctly. Token-scale-aware snapping is a natural extension once KIT•10 has a spacing-scale
	// token type; there isn't one yet, so this is a plain numeric stepper for now.
	type SpacingSlot = 'scalar' | 0 | 1 | 2 | 3;
	const SPACING_STEP = 4; // matches the codebase's own 4px spacing rhythm

	function expandShorthand(parts: number[]): [number, number, number, number] {
		if (parts.length === 0) return [0, 0, 0, 0];
		if (parts.length === 1) return [parts[0]!, parts[0]!, parts[0]!, parts[0]!];
		if (parts.length === 2) return [parts[0]!, parts[1]!, parts[0]!, parts[1]!];
		if (parts.length === 3) return [parts[0]!, parts[1]!, parts[2]!, parts[1]!];
		return [parts[0]!, parts[1]!, parts[2]!, parts[3]!];
	}

	const spacingParts = $derived(
		value
			? value
					.trim()
					.split(/\s+/)
					.filter(Boolean)
					.map((n) => parseFloat(n) || 0)
			: []
	);
	const spacingIsExpanded = $derived(spacingMode === 'box' && spacingParts.length > 1);
	const spacingScalar = $derived(spacingParts[0] ?? 0);
	const spacingTRBL = $derived(expandShorthand(spacingParts));
	const spacingSides: [string, 0 | 1 | 2 | 3][] = [
		['T', 0],
		['R', 1],
		['B', 2],
		['L', 3]
	];

	function nudgeSpacing(slot: SpacingSlot, delta: number) {
		if (slot === 'scalar') {
			writeValue(String(Math.max(0, spacingScalar + delta)));
			return;
		}
		const next = [...spacingTRBL] as [number, number, number, number];
		next[slot] = Math.max(0, next[slot] + delta);
		writeValue(next.join(' '));
	}

	function expandSpacingToBox() {
		const v = spacingScalar;
		writeValue(`${v} ${v} ${v} ${v}`);
	}

	function collapseSpacingToScalar() {
		writeValue(String(spacingTRBL[0]));
	}

	let spacingEditingSlot = $state<SpacingSlot | null>(null);
	let spacingInputRef: HTMLInputElement | undefined = $state();
	let spacingEditContent = $state('');

	async function startEditingSpacingSlot(slot: SpacingSlot) {
		spacingEditingSlot = slot;
		spacingEditContent = String(slot === 'scalar' ? spacingScalar : spacingTRBL[slot]);
		await tick();
		spacingInputRef?.focus();
		spacingInputRef?.select();
	}

	function cancelEditingSpacingSlot() {
		spacingEditingSlot = null;
		spacingEditContent = '';
	}

	function confirmEditingSpacingSlot() {
		const slot = spacingEditingSlot;
		spacingEditingSlot = null;
		const num = Math.max(0, parseFloat(spacingEditContent) || 0);
		spacingEditContent = '';
		if (slot === null) return;
		if (slot === 'scalar') {
			writeValue(String(num));
			return;
		}
		const next = [...spacingTRBL] as [number, number, number, number];
		next[slot] = num;
		writeValue(next.join(' '));
	}
</script>

<div
	class="option124"
	class:option124--top={position === 'top'}
	class:option124--bottom={position === 'bottom'}
	class:option124--mid={position !== 'top' && position !== 'bottom'}
	use:dropZone={{ accepts: 'token', canDrop: canDropToken, onDrop: handleTokenDrop }}
>
	<button
		class="option124__style-name"
		class:option124__style-name--highlighted={highlighted}
		use:contextMenu={menu}
		title={labelTooltip}
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
			style="--track-color: {trackColor(keys)}"
			aria-label="Tokenized property"
			title={trackTitle(conditionValues)}
			type="button"
		>
			<i class="fa-solid {kitIcon}"></i>
		</button>
	{:else}
		<button
			class="option124__track"
			style="--track-color: {trackColor(keys)}"
			class:option124__track--empty={!value}
			aria-label="Literal property"
			title={trackTitle(conditionValues)}
			type="button"
		>
			<i class="fa-solid {kitIcon}"></i>
		</button>
	{/if}

	{#if tokenizeState.now}
		<input
			type="text"
			title="Token alias"
			bind:this={tokenizeInputRef}
			bind:value={tokenizeState.alias}
			placeholder="alias"
			class="option124__value option124__value--edit"
			onblur={() => cancelTokenizing()}
			onkeydown={(e: KeyboardEvent) => {
				if (e.key === 'Enter') {
					confirmTokenize();
				} else if (e.key === 'Escape') {
					cancelTokenizing();
				}
			}}
		/>
	{:else if inputType === 'resize'}
		<div class="option124__value option124__value--resize">
			<div class="seg-control" role="group" aria-label="Resizing mode">
				<button
					type="button"
					class="seg-control__btn"
					class:seg-control__btn--sel={resizeMode === 'fixed'}
					title="Fixed size"
					onclick={() => selectFixed()}
				>
					<i class="fa-solid fa-ruler"></i>
				</button>
				<button
					type="button"
					class="seg-control__btn"
					class:seg-control__btn--sel={resizeMode === 'hug'}
					title="Hug contents"
					onclick={() => writeValue('hug')}
				>
					<i class="fa-solid fa-compress"></i>
				</button>
				<button
					type="button"
					class="seg-control__btn"
					class:seg-control__btn--sel={resizeMode === 'fill'}
					title="Fill container"
					onclick={() => writeValue('fill')}
				>
					<i class="fa-solid fa-arrows-left-right-to-line"></i>
				</button>
			</div>
			{#if resizeMode === 'fixed'}
				{#if editValue.now}
					<input
						type="text"
						title="Fixed size (e.g. 200px or 50%)"
						bind:this={inputRef}
						bind:value={editValue.content}
						placeholder={value ?? '200px'}
						class="resize-fixed"
						onblur={() => cancelEditing()}
						onkeydown={(e: KeyboardEvent) => {
							if (e.key === 'Enter') {
								confirmUpdateStyle();
							} else if (e.key === 'Escape') {
								cancelEditing();
							}
						}}
					/>
				{:else}
					<button class="resize-fixed" type="button" onclick={() => startEditing()}>
						{value}
					</button>
				{/if}
			{/if}
		</div>
	{:else if inputType === 'align'}
		<div class="option124__value option124__value--resize">
			<div class="seg-control" role="group" aria-label="Text align">
				{#each [{ v: 'left', icon: 'fa-align-left', title: 'Left' }, { v: 'center', icon: 'fa-align-center', title: 'Center' }, { v: 'right', icon: 'fa-align-right', title: 'Right' }, { v: 'justify', icon: 'fa-align-justify', title: 'Justify' }] as opt (opt.v)}
					<button
						type="button"
						class="seg-control__btn"
						class:seg-control__btn--sel={(value ?? 'left') === opt.v}
						title={opt.title}
						onclick={() => writeValue(opt.v)}
					>
						<i class="fa-solid {opt.icon}"></i>
					</button>
				{/each}
			</div>
		</div>
	{:else if inputType === 'decoration'}
		<div class="option124__value option124__value--resize">
			<div class="seg-control" role="group" aria-label="Text decoration">
				{#each [{ v: 'none', icon: 'fa-slash', title: 'None' }, { v: 'underline', icon: 'fa-underline', title: 'Underline' }, { v: 'line-through', icon: 'fa-strikethrough', title: 'Line-through' }] as opt (opt.v)}
					<button
						type="button"
						class="seg-control__btn"
						class:seg-control__btn--sel={(value ?? 'none') === opt.v}
						title={opt.title}
						onclick={() => writeValue(opt.v)}
					>
						<i class="fa-solid {opt.icon}"></i>
					</button>
				{/each}
			</div>
		</div>
	{:else if inputType === 'spacing'}
		{#snippet spacingStepper(slot: 'scalar' | 0 | 1 | 2 | 3, num: number)}
			<div class="spacing-stepper">
				<button
					type="button"
					class="spacing-stepper__btn"
					title="Decrease"
					onclick={() => nudgeSpacing(slot, -SPACING_STEP)}
				>
					<i class="fa-solid fa-minus"></i>
				</button>
				{#if spacingEditingSlot === slot}
					<input
						type="text"
						inputmode="numeric"
						bind:this={spacingInputRef}
						bind:value={spacingEditContent}
						class="spacing-stepper__value spacing-stepper__value--edit"
						onblur={() => confirmEditingSpacingSlot()}
						onkeydown={(e: KeyboardEvent) => {
							if (e.key === 'Enter') {
								confirmEditingSpacingSlot();
							} else if (e.key === 'Escape') {
								cancelEditingSpacingSlot();
							}
						}}
					/>
				{:else}
					<button
						type="button"
						class="spacing-stepper__value"
						onclick={() => startEditingSpacingSlot(slot)}
					>
						{num}
					</button>
				{/if}
				<button
					type="button"
					class="spacing-stepper__btn"
					title="Increase"
					onclick={() => nudgeSpacing(slot, SPACING_STEP)}
				>
					<i class="fa-solid fa-plus"></i>
				</button>
			</div>
		{/snippet}
		<div class="option124__value option124__value--spacing">
			{#if spacingIsExpanded}
				<div class="spacing-box" role="group" aria-label="{displayText} per side">
					{#each spacingSides as [label, idx] (idx)}
						<div class="spacing-box__side">
							<span class="spacing-box__label">{label}</span>
							{@render spacingStepper(idx, spacingTRBL[idx])}
						</div>
					{/each}
					<button
						type="button"
						class="spacing-toggle"
						title="Collapse to one value"
						onclick={() => collapseSpacingToScalar()}
					>
						<i class="fa-solid fa-compress"></i>
					</button>
				</div>
			{:else}
				{@render spacingStepper('scalar', spacingScalar)}
				{#if spacingMode === 'box'}
					<button
						type="button"
						class="spacing-toggle"
						title="Expand to per-side"
						onclick={() => expandSpacingToBox()}
					>
						<i class="fa-solid fa-expand"></i>
					</button>
				{/if}
			{/if}
		</div>
	{:else if inputType === 'asset'}
		<div class="option124__value">
			<SuggestField
				{value}
				localSearch={(q) => {
					const list = $assetRegister;
					if (!q) return list.map((a) => ({ value: a.id, label: a.name }));
					const lower = q.toLowerCase();
					return list
						.filter((a) => a.name.toLowerCase().includes(lower))
						.map((a) => ({ value: a.id, label: a.name }));
				}}
				onPick={(picked, _fetched) => confirmSuggestionPick(picked)}
			/>
		</div>
	{:else if suggestionsFrom && !isToken}
		<div class="option124__value">
			<SuggestField
				{value}
				pluginName={suggestionsFrom.plugin}
				searchFn={suggestionsFrom.searchFn}
				fetchFn={suggestionsFrom.fetchFn}
				{callUtilityPlugin}
				isLoaded={inputType === 'font'
					? (v) => getVellumInstance()?.is_font_loaded(v) ?? false
					: undefined}
				onPick={(picked, fetched) => confirmSuggestionPick(picked, fetched)}
			/>
		</div>
	{:else if editValue.now}
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
						class="fa-solid {iconFromResolvedScalar(value)} token-pill__icon"
						class:token-pill__icon--color={isColorScalar(value)}
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
		align-items: stretch;
		user-select: none;
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

		&:global(.dnd-over) {
			outline: 1px dashed var(--color-primary);
			outline-offset: -1px;

			:global(.option124__value) {
				background: var(--color-surface-alt);
			}
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
			background: var(--color-panel-header-fill);

			&--select,
			&-select {
				all: unset;
				display: block;
				width: 100%;
				height: 100%;
				cursor: pointer;
				@include fonts-stack('Satoshi-Regular', sans);
				font-size: $x-font-size-xs;

				option {
					color: var(--color-text);
					background: var(--color-pure);
				}
			}

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

			// Resize control container: lay out the segmented control + optional fixed input
			// horizontally, and drop the plain-value button's own padding/hover/background.
			// Unlike plain value boxes this is a composite (3 segments + a value input) whose
			// intrinsic width exceeds the standard 40% value column -- allow it to grow, or the
			// Fixed value renders clipped off the panel's right edge.
			&--resize {
				display: flex;
				align-items: center;
				gap: $x-space-xs;
				padding: 0;
				flex-grow: 1;
				background: transparent;
				overflow: visible;

				&:hover {
					background: transparent;
				}
			}

			// Spacing control container: same drop-padding/background treatment as resize, since
			// it's also a composite of small buttons rather than one plain value box.
			&--spacing {
				display: flex;
				align-items: center;
				gap: $x-space-xs;
				padding: 0;
				background: transparent;
				overflow: visible;

				&:hover {
					background: transparent;
				}
			}
		}
	}

	// Shared by resize (Fixed/Hug/Fill), align (Left/Center/Right/Justify), and decoration
	// (None/Underline/Line-through) -- one mutually-exclusive button-row look for every "pick a
	// fixed, Charter-known keyword" control, generic name since it's no longer resize-specific.
	.seg-control {
		display: inline-flex;
		flex-shrink: 0;
		border-radius: 2px;
		overflow: hidden;
		background: var(--color-panel-header-fill);
	}

	.seg-control__btn {
		all: unset;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: calc($x-space-xs / 2) $x-space-xs;
		font-size: $x-font-size-xs;
		color: var(--color-add-var-text);

		&:hover {
			background: var(--color-surface-alt);
			color: var(--color-text);
		}

		&--sel,
		&--sel:hover {
			background: var(--color-primary);
			color: var(--color-pure);
		}
	}

	.resize-fixed {
		all: unset;
		flex: 1;
		// Never collapse below ~3 digits -- with min-width: 0 a tight row shrank this to
		// padding-only and the value overflowed the panel edge instead of showing.
		min-width: 3ch;
		padding: calc($x-space-xs / 2) $x-space-xs;
		border-radius: 1px;
		background: var(--color-panel-header-fill);
		color: var(--color-add-var-text);
		font-size: $x-font-size-sm;
		cursor: pointer;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;

		&:hover {
			background: var(--color-surface-alt);
			color: var(--color-text);
		}
	}

	.spacing-stepper {
		display: inline-flex;
		align-items: stretch;
		flex-shrink: 0;
		border-radius: 2px;
		overflow: hidden;
		background: var(--color-panel-header-fill);
	}

	.spacing-stepper__btn {
		all: unset;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: calc($x-space-xs / 2) calc($x-space-xs / 2);
		font-size: $x-font-size-xs;
		color: var(--color-add-var-text);

		&:hover {
			background: var(--color-surface-alt);
			color: var(--color-text);
		}
	}

	.spacing-stepper__value {
		all: unset;
		min-width: 1.6em;
		text-align: center;
		padding: calc($x-space-xs / 2) calc($x-space-xs / 2);
		font-size: $x-font-size-sm;
		color: var(--color-text);
		cursor: text;

		&--edit {
			background: var(--color-pure);
			color: var(--color-primary);
		}
	}

	.spacing-toggle {
		all: unset;
		flex-shrink: 0;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: calc($x-space-xs / 2);
		font-size: $x-font-size-xs;
		color: var(--color-add-var-text);
		border-radius: 2px;

		&:hover {
			background: var(--color-surface-alt);
			color: var(--color-text);
		}
	}

	.spacing-box {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: calc($x-space-xs / 2);
	}

	.spacing-box__side {
		display: inline-flex;
		align-items: center;
		gap: calc($x-space-xs / 2);
	}

	.spacing-box__label {
		font-size: $x-font-size-xs;
		opacity: 0.6;
		min-width: 0.8em;
	}
</style>
