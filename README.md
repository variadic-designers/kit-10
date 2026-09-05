<p align="center">
  <img src="static/favicon.svg" alt="KIT•10 Logo" width="100" />
</p>

# KIT•10

[DRY][DontRepeatYourself] UI.

KIT•10 is a design system editor.

In current web, styles apply on a class basis. If you're `.theme--dark` you get a black background and `.theme--light` otherwise. __Tokens__ allowed you to have one `.theme` and consume one token `var(--clr-background)`. That looks great at first until you have to iterate for all the variants and edge cases like `.theme--dark--high-contrast` + `.theme--disabled` where not just background gets a rewrite but `font-family`, `flex-direction` fields too. That's one where css despite powerful, falls short for designers.

---

## Start by drawing

Open the editor. Right click Views and add Box, give it a text inside.
1. Create a Kit named Button for the Box
2. Create a Kit named ButtonLabel for the Text
3. For Text: Go to Render panel, write "Button" in Text.Content. Go ham on which Font and weight.
4. For Box: Go to Render panel, put Fill color to white. Change the Box.Radius

When you need a secondary variant, you don't duplicate anything. You drag that background color to an axis - **Emphasis → primary** - then add a second entry for **Emphasis → secondary**. The system now understands that background changes with emphasis, and it produces every combination automatically.

Add an axis for viewport width and every rule you've written now applies across every breakpoint.

---

## Why does this exist?

You've been there: your button needs a light version, a dark version, a compact version, a dark-compact version, a disabled version, a dark-disabled version - and now you're maintaining 27 components for 3 axes.

---

## It goes anywhere

The system resolves your rules to properties. What those properties mean - CSS variables, SCSS, 3D material settings, a sitemap structure - is up to a render plugin. The engine has no opinion about the output format. The community builds the interpreters.

---

## Where to start

- **[CONCEPTS.md](./CONCEPTS.md)** - the mental model: Views, Kits, Axes, Layers, Tokens
- **[FAQ.md](./FAQ.md)** - common questions about working with the editor

---

**KIT•10** → *"kitten"*. Yes, intentionally cute.

---

## License

*TBD*. Rights reserved until chosen.

[DontRepeatYourself]: https://en.wikipedia.org/wiki/Don%27t_repeat_yourself
