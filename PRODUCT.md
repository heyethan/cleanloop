# Product

## Register

product

## Users

**Primary: citizens reporting a dump on their phone.** On the street in Bengaluru, often one-handed, on patchy mobile data, in English or Kannada. Their job: photograph the dump, confirm the spot, send it, and later see whether anyone acted.

**Primary: cleanup volunteers and resolvers.** Standing at the spot after the cleanup. Their job: take the after photo with the live in-app camera so the case can close on evidence.

Secondary (served, not optimised for): ward officials clearing cases from `/ops`; the public, press and jury reading `/performance` and `/impact`.

## Product Purpose

CleanLoop checks whether a garbage dump was really cleared, without asking the people who cleared it to vouch for themselves. A report becomes a case with a named responsible official and a deadline. A cleanup only turns a pin green when the after photo shows the waste gone, matches the before scene, and was taken at the spot. Anything less stays yellow and open.

Success right now: **a green pin is trusted as proof**, because it is evidence, not somebody's word.

## Brand Personality

A tool first: fast, clear, out of the way (closer to a maps app than a launch site).

- **Now:** calm and trustworthy, like an honest public record; and accountable, naming who is responsible and what is overdue, without hype.
- **Later:** add warmth and hope that celebrates cleanups and the people who do them.

Voice: plain words, short sentences, no jargon. A non-green outcome is "held for review", never "failed".

## Anti-references

Not set yet. Add sites or patterns to avoid here as they come up.

## Design Principles

1. **A false yellow beats a false green.** When the evidence is thin, the interface says so and keeps the case open. Never let the design imply certainty the system doesn't have.
2. **Show the evidence, don't assert it.** Before and after photos, the model's reasoning, the timeline and the official's name are visible. Status alone is never the proof.
3. **Built for the street.** One hand, a moving phone, bad signal, two languages. Big targets, few steps, and nothing lost if the page reloads.
4. **Name who is responsible.** Every case leads to a real person and a deadline. Accountability is shown as fact, not as shaming.
5. **Honest about what's simulated.** Seeded data, offline mode and drafts are labelled as such, everywhere.

## Accessibility & Inclusion

- Target WCAG 2.2 AA.
- Touch targets at least 44px; inputs at 16px so iOS doesn't zoom on focus.
- Visible, on-brand keyboard focus ring (`:focus-visible`), not shown on mouse clicks.
- `prefers-reduced-motion` respected: movement stops, colour and opacity feedback stay.
- Status is never colour alone: green / yellow states carry text labels.
- English and Kannada throughout (Kannada strings still need a native-speaker review).
- Voice typing for the description where the browser supports it; hidden where it doesn't.
