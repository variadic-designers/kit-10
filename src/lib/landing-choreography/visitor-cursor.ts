// The Guest cursor is the visitor's own pointer, deliberately outside the GSAP system.
// The other cursors are choreography (fictional collaborators); this one is input
// feedback, so it mounts for the whole landing lifecycle and ignores the reduced-motion
// bail: following the pointer is not authored motion, and under reduced motion it simply
// tracks 1:1 instead of easing behind. It stays hidden until the first pointer move, so
// it joins the session where the visitor actually is rather than pretending to sit at
// the viewport center, and it relies on the shared .cursor rule's pointer-events: none
// to never sit under the pointer eating clicks.
//
// On top of following the pointer, it answers input state with the same forms the OS
// cursor would: the pointing hand over interactive elements (hover), a squish with a
// springy release (press), and an up-down readout while the page is scrolling. The
// tracker only decides when each state class on the root is true; the stylesheet owns
// what every form looks like. Touch never engages the cursor at all, so every handler
// below skips it the same way the tracking path does.

import { reducedMotionNow } from './guards.js';

// Trailing ease toward the pointer, per second and frame-rate compensated in the loop,
// so the lag feels identical at 60Hz and 144Hz.
const FOLLOW_RATE = 12;
const SETTLE_PX = 0.1;

// How long the scroll form holds after the last scroll activity before releasing.
const SCROLL_SETTLE_MS = 180;

// The set of elements the OS cursor answers with its pointer hand.
const INTERACTIVE_SELECTOR = 'a, button, input, select, textarea, label, summary, [role="button"]';

// Wires the .cursor--you element inside the landing root to the visitor's pointer.
// Returns a disposer that removes the listeners, cancels any pending frame and scroll
// timer, and clears the inline state and classes it applied, mirroring the
// choreography's honest-disposer contract.
export function trackVisitorCursor(root: HTMLElement): () => void {
	const cursor = root.querySelector<HTMLElement>('.cursor--you');
	if (!cursor || typeof window === 'undefined') return () => {};

	let raf = 0;
	let last = 0;
	let x = 0;
	let y = 0;
	let targetX = 0;
	let targetY = 0;
	let engaged = false;
	let hovering = false;
	let scrollTimer: ReturnType<typeof setTimeout> | undefined;

	const apply = () => {
		cursor.style.transform = `translate3d(${x}px, ${y}px, 0)`;
	};

	const step = (now: number) => {
		// Clamp the frame delta so a backgrounded tab cannot fling the trail on return.
		const dt = last ? Math.min(now - last, 100) : 1000 / 60;
		last = now;
		const k = 1 - Math.exp((-dt / 1000) * FOLLOW_RATE);
		x += (targetX - x) * k;
		y += (targetY - y) * k;
		apply();
		if (Math.abs(targetX - x) <= SETTLE_PX && Math.abs(targetY - y) <= SETTLE_PX) {
			x = targetX;
			y = targetY;
			apply();
			raf = 0;
			last = 0;
			return;
		}
		raf = requestAnimationFrame(step);
	};

	// Guarded on change so the high-frequency pointer events stay cheap: the class
	// toggle only runs when the answer actually flips.
	const syncHover = (event: PointerEvent) => {
		const next =
			event.target instanceof Element && event.target.closest(INTERACTIVE_SELECTOR) !== null;
		if (next !== hovering) {
			hovering = next;
			cursor.classList.toggle('cursor--hover', next);
		}
	};

	const onPointerDown = (event: PointerEvent) => {
		if (event.pointerType === 'touch') return;
		cursor.classList.add('cursor--press');
	};

	const releasePress = () => cursor.classList.remove('cursor--press');

	const onScrollActivity = () => {
		cursor.classList.add('cursor--scrolling');
		clearTimeout(scrollTimer);
		scrollTimer = setTimeout(() => cursor.classList.remove('cursor--scrolling'), SCROLL_SETTLE_MS);
	};

	const onPointerMove = (event: PointerEvent) => {
		// Touch has no hover cursor to mirror; pen and mouse do.
		if (event.pointerType === 'touch') return;
		targetX = event.clientX;
		targetY = event.clientY;
		syncHover(event);
		if (!engaged) {
			// First move: join exactly at the pointer, no glide in from the old spot.
			engaged = true;
			x = targetX;
			y = targetY;
			apply();
			cursor.classList.add('cursor--engaged');
			return;
		}
		if (reducedMotionNow()) {
			x = targetX;
			y = targetY;
			apply();
			return;
		}
		if (!raf) raf = requestAnimationFrame(step);
	};

	window.addEventListener('pointermove', onPointerMove, { passive: true });
	// pointerover re-syncs hover on element boundaries the move path can miss, e.g.
	// content scrolling under a stationary pointer.
	window.addEventListener('pointerover', syncHover, { passive: true });
	window.addEventListener('pointerdown', onPointerDown, { passive: true });
	window.addEventListener('pointerup', releasePress, { passive: true });
	window.addEventListener('pointercancel', releasePress, { passive: true });
	window.addEventListener('blur', releasePress);
	// wheel catches trackpad flicks at the scroll edges, where no scroll event fires.
	window.addEventListener('scroll', onScrollActivity, { passive: true });
	window.addEventListener('wheel', onScrollActivity, { passive: true });

	return () => {
		window.removeEventListener('pointermove', onPointerMove);
		window.removeEventListener('pointerover', syncHover);
		window.removeEventListener('pointerdown', onPointerDown);
		window.removeEventListener('pointerup', releasePress);
		window.removeEventListener('pointercancel', releasePress);
		window.removeEventListener('blur', releasePress);
		window.removeEventListener('scroll', onScrollActivity);
		window.removeEventListener('wheel', onScrollActivity);
		if (raf) cancelAnimationFrame(raf);
		clearTimeout(scrollTimer);
		cursor.classList.remove(
			'cursor--engaged',
			'cursor--hover',
			'cursor--press',
			'cursor--scrolling'
		);
		cursor.style.transform = '';
	};
}
