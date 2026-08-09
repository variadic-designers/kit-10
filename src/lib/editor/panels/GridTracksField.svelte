<script lang="ts">
	import FieldRow from './FieldRow.svelte';
	import { commitFieldValue } from './field-commit.ts';
	import {
		parseTrackList,
		serializeTrackList,
		kindHasValue,
		defaultValueForKind,
		TRACK_KIND_META,
		type Track,
		type TrackKind
	} from './grid-tracks.ts';
	import type { Api, ResolvedProperty } from 'manager';
	import type { FieldDef, FieldUpdate } from '$lib/plugins/types.js';

	// Same shape ArrangeField/ResizeField already take.
	type TrackInfo = {
		sourceLayerId: string | null;
		kitId: string | null;
		kitIcon: string;
		keys: string[];
		conditionValues: { axisId: string; value: string }[];
		isToken: boolean;
		tokenAlias: string | null;
		tokenId: string | null;
	};

	type GridTracksFieldProps = {
		field: FieldDef; // grid-template-columns or grid-template-rows
		label: string;
		track: (key: string) => TrackInfo;
		resolvedMap: Map<string, ResolvedProperty>;
		api?: Api;
		onFieldUpdate?: (update: FieldUpdate) => void;
	};

	let { field, label, track, resolvedMap, api, onFieldUpdate }: GridTracksFieldProps = $props();

	const info = $derived(track(field.key));
	const rawValue = $derived(resolvedMap.get(field.key)?.value ?? '');
	const tracks = $derived(parseTrackList(rawValue));

	function commit(next: Track[]) {
		commitFieldValue(track(field.key), field.key, serializeTrackList(next), { onFieldUpdate, api });
	}

	function addTrack() {
		commit([...tracks, { kind: 'fr', value: 1 }]);
	}

	function removeTrack(index: number) {
		commit(tracks.filter((_, i) => i !== index));
	}

	function moveTrack(index: number, dir: -1 | 1) {
		const target = index + dir;
		if (target < 0 || target >= tracks.length) return;
		const next = [...tracks];
		[next[index], next[target]] = [next[target], next[index]];
		commit(next);
	}

	function setKind(index: number, kind: TrackKind) {
		const next = [...tracks];
		const prevHadValue = kindHasValue(next[index].kind);
		next[index] = {
			kind,
			value: prevHadValue ? next[index].value : defaultValueForKind(kind)
		};
		commit(next);
	}

	function setValue(index: number, value: number) {
		const next = [...tracks];
		next[index] = { ...next[index], value };
		commit(next);
	}
</script>

<FieldRow
	{label}
	track={{ kitIcon: info.kitIcon, keys: info.keys, conditionValues: info.conditionValues }}
	trackAriaLabel="Track source"
>
	{#snippet valueSlot()}
		<span class="grid-tracks__summary">
			{tracks.length === 0 ? 'auto' : `${tracks.length} track${tracks.length === 1 ? '' : 's'}`}
		</span>
	{/snippet}

	{#snippet body()}
		<div class="grid-tracks">
			{#if tracks.length === 0}
				<div class="grid-tracks__empty">No explicit tracks - using the responsive default above.</div>
			{:else}
				<ul class="grid-tracks__list">
					{#each tracks as t, i (i)}
						<li class="grid-tracks__row">
							<div class="grid-tracks__reorder">
								<button
									type="button"
									disabled={i === 0}
									title="Move earlier"
									onclick={() => moveTrack(i, -1)}
								>
									<i class="fa-solid fa-chevron-up"></i>
								</button>
								<button
									type="button"
									disabled={i === tracks.length - 1}
									title="Move later"
									onclick={() => moveTrack(i, 1)}
								>
									<i class="fa-solid fa-chevron-down"></i>
								</button>
							</div>
							<select
								class="grid-tracks__kind"
								value={t.kind}
								title={TRACK_KIND_META.find((m) => m.kind === t.kind)?.tooltip}
								onchange={(e) => setKind(i, (e.currentTarget as HTMLSelectElement).value as TrackKind)}
							>
								{#each TRACK_KIND_META as meta (meta.kind)}
									<option value={meta.kind}>{meta.label}</option>
								{/each}
							</select>
							{#if kindHasValue(t.kind)}
								<input
									class="grid-tracks__value"
									type="number"
									value={t.value}
									onchange={(e) => setValue(i, parseFloat((e.currentTarget as HTMLInputElement).value) || 0)}
								/>
							{/if}
							<button
								class="grid-tracks__remove"
								type="button"
								title="Remove track"
								onclick={() => removeTrack(i)}
							>
								<i class="fa-solid fa-xmark"></i>
							</button>
						</li>
					{/each}
				</ul>
			{/if}

			<button class="grid-tracks__add" type="button" onclick={addTrack}>
				<i class="fa-solid fa-plus"></i>
				<span>Add track</span>
			</button>
		</div>
	{/snippet}
</FieldRow>

<style lang="scss">
	@use '_index' as *;

	button {
		all: unset;
		cursor: pointer;
	}

	.grid-tracks__summary {
		font-size: $x-font-size-sm;
		color: var(--color-add-var-text);
	}

	.grid-tracks {
		display: flex;
		flex-direction: column;
		gap: calc($x-space-xs / 2);

		&__empty {
			font-size: $x-font-size-xs;
			opacity: 0.6;
			padding-block: calc($x-space-xs / 2);
		}

		&__list {
			display: flex;
			flex-direction: column;
			gap: 2px;
			list-style: none;
			margin: 0;
			padding: 0;
		}

		&__row {
			display: flex;
			align-items: center;
			gap: calc($x-space-xs / 2);
			background: var(--color-panel-header-fill);
			border-radius: 2px;
			padding: 2px calc($x-space-xs / 2);
		}

		&__reorder {
			display: flex;
			flex-direction: column;
			flex: 0 0 auto;

			button {
				font-size: 0.6em;
				opacity: 0.6;
				padding: 1px;

				&:hover:not(:disabled) {
					opacity: 1;
				}

				&:disabled {
					opacity: 0.2;
					cursor: default;
				}
			}
		}

		&__kind {
			flex: 1;
			min-width: 0;
			background: transparent;
			border: none;
			color: var(--color-text);
			font-size: $x-font-size-xs;
			padding: calc($x-space-xs / 2);
			cursor: pointer;
		}

		&__value {
			flex: 0 0 4.5em;
			width: 4.5em;
			background: var(--color-surface-alt);
			border: none;
			border-radius: 2px;
			color: var(--color-text);
			font-size: $x-font-size-xs;
			padding: calc($x-space-xs / 2);
			text-align: right;
		}

		&__remove {
			flex: 0 0 auto;
			opacity: 0.6;
			padding: calc($x-space-xs / 2);

			&:hover {
				opacity: 1;
				color: var(--color-danger, #e05252);
			}
		}

		&__add {
			display: flex;
			align-items: center;
			justify-content: center;
			gap: calc($x-space-xs / 2);
			font-size: $x-font-size-xs;
			opacity: 0.75;
			padding-block: calc($x-space-xs / 2);
			border-radius: 2px;

			&:hover {
				opacity: 1;
				background: var(--color-surface-alt);
			}
		}
	}
</style>
