import assert from "node:assert/strict";
import test from "node:test";

import { BMLoader } from "../bmloader.js";

/*
 * A scene places hundreds of copies of one model in a single pass, so every load
 * after the first arrives while that first parse is still running. Each must wait
 * for it rather than parse the script again.
 */

let nextId = 0;

function spec(script) {
    return { id: "load-dedupe-" + (nextId++), revision: 1, script, textures: {}, animations: {} };
}

function load(json, variables) {
    return new Promise((resolve, reject) => {
        new BMLoader().load({ json, variables }, resolve, undefined, reject);
    });
}

test("concurrent loads of one model parse it once and each get their own clone", async () => {
    const json = spec("$tile=1\n$a>box($tile,1,1,#ff0000)\n$b>box(1,$tile,1,#ff0000)>position(2,0,0)");

    const models = await Promise.all(Array.from({ length: 25 }, () => load(json, { tile: 2 })));

    // A clone carries its source's parsed model; one parse means one source for all of them.
    const sources = new Set(models.map((m) => m.bmDat.src));
    assert.equal(sources.size, 1);
    assert.equal(new Set(models).size, models.length);
    assert.equal(new Set(models.map((m) => m.bmDat.cacheKey)).size, 1);
});

test("concurrent loads with different variables are not merged", async () => {
    const json = spec("$tile=1\n$a>box($tile,1,1,#ff0000)");

    const [small, large] = await Promise.all([load(json, { tile: 1 }), load(json, { tile: 3 })]);

    assert.notEqual(small.bmDat.cacheKey, large.bmDat.cacheKey);
    assert.equal(small.getPart("a").geometry.parameters.width, 1);
    assert.equal(large.getPart("a").geometry.parameters.width, 3);
});

test("a load after the first has finished still clones the cached model", async () => {
    const json = spec("$a>box(1,1,1,#ff0000)");

    const first = await load(json);
    const second = await load(json);

    assert.notEqual(first, second);
    assert.equal(first.bmDat.src, second.bmDat.src);
});

test("a shared load hands back the one cached model, before and after it is parsed", async () => {
    const json = spec("$a>box(1,1,1,#ff0000)");
    const shared = (variables) => new Promise((resolve, reject) => {
        new BMLoader().load({ json, variables, shared: true }, resolve, undefined, reject);
    });

    const [a, b] = await Promise.all([shared({ tile: 2 }), shared({ tile: 2 })]);
    const later = await shared({ tile: 2 });
    const clone = await load(json, { tile: 2 });

    assert.equal(a, b);
    assert.equal(a, later);
    assert.notEqual(clone, a, "an ordinary load still gets a clone");
    assert.equal(clone.bmDat.cacheKey, a.bmDat.cacheKey);
});
