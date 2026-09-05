// Regression test for splitWordsForReveal's DOM surgery, which shipped twice with
// "Element.replaceWith: The new child is an ancestor of the parent" - once for wrapping
// before replacing, once for a redundant second replaceWith in the element branch.
// Runs against a minimal DOM stub, just enough semantics for the function under test:
// live childNodes, append() moving nodes, replaceWith() swapping in place, and a
// parentless replaceWith being a no-op per spec.

import { describe, expect, it, beforeAll } from 'vitest';
import { splitWordsForReveal } from './landing-choreography.js';

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;
const FRAGMENT_NODE = 11;

// append/replaceWith accept strings (converted to text nodes) and fragments (whose
// CHILDREN are inserted, never the fragment itself), per the real DOM.
function flattenNodes(entries: (FakeNode | string)[]): FakeNode[] {
	return entries.flatMap((entry) => {
		if (typeof entry === 'string') return [new FakeNode(TEXT_NODE, entry)];
		if (entry.nodeType === FRAGMENT_NODE) {
			const kids = [...entry.childNodes];
			kids.forEach((k) => k.remove());
			return kids;
		}
		return [entry];
	});
}

class FakeNode {
	nodeType: number;
	className = '';
	childNodes: FakeNode[] = [];
	parentNode: FakeNode | null = null;
	textContentValue: string;

	constructor(nodeType: number, textContent = '') {
		this.nodeType = nodeType;
		this.textContentValue = textContent;
	}

	// textContent is derived, like the real DOM: own text for text nodes, the
	// concatenation of descendants for everything else.
	get textContent(): string {
		if (this.nodeType === TEXT_NODE) return this.textContentValue;
		return this.childNodes.map((c) => c.textContent).join('');
	}

	get firstElementChild(): FakeNode | null {
		return this.childNodes.find((c) => c.nodeType === ELEMENT_NODE) ?? null;
	}

	remove(): void {
		if (!this.parentNode) return;
		const siblings = this.parentNode.childNodes;
		siblings.splice(siblings.indexOf(this), 1);
		this.parentNode = null;
	}

	append(...nodes: (FakeNode | string)[]): void {
		for (const node of flattenNodes(nodes)) {
			node.remove();
			node.parentNode = this;
			this.childNodes.push(node);
		}
	}

	replaceWith(...entries: (FakeNode | string)[]): void {
		const parent = this.parentNode;
		if (!parent) return; // spec: no parent, nothing to do
		const index = parent.childNodes.indexOf(this);
		this.remove();
		const flat = flattenNodes(entries);
		parent.childNodes.splice(index, 0, ...flat);
		for (const node of flat) node.parentNode = parent;
	}
}

// The landing h1's exact shape: text, accent span, text, accent span.
function makeHero(): FakeNode {
	const h1 = new FakeNode(ELEMENT_NODE);
	const accent = (word: string) => {
		const span = new FakeNode(ELEMENT_NODE);
		span.className = 'hero-accent';
		span.append(new FakeNode(TEXT_NODE, word));
		return span;
	};
	h1.append(
		new FakeNode(TEXT_NODE, 'Actually build '),
		accent('Scalable'),
		new FakeNode(TEXT_NODE, ' Design '),
		accent('Workflows')
	);
	return h1;
}

beforeAll(() => {
	(globalThis as Record<string, unknown>).Node = { TEXT_NODE, ELEMENT_NODE };
	(globalThis as Record<string, unknown>).document = {
		createElement: () => new FakeNode(ELEMENT_NODE),
		createTextNode: (text: string) => new FakeNode(TEXT_NODE, text),
		createDocumentFragment: () => new FakeNode(FRAGMENT_NODE)
	};
});

const asElement = (node: FakeNode) => node as unknown as HTMLElement;

describe('splitWordsForReveal', () => {
	it('wraps every word without DOMException and preserves text content and order', () => {
		const h1 = makeHero();
		const inners = splitWordsForReveal(asElement(h1));

		expect(inners.map((w) => w.textContent)).toEqual([
			'Actually',
			'build',
			'Scalable',
			'Design',
			'Workflows'
		]);
		// Rendered text is unchanged, including single spaces between words.
		expect(h1.textContent).toBe('Actually build Scalable Design Workflows');
		// Structure: word > inner > (original text or original accent span).
		for (const inner of inners) {
			expect(inner.className).toBe('hero-word-inner');
			expect((inner.parentNode as unknown as FakeNode).className).toBe('hero-word');
			expect(inner.childNodes).toHaveLength(1);
		}
		// The accent spans are the SAME nodes, moved into wrappers, not cloned:
		// their class (and any styling on them) survives the split.
		const descendants = (node: FakeNode): FakeNode[] =>
			node.childNodes.flatMap((c) => [c, ...descendants(c)]);
		const accents = descendants(h1).filter((n) => n.className === 'hero-accent');
		expect(accents.map((n) => n.textContent)).toEqual(['Scalable', 'Workflows']);
		// structure is word > inner > (text or accent span)
		expect(
			accents.every((n) => (n.parentNode as unknown as FakeNode).className === 'hero-word-inner')
		).toBe(true);
		// Whitespace between words survives as plain text nodes, so wrapping behavior
		// matches the unsplit markup.
		const spaces = h1.childNodes.filter(
			(n) => n.nodeType === TEXT_NODE && /^\s+$/.test(n.textContent)
		);
		expect(spaces.map((n) => n.textContent)).toEqual([' ', ' ', ' ', ' ']);
	});

	it('is idempotent-safe to call once but throws nothing when re-splitting is attempted', () => {
		const h1 = makeHero();
		splitWordsForReveal(asElement(h1));
		// A second pass walks the already-wrapped children; it must not throw even if a
		// future edit makes that reachable (defensive, not a usage pattern).
		expect(() => splitWordsForReveal(asElement(h1))).not.toThrow();
	});
});
