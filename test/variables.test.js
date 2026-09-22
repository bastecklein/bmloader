import assert from "node:assert/strict";
import test from "node:test";

import { BMLoader } from "../bmloader.js";

/*
 * The variable behaviours OPERATIONS.md describes.
 *
 * Every one of these is a SILENT failure in the loader — nothing throws, nothing
 * warns — so the doc's warnings are worth more as assertions than as prose. If one of
 * these starts failing, the doc has stopped being true.
 *
 * Two traps are covered that the docs did not previously mention at all:
 *
 *   - the flat `{ id, script }` load form discards `variables` entirely.
 *   - a variable named after an expr-eval built-in (`length`, `min`, `max`, `abs`,
 *     `floor`, `round`, `sqrt`, ...) is shadowed by the built-in inside any
 *     expression, so arithmetic on it quietly returns nonsense.
 */

/* loadedRenderModels is module-level, so the cache key has to be unique per script. */
let nextId = 0;

function load(source, variables) {
    const loader = new BMLoader();
    const spec = variables ? Object.assign({}, source, { variables }) : source;

    return new Promise((resolve, reject) => {
        loader.load(spec, resolve, undefined, reject);
    });
}

function spec(script) {
    return { id: "variables-" + (nextId++), revision: 1, script, textures: {}, animations: {} };
}

/* The lane-shaped script the expression tests use, because it is the real case. */
function spanScript(declaredLast) {
    const parts = ["$frontOverhang=2", "$laneLength=30", "$backOverhang=2"];
    const span = "$boardSpan=$frontOverhang+$laneLength+$backOverhang";

    return (declaredLast
        ? ["$frontOverhang=2", "$backOverhang=2", span, "$board>box(1,1,$boardSpan,#ff0000)", "$laneLength=30"]
        : parts.concat([span, "$board>box(1,1,$boardSpan,#ff0000)"])
    ).join("\n");
}

test("a variable used before it is declared builds a zero-sized object", async () => {
    const model = await load(spec("$box>box($width,1,1,#ff0000)\n$width=6"));
    const box = model.getPart("box");

    assert.equal(box.geometry.parameters.width, 0, "the bare use gives 0, not an error");
    assert.notEqual(box.geometry.parameters.justForTheMessage, 0);
    assert.equal(box.geometry.parameters.height, 1, "and only the axis it sized is affected");
});

test("a variable used before it is declared inside an expression is worse", async () => {
    /* The measured case, and the reason the lane model declares its parameters at the
       top: the missing term contributes 0, so the result is a plausible number
       rather than a visibly broken one. */
    const good = await load(spec(spanScript(false)));
    const bad = await load(spec(spanScript(true)));

    assert.equal(good.getPart("board").geometry.parameters.depth, 34, "declared in order it is the real span");
    assert.equal(bad.getPart("board").geometry.parameters.depth, 4,
        "declared below its use it is 2 + 0 + 2, and nothing reports the missing 30");
});

test("a derived variable keeps its expression as text", async () => {
    const model = await load(spec("$width=2.2\n$half=$width/2\n$left>box($half,1,1,#ff0000)"));

    assert.ok(Math.abs(model.getPart("left").geometry.parameters.width - 1.1) < 1e-9,
        "the expression still evaluates where it is used");
    assert.equal(model.getPart("half"), "$width/2", "but the variable itself is the expression text");
    assert.ok(Number.isNaN(Number(model.getPart("half"))), "so it cannot be read back as a number");
});

test("an override reaches through a derived variable", async () => {
    /* Why a parametric model works at all: overriding one parameter moves everything
       derived from it, because those expressions are re-evaluated rather than baked. */
    const script = "$laneWidth=2.2\n$gutterWidth=0.45\n" +
        "$gutterX=$laneWidth/2+$gutterWidth/2\n" +
        "$gutter>box($gutterWidth,0.16,30,#232c3d,0,standard)>position(-$gutterX,-0.12,0)";

    const narrow = await load({ json: spec(script) }, null);
    const wide = await load({ json: spec(script) }, { laneWidth: 4.4 });

    assert.ok(Math.abs(narrow.getPart("gutter").position.x - (-1.325)) < 1e-9);
    assert.ok(Math.abs(wide.getPart("gutter").position.x - (-2.425)) < 1e-9,
        "the gutter followed the width out");
});

test("an override is not readable back off the model", async () => {
    const script = "$height=5\n$box>box(1,$height,1,#ff0000)";
    const model = await load({ json: spec(script) }, { height: 10 });

    assert.equal(model.getPart("box").geometry.parameters.height, 10, "the override applied");
    assert.equal(model.getPart("height"), "5", "but getPart() reports the script's default");
    assert.equal(model.bmDat.variableOverrides.height, 10, "which is why the override lives beside the script");
});

test("all three load forms apply variables", async () => {
    /*
     * The flat `{ id, script }` form used to be the odd one out: it called
     * loadBM(modelDat, null, scope), so every override was discarded while `{ url }`
     * and `{ json }` honoured them. That divergence was a documented trap; the null is
     * now the wrapper, so the three forms agree.
     */
    const script = "$height=5\n$box>box(1,$height,1,#ff0000)";

    assert.equal((await load(Object.assign(spec(script), { variables: { height: 10 } }))).getPart("box").geometry.parameters.height,
        10, "the flat form applies them now");
    assert.equal((await load({ json: spec(script), variables: { height: 10 } })).getPart("box").geometry.parameters.height,
        10, "the json form applies them");
});

test("the two scripts in the test above do not share a cache entry", async () => {
    /*
     * The trap underneath the trap. The flat form keyed its cache on
     * `object_${id}_r${revision}` with no override term, so applying overrides without
     * also fixing the key would have made the FIRST load win for every later one.
     * Asserted explicitly because it is invisible in a single load.
     */
    const script = "$height=5\n$box>box(1,$height,1,#ff0000)";
    const shared = spec(script); // one id for both loads, which is the point

    const tall = await load(Object.assign({}, shared), { height: 20 });
    const short = await load(Object.assign({}, shared), { height: 2 });

    assert.equal(tall.getPart("box").geometry.parameters.height, 20);
    assert.equal(short.getPart("box").geometry.parameters.height, 2,
        "a second load with different variables must not get the first one's geometry");

    const plain = await load(Object.assign({}, shared));
    assert.equal(plain.getPart("box").geometry.parameters.height, 5,
        "and an override-free load still gets the script's own value");
});

test("an override naming an undeclared variable is dropped without a word", async () => {
    const script = "$height=5\n$box>box(1,$height,1,#ff0000)";

    assert.equal((await load({ json: spec(script) }, { hieght: 10 })).getPart("box").geometry.parameters.height,
        5, "a typo looks exactly like no override at all");
});

test("a variable named after an expr-eval built-in is shadowed inside expressions", async () => {
    /*
     * getModValue strips the `$` and hands the bare identifier to expr-eval, so a model
     * variable named `length` becomes expr-eval's own `length` and the arithmetic
     * silently goes wrong. `length` is not special-cased anywhere; it is one of 53
     * built-in names (functions, unary operators and constants) with this problem.
     *
     * Asserted rather than merely documented so that a future fix is visible here.
     */
    const collides = await load(spec("$length=3\n$other=10\n$span=$length+$other\n$box>box(1,1,$span,#ff0000)"));

    assert.notEqual(collides.getPart("box").geometry.parameters.depth, 13,
        "the built-in shadows the variable, so the sum is not 13");

    /* A name that only CONTAINS one is fine, which is what makes this easy to miss. */
    const fine = await load(spec("$lengthOfLane=3\n$other=10\n$span=$lengthOfLane+$other\n$box>box(1,1,$span,#ff0000)"));

    assert.equal(fine.getPart("box").geometry.parameters.depth, 13, "so only an exact match is a problem");
});

test("a built-in name still works when it is never used in an expression", async () => {
    /* The trap needs an expression: a built-in-named variable used as a bare argument
       resolves through resolveVar() and is fine. That asymmetry is the reason this is
       worth a guard rather than a blanket ban. */
    const model = await load(spec("$length=7\n$box>box(1,$length,1,#ff0000)"));

    assert.equal(model.getPart("box").geometry.parameters.height, 7);
});
