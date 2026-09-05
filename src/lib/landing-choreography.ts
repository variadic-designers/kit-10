// Landing page choreography (GSAP + ScrollTrigger).
//
// Shape of the system:
// - A module-level pre-hide class keeps the nav and hero invisible from first paint until
//   the entrance timeline has installed its real initial states, so the reveal never plays
//   catch-up against already-visible content. Three ways out: the choreography lifts it
//   once states are installed, a failsafe timer lifts it if the chunks never arrive, and
//   it is never added at all when the visitor opted out of motion.
// - One entrance timeline on load (nav, headline words, sub, CTAs, glyph).
// - The pinned, scrubbed hero exit, kept from the previous implementation, plus a small
//   glyph drift for parallax depth.
// - One-shot scroll reveals per section, transform/opacity only, each graphic with its
//   own tailored motion. Elements already on screen when this runs (theme remount,
//   restored scroll) are left visible instead of replaying their entrance.
// - Reduced motion, the app's own setting first and the OS preference for "auto",
//   gets none of it: no pre-hide, no pin, no triggers, content in its final state.

import { getReducedMotion } from '$lib/reduced-motion.js';

type Gsap = typeof import('gsap').gsap;
type ScrollTriggerClass = typeof import('gsap/ScrollTrigger').ScrollTrigger;
type TweenVars = gsap.TweenVars;
type TweenTarget = gsap.TweenTarget;
type Timeline = gsap.core.Timeline;

const PENDING_CLASS = 'landing-anim-pending';
const PENDING_FAILSAFE_MS = 4000;

let failsafeTimer: ReturnType<typeof setTimeout> | undefined;

// The app persists its reduced-motion override as a cookie (setReducedMotionCookie).
// Reading it here lets the pre-hide guard agree with the store before hydration runs;
// no cookie means "auto", which defers to the OS preference.
function forcedReducedMotion(): 'reduce' | 'no-reduce' | null {
	if (typeof document === 'undefined') return null;
	const match = document.cookie.match(/(?:^|;\s*)reduced-motion=([^;]*)/);
	if (!match) return null;
	return decodeURIComponent(match[1]) === 'reduce' ? 'reduce' : 'no-reduce';
}

function osPrefersReducedMotion(): boolean {
	return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// Runs from the page's module script, i.e. as early as the route chunk exists. Purely
// additive: the failsafe guarantees the content appears even if everything downstream
// fails, and visitors who opted out of motion never see the guard at all.
export function armLandingPrehide(): void {
	if (typeof window === 'undefined') return;
	if (forcedReducedMotion() === 'reduce') return;
	if (forcedReducedMotion() === null && osPrefersReducedMotion()) return;
	document.documentElement.classList.add(PENDING_CLASS);
	if (failsafeTimer !== undefined) clearTimeout(failsafeTimer);
	failsafeTimer = setTimeout(() => {
		failsafeTimer = undefined;
		document.documentElement.classList.remove(PENDING_CLASS);
	}, PENDING_FAILSAFE_MS);
}

function disarmPrehide(): void {
	if (failsafeTimer !== undefined) {
		clearTimeout(failsafeTimer);
		failsafeTimer = undefined;
	}
	document.documentElement.classList.remove(PENDING_CLASS);
}

function reducedMotionNow(): boolean {
	const setting = getReducedMotion() ?? 'auto';
	if (setting === 'reduce') return true;
	if (setting === 'no-reduce') return false;
	return osPrefersReducedMotion();
}

// True when the trigger's top edge still sits below the reveal line. Elements already
// on screen just stay visible instead of replaying their entrance.
function belowFold(trigger: Element, fraction: number): boolean {
	return trigger.getBoundingClientRect().top > window.innerHeight * fraction;
}

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

// ── Entrance (load) ────────────────────────────────────────────────────────────

// Split h1 into per-word spans so each word can rise on its own: an outer .hero-word
// that preserves inline layout, and an inner .hero-word-inner that the tween actually
// transforms. The accent spans stay whole (one word each, so their gradient boxes are
// unchanged) and the split preserves the original text nodes plus the whitespace
// between words, so assistive tech and copy/paste see exactly what was there before.
export function splitWordsForReveal(h1: HTMLElement): HTMLElement[] {
	const words: HTMLElement[] = [];
	const wrap = (node: ChildNode): HTMLElement => {
		const word = document.createElement('span');
		word.className = 'hero-word';
		const inner = document.createElement('span');
		inner.className = 'hero-word-inner';
		word.append(inner);
		// Replace first, move second: appending the node into the wrapper before the
		// replaceWith would make `word` an ancestor of `node` and replaceWith throws
		// ("The new child is an ancestor of the parent").
		node.replaceWith(word);
		inner.append(node);
		return word;
	};
	for (const node of [...h1.childNodes]) {
		if (node.nodeType === Node.TEXT_NODE) {
			const frag = document.createDocumentFragment();
			for (const part of (node.textContent ?? '').split(/(\s+)/)) {
				if (!part) continue;
				if (/^\s+$/.test(part)) {
					frag.append(' ');
				} else {
					const word = wrap(document.createTextNode(part));
					frag.append(word);
					words.push(word.firstElementChild as HTMLElement);
				}
			}
			node.replaceWith(frag);
		} else if (node.nodeType === Node.ELEMENT_NODE) {
			// wrap() already performed the replaceWith; do not repeat it, since node now
			// lives inside word and replacing it again would throw (ancestor of parent).
			const word = wrap(node);
			words.push(word.firstElementChild as HTMLElement);
		}
	}
	return words;
}

function entrance(gsap: Gsap, root: HTMLElement, eligible: boolean): void {
	const nav = root.querySelector('nav');
	const h1 = root.querySelector<HTMLElement>('.hero-content h1');
	const sub = root.querySelector<HTMLElement>('.hero-sub');
	const cta = root.querySelector<HTMLElement>('.hero-cta');
	const glyph = root.querySelector<SVGElement>('.hero-glyph');
	if (!nav || !h1 || !sub || !cta || !glyph || !eligible) return;

	const words = splitWordsForReveal(h1);

	gsap.set(nav, { y: -14, opacity: 0 });
	gsap.set(words, { y: '0.6em', opacity: 0 });
	gsap.set([sub, cta], { y: 20, opacity: 0 });
	gsap.set(glyph, { opacity: 0, scale: 0.9, rotate: -8, transformOrigin: '50% 50%' });

	gsap
		.timeline({ defaults: { ease: 'power3.out' } })
		.to(nav, { y: 0, opacity: 1, duration: 0.55 }, 0)
		.to(words, { y: 0, opacity: 1, duration: 0.75, stagger: 0.05 }, 0.12)
		.to(sub, { y: 0, opacity: 1, duration: 0.6 }, 0.45)
		.to(cta, { y: 0, opacity: 1, duration: 0.6 }, 0.55)
		.to(glyph, { opacity: 1, scale: 1, rotate: 0, duration: 1, ease: 'power4.out' }, 0.3);
}

// ── Hero exit (scroll, pinned) ─────────────────────────────────────────────────

function heroExit(gsap: Gsap, root: HTMLElement): void {
	const hero = root.querySelector<HTMLElement>('.hero');
	const visual = root.querySelector<HTMLElement>('.hero-visual');
	if (!hero || !visual) return;
	gsap
		.timeline({
			defaults: { ease: 'none' },
			scrollTrigger: {
				trigger: hero,
				start: 'top top',
				end: 'bottom top',
				pin: true,
				pinSpacing: false,
				anticipatePin: 1,
				scrub: 1.5
			}
		})
		// The hero recedes while the glyph drifts a little further, so the two halves
		// separate slightly instead of shrinking as one flat block.
		.to(hero, { scale: 0.85, opacity: 0, ease: 'power1.inOut', duration: 1 }, 0)
		.to(visual, { yPercent: 12, duration: 1 }, 0);
}

// ── Shared reveal helpers ──────────────────────────────────────────────────────

function reveal(
	gsap: Gsap,
	trigger: Element,
	targets: TweenTarget,
	vars: TweenVars,
	fraction = 0.85
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

function revealTimeline(
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

// ── Section reveals ────────────────────────────────────────────────────────────

function revealSectionTexts(gsap: Gsap, root: HTMLElement): void {
	for (const text of root.querySelectorAll('.section-text')) {
		// Lists animate as their items, so ticks cascade one line at a time.
		const targets = [...text.children].flatMap((child) =>
			child.tagName === 'UL' ? [...child.children] : [child]
		);
		reveal(gsap, text, targets, { y: 26, opacity: 0 });
	}
}

function revealHandoff(gsap: Gsap, root: HTMLElement): void {
	const bridge = root.querySelector('.g-bridge');
	if (!bridge) return;
	revealTimeline(gsap, bridge, 0.78, (tl) => {
		tl.from(
			bridge.querySelector('.g-bridge__card--design'),
			{ x: -32, opacity: 0, duration: 0.65 },
			0
		)
			.from(
				bridge.querySelector('.g-bridge__card--code'),
				{ x: 32, opacity: 0, duration: 0.65 },
				0.12
			)
			.from(
				bridge.querySelector('.g-bridge__link'),
				{ opacity: 0, scale: 0.92, duration: 0.45 },
				0.34
			)
			.from(
				bridge.querySelectorAll('.chip'),
				{ opacity: 0, scale: 0.7, y: 6, duration: 0.4, stagger: 0.07 },
				0.42
			);
	});
}

function revealDemo(gsap: Gsap, root: HTMLElement): void {
	const demo = root.querySelector('.demo');
	const caption = root.querySelector('.demo__caption');
	if (!demo) return;
	revealTimeline(gsap, demo, 0.75, (tl) => {
		tl.from(demo.querySelector('.demo__stage-wrap'), { y: 30, opacity: 0, duration: 0.7 }, 0)
			.from(demo.querySelector('.demo__code'), { y: 30, opacity: 0, duration: 0.7 }, 0.16)
			.from(
				demo.querySelectorAll('.code-line'),
				{ x: -10, opacity: 0, duration: 0.4, stagger: 0.045 },
				0.44
			);
		if (caption) tl.from(caption, { y: 16, opacity: 0, duration: 0.5 }, 0.6);
	});
}

function revealAnatomy(gsap: Gsap, root: HTMLElement): void {
	const anatomy = root.querySelector('.anatomy');
	if (!anatomy) return;
	// Steps and arrows each get their own trigger: the column is taller than a viewport,
	// so one block trigger would fire everything while the last steps are still offscreen.
	for (const step of anatomy.querySelectorAll('.anatomy__step')) {
		reveal(gsap, step, step, { y: 30, opacity: 0, duration: 0.65 });
	}
	for (const arrow of anatomy.querySelectorAll('.anatomy__arrow')) {
		reveal(
			gsap,
			arrow,
			arrow,
			{ opacity: 0, scale: 0.6, duration: 0.45, ease: 'back.out(2)' },
			0.9
		);
	}
}

function revealSpecificity(gsap: Gsap, root: HTMLElement): void {
	const tiers = root.querySelector('.g-tiers');
	if (tiers) {
		revealTimeline(gsap, tiers, 0.78, (tl) => {
			tl.from(
				tiers.querySelectorAll('.g-tier'),
				{ x: -30, opacity: 0, duration: 0.6, stagger: 0.12 },
				0
			).from(tiers.querySelector('.g-tiers__note'), { opacity: 0, y: 10, duration: 0.4 }, 0.52);
		});
	}
	const why = root.querySelector('.g-why');
	if (why) {
		revealTimeline(gsap, why, 0.78, (tl) => {
			tl.from(why, { x: 30, opacity: 0, duration: 0.65 }, 0)
				.from(why.querySelector('.g-why__stage'), { scale: 0.94, opacity: 0, duration: 0.45 }, 0.3)
				.from(
					why.querySelectorAll('.g-why__stack li'),
					{ y: 12, opacity: 0, duration: 0.35, stagger: 0.07 },
					0.38
				);
		});
	}
}

function revealGraph(gsap: Gsap, root: HTMLElement): void {
	const svg = root.querySelector<SVGElement>('.g-graph');
	if (!svg) return;
	const core = svg.querySelector('.g-graph__core');
	const edges = svg.querySelectorAll<SVGLineElement>('.g-graph__edges line');
	const sats = svg.querySelectorAll('.g-graph__sat');
	revealTimeline(gsap, svg, 0.75, (tl) => {
		if (core) {
			tl.from(
				core,
				{
					scale: 0.4,
					opacity: 0,
					duration: 0.6,
					ease: 'back.out(1.6)',
					transformOrigin: '50% 50%'
				},
				0
			);
		}
		// Draw each edge outward from the core via a stroke-dash sweep.
		edges.forEach((line, i) => {
			const len = Math.hypot(
				line.x2.baseVal.value - line.x1.baseVal.value,
				line.y2.baseVal.value - line.y1.baseVal.value
			);
			gsap.set(line, { strokeDasharray: len, strokeDashoffset: len });
			tl.to(line, { strokeDashoffset: 0, duration: 0.55, ease: 'power2.out' }, 0.18 + i * 0.06);
		});
		tl.from(
			sats,
			{
				scale: 0.85,
				opacity: 0,
				duration: 0.45,
				stagger: 0.08,
				transformOrigin: '50% 50%'
			},
			0.4
		);
	});
}

function revealFlow(gsap: Gsap, root: HTMLElement): void {
	const flow = root.querySelector('.g-flow');
	const kicker = root.querySelector('.section-kicker');
	if (!flow) return;
	revealTimeline(gsap, flow, 0.75, (tl) => {
		tl.from(
			flow.querySelectorAll('.g-flow__col'),
			{ y: 26, opacity: 0, duration: 0.6, stagger: 0.16 },
			0
		).from(flow.querySelector('.g-flow__core'), { scale: 0.9, opacity: 0, duration: 0.55 }, 0.22);
		// clearProps so the CSS rotate (90deg on mobile, 0 on md+) regains control
		// after the tween instead of being frozen into an inline transform.
		tl.from(
			flow.querySelectorAll('.g-flow__arrow'),
			{ x: -10, opacity: 0, duration: 0.4, stagger: 0.16, clearProps: 'transform' },
			0.4
		);
		if (kicker) tl.from(kicker, { y: 12, opacity: 0, duration: 0.5 }, 0.62);
	});
}

function revealCta(gsap: Gsap, root: HTMLElement): void {
	const cta = root.querySelector('.cta-section');
	if (!cta) return;
	reveal(gsap, cta, [...cta.children], { y: 26, opacity: 0, stagger: 0.1 }, 0.8);
}

function revealFooter(gsap: Gsap, root: HTMLElement): void {
	const footer = root.querySelector('.footer');
	if (!footer) return;
	reveal(
		gsap,
		footer,
		[footer.querySelector('.footer__left'), footer.querySelector('.footer__team')],
		{ y: 24, opacity: 0, stagger: 0.1 },
		0.9
	);
}
