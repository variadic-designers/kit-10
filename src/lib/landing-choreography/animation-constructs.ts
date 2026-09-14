// Reusable reveal constructs: either a single tween batch or a caller-built timeline,
// both one-shot on first scroll into view and both skipped entirely when the trigger is
// already on screen, so a remount never replays finished entrances.

import { belowFold } from './utils.js';
import type { Gsap, Timeline, TweenTarget, TweenVars } from './utils.js';

export function reveal(
	gsap: Gsap,
	trigger: Element,
	targets: TweenTarget,
	vars: TweenVars,
	fraction = 0.8
): void {
	if (!belowFold(trigger, fraction)) return;
	gsap.from(targets, {
		duration: 0.7,
		ease: 'power3.out',
		stagger: 0.08,
		...vars,
		scrollTrigger: { trigger, start: `top ${fraction * 100}%`, once: true }
	});
}

export function revealTimeline(
	gsap: Gsap,
	trigger: Element,
	fraction: number,
	build: (tl: Timeline) => void
): void {
	if (!belowFold(trigger, fraction)) return;
	const tl = gsap.timeline({
		defaults: { ease: 'power3.out' },
		scrollTrigger: { trigger, start: `top ${fraction * 100}%`, once: true }
	});
	build(tl);
}
