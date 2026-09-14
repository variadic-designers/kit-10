// Shared GSAP types and small DOM/geometry helpers for the landing choreography.

export type Gsap = typeof import('gsap').gsap;
export type ScrollTriggerClass = typeof import('gsap/ScrollTrigger').ScrollTrigger;
export type TweenVars = gsap.TweenVars;
export type TweenTarget = gsap.TweenTarget;
export type Timeline = gsap.core.Timeline;

// True when the trigger's top edge still sits below the reveal line. Elements already
// on screen just stay visible instead of replaying their entrance.
export function belowFold(trigger: Element, fraction: number): boolean {
	return trigger.getBoundingClientRect().top > window.innerHeight * fraction;
}

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
