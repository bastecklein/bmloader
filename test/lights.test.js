import assert from "node:assert/strict";
import test from "node:test";

import * as THREE from "three";

import { BMLoader } from "../bmloader.js";

/*
 * The light and fog operations, and the traps they carry.
 *
 * The one that matters is directional aim. A DirectionalLight aims at its target, and
 * three.js only refreshes the world matrix of a target that is IN the scene graph. The
 * obvious implementation — position a detached target — is therefore silently ignored and
 * the light aims at the world ORIGIN no matter what the file says.
 *
 * So every aim assertion here reads the EFFECTIVE aim after updateMatrixWorld(). Asserting
 * `light.target.position` would pass on a completely broken light, which is exactly how
 * this bug survives inspection. The test below that demonstrates the detachment failure is
 * there to keep that reasoning honest.
 */

let nextId = 0;

function load(source, variables, options) {
    const loader = new BMLoader(undefined, options);
    const spec = variables ? Object.assign({}, source, { variables }) : source;

    return new Promise((resolve, reject) => {
        loader.load(spec, resolve, undefined, reject);
    });
}

function spec(script) {
    return { id: "lights-" + (nextId++), revision: 1, script, textures: {}, animations: {} };
}

/* Where the light actually shines, in world space, with world matrices up to date. */
function effectiveAim(model, light) {
    model.updateMatrixWorld(true);

    const from = new THREE.Vector3().setFromMatrixPosition(light.matrixWorld);
    const to = new THREE.Vector3().setFromMatrixPosition(light.target.matrixWorld);

    return to.sub(from).normalize();
}

function assertVector(actual, expected, message) {
    for (let i = 0; i < 3; i++) {
        assert.ok(Math.abs(actual.getComponent(i) - expected[i]) < 1e-6,
            `${message}: component ${i} was ${actual.getComponent(i)}, expected ${expected[i]}`);
    }
}

const ORIGIN_AIM = new THREE.Vector3(-4, -9, -3).normalize(); // what a detached target yields

test("hemispherelight() builds a hemisphere light in the model graph", async () => {
    const model = await load(spec("$sky>hemispherelight(#bfd9ff,#1a120b,0.85)"));
    const light = model.getPart("sky");

    assert.ok(light instanceof THREE.HemisphereLight, "the part is a real HemisphereLight");
    assert.equal("#" + light.color.getHexString(), "#bfd9ff", "sky colour");
    assert.equal("#" + light.groundColor.getHexString(), "#1a120b", "ground colour");
    assert.equal(light.intensity, 0.85, "and intensity is a number, not a string");
    assert.ok(model.children.includes(light), "parented into the model, so scene traversal finds it");
});

test("hemispherelight() defaults to a white sky and a dim ground", async () => {
    const light = (await load(spec("$sky>hemispherelight()"))).getPart("sky");

    assert.equal("#" + light.color.getHexString(), "#ffffff");
    assert.equal("#" + light.groundColor.getHexString(), "#444444");
    assert.equal(light.intensity, 1);
});

test("directionallight() actually aims where it is told", async () => {
    /*
     * The headline test. (0, 0.6, -0.8) is deliberately NOT a round number and NOT the
     * origin-aim direction, so a detached target cannot pass by luck.
     */
    const model = await load(spec("$sun>directionallight(#fff1dd,1.2,0,0.6,-0.8)>position(4,9,3)"));
    const light = model.getPart("sun");

    assert.ok(light instanceof THREE.DirectionalLight, "the part is a real DirectionalLight");
    assertVector(effectiveAim(model, light), [0, 0.6, -0.8], "aim follows the authored direction");

    assert.ok(effectiveAim(model, light).distanceTo(ORIGIN_AIM) > 0.5,
        "and it is nowhere near the origin aim a detached target would produce");
});

test("a directionallight's target is part of the light, not a detached node", async () => {
    /* Pins the design, because the design is the fix. A target parented anywhere that is
       NOT in the graph reintroduces the bug, and this test is what notices. */
    const model = await load(spec("$sun>directionallight(#fff1dd,1,0,0.6,-0.8)"));
    const light = model.getPart("sun");

    assert.equal(light.target.parent, light, "the target rides as a child of the light");
    assert.equal(light.castShadow, false, "shadows stay with the engine");

    /* Bringing the model into a scene must refresh the target's world matrix. */
    const scene = new THREE.Scene();
    scene.add(model);
    scene.updateMatrixWorld(true);

    assert.ok(light.target.matrixWorld.elements.some((e, i) => i === 13 && e !== 0),
        "the target's world matrix is actually updated once the model is in a scene");
});

test("the `=` assignment form of directionallight() works too", async () => {
    /*
     * Different code path: `$x = op > position(...)` runs the hasGeometryOperation() check
     * that the `$x>op` form skips. If `directionallight(` were missing from that list the
     * whole line would be stored as a transform string and NO LIGHT would be created —
     * silently. This is the regression test for that list.
     */
    const model = await load(spec("$sun = directionallight(#fff1dd, 1.2, 0, 0.6, -0.8) > position(4, 9, 3)"));

    assert.ok(model.getPart("sun") instanceof THREE.DirectionalLight,
        "the light is created, not swallowed as a transform string");
    assertVector(effectiveAim(model, model.getPart("sun")), [0, 0.6, -0.8], "and it aims correctly");
});

test("a directionallight defaulting to no direction travels straight down", async () => {
    const model = await load(spec("$sun>directionallight()"));
    const light = model.getPart("sun");

    assertVector(effectiveAim(model, light), [0, -1, 0], "straight down");
});

test("cloning keeps the lights and re-aims the directional one at its own target", async () => {
    /*
     * cloneObject3D() is hand-rolled, so a new node type has to be taught to it or it
     * falls through to three's clone(). Lights are cloned by EVERY load path. The
     * directional case is subtler than "did the light survive": the clone must be aimed at
     * its OWN cloned target, because the template's target is not in any scene and so never
     * gets its world matrix refreshed.
     */
    const shared = spec("$sky>hemispherelight(#bfd9ff,#1a120b,0.85)\n" +
        "$sun>directionallight(#fff1dd,1.2,0,0.6,-0.8)>position(4,9,3)");

    const first = await load(Object.assign({}, shared));   // builds and caches the template
    const clone = await load(Object.assign({}, shared));   // cache hit, so this is a CLONE

    const templateSun = first.getPart("sun");
    const cloneSun = clone.getPart("sun");

    assert.ok(clone.getPart("sky") instanceof THREE.HemisphereLight, "the hemisphere light cloned");
    assert.ok(cloneSun instanceof THREE.DirectionalLight, "the directional light cloned");
    assert.notEqual(cloneSun, templateSun, "as a genuinely separate object");
    assert.equal("#" + clone.getPart("sky").groundColor.getHexString(), "#1a120b",
        "with its properties intact");

    assert.notEqual(cloneSun.target, templateSun.target, "the clone aims at its own target");
    assert.equal(cloneSun.target.parent, cloneSun, "which is part of the clone's own graph");

    assertVector(effectiveAim(clone, cloneSun), [0, 0.6, -0.8],
        "so the clone still aims where the file says");
});

test("fog is recorded as data, because there is no Scene to parent it to", async () => {
    const model = await load(spec("fog(#c8d8ff,20,140)"));

    assert.deepEqual(model.bmDat.fog, { color: "#c8d8ff", near: 20, far: 140 });
    assert.equal(model.children.length, 0, "fog adds no object to the graph");
});

test("fog defaults and survives the clone path", async () => {
    const shared = spec("fog(#c8d8ff,20,140)");

    assert.deepEqual((await load(spec("fog()"))).bmDat.fog,
        { color: "#ffffff", near: 1, far: 100 }, "defaults");

    await load(Object.assign({}, shared));
    const clone = await load(Object.assign({}, shared)); // cache hit -> a clone

    /* bmDat fields are copied one by one in cloneRenderModel(), so a new field that is not
       added there silently disappears on every clone. */
    assert.deepEqual(clone.bmDat.fog, { color: "#c8d8ff", near: 20, far: 140 },
        "fog is not dropped by the clone");
});

test("fog is not a light, so enableLights:false still records it", async () => {
    const model = await load(spec("fog(#c8d8ff,20,140)\n$sky>hemispherelight(#bfd9ff,#1a120b,0.85)"),
        null, { enableLights: false });

    assert.deepEqual(model.bmDat.fog, { color: "#c8d8ff", near: 20, far: 140 },
        "fog is atmosphere, not lighting");
    assert.ok(!(model.getPart("sky") instanceof THREE.HemisphereLight),
        "but the light is skipped, as enableLights promises");
});

test("this is the failure the aim tests are written to catch", () => {
    /* Not testing the loader — pinning the trap. A detached target has the right
       position and the wrong aim, and proves the assertions above are not vacuous. */
    const scene = new THREE.Scene();
    const naive = new THREE.DirectionalLight("#ffffff", 1);

    naive.position.set(4, 9, 3);
    naive.target.position.set(0, 0.6, -0.8); // "aimed" — but never added to anything
    scene.add(naive);

    scene.updateMatrixWorld(true);

    const from = new THREE.Vector3().setFromMatrixPosition(naive.matrixWorld);
    const to = new THREE.Vector3().setFromMatrixPosition(naive.target.matrixWorld);
    const aim = to.sub(from).normalize();

    assert.equal(naive.target.position.z, -0.8, "the position reads back correctly...");
    assertVector(aim, ORIGIN_AIM.toArray(), "...but the effective aim is the world origin");
    assert.ok(aim.distanceTo(new THREE.Vector3(0, 0.6, -0.8)) > 0.5,
        "which is nowhere near what the file asked for");
});
