# Decisions

## 2026-09-29 — The function form is the only animation syntax

**Decided:** Animations are written `@name > action($object, speed, step1, step2, ...)`,
which is what `parseAnimationInstructions()` has always read. OPERATIONS.md was
rewritten to match. The parser was not changed.

**Why:** OPERATIONS.md described `@name > $object > action > values > speed`, but
the parser never accepted that form, so every example in the guide failed without
any warning. Existing Basic Modeler files already use the function form, so the
guide was changed to match the code rather than the other way round.

The speed number was deliberately left as it is: it goes through `degToRad`, so it
means degrees per second for `rotate*`, about speed ÷ 57.3 per second for
`position*`/`scale*`, about speed ÷ 5.73 per second for
`emissiveIntensity`/`opacity`, and seconds per step for `visible`/`txChange`.
Making the units consistent would change how every existing animation plays, so
OPERATIONS.md now documents the units in a table instead. `test/regressions.test.js`
checks that every `@` example in the guide parses.
