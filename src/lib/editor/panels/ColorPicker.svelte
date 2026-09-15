<script lang="ts">
	// The shared oklch picker body: a lightness x chroma plane (drag both at once - that's the
	// actual relationship a designer is reasoning about, not two independent numbers) plus
	// gradient-filled hue/alpha rails, and a collapsible raw-text escape hatch for pasting a
	// legacy hex/rgb/hsl value. Every commit delivers canonical `oklch(...)` to `onCommit` --
	// editing a legacy value through this widget upgrades it on first touch (hex/rgb/hsl are
	// accepted input, never re-authored). Used by the Render panel's ColorField (expanded state)
	// and the Tokens panel's expanded color-token row, so a color is edited identically in both.
	// Gamut-mapping/fallback-visibility (Phase 2), oklch.com-style 2D graphs (Phase 3), and P3
	// awareness (Phase 4) are deliberately not built yet - see resources/oklch.md.
	import { parseCssColorToOklch, formatOklch } from '$lib/color/oklch.js';

	type ColorPickerProps = {
		// The raw CSS color string to sync from (any form parseCssColorToOklch accepts); null
		// starts the plane at the neutral FALLBACK starting point.
		value: string | null;
		// Dims the whole picker (a value-less color's FALLBACK mid-gray must not read as an
		// actively-authored gray). Opacity only - never pointer-events:none, since dragging is
		// exactly how you add the color.
		muted?: boolean;
		onCommit: (raw: string) => void;
	};

	let { value, muted = false, onCommit }: ColorPickerProps = $props();

	// A neutral, mid-lightness starting point when nothing is set yet or the stored value is
	// unparseable -- lets a designer start dragging immediately rather than hitting a dead end.
	const FALLBACK = { l: 0.5, c: 0, h: 0, alpha: 1 };
	// Domain ceiling for the plane's chroma axis - mirrors the old chroma slider's own max, itself
	// chosen because real, in-gamut OKLCH chroma rarely exceeds it (see resources/oklch.md).
	const C_MAX = 0.37;

	let l = $state(FALLBACK.l);
	let c = $state(FALLBACK.c);
	let h = $state(FALLBACK.h);
	let alpha = $state(FALLBACK.alpha);
	let rawText = $state('');
	let rawInvalid = $state(false);

	// Resync local slider state whenever the resolved value changes underneath us (a different
	// layer/axis selection, an external write, or the initial mount) -- never while the user is
	// actively dragging, since that's local-only until committed on pointerup/keydown.
	let lastSyncedRaw: string | null | undefined = undefined;
	$effect(() => {
		if (value === lastSyncedRaw) return;
		lastSyncedRaw = value;
		const parsed = parseCssColorToOklch(value) ?? FALLBACK;
		l = parsed.l;
		c = parsed.c;
		h = parsed.h;
		alpha = parsed.alpha;
		rawText = value ?? '';
		rawInvalid = false;
	});

	// Plane background: N stacked horizontal gradient bands (lightness 1 at the top, 0 at the
	// bottom), each spanning chroma 0..C_MAX at the CURRENT hue - a true 2D oklch gradient has no
	// single CSS syntax, so this is the same "many linear-gradient layers" trick real OKLCH pickers
	// (oklch.com included) use. A slight per-band height overlap avoids visible seams between rows.
	const planeBackground = $derived.by(() => {
		const rows = 14;
		const layers: string[] = [];
		for (let i = 0; i < rows; i++) {
			const rowL = 1 - i / rows;
			const from = formatOklch(rowL, 0, h, 1);
			const to = formatOklch(rowL, C_MAX, h, 1);
			const top = (i / rows) * 100;
			const height = 100 / rows + 0.6;
			layers.push(
				`linear-gradient(to right, ${from}, ${to}) 0 ${top}% / 100% ${height}% no-repeat`
			);
		}
		return layers.join(', ');
	});

	// Hue and alpha are vertical rails, top-to-bottom, sitting beside the plane rather than as
	// full-width rows underneath it. Top = 0deg / fully opaque, matching the plane's own
	// top = full-lightness convention.

	// Hue rail: a fixed, vivid representative L/C regardless of the CURRENT color, so the rail
	// stays legible/informative even when the current color is itself near-gray or near-black -
	// the same choice most HSB-style pickers make for their own hue bar.
	const HUE_RAIL_L = 0.75;
	const HUE_RAIL_C = 0.19;
	const hueBackground = $derived.by(() => {
		const stops: string[] = [];
		for (let i = 0; i <= 12; i++) {
			stops.push(formatOklch(HUE_RAIL_L, HUE_RAIL_C, i * 30, 1));
		}
		return `linear-gradient(to bottom, ${stops.join(', ')})`;
	});

	// Alpha rail: the CURRENT color from fully opaque (top) to fully transparent (bottom) - alpha's
	// whole meaning is "how much of THIS color shows", so unlike the hue rail this one must track
	// l/c/h live.
	const alphaBackground = $derived(
		`linear-gradient(to bottom, ${formatOklch(l, c, h, 1)}, ${formatOklch(l, c, h, 0)})`
	);

	const planeThumbLeft = $derived(`${Math.min(Math.max(c / C_MAX, 0), 1) * 100}%`);
	const planeThumbTop = $derived(`${(1 - Math.min(Math.max(l, 0), 1)) * 100}%`);
	const hueThumbTop = $derived(`${(h / 360) * 100}%`);
	const alphaThumbTop = $derived(`${(1 - alpha) * 100}%`);

	function commit() {
		onCommit(formatOklch(l, c, h, alpha));
	}

	// --- Plane + rail drag interaction ---
	// Continuous local updates for live visual feedback while dragging; the actual write only
	// happens once on pointerup (or once per keydown nudge) - mirrors the old range inputs' own
	// `onchange`-only-on-release semantic, so a drag doesn't spam the DB/undo history with every
	// intermediate position.
	let planeEl: HTMLDivElement | undefined = $state();
	let hueEl: HTMLDivElement | undefined = $state();
	let alphaEl: HTMLDivElement | undefined = $state();

	function beginDrag(getEl: () => HTMLElement | undefined, onMove: (x: number, y: number) => void) {
		return (e: PointerEvent) => {
			const el = getEl();
			if (!el) return;
			const rect = el.getBoundingClientRect();
			const apply = (ev: PointerEvent) => {
				const x = Math.min(Math.max((ev.clientX - rect.left) / rect.width, 0), 1);
				const y = Math.min(Math.max((ev.clientY - rect.top) / rect.height, 0), 1);
				onMove(x, y);
			};
			apply(e);
			const onMoveWin = (ev: PointerEvent) => apply(ev);
			const onUp = () => {
				window.removeEventListener('pointermove', onMoveWin);
				window.removeEventListener('pointerup', onUp);
				commit();
			};
			window.addEventListener('pointermove', onMoveWin);
			window.addEventListener('pointerup', onUp);
		};
	}

	const handlePlanePointerDown = beginDrag(
		() => planeEl,
		(x, y) => {
			c = x * C_MAX;
			l = 1 - y;
		}
	);
	// Hue and alpha are vertical rails now (top-to-bottom, alongside the plane rather than
	// stacked full-width rows below it) - both read the drag's y, not x.
	const handleHuePointerDown = beginDrag(
		() => hueEl,
		(_x, y) => {
			h = y * 360;
		}
	);
	const handleAlphaPointerDown = beginDrag(
		() => alphaEl,
		(_x, y) => {
			alpha = 1 - y;
		}
	);

	// Keyboard fallback for the three pointer-driven controls - Up/Down nudge by a small step
	// (Left/Right too on the plane, since it's still the one 2D control), Shift for a coarser
	// one. Each key press commits immediately (no separate "release" event exists for keyboard
	// input), matching how this panel's other steppers (RadiusField's nudgeRadius, StyleField's
	// spacing stepper) already commit per-press.
	function handlePlaneKeydown(e: KeyboardEvent) {
		const step = e.shiftKey ? 0.02 : 0.005;
		const lStep = e.shiftKey ? 0.05 : 0.01;
		if (e.key === 'ArrowLeft') c = Math.max(0, c - step);
		else if (e.key === 'ArrowRight') c = Math.min(C_MAX, c + step);
		else if (e.key === 'ArrowUp') l = Math.min(1, l + lStep);
		else if (e.key === 'ArrowDown') l = Math.max(0, l - lStep);
		else return;
		e.preventDefault();
		commit();
	}

	function handleHueKeydown(e: KeyboardEvent) {
		const step = e.shiftKey ? 10 : 2;
		if (e.key === 'ArrowUp') h = (h - step + 360) % 360;
		else if (e.key === 'ArrowDown') h = (h + step) % 360;
		else return;
		e.preventDefault();
		commit();
	}

	function handleAlphaKeydown(e: KeyboardEvent) {
		const step = e.shiftKey ? 0.05 : 0.01;
		if (e.key === 'ArrowUp') alpha = Math.min(1, alpha + step);
		else if (e.key === 'ArrowDown') alpha = Math.max(0, alpha - step);
		else return;
		e.preventDefault();
		commit();
	}

	function commitRaw() {
		const parsed = parseCssColorToOklch(rawText);
		if (!parsed) {
			rawInvalid = true;
			return;
		}
		rawInvalid = false;
		l = parsed.l;
		c = parsed.c;
		h = parsed.h;
		alpha = parsed.alpha;
		commit();
	}
</script>

<div class="color-picker" class:color-picker--muted={muted}>
	<div
		bind:this={planeEl}
		class="color-picker__plane"
		style="background: {planeBackground}"
		role="slider"
		tabindex="0"
		aria-label="Lightness and chroma"
		aria-valuenow={Math.round(l * 100)}
		aria-valuemin="0"
		aria-valuemax="100"
		aria-valuetext="L {Math.round(l * 100)}%, C {c.toFixed(3)}"
		onpointerdown={handlePlanePointerDown}
		onkeydown={handlePlaneKeydown}
	>
		<div
			class="color-picker__plane-thumb"
			style="left: {planeThumbLeft}; top: {planeThumbTop};"
		></div>
	</div>

	<!-- Hue + alpha as two narrow vertical rails beside the plane, not two more full-width
	     rows below it - the plane's own height already sets this row's height, so the
	     rails spend that height instead of adding to it. -->
	<div class="color-picker__rails">
		<div class="color-picker__strip">
			<span class="color-picker__strip-label">H</span>
			<div
				bind:this={hueEl}
				class="color-picker__strip-track"
				style="background: {hueBackground}"
				role="slider"
				tabindex="0"
				aria-label="Hue"
				aria-orientation="vertical"
				aria-valuenow={Math.round(h)}
				aria-valuemin="0"
				aria-valuemax="360"
				onpointerdown={handleHuePointerDown}
				onkeydown={handleHueKeydown}
			>
				<div class="color-picker__strip-thumb" style="top: {hueThumbTop};"></div>
			</div>
			<span class="color-picker__strip-val">{Math.round(h)}°</span>
		</div>

		<div class="color-picker__strip">
			<span class="color-picker__strip-label">A</span>
			<div
				bind:this={alphaEl}
				class="color-picker__strip-track color-picker__strip-track--checker"
				role="slider"
				tabindex="0"
				aria-label="Alpha"
				aria-orientation="vertical"
				aria-valuenow={Math.round(alpha * 100)}
				aria-valuemin="0"
				aria-valuemax="100"
				onpointerdown={handleAlphaPointerDown}
				onkeydown={handleAlphaKeydown}
			>
				<div class="color-picker__strip-track-fill" style="background: {alphaBackground}"></div>
				<div class="color-picker__strip-thumb" style="top: {alphaThumbTop};"></div>
			</div>
			<span class="color-picker__strip-val">{Math.round(alpha * 100)}%</span>
		</div>
	</div>

	<details class="color-picker__raw">
		<summary>Raw value</summary>
		<input
			type="text"
			class="color-picker__raw-input"
			class:color-picker__raw-input--invalid={rawInvalid}
			bind:value={rawText}
			placeholder="oklch(70% 0.15 30), #3b82f6, rgb(…), …"
			onblur={commitRaw}
			onkeydown={(e) => {
				if (e.key === 'Enter') commitRaw();
			}}
		/>
	</details>
</div>

<style lang="scss">
	@use '_index' as *;

	// Plane on the left (near-square), hue+alpha as two narrow vertical rails on the right -
	// the plane's own height sets the row height (auto-sized column), so the rails spend that
	// height instead of adding two more full-width rows underneath (the previous layout).
	.color-picker {
		display: grid;
		grid-template-columns: 1fr auto;
		align-items: stretch;
		gap: $x-space-xs;

		// Muted while unset so FALLBACK's mid-gray positions don't read as an active gray.
		&--muted {
			opacity: 0.6;
		}
	}

	.color-picker__plane {
		position: relative;
		width: 100%;
		aspect-ratio: 1.2 / 1;
		border-radius: 6px;
		border: 1px solid var(--color-panel-header-border);
		cursor: crosshair;
		touch-action: none;
		overflow: hidden;

		&:focus-visible {
			outline: 2px solid var(--color-primary);
			outline-offset: 1px;
		}
	}

	.color-picker__plane-thumb {
		position: absolute;
		width: 13px;
		height: 13px;
		border-radius: 50%;
		border: 2px solid var(--color-pure);
		box-shadow:
			0 0 0 1px rgba(0, 0, 0, 0.4),
			0 1px 3px rgba(0, 0, 0, 0.35);
		transform: translate(-50%, -50%);
		pointer-events: none;
	}

	// Two vertical strips side by side, each stretched (flex default align-items: stretch) to
	// the rails container's own height, which in turn matches the plane's height via the grid
	// row's align-items: stretch above.
	.color-picker__rails {
		display: flex;
		flex-direction: row;
		gap: $x-space-xs;
		min-width: 0;
	}

	.color-picker__strip {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: calc($x-space-xs / 2);
		min-width: 2.2em;
	}

	.color-picker__strip-label {
		flex: 0 0 auto;
		font-size: $x-font-size-xs;
		color: var(--color-add-var-text);
		text-transform: uppercase;
	}

	.color-picker__strip-track {
		position: relative;
		flex: 1;
		width: 10px;
		border-radius: 6px;
		border: 1px solid var(--color-panel-header-border);
		cursor: pointer;
		touch-action: none;
		overflow: hidden;

		&:focus-visible {
			outline: 2px solid var(--color-primary);
			outline-offset: 1px;
		}

		// Alpha rail only - a checkerboard sits BEHIND the transparent-to-opaque gradient fill,
		// same convention every other transparency UI (browser devtools, design tools) uses.
		&--checker {
			background-image:
				linear-gradient(45deg, var(--color-panel-header-border) 25%, transparent 25%),
				linear-gradient(-45deg, var(--color-panel-header-border) 25%, transparent 25%),
				linear-gradient(45deg, transparent 75%, var(--color-panel-header-border) 75%),
				linear-gradient(-45deg, transparent 75%, var(--color-panel-header-border) 75%);
			background-size: 8px 8px;
			background-position:
				0 0,
				0 4px,
				4px -4px,
				-4px 0;
		}
	}

	.color-picker__strip-track-fill {
		position: absolute;
		inset: 0;
	}

	.color-picker__strip-thumb {
		position: absolute;
		left: 50%;
		width: 13px;
		height: 13px;
		border-radius: 50%;
		border: 2px solid var(--color-pure);
		box-shadow:
			0 0 0 1px rgba(0, 0, 0, 0.4),
			0 1px 3px rgba(0, 0, 0, 0.35);
		transform: translate(-50%, -50%);
		pointer-events: none;
	}

	// Fixed width (not just min-width) sized for the widest either rail ever shows ("360°",
	// "100%") - letting this fluctuate with digit count (e.g. "86%" -> "100%") resizes the
	// __rails auto grid column, which shrinks the plane's own 1fr column and, via its
	// aspect-ratio, its height - a one-character value change must never move the plane.
	.color-picker__strip-val {
		flex: 0 0 auto;
		width: 2.4em;
		text-align: center;
		font-size: $x-font-size-xs;
		color: var(--color-add-var-text);
		font-variant-numeric: tabular-nums;
	}

	.color-picker__raw {
		grid-column: 1 / -1;
		margin-top: calc($x-space-xs / 2);
		font-size: $x-font-size-xs;

		summary {
			cursor: pointer;
			color: var(--color-add-var-text);
			list-style: none;

			&::-webkit-details-marker {
				display: none;
			}

			&:hover {
				color: var(--color-text);
			}

			&::before {
				content: '▸ ';
			}
		}

		&[open] summary::before {
			content: '▾ ';
		}
	}

	.color-picker__raw-input {
		all: unset;
		display: block;
		width: 100%;
		margin-top: calc($x-space-xs / 2);
		padding: calc($x-space-xs / 2) $x-space-xs;
		border-radius: 2px;
		background: var(--color-panel-header-fill);
		color: var(--color-text);
		box-sizing: border-box;

		&--invalid {
			outline: 1px solid var(--color-danger);
		}
	}
</style>
