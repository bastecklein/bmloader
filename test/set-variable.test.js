import assert from "node:assert/strict";
import test from "node:test";

import { BMLoader } from "../bmloader.js";

function loadModel(source) {
    const loader = new BMLoader();

    return new Promise((resolve, reject) => {
        loader.load(source, resolve, undefined, reject);
    });
}

test("setVariable rebuilds without growing the captured script", async () => {
    const model = await loadModel({
        id: "set-variable-regression",
        revision: 1,
        script: "$size=1\n$part=box($size,$size,$size,#ff0000)",
        textures: {},
        animations: {}
    });
    const scriptLineCount = model.bmDat._scriptLines.length;

    for(let size = 2; size <= 10; size++) {
        await model.setVariable("$size", size);

        assert.equal(model.children.length, 1);
        assert.equal(model.bmDat._scriptLines.length, scriptLineCount);

        const part = model.getPart("part");
        part.geometry.computeBoundingBox();
        assert.equal(part.geometry.boundingBox.max.x - part.geometry.boundingBox.min.x, size);
    }
});