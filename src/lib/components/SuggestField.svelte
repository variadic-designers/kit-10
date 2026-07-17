<script lang="ts">
	// Generic search-and-pick input for any field a plugin marks with `suggestionsFrom` --
	// this component has no knowledge of fonts, Fontavious, or any other specific plugin. It
	// only ever calls callUtilityPlugin(pluginName, searchFn/fetchFn, ...) and reports back
	// whatever it got. See VISION.md's 1st Principle: no lock-in to a specific tool for a job.
	// The plugin-agnostic suggestion contract. `value`/`label` are the base; `badge`/`tone`/
	// `note` are GENERIC display slots a provider plugin may fill (Fontavious projects font
	// licensing/substitution into them -- see resources/fontavious-catalogue-plan.md §5.1).
	// This component renders them without knowing what they mean domain-wise; a future icon
	// plugin would fill the same slots from its own concepts.
	type SuggestionEntry = {
		value: string;
		label?: string;
		badge?: string;
		tone?: 'neutral' | 'info' | 'warn';
		note?: string;
	};

	type SuggestFieldProps = {
		value?: string | null;
		pluginName?: string;
		searchFn?: string;
		fetchFn?: string;
		callUtilityPlugin?: (name: string, fn: string, payload: string) => Promise<unknown>;
		// Alternative to plugin-based search: provide a local search function that returns
		// results synchronously. Takes precedence over plugin/searchFn when set.
		localSearch?: (query: string) => SuggestionEntry[];
		// Optional: lets a caller with domain knowledge (e.g. StyleField knowing Vellum already
		// has a given font loaded) skip a redundant fetchFn round-trip -- a real, measured cost
		// (network fetch of a font file, ~200ms+ for one not already cached) when re-picking a
		// value that's already available. SuggestField stays generic: it doesn't know *why*
		// something is already loaded, just whether to skip re-fetching it.
		isLoaded?: (value: string) => boolean;
		// `fetched` is only present when `fetchFn` is set, it wasn't skipped via `isLoaded`, and
		// the call returned something -- the caller (StyleField) decides what it means (e.g.
		// font bytes to hand to Vellum).
		onPick?: (value: string, fetched?: Uint8Array) => void;
	};

	let {
		value,
		pluginName,
		searchFn,
		fetchFn,
		callUtilityPlugin,
		localSearch,
		isLoaded,
		onPick
	}: SuggestFieldProps = $props();

	let open = $state(false);
	let query = $state('');
	let blurTimer: ReturnType<typeof setTimeout> | null = null;
	let results = $state<SuggestionEntry[]>([]);
	let loading = $state(false);
	let error = $state<string | null>(null);
	let highlighted = $state(0);
	let triggerRef: HTMLButtonElement | undefined = $state();
	let inputRef: HTMLInputElement | undefined = $state();
	let panelRef: HTMLDivElement | undefined = $state();

	// Bumped on every open -- lets a slow-to-settle async call (a pick's fetch, a search) tell
	// whether it's still "current" by the time it resolves, so it can't stomp on a session the
	// user has since reopened or re-searched. Same pattern as PluginManager's `selectionGen` /
	// Editor.svelte's `reResolveVersion`, same reason: a real race, not a hypothetical one --
	// reopening the picker shortly after a pick (before its fetch/onPick finished) let that
	// trailing `open = false` close the freshly reopened panel, making it look like the whole
	// dropdown had "stopped responding".
	let sessionGen = 0;

	// Panel renders `position: fixed` at coordinates read off the trigger's own bounding box,
	// rather than `position: absolute` relative to this component -- StyleField's value cell
	// (a reasonable, correct place for it to live) has `overflow: hidden` for its own unrelated
	// job of ellipsis-truncating plain text values, which would otherwise silently clip an
	// absolutely-positioned dropdown to invisibility. `fixed` escapes any ancestor's overflow.
	let panelStyle = $state('');

	function positionPanel() {
		if (!triggerRef) return;
		const rect = triggerRef.getBoundingClientRect();
		panelStyle = `top:${rect.bottom}px; left:${rect.left}px; min-width:${rect.width}px;`;
	}

	// callUtilityPlugin's return type is whatever @extism/extism's Plugin.call resolves to --
	// narrowed here to just the two reader methods this component needs.
	type CallOutput = { text(): string; bytes(): Uint8Array };

	async function search(q: string) {
		const gen = sessionGen;
		loading = true;
		error = null;
		try {
			if (localSearch) {
				results = localSearch(q);
			} else if (callUtilityPlugin && pluginName && searchFn) {
				const result = (await callUtilityPlugin(pluginName, searchFn, q)) as CallOutput | undefined;
				if (gen !== sessionGen) return; // a newer open/search has since started -- discard
				results = result ? (JSON.parse(result.text()) as SuggestionEntry[]) : [];
			} else {
				results = [];
			}
			highlighted = 0;
		} catch (err) {
			if (gen !== sessionGen) return;
			error = String(err);
			results = [];
		} finally {
			if (gen === sessionGen) loading = false;
		}
	}

	async function openPicker() {
		// Always start from a clean slate -- otherwise a second open carries over whatever was
		// last typed (e.g. a previously picked value), so new keystrokes land after stale text
		// instead of replacing it, and the search silently matches nothing forever after.
		sessionGen++;
		if (blurTimer !== null) {
			clearTimeout(blurTimer);
			blurTimer = null;
		}
		open = true;
		query = '';
		results = [];
		error = null;
		highlighted = 0;
		positionPanel();
		await search(query);
		inputRef?.focus();
	}

	function closePicker() {
		open = false;
	}

	async function pick(entryValue: string) {
		const gen = sessionGen;
		loading = true;
		error = null;
		try {
			let fetched: Uint8Array | undefined;
			if (fetchFn && callUtilityPlugin && pluginName && !isLoaded?.(entryValue)) {
				const result = (await callUtilityPlugin(
					pluginName,
					fetchFn,
					JSON.stringify({ value: entryValue })
				)) as CallOutput | undefined;
				fetched = result?.bytes();
			}
			// Only apply *this* session's pick -- if the user has since reopened the picker and
			// picked something else (this pick's fetch took a while to land), a stale pick used to
			// still fire onPick after the newer one, silently reverting the field to the older
			// value. Discarding it here, not just skipping the open/loading/error settle below, is
			// the actual fix -- this used to be the one place gen wasn't checked.
			if (gen !== sessionGen) return;
			onPick?.(entryValue, fetched);
			open = false;
		} catch (err) {
			if (gen === sessionGen) error = String(err);
		} finally {
			if (gen === sessionGen) loading = false;
		}
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			if (results.length > 0) highlighted = (highlighted + 1) % results.length;
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			if (results.length > 0) highlighted = (highlighted - 1 + results.length) % results.length;
		} else if (e.key === 'Enter') {
			// Prefer the keyboard-highlighted row; fall back to an exact (case-insensitive)
			// match over just "the first result", since substring search can rank a longer
			// family above the one you typed.
			const byHighlight = results[highlighted];
			const exact = results.find((r) => r.value.toLowerCase() === query.trim().toLowerCase());
			const target = byHighlight ?? exact ?? results[0];
			if (target) pick(target.value);
		} else if (e.key === 'Escape') {
			closePicker();
		}
	}
</script>

<svelte:window
	onresize={() => open && positionPanel()}
	onscrollcapture={(e: Event) => {
		// Scroll events don't bubble, so a capture-phase window listener is the only way to
		// catch "something outside this component scrolled" -- but that also means it sees the
		// results list's own internal scrolling (it has overflow-y: auto). Only close for
		// scrolls that didn't originate inside our own panel.
		if (open && !(e.target instanceof Node && panelRef?.contains(e.target))) closePicker();
	}}
/>

<div class="suggest-field">
	<button type="button" class="suggest-field__trigger" bind:this={triggerRef} onclick={openPicker}>
		{value || 'Pick a value'}
	</button>

	{#if open}
		<div class="suggest-field__panel" style={panelStyle} bind:this={panelRef}>
			<input
				type="text"
				bind:this={inputRef}
				bind:value={query}
				placeholder="Search…"
				oninput={() => search(query)}
				onblur={() => {
					blurTimer = setTimeout(closePicker, 150);
				}}
				onkeydown={onKeydown}
			/>

			{#if loading}
				<div class="suggest-field__status">Loading…</div>
			{:else if error}
				<div class="suggest-field__status suggest-field__status--error">{error}</div>
			{:else if results.length === 0}
				<div class="suggest-field__status">No matches</div>
			{:else}
				<ul class="suggest-field__list">
					{#each results as entry, i (entry.value)}
						<li>
							<button
								type="button"
								class:suggest-field__option--highlighted={i === highlighted}
								onmousedown={() => pick(entry.value)}
								onmouseenter={() => (highlighted = i)}
							>
								<span class="suggest-field__label">{entry.label ?? entry.value}</span>
								{#if entry.note}<span
										class="suggest-field__note suggest-field__note--{entry.tone ?? 'neutral'}"
										>{entry.note}</span
									>{/if}
								{#if entry.badge}<span
										class="suggest-field__badge suggest-field__badge--{entry.tone ?? 'neutral'}"
										>{entry.badge}</span
									>{/if}
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	{/if}
</div>

<style lang="scss">
	.suggest-field {
		position: relative;
		display: block;
		width: 100%;
		height: 100%;

		&__trigger {
			all: unset;
			display: block;
			box-sizing: border-box;
			width: 100%;
			height: 100%;
			cursor: pointer;
		}

		&__panel {
			position: fixed;
			z-index: 1000;
			background: var(--color-pure);
			border: 1px solid var(--color-panel-header-border);
			border-radius: 4px;
			box-shadow: 0 4px 12px oklch(0% 0 0 / 0.15);

			input {
				all: unset;
				display: block;
				width: 100%;
				box-sizing: border-box;
				padding: 0.4em 0.6em;
				border-bottom: 1px solid var(--color-panel-header-border);
			}
		}

		&__status {
			padding: 0.5em;
			opacity: 0.6;
			font-size: 0.85em;

			&--error {
				color: var(--color-danger, oklch(63.7% 0.2078 25.3));
			}
		}

		&__list {
			list-style: none;
			margin: 0;
			padding: 0;
			max-height: 14rem;
			overflow-y: auto;

			button {
				all: unset;
				display: flex;
				align-items: baseline;
				gap: 0.5em;
				width: 100%;
				box-sizing: border-box;
				padding: 0.4em 0.6em;
				cursor: pointer;

				&:hover,
				&.suggest-field__option--highlighted {
					background: var(--color-surface-alt);
				}
			}
		}

		&__label {
			flex: 1 1 auto;
			min-width: 0;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		// Generic secondary line (e.g. "matches Arial", "approximates Gotham"). Muted, right-aligned.
		// `tone` optionally tints it (a visual look-alike match cautions in warn).
		&__note {
			flex: 0 0 auto;
			font-size: 0.8em;
			opacity: 0.55;

			&--warn {
				color: var(--color-danger, oklch(63.7% 0.2078 25.3));
				opacity: 0.85;
			}

			&--info {
				color: var(--color-accent, oklch(63% 0.17 250));
				opacity: 0.85;
			}
		}

		// Generic tag. `tone` maps to emphasis only -- no domain meaning lives here.
		&__badge {
			flex: 0 0 auto;
			font-size: 0.68em;
			text-transform: uppercase;
			letter-spacing: 0.03em;
			padding: 0.1em 0.4em;
			border-radius: 3px;
			background: var(--color-surface-alt);
			opacity: 0.75;

			&--warn {
				background: color-mix(
					in oklab,
					var(--color-danger, oklch(63.7% 0.2078 25.3)) 22%,
					transparent
				);
				opacity: 0.9;
			}

			&--info {
				background: color-mix(in oklab, var(--color-accent, oklch(63% 0.17 250)) 22%, transparent);
				opacity: 0.9;
			}
		}
	}
</style>
