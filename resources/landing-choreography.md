# Landing choreography: a short course in thinking like a motion designer

This is both documentation and a course. The reference implementation is
`src/lib/landing-choreography/` (guards.ts, utils.ts, animation-constructs.ts, sections.ts,
visitor-cursor.ts, index.ts). Every lesson below reads a real decision from that code, so
you can open the file next to it. The goal is not "how to use GSAP" (the API docs do that)
but _how to think_, because GSAP is unusual among libraries: it hands you almost no
structure and expects you to bring an opinion. Novices suffer there, and the suffering is
usually diagnosable as one of a handful of thinking errors.

No em dashes in this repo, fittingly: motion has the same rule. A cut, a comma, a
restructure. Never the thing that pretends two ideas were already one.

---

## Lesson 0. Motion is choreography, not effects

The single most common novice error is thinking of animation as something you _add to
elements_: "animate the button, animate the card, animate the nav." That produces the
overstimulated feeling you already know from reading a single 451-line file: dozens of
unrelated tweens, no sense of who leads.

Professionals think in **one continuous performance per context**. The page has an
entrance. The scroll is a second performance. Each section's reveal is a _movement_ within
it, not its own private show. Notice what index.ts actually does:

```ts
ctx = gsap.context(() => {
	entrance(gsap, root, introEligible);   // the overture
	heroExit(gsap, root);                  // act one
	revealSectionTexts(gsap, root);        // ...and so on
	...
}, root);
```

One context, one mount, one place to reason about the whole performance. The function
names are verbs of the _piece_ (entrance, heroExit, revealHandoff), not of the _effect_
(fadeIn, slideUp). That naming discipline alone will fix half of what feels wrong in
novice motion code. `fadeIn` describes pixels. `entrance` describes intent.

The directory split is the same idea in architecture form: sections.ts holds movements,
animation-constructs.ts holds the _vocabulary_ of movement, guards.ts holds the stage
management. When you feel a motion file getting overstimulating, that is the signal that
these three concerns have fused.

---

## Lesson 1. Think in states, not in animations

The second novice error: thinking "how do I animate this in?" GSAP's answer is that you
almost never animate things in. You **set a state, then tween to the truth.**

Look at the opening of `entrance` in sections.ts:

```ts
gsap.set(nav, { y: '-100%', opacity: 0 });
gsap.set(words, { y: '0.6em', opacity: 0 });
gsap.set([sub, cta], { y: 20, opacity: 0 });
```

Nothing is moving yet. This is the entire craft in miniature: the elements are declared to
start _somewhere other than their CSS truth_, and then the timeline below simply brings
them home. Two consequences worth internalizing:

1. **Your CSS never contains animation state.** The markup ships in its final, correct,
   accessible state. Motion is an overlay opinion on top of a page that is already
   complete without it. This is why reduced-motion users get a _perfect_ page for free:
   they just skip the overlay.
2. **`from()` is the same thought compressed.** `reveal()` in animation-constructs.ts uses
   `gsap.from(targets, { y: 26, opacity: 0, ... })`: "start displaced, arrive at truth."
   Idiomatic GSAP reads as a series of arrivals, not a series of effects.

The anti-pattern to hunt in your own code: tweens whose end state is a _magic value_
(`opacity: 1, y: 0` spelled out everywhere). If you find yourself restating the truth, you
are writing effects. Use `from()`, or `set()` then `to()`, and let the stylesheet own the
truth.

---

## Lesson 2. The timeline is a score; the position parameter is the beats

Novices sequence with `delay` on individual tweens. That is the equivalent of writing a
score where every note carries its own "seconds from the big bang" timestamp: change one
note and you recompute everything after it by hand.

The idiomatic move is a **timeline plus the position parameter**, and it is the single
highest-leverage GSAP skill. From `entrance`:

```ts
gsap
	.timeline({ defaults: { ease: 'power3.out' } })
	.to(nav, { y: 0, opacity: 1, duration: 0.55 }, 0)        // beat 0
	.to(words, { y: 0, opacity: 1, stagger: 0.05 }, 0.12)    // slightly after
	.to(sub, { y: 0, opacity: 1, duration: 0.6 }, 0.45)
	.to(cta, { y: 0, opacity: 1, duration: 0.6 }, 0.55)
	.to(cursor, { x: 0, y: 0, duration: 1 })
	.to(glyph, { ..., duration: 1 }, '<0.5');
```

Read the numbers as a conductor would. Nav leads. Words follow almost immediately
(overlap, not wait). Sub and CTA arrive while the words are still settling, because an
entrance where everything politely finishes before the next thing starts feels like a
slideshow. **Overlaps create flow; gaps create hesitation.** The final `'<0.5'` is the
grammar: "half a second after the previous tween started." The `<` family (`'<'`,
`'>'`, `'<+=0.3'`, `'label+=1'`) is how professionals express _relationships_ between
movements instead of absolute times. When a director changes (you shorten the word
stagger), everything downstream reflows automatically. That is the whole point.

Rules of thumb that fall out of this:

- Sequence with the position parameter, never with `delay`.
- Deliberate overlap of 30 to 60 percent between successive arrivals.
- `defaults` on the timeline declares the house style (here, one ease for the whole
  entrance); per-tween overrides are the exception that must justify itself.

---

## Lesson 3. Eases are the soul; most of the work is choosing one

A linear ease (`ease: 'none'`) means the object is a machine. Almost nothing in the real
world moves that way, which is why it appears exactly twice in this codebase, both times
_deliberately_:

- The hero exit scrub (`heroExit`) uses `ease: 'none'` at the timeline level, because with
  `scrub`, the user's finger is the easing function. Easing a scrubbed tween fights the
  user's hand. The one `power1.inOut` inside shapes the _composition_ of the exit, not the
  playback.
- Everything else: some flavor of `powerN.out`, with `back.out` for things that should
  land with a little overshoot (the anatomy arrows, the graph core: playful, physical,
  "it arrived with weight").

The vocabulary to internalize, in order of daily usefulness:

- **`power1` through `power4`, in and out.** The workhorses. `out` for things arriving
  (fast start, gentle landing: feels confident). `in` for things leaving (reluctant
  launch, gone). `inOut` for things that turn around mid-screen.
- **`back.out(k)`** for arrivals with overshoot. Small k (1.2 to 2) reads playful;
  large k reads cartoonish. It is spice, not sauce: notice it is used only on small
  elements (arrows, satellites), never on a section's main content.
- **`expo.out`** for large surfaces that should feel like they decelerate from real
  momentum.
- **`elastic`/`bounce`**: almost never. If you reach for these, ask what the piece is
  about first.

The thinking error to catch: choosing eases per-tween at write time, as decoration. Choose
them as a _system_: one family for the piece, exceptions for specific physical jokes.

---

## Lesson 4. Stagger is rhythm; it is how groups speak

A group of items tweening simultaneously is a wall. A group tweening one after another
with equal gaps is a staircase. Stagger is the dial between them, and it is _per-group
authorship_, not a global constant.

Read the choices in sections.ts and notice each stagger has a reason:

- Hero words: `0.05`. Fast, intimate, one breath per word. Text is read, not watched.
- Tiers (`.g-tier`, `0.12`): deliberate, each tier is a _statement_ you are meant to
  weigh.
- Flow columns: `0.16` plus a later arrow wave at the same `0.16`: two groups moving in
  the same rhythm, so the diagram reads as one system pumping.
- Code lines in the demo: `0.045`. Dense, nearly a shimmer, because code is texture.

The lesson: stagger duration should scale with _how much content each item carries_ and
_how much you want the group read as individuals versus as a mass_. Also know that
`stagger` accepts an object (`stagger: { each: 0.05, from: 'center', grid: 'auto' }`);
directional staggers (`from: 'center'`, `from: 'edges'`) are how you make a grid feel
alive rather than typewritten. Nothing in this codebase needs it, and that restraint is
also a decision.

---

## Lesson 5. Scroll choreography: triggers are declarative, state is owed to no one

Everything in `reveal()` and `revealTimeline()` is one idiom:

```ts
scrollTrigger: { trigger, start: `top ${fraction * 100}%`, once: true }
```

Three ideas live in that one line:

1. **The trigger, not the clock, is the source of truth.** Motion in flow is caused by
   _where the content is relative to the viewport_, never by timeouts. `setTimeout` in
   scroll-adjacent code is a bug you have not met yet.
2. **`start` is a sentence**: "when my top crosses 75 to 80 percent down the viewport."
   The fraction is a per-section artistic choice in this codebase (0.75 for hero-adjacent
   demos, 0.9 for the footer, which you want nearly on stage before it moves).
3. **`once: true` is a promise to the reader.** Reveals replay only on remount, never on
   scroll-up. Content that re-animates every time you scroll past it is a haunted house,
   not a document.

And the guard that separates competent from professional, `belowFold` in utils.ts:

```ts
if (!belowFold(trigger, fraction)) return;
```

If the section is already on screen when the code runs (theme remount, restored scroll),
no trigger is created at all. The element simply _is_ there, in its final state. The
principle: **a reveal that would immediately fire is a reveal that should never exist.**
Never create a trigger whose first act is to skip itself; the skip is visible as a flash.
Decide before creating, not inside the animation.

The pinned hero exit demonstrates the other scroll register: `scrub: 1.5` maps the
timeline to scroll position with a smoothing lag, so the hero's exit is literally _held in
the reader's hand_. Pin/scrub work is a different genre (scrollytelling) from reveals
(choreography). Do not mix their vocabularies casually: scrubbed things are compositions
of the scroll position, revealed things are responses to an event.

---

## Lesson 6. Reduced motion is a design decision, not an accessibility chore

The most professional code in the directory is arguably guards.ts, because it treats
"no motion" as a _first-class choreography_, authored with the same care:

- The cookie is read before hydration, so the guard agrees with the store from the first
  paint (no flash either way).
- Reduced-motion users never get the pre-hide class at all: their page is final-state from
  byte one.
- `reducedMotionNow()` is checked _twice_ in index.ts: once before the dynamic imports,
  and again after the chunks land, because **the setting may have flipped while you were
  loading**. State you checked once is a snapshot, not a fact.
- Every failure path (`bail()`) disarms the pre-hide and returns a no-op disposer. If the
  choreography fails to set up, the page must simply _be there_, statically. Console
  error, visible content, no stuck class.

Internalize the asymmetry: motion is an enhancement; legibility is the floor. Every
entrance you author is a tax you chose to levy on first paint, and the guard system is the
refund policy. Failsafe timers (`PENDING_FAILSAFE_MS`, 4 seconds) exist because "the code
above will definitely run" is a claim about the network, and the network did not agree to
it.

One resident proves the boundary from the outside: the Guest cursor (visitor-cursor.ts) is
deliberately not choreography, and it is the one thing in the directory that ignores the
reduced-motion bail. A cursor that follows the pointer is input feedback, not authored
motion; under reduced motion it tracks 1:1 instead of easing behind, which is the
difference between moving _with_ the visitor and moving _at_ them. It still obeys the
lifecycle contract (mounted with the page, honest disposer on unmount) and Lesson 1's rule
that CSS owns the truth: the element ships hidden, and the tracker only adds the class
that lets it be seen where the visitor actually is.

Its input forms hold the same line. The tracker decides when `cursor--hover`,
`cursor--press`, and `cursor--scrolling` are true and never draws a pixel of them; the
stylesheet owns what each looks like. That split is what keeps the three states composable
(press stacks on hover or scroll) and what keeps a future form a one-rule change instead
of a JS edit. The one continuously animated piece, the scroll bob, is the only part gated
on reduced motion: looping motion is authored motion, discrete click and hover feedback is
not.

---

## Lesson 7. Own the lifecycle: context, revert, and the honest disposer

`startLandingChoreography` returns `() => ctx.revert()`. That one line carries the whole
lifecycle contract, and it works because of `gsap.context(fn, root)`:

- Everything created inside the context (tweens, timelines, ScrollTriggers, inline styles
  set on elements) is _inventoried_.
- `ctx.revert()` un-creates all of it: kills triggers, removes inline styles, restores the
  DOM to pre-choreography truth. Theme remount leaves zero residue.

The novice pattern this replaces: keeping your own arrays of tweens to `.kill()`, chasing
each new GSAP feature with a new cleanup line, and slowly leaking scroll triggers until
the page starts twitching. GSAP already did the bookkeeping; the idiom is to let it.

Two discipline points that fall out:

- **Dynamic imports for the heavy stuff.** GSAP is only fetched when motion will actually
  run (reduced-motion users never pay for it), and the post-import reduced-motion re-check
  (Lesson 6) covers the race.
- **One context per mount, scoped to the component root.** `gsap.context(fn, root)` scopes
  selector text so a future `gsap.to('.chip', ...)` inside the context cannot reach into
  some other component's chips.

---

## Lesson 8. Build vocabulary, then compose it

Once you have written three sections, you notice they are the same three moves: a timeline
or a tween batch, gated on `belowFold`, one-shot, arriving at truth. `animation-constructs.ts`
is that observation made into code:

```ts
export function reveal(gsap, trigger, targets, vars, fraction = 0.8) { ... }
export function revealTimeline(gsap, trigger, fraction, build) { ... }
```

This is the moment a motion codebase stops being a pile of effects and becomes a
_choreographic language_: sections now read as intent ("revealHandoff: two cards from
opposite sides, then chips cascade") with zero repeated plumbing. The `build(tl)` callback
shape matters too: the construct owns the _when and whether_, the section owns the _what_.
That separation is why sections.ts is mostly readable as prose.

The composition instinct generalizes beyond this file:

- `reveal` for flat groups; `revealTimeline` when elements must relate in time.
- Section functions take `(gsap, root)` and no-op when their markup is absent, so index.ts
  stays a flat table of contents with no conditionals.
- Shared magic numbers (the 0.7s duration, the default 0.8 fraction) live in exactly one
  place. Choreographic consistency is mostly just _shared constants_, honestly.

---

## Lesson 9. The file is part of the performance

Why did you ask for this split? Because all of it in one file was overstimulating. That
instinct is correct and it is the last lesson: **motion code that is hard to read is
usually motion that is hard to feel.** The same lack of hierarchy that buries the entrance
among forty `reveal` calls buries the _beat_ among forty tweens.

The directory is the score's layout: guards.ts is stage management, utils.ts is the
instrument, animation-constructs.ts is the notation, sections.ts is the movements,
index.ts is the program note. When you sit down to author new motion, write the program
note first: one comment block in index.ts describing the piece (the module header there is
exactly that). Then add a movement. Then, only if a third movement repeats it, extract the
construct.

---

## Quick reference: the idioms this codebase bets on

| Novice instinct                     | Idiomatic move                                                                                   | Where to see it                   |
| ----------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------- |
| Animate elements in with delays     | `set()` states, timeline brings them home; position parameter for beats                          | `entrance`, sections.ts           |
| `opacity: 1` spelled out everywhere | `gsap.from()`, truth lives in CSS                                                                | `reveal`, animation-constructs.ts |
| Per-tween `delay` chains            | Timeline + `'<0.5'`-style position strings                                                       | `entrance`                        |
| Random eases per tween              | One ease family in `defaults`, deliberate exceptions (`back.out` on small arrivals)              | every timeline                    |
| Animate everything, always          | `belowFold` gate before creating any trigger                                                     | `reveal`/`revealTimeline`         |
| Replay reveals on every scroll-up   | `once: true`                                                                                     | same                              |
| `setTimeout` around scroll work     | `scrollTrigger` positions as the clock                                                           | hero exit                         |
| Kill tweens by hand in cleanup      | `gsap.context(fn, root)` + returned `ctx.revert()`                                               | index.ts                          |
| Motion for everyone                 | Cookie read pre-hydration, double-check after async loads, failsafe timer, disarm on any failure | guards.ts                         |
| Effects named after pixels          | Movements named after intent (`entrance`, `revealHandoff`)                                       | sections.ts                       |

## A final exercise

Before adding motion to a page, write four sentences in a comment, no code: what the
reader should feel on load, what leads, what follows and by how much, and what a
reduced-motion visitor gets instead. If you cannot write it, the choreography does not
exist yet, and GSAP would only be typesetting a decision you have not made. That comment
block above `startLandingChoreography` is this exercise, already done, and it is the most
load-bearing text in the directory.
