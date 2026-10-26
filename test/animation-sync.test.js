import assert from "node:assert/strict";
import test from "node:test";

import { BMLoader } from "../bmloader.js";

/*
 * Looping animation instructions share one clock per animation, so limbs that are
 * meant to swing in opposite phase stay that way after the animation is switched.
 * Each instruction used to step toward its targets on its own, and switching
 * animations never reset them, so walk cycles drifted into parallel arms and legs.
 */

let nextId = 0;

const WALKER = [
    "$rightArm = box(0.2, 1, 0.2, #ff0000);",
    "$leftArm = box(0.2, 1, 0.2, #00ff00);",
    "$leftLeg = box(0.2, 1, 0.2, #0000ff);",
    "$spinner = box(0.2, 0.2, 0.2, #ffffff);",
    "$hold = box(0.2, 0.2, 0.2, #ffffff);",
    "@walking > rotateX($rightArm, 3, 45, -45)",
    "@walking > rotateX($leftArm, 3, -45, 45)",
    "@walking > rotateX($leftLeg, 3, 45, -45)",
    "@attack > rotateX($rightArm, 6, -90)",
    "@attack > rotateX($leftArm, 3, -45, 45)",
    "@spin > rotateY($spinner, 10, 0, 360)",
    "@spin > positionY($hold, 57.29577951308232, 2)"
].join("\n");

function load(script) {
    const loader = new BMLoader();
    const spec = { id: "animation-sync-" + (nextId++), revision: 1, script, textures: {}, animations: {} };

    return new Promise((resolve, reject) => {
        loader.load(spec, resolve, undefined, reject);
    });
}

function degrees(radians) {
    return radians * 180 / Math.PI;
}

function play(model, animation, frames, delta = 1) {
    model.bmDat.animation = animation;

    for(let i = 0; i < frames; i++) {
        model.animate(delta);
    }
}

function limbs(model) {
    const v = model.bmDat.variables;
    return [v.rightArm, v.leftArm, v.leftLeg].map(ob => degrees(ob.rotation.x));
}

function assertInPhase(model, frames, label) {
    for(let i = 0; i < frames; i++) {
        model.animate(1);
        const [rightArm, leftArm, leftLeg] = limbs(model);
        assert.ok(Math.abs(rightArm - leftLeg) < 1e-6, `${label}: right arm ${rightArm} vs left leg ${leftLeg}`);
        assert.ok(Math.abs(rightArm + leftArm) < 1e-6, `${label}: right arm ${rightArm} vs left arm ${leftArm}`);
    }
}

test("a walk cycle from rest approaches the first step, then loops through the steps", async () => {
    const model = await load(WALKER);
    play(model, "walking", 10);
    assert.ok(Math.abs(limbs(model)[0] - 30) < 1e-6);
    play(model, "walking", 5);
    assert.ok(Math.abs(limbs(model)[0] - 45) < 1e-6);
    play(model, "walking", 30);
    assert.ok(Math.abs(limbs(model)[0] + 45) < 1e-6);
    play(model, "walking", 10);
    assert.ok(Math.abs(limbs(model)[0] + 15) < 1e-6);
    assertInPhase(model, 120, "fresh walk");
});

test("limbs fall back into phase after an animation posed one of them elsewhere", async () => {
    const model = await load(WALKER);
    play(model, "walking", 20);
    play(model, "attack", 23);
    assert.ok(Math.abs(limbs(model)[0] + 90) < 1e-6, "the attack holds the right arm at -90");

    // The right arm catches up at three times its speed, then stays locked.
    play(model, "walking", 30);
    assertInPhase(model, 200, "after attack");
});

test("switching animations restarts every instruction from the first step", async () => {
    const fresh = await load(WALKER);
    play(fresh, "walking", 37);

    const switched = await load(WALKER);
    play(switched, "walking", 21);
    play(switched, "attack", 40);
    play(switched, "walking", 200);
    // Back at rest-equivalent phase: compare against a model that only ever walked.
    play(fresh, "walking", 200 - 37);
    assert.deepEqual(limbs(switched).map(Math.round), limbs(fresh).map(Math.round));
});

test("the schedule does not depend on frame rate", async () => {
    const steady = await load(WALKER);
    const uneven = await load(WALKER);
    play(steady, "walking", 90);
    uneven.bmDat.animation = "walking";
    for(const delta of [0.5, 2.5, 1, 7, 0.25, 0.75, 3, 75]) {
        uneven.animate(delta);
    }
    const a = limbs(steady);
    const b = limbs(uneven);
    for(let i = 0; i < a.length; i++) {
        assert.ok(Math.abs(a[i] - b[i]) < 1e-6, `${a[i]} vs ${b[i]}`);
    }
});

test("a full-turn spin keeps turning, and single-step instructions go to their value and hold", async () => {
    const model = await load(WALKER);
    const { spinner, hold } = model.bmDat.variables;
    let previous = 0;
    let turned = 0;
    model.bmDat.animation = "spin";

    for(let i = 0; i < 100; i++) {
        model.animate(1);
        let change = degrees(spinner.rotation.y) - previous;
        if(change < -180) {
            change += 360;
        }
        assert.ok(change > 0, `spin reversed at frame ${i}`);
        turned += change;
        previous = degrees(spinner.rotation.y);
    }

    assert.ok(Math.abs(turned - 1000) < 1e-6, `turned ${turned}`);
    assert.equal(hold.position.y, 2);
});
