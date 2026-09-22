import assert from "node:assert/strict";
import test from "node:test";

import { Vector3 } from "three";

import { BMLoader } from "../bmloader.js";

/*
 * Pins down the parenting semantics OPERATIONS.md describes, because the direction
 * of add() is the single most misreadable thing in the language. The "Adding
 * Objects" and "Groups" sections both make claims about which object ends up
 * inside which, and about how far nesting reaches — these tests are those claims.
 *
 * The documented-in-the-past-but-wrong form is covered too: it is the mistake the
 * docs now explicitly call out, so it should keep behaving the way the warning
 * says it does.
 */

/* loadedRenderModels is module-level, so the cache key has to be unique per
   script or the loader hands back whichever model claimed that id first. */
let nextId = 0;

function loadModel(script) {
    const loader = new BMLoader();
    const spec = { id: "parenting-" + (nextId++), revision: 1, script, textures: {}, animations: {} };

    return new Promise((resolve, reject) => {
        loader.load(spec, resolve, undefined, reject);
    });
}

test("a reused id hands back the first script's model", async () => {
    const loader = new BMLoader();
    const spec = { id: "parenting-shared", revision: 1, script: "$shape>box(1,1,1,#ff0000)", textures: {}, animations: {} };
    const load = () => new Promise((resolve, reject) => loader.load(spec, resolve, undefined, reject));

    await load();

    const second = await load();
    second.bmDat.script = "$shape>sphere(1,32,32,#00ff00)";

    const stale = await load();

    // The cache key is id + revision only, so the replaced script is ignored and
    // the box comes back. Editing a model in place needs a revision bump.
    assert.equal(stale.getPart("shape").geometry.type, "BoxGeometry");
});

/* Finalize appends one merged mesh per (material, layout) group to the model root,
   so counting root children only measures authored structure if those are filtered
   out. Engine code inspecting the root needs the same filter. */
function authoredRootChildren(model) {
    return model.children.filter(function(node) {
        return !(node.userData && node.userData.__bmMergeGroup !== undefined);
    }).length;
}

function contains(ancestor, node) {
    for(let walk = node; walk; walk = walk.parent) {
        if(walk === ancestor) {
            return true;
        }
    }

    return false;
}

test("add() puts the named object inside the object on its own line", async () => {
    const model = await loadModel("$parent>empty()\n$child>sphere(1,32,32)\n$parent>add($child)");
    const parent = model.getPart("parent");
    const child = model.getPart("child");

    assert.ok(parent && child, "both parts should be addressable");
    assert.ok(contains(parent, child), "$child should be inside $parent");
    assert.ok(!contains(child, parent), "$parent should not be inside $child");
    assert.equal(authoredRootChildren(model), 1, "only $parent should sit at the root");
    assert.equal(parent.children.length, 1);
});

test("the inverted form is what the docs warn against", async () => {
    /* `$child > sphere(...) > add($parent)` reads like "add the child to the
       parent" but does the opposite. Asserted so the documented warning stays
       true rather than becoming folklore. */
    const model = await loadModel("$parent>empty()\n$child>sphere(1,32,32)>add($parent)");
    const parent = model.getPart("parent");
    const child = model.getPart("child");

    assert.ok(contains(child, parent), "the inverted form buries $parent inside $child");
    assert.equal(parent.children.length, 0, "so $parent is an empty group");
});

test("one add() per level nests to any depth and every name still resolves", async () => {
    const model = await loadModel(
        "$alley>empty()\n" +
        "$section>empty()\n" +
        "$pinDeck>empty()>position(0,0,-30)\n" +
        "$deckPlate>box(1.5,0.05,1.5,#14100c,0,standard)\n" +
        "$alley>add($section)\n" +
        "$section>add($pinDeck)\n" +
        "$pinDeck>add($deckPlate)"
    );

    const alley = model.getPart("alley");
    const section = model.getPart("section");
    const pinDeck = model.getPart("pinDeck");
    const deckPlate = model.getPart("deckPlate");

    for(const [name, part] of Object.entries({ alley, section, pinDeck, deckPlate })) {
        assert.ok(part, name + " should be addressable at depth");
    }

    assert.ok(contains(alley, section), "section inside alley");
    assert.ok(contains(section, pinDeck), "deck inside section");
    assert.ok(contains(pinDeck, deckPlate), "plate inside deck");
    assert.equal(authoredRootChildren(model), 1, "the whole thing is one root child");

    // The landmark's transform is what the engine places pins against, so the
    // nesting must not disturb it.
    model.updateMatrixWorld(true);
    assert.equal(pinDeck.position.z, -30);
    assert.equal(pinDeck.getWorldPosition(new Vector3()).z, -30,
        "depth must not shift the landmark the engine measures against");
});

test("an object has one parent, so adding it twice moves it", async () => {
    const model = await loadModel("$a>empty()\n$b>empty()\n$part>box(1,1,1,#ff0000)\n$a>add($part)\n$b>add($part)");
    const a = model.getPart("a");
    const b = model.getPart("b");
    const part = model.getPart("part");

    assert.ok(contains(b, part), "$part should end up in the second destination");
    assert.ok(!contains(a, part), "and be removed from the first");
    assert.equal(a.children.length, 0);
});

test("nested startgroup() abandons the outer group", async () => {
    /* The warning in the Groups section. The outer group is lost, not merely
       left empty — this is the failure mode that is invisible on screen. */
    const model = await loadModel(
        "$outer>startgroup()\n" +
        "$m1>box(1,1,1,#ff0000)\n" +
        "$inner>startgroup()\n" +
        "$m2>box(1,1,1,#00ff00)\n" +
        "endgroup()\n" +
        "$m3>box(1,1,1,#0000ff)\n" +
        "endgroup()"
    );

    assert.equal(model.getPart("outer"), undefined, "$outer should have stopped resolving");
    assert.equal(model.getPart("m1"), undefined, "and taken its contents with it");
    assert.ok(model.getPart("inner"), "$inner survives");
    assert.ok(model.getPart("m2"), "$m2 survives");
    assert.ok(model.getPart("m3"), "$m3 survives");
});

test("a single startgroup() does group, so the documented example holds", async () => {
    const model = await loadModel(
        "$flock>startgroup()\n" +
        "$bird1>sphere(0.2,8,8)\n" +
        "$bird2>sphere(0.2,8,8)>position(1,0,0)\n" +
        "endgroup()"
    );

    const flock = model.getPart("flock");
    assert.ok(flock, "$flock should be addressable");
    assert.equal(flock.children.length, 2, "both birds should be inside the group");
    assert.equal(authoredRootChildren(model), 1);
});

test("finalize appends a merged mesh at the model root", async () => {
    /* Two same-material meshes become one draw call, and the merged mesh is added
       to the root rather than to the group its sources live in. Anything counting
       model.children to understand authored structure is off by one per merge
       group, so merge nodes have to be recognised by userData instead. */
    const model = await loadModel("$flock>startgroup()\n$left>box(1,1,1,#ff0000)\n$right>box(1,1,1,#ff0000)>position(2,0,0)\nendgroup()");

    const mergeNodes = model.children.filter(function(node) {
        return node.userData && node.userData.__bmMergeGroup !== undefined;
    });

    assert.equal(mergeNodes.length, 1, "the two boxes should share one draw call");
    assert.equal(authoredRootChildren(model), 1, "but only one authored root child");

    const left = model.getPart("left");
    assert.equal(left.visible, true, "getPart() restores the source so it is drawn again");
    assert.equal(mergeNodes[0].userData.__bmMergeGroup, 0);
    assert.equal(left.userData.__bmMergeSource, 0, "and the source knows which group it came from");
});

test("the clone-groups example produces a group that actually has children", async () => {
    /* The example used to parent in the wrong direction, which left $tree empty
       and made every clone of it an empty object. */
    const model = await loadModel(
        "$tree>empty()\n" +
        "$trunk>cylinder(0.2,0.2,2,8,#8B4513)\n" +
        "$leaves>sphere(1,16,16,#228B22)>position(0,2,0)\n" +
        "$tree>add($trunk)\n" +
        "$tree>add($leaves)"
    );

    const tree = model.getPart("tree");
    assert.ok(tree);
    assert.equal(tree.children.length, 2, "a clone of $tree must carry both parts");
    assert.equal(authoredRootChildren(model), 1);

    const copy = model.clone();
    const copiedTree = copy.getPart("tree");
    assert.ok(copiedTree, "the name should survive the clone");
    assert.equal(copiedTree.children.length, 2);
});

test("getPart accepts the $ prefix and rejects anything else", async () => {
    const model = await loadModel("$deck>empty()\n$laneWidth=2.2");

    assert.ok(model.getPart("deck"));
    assert.ok(model.getPart("$deck"), "the $ form is documented as equivalent");
    assert.equal(model.getPart(" deck"), undefined, "the lookup is exact");

    // Documented in the getPart() note: literals are stored as written, so a
    // number comes back as a string.
    assert.equal(model.getPart("laneWidth"), "2.2");
    assert.equal(typeof model.getPart("laneWidth"), "string");
    assert.equal(Number(model.getPart("laneWidth")), 2.2);
});
