import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { BMLoader } from "../bmloader.js";

/*
 * Regressions for three bugs found while building a model from OPERATIONS.md:
 *
 *   - a variable used twice in one expression tree was reported as a circular
 *     reference and silently resolved to 0.
 *   - clone($obj) was documented but not implemented.
 *   - OPERATIONS.md described an animation syntax the parser does not read.
 */

let nextId = 0;

function load(script) {
    const loader = new BMLoader();
    const spec = { id: "regressions-" + (nextId++), revision: 1, script, textures: {}, animations: {} };

    return new Promise((resolve, reject) => {
        loader.load(spec, resolve, undefined, reject);
    });
}

async function withWarnings(fn) {
    const warnings = [];
    const original = console.warn;
    console.warn = (...args) => warnings.push(args.map(String).join(" "));

    try {
        return { result: await fn(), warnings };
    } finally {
        console.warn = original;
    }
}

test("a variable shared by two terms is not a circular reference", async () => {
    const { result: model, warnings } = await withWarnings(() =>
        load("$tile=2\n$a=$tile*2\n$b=$a+$tile\n$box>box($b,1,1,#ff0000)"));

    assert.equal(model.getPart("box").geometry.parameters.width, 6);
    assert.deepEqual(warnings, []);
});

test("a real circular reference is still detected", async () => {
    const { warnings } = await withWarnings(() =>
        load("$a=$b+1\n$b=$a+1\n$box>box($a,1,1,#ff0000)"));

    assert.ok(warnings.some((w) => w.includes("Circular reference")));
});

test("clone($obj) copies a mesh into the model", async () => {
    const model = await load("$original>sphere(1,8,8,#ff0000)\n$copy>clone($original)>position(3,0,0)");
    const { original, copy } = model.bmDat.variables;

    assert.ok(copy && copy.isMesh);
    assert.notEqual(copy, original);
    assert.equal(copy.parent, model);
    assert.equal(copy.position.x, 3);
    assert.equal(original.position.x, 0, "transforms on the clone do not move the source");
    assert.equal(copy.geometry, original.geometry, "geometry is shared");
});

test("clone($obj) deep-copies a group and its children", async () => {
    const model = await load([
        "$tree>empty()",
        "$trunk>cylinder(0.2,0.2,2,8,#8B4513)",
        "$leaves>sphere(1,8,8,#228B22)>position(0,2,0)",
        "$tree>add($trunk)",
        "$tree>add($leaves)",
        "$forest>clone($tree)>position(5,0,0)"
    ].join("\n"));
    const { tree, forest } = model.bmDat.variables;

    assert.equal(forest.children.length, 2);
    assert.equal(tree.children.length, 2, "the source keeps its children");
    assert.notEqual(forest.children[0], tree.children[0]);
});

test("material() on a clone does not change the source", async () => {
    const model = await load([
        "$a>box(1,1,1,#ff0000)>material(#ff0000,,,,,,#ffffff,1)",
        "$b>clone($a)",
        "$b>material(#00ff00)"
    ].join("\n"));

    assert.equal(model.bmDat.variables.a.material.color.getHexString(), "ff0000");
    assert.equal(model.bmDat.variables.b.material.color.getHexString(), "00ff00");
});

test("every animation example in OPERATIONS.md parses", () => {
    const doc = readFileSync(new URL("../OPERATIONS.md", import.meta.url), "utf8");
    const lines = doc.split(/\r?\n/).filter((l) => /^@\w+ > /.test(l) && !l.includes("action($object"));

    assert.ok(lines.length > 10, "found the examples");

    for (const line of lines) {
        const src = line.replace(/^@\w+ > /, "").replaceAll(" ", "");
        const parts = src.replace(")", "").split("(");

        assert.equal(parts.length, 2, `one call per line: ${line}`);
        const args = parts[1].split(",");
        assert.ok(args[0].startsWith("$"), `first argument is the object: ${line}`);
        assert.ok(!isNaN(parseFloat(args[1])), `second argument is a numeric speed: ${line}`);
        assert.ok(args.length >= 3, `at least one step: ${line}`);
    }
});

test("rotate speed is degrees per second; visible speed is seconds per step", async () => {
    const model = await load("$b>box(1,1,1,#ff0000)\n$c>box(1,1,1,#ff0000)\n@go>rotateY($b,90,0,360)\n@go>visible($c,0.5,0,1)");
    model.bmDat.animation = "go";

    for (let i = 0; i < 100; i++) model.animate(0.01);

    const degrees = model.getPart("b").rotation.y * 180 / Math.PI;
    assert.ok(Math.abs(degrees - 90) < 2, `turned ${degrees} degrees in 1s`);
    assert.equal(model.getPart("c").visible, true, "after 1s the visible animation is on its second step (1)");
});
