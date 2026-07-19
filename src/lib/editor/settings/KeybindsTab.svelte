<script lang="ts">
	// Keybinds settings tab. Unlike Appearance/Canvas (which render through the generic string-valued
	// PreferenceControl), a keybind needs a click-to-record capture widget, so this tab is bespoke: it
	// reads the keybinds store directly and writes it through updateKeybind. One row per declared
	// action, grouped by action.group.
	import {
		keybinds,
		KEYBIND_ACTIONS,
		updateKeybind,
		resetKeybind,
		resetAllKeybinds,
		formatBinding,
		readEventToBinding,
		type KeybindAction,
		type KeybindActionDef
	} from '../keybinds.js';

	// Which action is currently capturing input (null = idle).
	let recording = $state<KeybindAction | null>(null);
	let cleanup: (() => void) | null = null;

	const groups = $derived.by(() => {
		const map = new Map<string, KeybindActionDef[]>();
		for (const a of KEYBIND_ACTIONS) {
			const list = map.get(a.group) ?? [];
			list.push(a);
			map.set(a.group, list);
		}
		return [...map.entries()];
	});

	function stopRecording() {
		recording = null;
		if (cleanup) {
			cleanup();
			cleanup = null;
		}
	}

	function startRecording(def: KeybindActionDef) {
		// Clicking the button of the row that's already recording toggles it off.
		if (recording === def.id) {
			stopRecording();
			return;
		}
		stopRecording();
		recording = def.id;

		// Track held Space so a mouse gesture can capture the Figma-style Space+click pan variant
		// (readEventToBinding only reads ctrl/shift/alt/meta off the event; Space isn't a DOM modifier).
		let spaceHeld = false;

		const onKey = (e: KeyboardEvent) => {
			if (e.code === 'Space') {
				spaceHeld = true;
				// While recording a mouse slot, Space is a modifier to combine with a click, not a
				// binding of its own -- swallow it and keep waiting for the click.
				if (def.allow.includes('mouse') && !def.allow.includes('key')) {
					e.preventDefault();
					return;
				}
			}
			if (!def.allow.includes('key')) return; // wrong input kind for this slot; keep waiting
			const b = readEventToBinding(e);
			if (!b) return; // modifier-only press; keep waiting
			e.preventDefault();
			e.stopPropagation();
			updateKeybind(def.id, b);
			stopRecording();
		};
		const onKeyUp = (e: KeyboardEvent) => {
			if (e.code === 'Space') spaceHeld = false;
		};
		const onMouse = (e: MouseEvent) => {
			if (!def.allow.includes('mouse')) return;
			const b = readEventToBinding(e);
			if (!b) return;
			e.preventDefault();
			e.stopPropagation();
			updateKeybind(def.id, { ...b, space: spaceHeld });
			stopRecording();
		};

		window.addEventListener('keydown', onKey, true);
		window.addEventListener('keyup', onKeyUp, true);
		// Defer the mouse listener a tick so the click that STARTED recording isn't itself captured.
		let mouseAttached = false;
		const attachMouse = () => {
			window.addEventListener('mousedown', onMouse, true);
			mouseAttached = true;
		};
		const timer = window.setTimeout(attachMouse, 0);

		cleanup = () => {
			window.clearTimeout(timer);
			window.removeEventListener('keydown', onKey, true);
			window.removeEventListener('keyup', onKeyUp, true);
			if (mouseAttached) window.removeEventListener('mousedown', onMouse, true);
		};
	}
</script>

<div class="tab">
	<div class="head">
		<p class="hint">
			Rebind editor gestures. Click a shortcut, then press the key combo (or, for mouse actions,
			the modifier + click) you want. Navigation keys are ignored while you're typing in a field.
		</p>
		<button class="reset-all" onclick={() => resetAllKeybinds()}>Reset all</button>
	</div>

	{#each groups as [groupName, actions] (groupName)}
		<h4 class="group">{groupName}</h4>
		{#each actions as def (def.id)}
			<div class="kb-row">
				<span class="kb-label">{def.label}</span>
				<div class="kb-controls">
					<button
						class="kb-capture"
						class:recording={recording === def.id}
						onclick={() => startRecording(def)}
					>
						{#if recording === def.id}
							Press {def.allow.includes('mouse') && !def.allow.includes('key')
								? 'modifier + click'
								: 'keys'}…
						{:else}
							{formatBinding($keybinds[def.id])}
						{/if}
					</button>
					<button
						class="kb-reset"
						title="Reset to default"
						aria-label="Reset to default"
						onclick={() => {
							if (recording === def.id) stopRecording();
							resetKeybind(def.id);
						}}
					>
						<i class="fa-solid fa-rotate-left"></i>
					</button>
				</div>
			</div>
		{/each}
	{/each}
</div>

<style lang="scss">
	@use '_index' as *;

	.tab {
		@include layout-flex-column();
		gap: 2px;
	}

	.head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: $x-space-sm;
	}

	.hint {
		color: var(--color-text-muted);
		font-size: $x-font-size-sm;
		padding: 0 $x-space-xs $x-space-sm;
		@include fonts-stack('Satoshi-Regular', sans);
	}

	.reset-all {
		flex: none;
		background: var(--color-surface);
		color: var(--color-text);
		border: 1px solid var(--color-bg);
		border-radius: calc($x-space-xs / 2);
		padding: calc($x-space-xs / 4) $x-space-xs;
		font-size: $x-font-size-sm;
		cursor: pointer;
		@include fonts-stack('Satoshi-Regular', sans);
	}

	.group {
		font-size: $x-font-size-sm;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 1px;
		@include fonts-stack('Satoshi-Light', sans);
		padding: $x-space-sm $x-space-xs calc($x-space-xs / 2);
	}

	.kb-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: $x-space-sm;
		padding: calc($x-space-xs / 2) $x-space-sm;

		.kb-label {
			font-size: $x-font-size-md;
			@include fonts-stack('Satoshi-Regular', sans);
			color: var(--color-text);
		}
	}

	.kb-controls {
		display: flex;
		align-items: center;
		gap: calc($x-space-xs / 2);
	}

	.kb-capture {
		min-width: calc($x-space-xxxl * 2);
		background: var(--color-surface);
		color: var(--color-text);
		border: 1px solid var(--color-bg);
		border-radius: calc($x-space-xs / 2);
		padding: calc($x-space-xs / 4) $x-space-xs;
		font-size: $x-font-size-md;
		cursor: pointer;
		@include fonts-stack('Satoshi-Regular', sans);

		&.recording {
			border-color: var(--color-accent, #5b8cff);
			color: var(--color-text-muted);
		}
	}

	.kb-reset {
		background: none;
		border: none;
		color: var(--color-text-muted);
		cursor: pointer;
		padding: calc($x-space-xs / 4);
		font-size: $x-font-size-sm;

		&:hover {
			color: var(--color-text);
		}
	}
</style>
