# Applying the Crystal Design System

You are updating an existing dashboard so that every screen follows our design system.

`crystal-design-system` is the design system. Open it in a browser and use it before you start — every component in it works, so click things. Everything you need to know about how something should look and behave is in that file. This document only tells you how to go about the work.

\---

## The basic instruction

Match the design system exactly. Do not improve on it, reinterpret it, or fill gaps with your own taste.

When you need to build something, find it in the design system first, then copy how it is built. Do not rebuild it from memory or from how similar things usually look. If the design system has it, the design system wins.

You are changing how the dashboard looks and behaves on screen. You are not changing what it does. If making something look right seems to require changing the logic, stop and ask.

\---

## Before you change anything

1. Go through the whole dashboard, screen by screen, and write down what you find: every screen, and which parts of it need replacing.
2. Note anything that appears in more than one place — the buttons, the tables, the date fields, the icons. These are what you fix first.
3. Sort the screens into three groups: the ones people use constantly, the ordinary ones, and the ones almost nobody opens.
4. Show me this list before you start making changes.

You will almost certainly find more than one icon set, more than one date picker, and several different button styles. All of them collapse into one — the design system's version.

\---

## The order of work

Fix the shared pieces first, then the screens. If you fix one screen at a time, you end up with fourteen slightly different buttons.

1. **Set up the foundation.** Colours, fonts, spacing, dark mode. Take these from the design system directly rather than copying values by hand. Do this on its own and check nothing breaks before continuing.
2. **Fix the small shared pieces.** Buttons, inputs, checkboxes, dropdowns, tags, labels, icons, cards. Most of the dashboard will start looking right at this point.
3. **Fix the frame.** Sidebar, top bar, tabs, breadcrumbs.
4. **Fix the data parts.** Tables, charts, number cards, loading states, empty states.
5. **Fix the pop-up parts.** Dialogs, side panels, toasts, warnings, search.
6. **Walk every screen.** Now fix layout, spacing and hierarchy on each one, most-used screens first.
7. **Check everything.** Keyboard, screen readers, phone sizes, dark mode. Delete the old styling you have replaced.

Commit one component or one screen at a time, never in one big batch.

\---

## Rules that must not be broken

These have all been broken before on this project. Number them in your reports when you fix one.

1. Only the four brand colours. No fifth colour anywhere.
2. Status colours are only for status — never a button, a heading, a menu item, or decoration.
3. **No stray colours in icons or secondary buttons.** This is the mistake that keeps happening. Icons take the colour of the text around them.
4. **One navy hero card per screen.** Two large navy blocks competing is wrong.
5. **The sidebar stays white** with a lightly tinted active item. It is never a solid navy panel.
6. Amber is a small accent, used once or twice per screen. Never a large filled area.
7. Never white text on amber. Amber always carries black text.
8. White cards get a thin border. Tinted cards get none.
9. Squint at each screen. It should read as mostly white, with navy as the structure and amber as a spark. If navy dominates, you have used too much.
10. Everything that can be focused shows a focus ring. Never remove one without replacing it.
11. Every clickable thing needs all its states drawn — normal, hover, pressed, focused, disabled, and loading where it waits on something.
12. Never show status by colour alone. Always a colour, an icon, and a word.
13. One main action per area of the screen. Two competing main buttons means the design has not decided.
14. Keep animation quick and subtle. Nothing should feel slow or bouncy.

\---

## Where the design system does not cover something

It defines the pieces, not every possible screen. When you have to decide:

* Follow the closest thing that already exists in it.
* Choose the plainer option. Fewer colours, fewer boxes, more space. Design systems fall apart by collecting exceptions, not by being too plain.
* Then add what you decided back into `crystal-design-system`, in the right section, so nobody has to decide it again.

Two things you will need early that are not there yet — build them, add them to the file, and tell me:

* **Tables on a phone.** They should become a list of cards, one per record, showing three or four key fields, tapping through to the full detail.
* **The sidebar on a phone.** It should slide in over the screen rather than sit beside it.

One deliberate exception: the rich text editor in the design system uses an old browser feature that is being retired. Keep its appearance exactly, but build it on a current editor library instead.

\---

## Before you call a screen finished

* It uses no colours, sizes, or spacing outside the design system.
* All fourteen rules above have been checked on it, not assumed.
* It has proper loading and empty states, not a blank area or a spinner.
* It works at phone, tablet and desktop widths, and when the browser is zoomed to 200%.
* It works in dark mode with no dark-specific styling written by hand. If it needs any, the foundation is wrong — fix that instead.
* It can be used entirely by keyboard, and focus goes somewhere sensible when a dialog closes.
* An accessibility checker reports nothing serious.
* The old styling it replaced has been deleted.

\---

## What to report back

After each stage:

* What you changed, and where.
* Which components you replaced, and how many places used them.
* Which rules you found broken and fixed — name the number and be specific about where.
* Anything you added back into the design system file.
* Anything you need me to decide. Give me your recommendation with it. Never guess on anything involving money, permissions, or deleting things.
* Before and after screenshots of the most-used screens, in both light and dark, on desktop and phone.

If you do something differently from the design system, say so and explain why. Quietly doing it your own way is how design systems fall apart.

\---

## If you are unsure

1. Look in `crystal-design-system` again. It is almost certainly there.
2. Check the rules above. They override your own judgement about what looks better.
3. Pick the plainer option.
4. Ask. One good question costs five minutes. A wrong assumption spread across forty screens costs two days.

