// Landing page choreography (GSAP + ScrollTrigger).
//
// Shape of the system:
// - guards.ts owns the pre-hide class and the reduced-motion policy.
// - One entrance timeline on load (nav, headline words, sub, CTAs, glyph).
// - The pinned, scrubbed hero exit, kept from the previous implementation, plus a small
//   glyph drift for parallax depth.
// - One-shot scroll reveals per section (sections.ts), built on the shared constructs
//   in animation-constructs.ts.
// - visitor-cursor.ts is the one non-choreography resident: the Guest cursor tracks the
//   visitor's pointer for the whole mount, GSAP-free and deliberately exempt from the
//   reduced-motion bail (input feedback, not authored motion).

import { disarmPrehide, PENDING_CLASS, reducedMotionNow } from './guards.js';
import {
	entrance,
	heroExit,
	revealAnatomy,
	revealCta,
	revealDemo,
	revealFlow,
	revealFooter,
	revealGraph,
	revealHandoff,
	revealSectionTexts,
	revealSpecificity
} from './sections.js';
import type { Gsap, ScrollTriggerClass } from './utils.js';

export { armLandingPrehide } from './guards.js';
export { trackVisitorCursor } from './visitor-cursor.js';
export { splitWordsForReveal } from './utils.js';

export async function startLandingChoreography(root: HTMLElement): Promise<() => void> {
	const bail = () => {
		disarmPrehide();
		return () => {};
	};
	if (!root || reducedMotionNow()) return bail();

	let gsap: Gsap;
	let ScrollTrigger: ScrollTriggerClass;
	try {
		const [gsapModule, stModule] = await Promise.all([
			import('gsap'),
			import('gsap/ScrollTrigger')
		]);
		gsap = gsapModule.gsap;
		ScrollTrigger = stModule.ScrollTrigger;
	} catch {
		return bail();
	}
	// The setting may have flipped while the chunks were in flight.
	if (reducedMotionNow()) return bail();

	gsap.registerPlugin(ScrollTrigger);
	ScrollTrigger.config({ ignoreMobileResize: true });

	// Only a mount that still holds the pre-hide guard earns the entrance; later mounts
	// (theme remount, client-side navigation back) keep the content where it is.
	const introEligible = document.documentElement.classList.contains(PENDING_CLASS);

	let ctx: gsap.Context;
	try {
		ctx = gsap.context(() => {
			entrance(gsap, root, introEligible);
			heroExit(gsap, root);
			revealSectionTexts(gsap, root);
			revealHandoff(gsap, root);
			revealDemo(gsap, root);
			revealAnatomy(gsap, root);
			revealSpecificity(gsap, root);
			revealGraph(gsap, root);
			revealFlow(gsap, root);
			revealCta(gsap, root);
			revealFooter(gsap, root);
			// Font swaps change text metrics, and therefore every trigger position.
			document.fonts?.ready.then(() => ScrollTrigger.refresh());
		}, root);
	} catch (err) {
		// A setup failure must never leave the pre-hide guard stuck: show the content
		// statically rather than hiding it behind a broken choreography.
		console.error('Landing choreography failed to set up', err);
		return bail();
	}

	// Initial states are installed synchronously inside the context above; the real
	// styles can take over from the guard class without a flash.
	disarmPrehide();

	return () => ctx.revert();
}
