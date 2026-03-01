<script lang="ts">
	import { type ComponentView, type ComponentFlat } from '../Component.svelte';
	import { tick } from 'svelte';

	type StyleFieldValue = string | { resolve: string };

	type StyleFieldProps = {
		key: string;
		displayText: string;
		set?: AxesSet;
		color?: string;
		stack: number;
		tokens: TokenLibrary;

		selection: EditorSelection;
		kitsPool: Record<string, ComponentFlat>;
		viewsPool: Record<string, ComponentView>;
		value?: StyleFieldValue;
		highlighted?: boolean;

		// Styling
		position?: 'top' | 'bottom' | 'mid';
	};

	let {
		key,
		displayText,
		kitsPool = $bindable(),
		viewsPool,
		color,
		set,
		selection,
		value,
		stack,
		highlighted = $bindable(false),
		position = 'mid',
		tokens
	}: StyleFieldProps = $props();

	import { contextMenu } from '../contextMenu.ts';
	import type { AxesSet, StyleSource } from '../../cascadeAxesMap.ts';
	import type { EditorSelection } from '../Editor.svelte';

	const menu = () => {
		return [
			{
				name: 'custom axis',
				description: 'Save as Token',
				displayText: 'Tokenize',
				icon: 'fa-solid fa-square-binary'
			},
			{
				name: 'custom axis',
				description: '',
				displayText: 'Unwrap',
				icon: 'fa-solid fa-box-open',
				disabled: true
			},

			'hr',
			{
				name: 'custom axis',
				description: 'Add custom axis',
				displayText: 'Remove',
				icon: 'fa-solid fa-trash',
				destructive: true
			}
		];
	};

	const styleOptions = () => {
		return [
			{
				name: 'cut selected styles',
				description: '',
				displayText: 'Cut Selected',
				icon: 'fa-solid fa-scissors'
			},
			{
				name: 'copy selected styles',
				description: '',
				displayText: 'Copy Selected',
				icon: 'fa-solid fa-copy'
			},
			'hr',
			{
				name: 'remove style tracking',
				description: '',
				displayText: 'Remove Track',
				icon: 'fa-solid fa-delete-left'
			},
			{
				name: 'delete style value',
				description: '',
				displayText: 'Delete Value',
				icon: 'fa-solid fa-trash'
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
			// focus the input
			inputRef.focus();

			// optional: select all text
			inputRef.select();
		}
	}

	function shallowEqual(obj1: Record<string, any>, obj2: Record<string, any>) {
		const keys1 = Object.keys(obj1);
		const keys2 = Object.keys(obj2);
		if (keys1.length !== keys2.length) return false;
		return keys1.every((key) => obj1[key] === obj2[key]);
	}

	// Disgustang
	const isEmpty = $derived(false);

	const layers = $derived(0);

	import { dropzone } from '../dragDrop.ts';
	import { tokenIcon, type Token, type TokenLibrary } from './Variables.svelte';

	// Action for receiving Tokens
	const tokenDrop = dropzone<Token>();
	const softResolve = (path: string, library: TokenLibrary): Token | undefined => {
		const [head, ...rest] = path.split('/');
		// console.log(`About to resolve from library ${head}, with the rest ${JSON.stringify(rest,null, 2)}`)

		if (!head) return; // namespace doesn't exist for some reason

		console.log(library, head, library[head]);

		const node = library[head];

		if (!node) {
			console.error(`Top Level ${head} missing`);
			return;
		}

		// if no more path, we can only check tokens at this level
		if (rest.length === 0) {
			return undefined; // nothing left to resolve
		}

		const nextSegment = rest[0];

		// 1️⃣ Check children recursively
		if (node.children && node.children[nextSegment]) {
			return softResolve(rest.join('/'), node.children);
		}

		// 2️⃣ If this is the last segment, also check tokens
		if (node.tokens && rest.length === 1) {
			return node.tokens.find((t) => t.name === nextSegment);
		}

		return undefined; // not found
	};
</script>

<div
	class="option124"
	class:option124--top={position === 'top'}
	class:option124--bottom={position === 'bottom'}
	class:option124--mid={position !== 'top' && position !== 'bottom'}
>
	{#if selection.selectedViewPrimary}
		<!-- {JSON.stringify(kits[selectedKit.source_index].sets.layers.map((s) => { return Object.keys(s.axes) }), null, 2)} -->
	{/if}

	<button
		class="option124__style-name"
		class:option124__style-name--highlighted={highlighted}
		use:contextMenu={styleOptions}
		onclick={() => {
			highlighted = !highlighted;
		}}
	>
		{displayText ?? key}
	</button>

	<button
		style="--color-tracker: {color}"
		class="option124__track"
		class:option124__track--tracked--empty={isEmpty}
		aria-label="Adds the style into the axes set"
		title="track '{displayText ?? key}' on Axes set"
		type="button"
		onclick={() => {
			console.log('Tried to add style to set');
		}}
	>
		<i
			class:fa-diamond={stack <= 1}
			class:fa-pentagon={stack === 2}
			class:fa-hexagon={stack === 3}
			class:fa-heptagon={stack === 4}
			class:fa-octagon={stack === 5}
			class="fa-solid"
		>
		</i>
	</button>

	{#if editValue.now}
		<input
			type="text"
			title="Edit Value"
			bind:this={inputRef}
			bind:value={editValue.content}
			placeholder={typeof value === 'string' ? value : undefined}
			class="option124__value option124__value--edit"
			onclick={() => {
				console.log('Tried token to style');
			}}
			onblur={() => {
				editValue.now = false;
				editValue.content = '';
			}}
			onkeydown={(e) => {
				if (e.key === 'Enter') {
					editValue.now = false;

					if (selection.selectedViewPrimary && selection.selectedKitIndex !== null) {
						const layers =
							kitsPool[
								viewsPool[selection.selectedViewPrimary].resolve[selection.selectedKitIndex]
									.source_uuid
							].sets.layers;

						// Normalize: no set specified means {}
						const targetAxes = set ?? {};

						// Find the layer matching the target axes
						const layer = layers.find((l) => {
							console.log(
								`Comparing layer axes ${JSON.stringify(l.axes)} to target ${JSON.stringify(targetAxes)}`
							);
							return shallowEqual(l.axes, targetAxes);
						});

						console.log(
							`Tried to edit ${JSON.stringify(layer)}, with ${key}: ${editValue.content}`
						);

						if (layer) {
							layer.style[key] = editValue.content;
						} else {
							// Optional: if no matching layer exists, you could create it
							layers.push({
								axesSignature: '',
								axes: {},
								specificity: 0,
								style: { [key]: editValue.content }
							});
							console.warn('No layer found for target axes, edit skipped');
						}
					}
				}
			}}
			use:contextMenu={menu}
		/>
	{:else}
		<button
			title="Attach Token"
			class="option124__value"
			class:option124__value--new={!value}
			onclick={() => {
				console.log('Tryna start editing');
				startEditing();
			}}
			disabled={!!!selection.selectedViewPrimary}
			use:contextMenu={menu}
			use:tokenDrop={{
				dragOverClassName: 'option124__value--dragged-over',
				ondrop: (t: Token) => {
					console.log(JSON.stringify(t, null, 2));
				}
			}}
		>
			{#if value}
				{#if typeof value !== 'string'}
					{@const resolution = softResolve(value.resolve, tokens)}
					{#if resolution}
						<span class="token--found">
							<i class="fa-solid {tokenIcon(resolution.type)}"></i>
							{resolution.displayName}
						</span>
					{:else}
						<span class="token--unfound">
							{value.resolve}
						</span>
					{/if}
				{:else}
					<span>
						{value}
					</span>
				{/if}
			{:else if !!!selection.selectedViewPrimary}
				<em>
					<i class="fa-solid fa-minus"></i>
					Select a Kit
					<i class="fa-solid fa-minus"></i>
				</em>
			{:else}
				<!-- <i class="fa-solid fa-plus"></i> -->
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
			font-size: $x-font-size-md;
			letter-spacing: 1px;
			gap: $x-space-xs;
		}

		@include layout-respond-max('xl') {
			font-size: $x-font-size-sm;
		}

		&__track,
		&__style-name,
		&__value {
			// padding-block: calc($x-space-xs / 4);
			// padding-inline: calc($x-space-xs / 4);
		}

		&__track {
			text-align: center;
			font-size: $x-font-size-md;

			-webkit-text-stroke-width: 2px;
			color: var(--color-tracker, --color-diamond-color--tracked);
			-webkit-text-stroke-color: var(--color-diamond-border--tracked);

			&:focus {
				// color: var(--color-text);
				filter: saturate(1.2);
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
			padding: 2px;
			text-align: center;
			flex-basis: 60%;
			flex-shrink: 1;
			position: relative;
			border-radius: 1px;
			color: var(--color-add-var-text);
			cursor: text;
			font-size: $x-font-size-sm;
			background:
				radial-gradient(closest-side, var(--color-panel-header-fill) 90%, transparent 100%) 0 0/ 3px
					3px,
				var(--color-panel-header-border); /* Base color */
			background: var(--color-panel-header-fill);

			&:has(span.token--found) {
				background: var(--color-surface-alt);
			}

			span.token--found {
				color: var(--color-primary);
			}

			span.token--unfound {
				color: var(--color-danger);
			}

			&--dragged-over {
				background: var(--color-surface-alt);

				&:has(span.token--found) {
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

		&.token--found {
			color: var(--color-primary);
			text-decoration: underline;
		}

		&--top > * {
			border-radius: $x-space-xs $x-space-xs 0 0;
		}
		&--bottom > * {
			border-radius: 0 0 $x-space-xs $x-space-xs;
		}

		&--top > *,
		&--mid > * {
			border-bottom: unset;
		}
	}
</style>
