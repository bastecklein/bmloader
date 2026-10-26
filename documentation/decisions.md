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

## 2026-10-19 — A model is parsed once per cache key, however many loads are waiting

**Decided:** `load()` routes every form through `loadCachedRenderModel`, which keeps an
in-flight promise per cache key: loads that arrive while the first parse is running wait
for it and get a clone of the cached model. `createMergedGeometry` finds a geometry's
cache key through a `WeakMap` filled by `storeGeometry` instead of scanning
`storedGeometries`. A failed load now reaches `onError` (or is logged) instead of being an
unhandled rejection.

**Why:** Measured in My City. A scene places thousands of copies of a few hundred models in
one pass, so nearly every load arrived before the first parse finished and each parsed the
script again (three's `FileLoader` deduplicates the fetch, not the parse): 100 concurrent
loads of one model took 652 ms, now 37 ms. The cache scan was 91% of parse time in a CPU
profile and grew with every geometry ever stored, so each parse was slower than the last;
a parse fell from ~28 ms to ~2 ms. In the app, a 120x120 city's buildings went from ~20 s
to ~1 s to appear. `test/load-dedupe.test.js` fails on the old loader.

## 2026-10-19 — A `shared: true` load returns the cached model itself

**Decided:** every load form accepts `shared: true`, which hands back the cached render model
instead of a clone, both from the cache and when the in-flight parse finishes. Ordinary loads
are unchanged and still get a clone.

**Why:** a renderer that draws many copies through instancing only needs the model's geometry,
materials and part transforms, not a scene graph of its own per copy. Scroll3D's instanced path
now uses this; cloning was most of the cost of scrolling a dense city. The returned model is
read-only by contract: it is what every later clone is made from.

**Reached from:** My City and Scroll3D. My City uses the option only for static, non-hittable
objects that will be instanced; ordinary callers retain clone isolation. Committed as `97fcbd5`
and pushed, with My City's lockfile pinned to this version. My City keeps
`documentation/patches/bmloader-shared-load.patch` as review history; no phone timing has been
collected.

## 2026-10-26 — Looping animation lines share one clock per animation

**Decided:** When `bmDat.animation` changes, every instruction of the new animation
restarts at its first step and `bmDat.animationTime` restarts at zero. Looping
`position*`/`rotate*`/`scale*` instructions (two or more steps) no longer step toward
their targets independently. Their value is scheduled from `animationTime`: approach
the first step from the saved rest pose, then travel the closed path of steps at the
line's speed. A part that is off schedule moves toward it at three times its speed
until it reaches it. Single-step lines and material, `visible`, and `txChange` lines
keep the step-by-step code.

**Why:** Walk cycles in Realms of Conflict and Sarge 2 drifted until arms and legs
swung in parallel. There were two causes. The intended reset on an animation change
was `ani.step = 0` on the instruction array, which reset nothing, so a resumed
animation continued from stale steps. And every instruction kept its own phase, so a
part that started from a different pose (an arm coming back from an attack) stayed
permanently out of step with the parts it should mirror. Resetting the steps alone
does not fix the second cause, and snapping to the rest pose on every switch would
pop visibly. A shared clock with a short catch-up does both. Scheduling from the rest
pose reproduces the old path when an animation starts from rest. The old code also
held each turning point for an extra frame, because the frame that reached a target
was clamped there. The schedule does not, so loops now run at their written speed,
slightly faster than before (30 frames instead of 31 for a 90° swing at
3°/frame). `test/animation-sync.test.js` covers phase-locking after a switch, the
restart, frame-rate independence, and full-turn spins.

**Reached from:** Sarge 2 player play-testing. Realms of Conflict shows the same drift
and picks up the fix when its bmloader dependency is updated.
