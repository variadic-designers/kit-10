// Per-section choreography: the load entrance, the pinned hero exit, and one
// transform/opacity-only scroll reveal per landing section, each graphic with its own
// tailored motion. Every function is a no-op when its markup is missing, so the index
// can call them all unconditionally.

import { reveal, revealTimeline } from './animation-constructs.js';
import { splitWordsForReveal } from './utils.js';
import type { Gsap } from './utils.js';

// ── Entrance (load) ────────────────────────────────────────────────────────────

export function entrance(gsap: Gsap, root: HTMLElement, eligible: boolean): void {
	const nav = root.querySelector('nav');
	const cursor = root.querySelector<HTMLElement>('.cursor-2');
	const h1 = root.querySelector<HTMLElement>('.hero-content h1');
	const sub = root.querySelector<HTMLElement>('.hero-sub');
	const cta = root.querySelector<HTMLElement>('.hero-cta');
	const glyph = root.querySelector<SVGElement>('.hero-glyph');
	if (!nav || !h1 || !sub || !cta || !glyph || !eligible) return;

	const words = splitWordsForReveal(h1);

	gsap.set(nav, { y: '-100%', opacity: 0 });
	gsap.set(words, { y: '0.6em', opacity: 0 });
	gsap.set([sub, cta], { y: 20, opacity: 0 });
	gsap.set(cursor, { y: -220, opacity: 1 });
	gsap.set(glyph, { opacity: 0, scale: 0.9, rotate: -8, transformOrigin: '50% 50%' });

	gsap
		.timeline({ defaults: { ease: 'power3.out' } })
		.to(nav, { y: 0, opacity: 1, duration: 0.55 }, 0)
		.to(words, { y: 0, opacity: 1, duration: 0.75, stagger: 0.05 }, 0.12)
		.to(sub, { y: 0, opacity: 1, duration: 0.6 }, 0.45)
		.to(cta, { y: 0, opacity: 1, duration: 0.6 }, 0.55)
		.to(cursor, { x: 0, y:0, duration: 1, ease: 'power3.out' })
		.to(glyph, { opacity: 1, scale: 1, rotate: 0, duration: 1, ease: 'power4.out' }, '<0.5');
}

// ── Hero exit (scroll, pinned) ─────────────────────────────────────────────────

export function heroExit(gsap: Gsap, root: HTMLElement): void {
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
		.to(visual, { yPercent: 12, duration: 0.5 }, 0);
}

// ── Section reveals ────────────────────────────────────────────────────────────

export function revealSectionTexts(gsap: Gsap, root: HTMLElement): void {
	for (const text of root.querySelectorAll('.section-text')) {
		// Lists animate as their items, so ticks cascade one line at a time.
		const targets = [...text.children].flatMap((child) =>
			child.tagName === 'UL' ? [...child.children] : [child]
		);
		reveal(gsap, text, targets, { y: 26, opacity: 0 });
	}
}

export function revealHandoff(gsap: Gsap, root: HTMLElement): void {
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

export function revealDemo(gsap: Gsap, root: HTMLElement): void {
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

export function revealAnatomy(gsap: Gsap, root: HTMLElement): void {
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

export function revealSpecificity(gsap: Gsap, root: HTMLElement): void {
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

export function revealGraph(gsap: Gsap, root: HTMLElement): void {
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

export function revealFlow(gsap: Gsap, root: HTMLElement): void {
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

export function revealCta(gsap: Gsap, root: HTMLElement): void {
	const cta = root.querySelector('.cta-section');
	if (!cta) return;
	reveal(gsap, cta, [...cta.children], { y: 26, opacity: 0, stagger: 0.1 }, 0.8);
}

export function revealFooter(gsap: Gsap, root: HTMLElement): void {
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
