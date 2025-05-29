import { hash, guid, rebuildStandardObject } from "common-helpers";

import {
    Loader,
    MeshLambertMaterial,
    Mesh,
    Group,
    MathUtils,
    FileLoader,
    SphereGeometry,
    TorusGeometry,
    BoxGeometry,
    ConeGeometry,
    CylinderGeometry,
    DoubleSide,
    SRGBColorSpace,
    TextureLoader,
    CapsuleGeometry,
    Shape,
    ExtrudeGeometry,
    Vector2,
    PlaneGeometry,
    Color,
    Vector3,
    Euler
} from "three";

import { DecalGeometry } from "three/addons/geometries/DecalGeometry.js";

import { Parser } from "expr-eval";

const storedGeometries = {};
const storedImageCanvases = {};

const DEF_MODEL_COLOR = "#999999";
const FULLTURN = MathUtils.degToRad(360);

const parser = new Parser();

let threeLoader = null;
let remoteModels = {};

class BMLoader extends Loader {
    constructor(manager) {
        super(manager);
    }

    load(url, onLoad, onProgress, onError) {
        const scope = this;

        let options = {};
        let modelDat = null;

        if(typeof url === "object") {

            if(url.script && url.id) {
                modelDat = rebuildBM(url);

                loadBM(modelDat, null).then(function(renderModel) {
                    onLoad(renderModel);
                });

                return;
            }

            if(url.json && url.json.script && url.json.id) {
                modelDat = rebuildBM(url.json);

                loadBM(modelDat, url).then(function(renderModel) {
                    onLoad(renderModel);
                });

                return;
            }

            if(options.url) {
                url = options.url;
                options = url;
            } else {
                onError(new Error("Invalid model data"));
                return;
            }
        }

        if(remoteModels[url]) {
            loadBM(remoteModels[url], options).then(function(renderModel) {
                onLoad(renderModel);
            });

            return;
        }

        const loader = new FileLoader(scope.manager);
        loader.setResponseType("json");
        loader.setPath(this.path);
        loader.load(url, function (data) {

            modelDat = rebuildBM(data);
            remoteModels[url] = modelDat;

            loadBM(modelDat, options).then(function(renderModel) {
                onLoad(renderModel);
            });

            
        }, onProgress, onError);
    }
}

class BasicModel {
    constructor(appName = null, appVersion = null) {
        this.script = null;
        this.textures = {};
        this.animations = {};

        this.revision = 0;
        this.author = null;
        this.editingApplication = appName;
        this.applicationVersion = appVersion;

        this.id = guid();

        this.created = new Date().getTime();
        this.edited = this.created;

        this.textureCounter = 0;
    }
}

class ModelTexture {
    constructor() {
        this.type = null;
        this.data = null;
        this.frames = 1;
        this.varName = null;
    }
}

class RenderBasicModel extends Group {
    constructor(model) {
        super();

        this.bmDat = {
            src: model,
            variables: {},
            variableOverrides: {},
            geoTranslate: { x: 0, y: 0, z: 0 },
            animations: {},
            animation: null,
            _scriptLines: null,
            lastAnimation: null,
            defaultState: {}
        };
    }

    dispose() {
        this.bmDat = null;
    }

    animate(delta) {
        animateModel(this, delta);
    }

    reset() {
        console.log("reset model!");
        resetRenderModel(this);
        console.log("model reset!");
    }

    saveState() {
        saveModelState(this, this);
    }

    restoreState() {
        console.log("restore model state!");
        restoreModelState(this, this);
        console.log("state restored!");
    }
}

class RenderAnimation {
    constructor(inst) {
        this.src = inst;

        this.target = null;
        this.action = null;
        this.step = 0;

        this.speed = 0;
        this.steps = [];
        this.renTime = 0;

        parseAnimationInstructions(this);
    }
}

function parseAnimationInstructions(animation) {
    const inst = animation.src;

    if(!inst || inst.trim().length == 0) {
        return;
    }

    const parts = inst.replace(")","").split("(");

    if(parts.length == 2) {
        animation.action = parts[0].trim();

        const lines = parts[1].trim().split(",");

        if(lines.length > 0) {
            animation.target = lines[0].replace("$","").trim();
        }

        if(lines.length > 1) {
            animation.speed = lines[1];
        }

        for(let i = 2; i < lines.length; i++) {
            const step = lines[i];
            animation.steps.push(step);
        }
    }
}

/**
 * Runs the current model animation script
 * @param {RenderBasicModel} model The model to animate
 * @param {number} delta The time delta since the last frame
 */
function animateModel(model, delta) {
    if(!model.bmDat.animations || !model.bmDat.animation) {

        if(model.bmDat.lastAnimation) {
            model.bmDat.lastAnimation = null;
            model.restoreState();
        }

        if(model.bmDat.animations) {
            for(let aniName in model.bmDat.animations) {
                const ani = model.bmDat.animations[aniName];
                ani.step = 0;
            }
        }

        return;
    }

    for(let aniName in model.bmDat.animations) {
        if(aniName == model.bmDat.animation) {
            continue;
        }
        
        const ani = model.bmDat.animations[aniName];
        ani.step = 0;
    }

    model.bmDat.lastAnimation = model.bmDat.animation;

    if(!model.bmDat.animation) {
        return;
    }

    const animation = model.bmDat.animations[model.bmDat.animation];

    if(!animation) {
        return;
    }

    for(let i = 0; i < animation.length; i++) {
        const inst = animation[i];
        doAnimate(model, inst, delta);
    }
}

function doAnimate(model, inst, delta) {
    const ob = model.bmDat.variables[inst.target];

    if(ob) {
        const rawSpeed = getModValue(inst.speed, model);
        const speed = MathUtils.degToRad(parseFloat(rawSpeed)) * delta;
        const rawVal = inst.steps[inst.step];
        const tgtVal = getModValue(rawVal, model);

        let changeBaseOb = null;
        let subProp = null;
        let target = null;

        if(inst.action.indexOf("txChange") == 0) {
            inst.renTime += delta;

            if(inst.renTime >= inst.speed) {
                inst.renTime = 0;

                getTextureMaterial(rawVal, model, ob.material.transparent, undefined, ob.material.depthWrite).then(function(mat) {
                    if(mat) {
                        ob.material = mat;
                        ob.material.needsUpdate = true;
                    } else {
                        console.warn("Texture not found for:", rawVal);
                    }
                });

                inst.step++;

                if(inst.step >= inst.steps.length) {
                    inst.step = 0;
                }
            }

            return;
        }

        if(inst.action.indexOf("scale") == 0) {
            changeBaseOb = "scale";
            subProp = inst.action.replace("scale","").toLowerCase();
            target = parseFloat(tgtVal);

            if(isNaN(target)) {
                console.warn("Invalid scale target value:", tgtVal);
                return;
            }
        }

        if(inst.action.indexOf("rotate") == 0) {
            changeBaseOb = "rotation";
            subProp = inst.action.replace("rotate","").toLowerCase();
            target = MathUtils.degToRad(parseFloat(tgtVal));
        }

        if(inst.action.indexOf("position") == 0) {
            changeBaseOb = "position";
            subProp = inst.action.replace("position","").toLowerCase();
            target = parseFloat(tgtVal);
        }

        const cur = ob[changeBaseOb][subProp];

        if(cur > target) {
            ob[changeBaseOb][subProp] -= speed;

            if(ob[changeBaseOb][subProp] <= target) {
                ob[changeBaseOb][subProp] = target;
                inst.step++;

                if(changeBaseOb == "rotation") {
                    if(ob[changeBaseOb][subProp] <= -FULLTURN) {
                        ob[changeBaseOb][subProp] += FULLTURN;
                    }
                }
            }
        } else {
            ob[changeBaseOb][subProp] += speed;

            if(ob[changeBaseOb][subProp] >= target) {
                ob[changeBaseOb][subProp] = target;
                inst.step++;
            }

            if(changeBaseOb == "rotation") {
                if(ob[changeBaseOb][subProp] >= FULLTURN) {
                    ob[changeBaseOb][subProp] -= FULLTURN;
                }
            }
        }

        if(inst.step >= inst.steps.length) {
            inst.step = 0;
        }

    }
}

/**
 * 
 * @param {BasicModel} modelData 
 * @param {*} options 
 * @returns RenderBasicModel
 */
async function loadBM(modelData, options) {

    const renderModel = new RenderBasicModel(modelData);

    if(options) {
        if(options.variables) {
            for(let varName in options.variables) {
                renderModel.bmDat.variableOverrides[varName] = options.variables[varName];
            }
        }
    }

    const currentGroup = {
        grp: null
    };

   

    let code = modelData.script.trim();
    code = code.replaceAll(" ", "");
    code = code.replaceAll("\n", ";");

    const lines = code.split(";");

    for(let i = 0; i < lines.length; i++) {
        const line = lines[i];
        await negotiateInstructionLine(line, renderModel, currentGroup);
    }

    renderModel.saveState();

    return renderModel;
}

async function negotiateInstructionLine(line, renderModel, currentGroup) {
    if (line.trim().startsWith("//") || !line.trim()) return;

    // Store original instruction
    if (!renderModel.bmDat._scriptLines) {
        renderModel.bmDat._scriptLines = [];
    }

    renderModel.bmDat._scriptLines.push(line);

    let usingVar = null;
    let usingObj = null;
    let usingAni = null;
    let aniOb = null;

    let codeParts = line;

    const assignments = line.split("=");
    if (assignments.length === 2 && assignments[0].trim().startsWith("$")) {
        usingVar = assignments[0].trim().replace("$", "");
        codeParts = assignments[1].trim();
    }

    const modParts = codeParts.split(">");

    // If this is a simple expression or literal assignment (no ">" present), store directly
    if (modParts.length === 1 && usingVar && !modParts[0].includes("(") && !modParts[0].startsWith("@")) {
        renderModel.bmDat.variables[usingVar] = modParts[0].trim();
        return;
    }

    for (let mod of modParts) {
        mod = mod.trim();
        if (!mod) continue;

        // Handle variable references
        if (mod.startsWith("$")) {
            const evals = mod.replace("$", "");

            if (usingVar && renderModel.bmDat.variables[evals]) {
                renderModel.bmDat.variables[usingVar] = renderModel.bmDat.variables[evals];
            } else {
                usingVar = evals;
                usingObj = renderModel.bmDat.variables[evals] || null;
            }
            continue;
        }

        // Handle animation references
        if (mod.startsWith("@")) {
            const evals = mod.replace("@", "");

            if (usingAni && renderModel.bmDat.animations[evals]) {
                renderModel.bmDat.animations[usingAni] = renderModel.bmDat.animations[evals];
            } else {
                usingAni = evals;
                aniOb = renderModel.bmDat.animations[evals] || null;
            }
            continue;
        }

        // Handle animation definitions
        if (usingAni) {
            if (!aniOb) {
                aniOb = [];
                renderModel.bmDat.animations[usingAni] = aniOb;
            }
            aniOb.push(new RenderAnimation(mod));
            continue;
        }

        // Handle grouping
        if (mod === "startgroup()" || mod === "endgroup()") {
            if (mod === "endgroup()" && currentGroup.grp) {
                renderModel.add(currentGroup.grp);
                currentGroup.grp = null;
            } else if (mod === "startgroup()") {
                currentGroup.grp = new Group();
                usingObj = currentGroup.grp;
                if (usingVar) renderModel.bmDat.variables[usingVar] = currentGroup.grp;
            }
            continue;
        }

        // Geometry and transform operations
        const ops = [
            { keyword: "sphere(", func: createSphereOperation },
            { keyword: "torus(", func: createTorusOperation },
            { keyword: "box(", func: createBoxOperation },
            { keyword: "cone(", func: createConeOperation },
            { keyword: "cylinder(", func: createCylinderOperation },
            { keyword: "capsule(", func: createCapsuleOperation },
            { keyword: "shape(", func: createShapeOperation },
            { keyword: "plane(", func: createPlaneOperation },
            { keyword: "empty()", func: createGroupOperation },
            { keyword: "decal(", func: createDecalOperation }
        ];

        let handled = false;
        for (const op of ops) {
            if (mod.startsWith(op.keyword)) {
                usingObj = await op.func(mod, renderModel, currentGroup.grp);
                if (usingVar) renderModel.bmDat.variables[usingVar] = usingObj;
                handled = true;
                break;
            }
        }
        if (handled) continue;

        // Handle 'add($someObject)' syntax
        if (mod.startsWith("add($") && mod.endsWith(")")) {
            const targetName = mod.slice(5, -1);
            const targetObj = renderModel.bmDat.variables[targetName];
            if (targetObj && usingObj && typeof usingObj.add === 'function') {
                usingObj.add(targetObj);
            } else {
                console.warn("Unable to add object to group:", targetName);
            }
            continue;
        }

        // Handle material override
        if (mod.startsWith("material(")) {
            const args = mod.substring(9, mod.length - 1).split(",").map(s => s.trim());
            const [color, bumpMap, lightMap] = args;
            if (usingObj && usingObj.material) {
                usingObj.material.color = new Color(getModValue(color, renderModel));
                if (bumpMap && renderModel.bmDat.textures[getModValue(bumpMap, renderModel)]) {
                    usingObj.material.bumpMap = renderModel.bmDat.textures[getModValue(bumpMap, renderModel)];
                    usingObj.material.bumpScale = 1;
                }
                if (lightMap && renderModel.bmDat.textures[getModValue(lightMap, renderModel)]) {
                    usingObj.material.lightMap = renderModel.bmDat.textures[getModValue(lightMap, renderModel)];
                }
                usingObj.material.needsUpdate = true;
            }
            continue;
        }

        // Handle 'bottomAlign()'
        if (mod === "bottomAlign()") {
            if (usingObj && usingObj.geometry) {
                usingObj.geometry.computeBoundingBox();
                const bbox = usingObj.geometry.boundingBox;
                const offsetY = -bbox.min.y;
                usingObj.geometry.translate(0, offsetY, 0);
            }
            continue;
        }

        // Handle transforms.
        if (mod.startsWith("geotranslate(")) {
            handleGeoTranslate(mod, renderModel);
            continue;
        }
        if (mod.startsWith("position(")) {
            (usingVar ? doPositionOperation(usingVar, mod, renderModel)
                : usingObj && doPositionOperation(usingObj, mod, renderModel));
            continue;
        }
        if (mod.startsWith("rotate(")) {
            (usingVar ? doRotateOperation(usingVar, mod, renderModel)
                : usingObj && doRotateOperation(usingObj, mod, renderModel));
            continue;
        }
        if (mod.startsWith("scale(")) {
            (usingVar ? doScaleOperation(usingVar, mod, renderModel)
                : usingObj && doScaleOperation(usingObj, mod, renderModel));
            continue;
        }
        if (mod.startsWith("opacity(")) {
            (usingVar ? doOpacityOperation(usingVar, mod, renderModel)
                : usingObj && doOpacityOperation(usingObj, mod, renderModel));
            continue;
        }
        if (mod.startsWith("orientation(")) {
            (usingVar ? doOrientationOperation(usingVar, mod, renderModel)
                : usingObj && doOrientationOperation(usingObj, mod, renderModel));
            continue;
        }

        // Fallback: unknown mod, possibly a value assignment
        if (usingVar) {
            renderModel.bmDat.variables[usingVar] = mod;
        } else {
            console.warn("Unrecognized operation in line:", line);
        }
    }
}

async function createSphereOperation(code, renderModel, currentGroup) {
    let raw = code.replace("sphere(","");
    raw = raw.replace(")","");

    const parts = raw.split(",");

    let mesh = null;

    let rad = 1;
    let wSegs = 1;
    let hSegs = 1;

    if(parts.length >= 3) {

        rad = getModValue(parts[0], renderModel);
        wSegs = getModValue(parts[1], renderModel);
        hSegs = getModValue(parts[2], renderModel);

        let geoName = "sphere." + rad + "." + wSegs + "." + hSegs + "." + renderModel.bmDat.geoTranslate.x + "." + renderModel.bmDat.geoTranslate.y + "." + renderModel.bmDat.geoTranslate.z;

        let geometry = null;

        if(storedGeometries[geoName]) {
            geometry = storedGeometries[geoName];
        } else {
            geometry = new SphereGeometry(rad,wSegs,hSegs);

            geometry.translate(renderModel.bmDat.geoTranslate.x, renderModel.bmDat.geoTranslate.y, renderModel.bmDat.geoTranslate.z);

            storedGeometries[geoName] = geometry;
        }
        
        let material = null;

        // texture
        if(parts.length > 4) {
            let transparent = false;
            const colPart = getModValue(parts[3], renderModel)

            if(colPart == "transparent" || (colPart.length == 7 && colPart[0] == "#")) {
                transparent = true;
            }

            material = await getTextureMaterial(parts[4], renderModel, transparent, colPart);
        }
        

        if(!material) {
            if(parts.length > 3) {
                material = new MeshLambertMaterial({
                    color: getModValue(parts[3], renderModel)
                });
            } else {
                material = new MeshLambertMaterial({
                    color: DEF_MODEL_COLOR
                });
            }
        }

        mesh = new Mesh(geometry, material);

        if(currentGroup) {
            currentGroup.add(mesh);
        } else {
            renderModel.add(mesh);
        }

    }

    return mesh;
}

function createGroupOperation(code, renderModel, currentGroup) {
    const group = new Group();

    if(currentGroup) {
        currentGroup.add(group);
    } else {
        renderModel.add(group);
    }

    return group;
}

function getModValue(val, renderModel, visited = new Set()) {
    if (typeof val !== 'string') return val;

    const rawVars = {
        ...(renderModel.bmDat.variables || {}),
        ...(renderModel.bmDat.variableOverrides || {})
    };

    function resolveVar(key) {
        if (visited.has(key)) {
            console.warn(`Circular reference detected for variable: ${key}`);
            return 0;
        }

        visited.add(key);

        let value = rawVars[key];
        if (typeof value === 'undefined') return 0;

        // Recurse and fully resolve the variable's value
        return getModValue(value, renderModel, visited);
    }

    // $foo or -$foo (simple variable reference)
    const varOnlyMatch = val.match(/^(-?)\$(\w+)$/);
    if (varOnlyMatch) {
        const [, neg, varName] = varOnlyMatch;
        const resolved = resolveVar(varName);
        return typeof resolved === 'number' && neg === '-' ? -resolved : resolved;
    }

    // If not math-like, return literal or parsed float
    const looksLikeMath = /[+\-*/()]/.test(val) || /\$\w+/.test(val);
    if (!looksLikeMath) {
        return isNaN(val) ? val : parseFloat(val);
    }

    // Replace $var with real variable names (expr-eval expects bare names)
    const cleanExpr = val.replace(/\$(\w+)/g, (_, name) => name);

    try {
        const expr = parser.parse(cleanExpr);
        const scope = new Proxy({}, {
            get(_, name) {
                return resolveVar(name);
            }
        });
        return expr.evaluate(scope);
    } catch (e) {
        console.warn(`Failed to evaluate: ${val}`, e);
        return val;
    }
}

async function createTorusOperation(code,renderModel,currentGroup) {
    let raw = code.replace("torus(","");
    raw = raw.replace(")","");

    const parts = raw.split(",");

    let mesh = null;

    let rad = 1;
    let tube = 1;
    let radSegs = 1;
    let tubeSegs = 1;

    if(parts.length >= 4) {

        rad = getModValue(parts[0],renderModel);
        tube = getModValue(parts[1],renderModel);
        radSegs = getModValue(parts[2],renderModel);
        tubeSegs = getModValue(parts[3],renderModel);

        let geoName = "torus." + rad + "." + tube + "." + radSegs + "." + tubeSegs + "." + renderModel.bmDat.geoTranslate.x + "." + renderModel.bmDat.geoTranslate.y + "." + renderModel.bmDat.geoTranslate.z;

        let geometry = null;

        if(storedGeometries[geoName]) {
            geometry = storedGeometries[geoName];
        } else {
            geometry = new TorusGeometry(rad,tube,radSegs,tubeSegs);

            geometry.translate(renderModel.bmDat.geoTranslate.x, renderModel.bmDat.geoTranslate.y, renderModel.bmDat.geoTranslate.z);

            storedGeometries[geoName] = geometry;
        }

        let material = null;

        // texture
        if(parts.length > 5) {
            material = await getTextureMaterial(parts[5],renderModel);
        }
        

        if(!material) {
            if(parts.length > 4) {
                material = new MeshLambertMaterial({
                    color: getModValue(parts[4],renderModel)
                });
            } else {
                material = new MeshLambertMaterial({
                    color: DEF_MODEL_COLOR
                });
            }
        }

        mesh = new Mesh(geometry, material);

        if(currentGroup) {
            currentGroup.add(mesh);
        } else {
            renderModel.add(mesh);
        }
        

    }

    return mesh;
}

async function createPlaneOperation(code, renderModel, currentGroup) {
    let raw = code.replace("plane(","");
    raw = raw.replace(")","");

    const parts = raw.split(",");

    let mesh = null;

    if(parts.length >= 2) {

        const w = getModValue(parts[0], renderModel);
        const h = getModValue(parts[1], renderModel);

        let geoName = "plane." + w + "." + h + "." + renderModel.bmDat.geoTranslate.x + "." + renderModel.bmDat.geoTranslate.y + "." + renderModel.bmDat.geoTranslate.z;

        let geometry = null;

        if(storedGeometries[geoName]) {
            geometry = storedGeometries[geoName];
        } else {
            geometry = new PlaneGeometry(w, h);

            geometry.translate(renderModel.bmDat.geoTranslate.x, renderModel.bmDat.geoTranslate.y, renderModel.bmDat.geoTranslate.z);

            storedGeometries[geoName] = geometry;
        }

        let material = null;

        // texture
        if(parts.length > 3) {

            let transparent = false;
            let depthWrite = true;
            const colPart = getModValue(parts[2], renderModel)

            if(colPart == "transparent") {
                transparent = true;
                depthWrite = false;
            }

            material = await getTextureMaterial(parts[3], renderModel, transparent, colPart, depthWrite);
        }
        
        if(!material) {
            if(parts.length > 2) {
                material = new MeshLambertMaterial({
                    color: getModValue(parts[2],renderModel),
                    side: DoubleSide
                });
            } else {
                material = new MeshLambertMaterial({
                    color: DEF_MODEL_COLOR,
                    side: DoubleSide
                });
            }
        }

        mesh = new Mesh(geometry, material);

        if(currentGroup) {
            currentGroup.add(mesh);
        } else {
            renderModel.add(mesh);
        }

    }

    return mesh;
}

async function createBoxOperation(code,renderModel,currentGroup) {
    let raw = code.replace("box(","");
    raw = raw.replace(")","");

    const parts = raw.split(",");

    let mesh = null;

    if(parts.length >= 3) {

        const x = getModValue(parts[0],renderModel);
        const y = getModValue(parts[1],renderModel);
        const z = getModValue(parts[2],renderModel);

        let geoName = "box." + x + "." + y + "." + z + "." + renderModel.bmDat.geoTranslate.x + "." + renderModel.bmDat.geoTranslate.y + "." + renderModel.bmDat.geoTranslate.z;

        let geometry = null;

        if(storedGeometries[geoName]) {
            geometry = storedGeometries[geoName];
        } else {
            geometry = new BoxGeometry(x, y, z);

            geometry.translate(renderModel.bmDat.geoTranslate.x, renderModel.bmDat.geoTranslate.y, renderModel.bmDat.geoTranslate.z);

            storedGeometries[geoName] = geometry;
        }

        let material = null;

        // texture
        if(parts.length > 4) {
            let transparent = false;
            const colPart = getModValue(parts[3], renderModel)

            if(colPart == "transparent" || (colPart.length == 7 && colPart[0] == "#")) {
                transparent = true;
            }

            material = await getTextureMaterial(parts[4], renderModel, transparent, colPart);
        }
        

        if(!material) {
            if(parts.length > 3) {
                material = new MeshLambertMaterial({
                    color: getModValue(parts[3],renderModel)
                });
            } else {
                material = new MeshLambertMaterial({
                    color: DEF_MODEL_COLOR
                });
            }
        }

        mesh = new Mesh(geometry, material);

        if(currentGroup) {
            currentGroup.add(mesh);
        } else {
            renderModel.add(mesh);
        }

    }

    return mesh;
}

async function createConeOperation(code,renderModel,currentGroup) {
    let raw = code.replace("cone(","");
    raw = raw.replace(")","");

    const parts = raw.split(",");

    let mesh = null;

    let rad = 1;
    let height = 1;
    let segs = 1;

    if(parts.length >= 3) {

        rad = getModValue(parts[0],renderModel);
        height = getModValue(parts[1],renderModel);
        segs = getModValue(parts[2],renderModel);

        let geoName = "cone." + rad + "." + height + "." + segs + "." + renderModel.bmDat.geoTranslate.x + "." + renderModel.bmDat.geoTranslate.y + "." + renderModel.bmDat.geoTranslate.z;

        let geometry = null;

        if(storedGeometries[geoName]) {
            geometry = storedGeometries[geoName];
        } else {
            geometry = new ConeGeometry(rad,height,segs);

            geometry.translate(renderModel.bmDat.geoTranslate.x, renderModel.bmDat.geoTranslate.y, renderModel.bmDat.geoTranslate.z);

            storedGeometries[geoName] = geometry;
        }

        let material = null;

        // texture
        if(parts.length > 4) {
            let transparent = false;
            const colPart = getModValue(parts[3], renderModel);

            if(colPart == "transparent" || (colPart.length == 7 && colPart[0] == "#")) {
                transparent = true;
            }

            material = await getTextureMaterial(parts[4], renderModel, transparent, colPart);
        }
        

        if(!material) {
            if(parts.length > 3) {
                material = new MeshLambertMaterial({
                    color: getModValue(parts[3],renderModel)
                });
            } else {
                material = new MeshLambertMaterial({
                    color: DEF_MODEL_COLOR
                });
            }
        }

        mesh = new Mesh(geometry, material);

        if(currentGroup) {
            currentGroup.add(mesh);
        } else {
            renderModel.add(mesh);
        }
        

    }

    return mesh;
}

async function createShapeOperation(code, renderModel, currentGroup) {
    let raw = code.replace("shape(","");
    raw = raw.replace(")","");

    const parts = raw.split(",");

    let shapeName = "";
    const allShapeCoords = [];
    let curShapeCoord = [];

    let extDepth = 1;
    let bevSize = 1;
    let bevThick = 1;
    let bevOffset = 0;

    if(parts.length < 1) {
        console.warn("Shape definition must have at least 1 point.");
        return null;
    }

    const shapeParts = getModValue(parts[0], renderModel).split("|");

    for(let i = 0; i < shapeParts.length; i++) {
        let part = shapeParts[i].trim();

        if(part.length > 0) {
            const rawPart = getModValue(part, renderModel);
            shapeName += rawPart + ".";

            curShapeCoord.push(rawPart);

            if(curShapeCoord.length == 2) {
                //allShapeCoords.push([parseFloat(curShapeCoord[0]), parseFloat(curShapeCoord[1])]);
                allShapeCoords.push(new Vector2(parseFloat(curShapeCoord[0]), parseFloat(curShapeCoord[1])));
                curShapeCoord = [];
            }
        }
    }

    if(parts.length > 1) {
        extDepth = getModValue(parts[1], renderModel);
    }

    if(parts.length > 2) {
        bevSize = getModValue(parts[2], renderModel);
    }

    if(parts.length > 3) {
        bevThick = getModValue(parts[3], renderModel);
    }

    if(parts.length > 4) {
        bevOffset = getModValue(parts[4], renderModel);
    }

    if(allShapeCoords.length < 3) {
        console.warn("Shape definition must have at least 3 points.");
        return null;
    }

    const shape = new Shape(allShapeCoords);


    let geoName = "shape." + extDepth + "." + bevSize + "." + bevThick + "." + bevOffset + "." + shapeName + "." + renderModel.bmDat.geoTranslate.x + "." + renderModel.bmDat.geoTranslate.y + "." + renderModel.bmDat.geoTranslate.z;
    let geometry = null;

    if(storedGeometries[geoName]) {
        geometry = storedGeometries[geoName];
    } else {
        let bevelEnabled = false;

        if(bevSize > 0 && bevThick > 0) {
            bevelEnabled = true;
        }

        const extrudeSettings = {
            steps: 1,
            depth: extDepth,
            bevelEnabled: bevelEnabled,
            bevelThickness: bevThick,
            bevelSize: bevSize,
            bevelOffset: bevOffset,
            bevelSegments: 1
        };

        geometry = new ExtrudeGeometry(shape, extrudeSettings);
    }

    let mesh = null;

    let material = null;

    // texture
    if(parts.length > 6) {
        let transparent = false;
        const colPart = getModValue(parts[5], renderModel);

        if(colPart == "transparent" || (colPart.length == 7 && colPart[0] == "#")) {
            transparent = true;
        }

        material = await getTextureMaterial(parts[6], renderModel, transparent, colPart);
    }
        

    if(!material) {
        if(parts.length > 5) {
            material = new MeshLambertMaterial({
                color: getModValue(parts[5],renderModel)
            });
        } else {
            material = new MeshLambertMaterial({
                color: DEF_MODEL_COLOR
            });
        }
    }

    mesh = new Mesh(geometry, material);

    if(currentGroup) {
        currentGroup.add(mesh);
    } else {
        renderModel.add(mesh);
    }

    return mesh;
}

async function createCapsuleOperation(code,renderModel,currentGroup) {
    let raw = code.replace("capsule(","");
    raw = raw.replace(")","");

    const parts = raw.split(",");

    let mesh = null;

    let rad = 1;
    let height = 1;
    let seg = 1;
    let radseg = 1;

    if(parts.length >= 4) {

        rad = getModValue(parts[0], renderModel);
        height = getModValue(parts[1], renderModel);
        seg = getModValue(parts[2], renderModel);
        radseg = getModValue(parts[3], renderModel);

        let geoName = "shape." + rad + "." + height + "." + seg + "." + radseg + "." + renderModel.bmDat.geoTranslate.x + "." + renderModel.bmDat.geoTranslate.y + "." + renderModel.bmDat.geoTranslate.z;

        let geometry = null;

        if(storedGeometries[geoName]) {
            geometry = storedGeometries[geoName];
        } else {
            geometry = new CapsuleGeometry(rad, height, seg, radseg);
            geometry.translate(renderModel.bmDat.geoTranslate.x, renderModel.bmDat.geoTranslate.y, renderModel.bmDat.geoTranslate.z);
            storedGeometries[geoName] = geometry;
        }

        let material = null;

        // texture
        if(parts.length > 5) {
            let transparent = false;
            const colPart = getModValue(parts[4], renderModel);

            if(colPart == "transparent" || (colPart.length == 7 && colPart[0] == "#")) {
                transparent = true;
            }

            material = await getTextureMaterial(parts[5], renderModel, transparent, colPart);
        }
        

        if(!material) {
            if(parts.length > 4) {
                material = new MeshLambertMaterial({
                    color: getModValue(parts[4],renderModel)
                });
            } else {
                material = new MeshLambertMaterial({
                    color: DEF_MODEL_COLOR
                });
            }
        }

        mesh = new Mesh(geometry, material);

        if(currentGroup) {
            currentGroup.add(mesh);
        } else {
            renderModel.add(mesh);
        }
        
    }

    return mesh;
}

async function createCylinderOperation(code,renderModel,currentGroup) {
    let raw = code.replace("cylinder(","");
    raw = raw.replace(")","");

    const parts = raw.split(",");

    let mesh = null;

    let radTop = 1;
    let radBottom = 1;
    let height = 1;
    let segs = 1;

    if(parts.length >= 4) {

        radTop = getModValue(parts[0],renderModel);
        radBottom = getModValue(parts[1],renderModel);
        height = getModValue(parts[2],renderModel);
        segs = getModValue(parts[3],renderModel);

        let geoName = "cylinder." + radTop + "." + radBottom + "." + height + "." + segs + "." + renderModel.bmDat.geoTranslate.x + "." + renderModel.bmDat.geoTranslate.y + "." + renderModel.bmDat.geoTranslate.z;

        let geometry = null;

        if(storedGeometries[geoName]) {
            geometry = storedGeometries[geoName];
        } else {
            geometry = new CylinderGeometry(radTop,radBottom,height,segs);

            geometry.translate(renderModel.bmDat.geoTranslate.x, renderModel.bmDat.geoTranslate.y, renderModel.bmDat.geoTranslate.z);

            storedGeometries[geoName] = geometry;
        }

        let material = null;

        // texture
        if(parts.length > 5) {
            let transparent = false;
            const colPart = getModValue(parts[4], renderModel);

            if(colPart == "transparent" || (colPart.length == 7 && colPart[0] == "#")) {
                transparent = true;
            }

            material = await getTextureMaterial(parts[5], renderModel, transparent, colPart);
        }
        

        if(!material) {
            if(parts.length > 4) {
                material = new MeshLambertMaterial({
                    color: getModValue(parts[4],renderModel)
                });
            } else {
                material = new MeshLambertMaterial({
                    color: DEF_MODEL_COLOR
                });
            }
        }

        mesh = new Mesh(geometry, material);

        if(currentGroup) {
            currentGroup.add(mesh);
        } else {
            renderModel.add(mesh);
        }
        
    }

    return mesh;
}

function handleGeoTranslate(code, renderModel) {
    let raw = code.replace("geotranslate(","");
    raw = raw.replace(")","");

    const parts = raw.split(",");

    if(parts.length >= 3) {
        renderModel.bmDat.geoTranslate.x = getModValue(parts[0], renderModel);
        renderModel.bmDat.geoTranslate.y = getModValue(parts[1], renderModel);
        renderModel.bmDat.geoTranslate.z = getModValue(parts[2], renderModel);
    }
}

async function createDecalOperation(code, renderModel, currentGroup) {
    let raw = code.replace("decal(","");
    raw = raw.replace(")","");

    const parts = raw.split(",");

    if(parts.length < 1) {
        return null;
    }

    const targetObjectName = parts[0].trim().replace("$", "");
    let targetModel = null;

    if(renderModel.bmDat.variables[targetObjectName]) {
        targetModel = renderModel.bmDat.variables[targetObjectName];
    }

    if(!targetModel || !targetModel.position) {
        console.warn("Invalid object for decal operation:", targetObjectName);
        console.warn("Code:", code);
        console.warn("Render Model:", renderModel);
        console.warn(targetModel);
        return;
    }

    const decalMaterial = await getTextureMaterial(parts[1], renderModel, true);

    if(!decalMaterial) {
        console.warn("No valid decal material provided in:", code);
        return null;
    }

    let pX = 0;
    let pY = 0;
    let pZ = 0;

    let oX = 0;
    let oY = 0;
    let oZ = 0;

    let sX = 1;
    let sY = 1;
    let sZ = 1;

    if(parts.length > 2) {
        pX = getModValue(parts[2], renderModel);
    }

    if(parts.length > 3) {
        pY = getModValue(parts[3], renderModel);
    }

    if(parts.length > 4) {
        pZ = getModValue(parts[4], renderModel);
    }

    if(parts.length > 5) {
        oX = getModValue(parts[5], renderModel);
    }

    if(parts.length > 6) {
        oY = getModValue(parts[6], renderModel);
    }

    if(parts.length > 7) {
        oZ = getModValue(parts[7], renderModel);
    }

    if(parts.length > 8) {
        sX = getModValue(parts[8], renderModel);
    }

    if(parts.length > 9) {
        sY = getModValue(parts[9], renderModel);
    }

    if(parts.length > 10) {
        sZ = getModValue(parts[10], renderModel);
    }

    return addDecalToObject(targetModel, decalMaterial, { x: pX, y: pY, z: pZ }, { x: oX, y: oY, z: oZ }, { x: sX, y: sY, z: sZ });
}

function doPositionOperation(id, code, renderModel) {

    let obid = id;

    if(typeof id == "string" && renderModel.bmDat.variables[id]) {
        obid = renderModel.bmDat.variables[id];
    }

    if(!obid || !obid.position) {
        console.warn("Invalid object for position operation:", id);
        console.warn("Code:", code);
        console.warn("Render Model:", renderModel);
        console.warn(obid);
        return;
    }

    let raw = code.replace("position(","");
    raw = raw.replace(")","");

    const parts = raw.split(",");

    if(parts.length >= 3) {

        const x = getModValue(parts[0],renderModel);
        const y = getModValue(parts[1],renderModel);
        const z = getModValue(parts[2],renderModel);

        obid.position.set(x, y, z);
    }
}

function doOrientationOperation(id,code,renderModel) {

    let obid = id;

    if(typeof id == "string" && renderModel.bmDat.variables[id]) {
        obid = renderModel.bmDat.variables[id];
    }

    if(!obid || obid.orientation == undefined) {
        return;
    }

    let raw = code.replace("orientation(","");
    raw = raw.replace(")","");

    const parts = raw.split(",");

    if(parts.length >= 3) {

        const x = getModValue(parts[0], renderModel);
        const y = getModValue(parts[1], renderModel);
        const z = getModValue(parts[2], renderModel);

        obid.orientation.set(x, y, z);
    }
}

function doRotateOperation(id,code,renderModel) {

    let obid = id;

    if(typeof id == "string" && renderModel.bmDat.variables[id]) {
        obid = renderModel.bmDat.variables[id];
    }

    if(!obid) {
        return;
    }

    let raw = code.replace("rotate(","");
    raw = raw.replace(")","");

    let parts = raw.split(",");

    if(parts.length >= 3) {

        let x = getModValue(parts[0], renderModel);
        let y = getModValue(parts[1], renderModel);
        let z = getModValue(parts[2], renderModel);

        obid.rotation.set(MathUtils.degToRad(x), MathUtils.degToRad(y), MathUtils.degToRad(z));
    }
}

function doOpacityOperation(id, code, renderModel) {

    let obid = id;

    if(typeof id == "string" && renderModel.bmDat.variables[id]) {
        obid = renderModel.bmDat.variables[id];
    }

    if(!obid) {
        return;
    }

    let raw = code.replace("opacity(","");
    raw = raw.replace(")","");

    let opVal = parseInt(raw);

    if(isNaN(opVal)) {
        opVal = 1;
    }

    if(opVal < 0) {
        opVal = 0;
    }

    if(opVal > 1) {
        opVal = 1;
    }

    if(obid.material) {
        if(Array.isArray(obid.material)) {
            for(let i = 0; i < obid.material.length; i++) {
                obid.material[i].opacity = opVal;
                obid.material[i].transparent = true;
            }
        } else {
            obid.material.opacity = opVal;
            obid.material.transparent = true;
        }
    }
}

function doScaleOperation(id, code, renderModel) {

    let obid = id;

    if(typeof id == "string" && renderModel.bmDat.variables[id]) {
        obid = renderModel.bmDat.variables[id];
    }

    if(!obid) {
        return;
    }

    let raw = code.replace("scale(","");
    raw = raw.replace(")","");

    const parts = raw.split(",");

    if(parts.length >= 3) {

        const x = getModValue(parts[0], renderModel);
        const y = getModValue(parts[1], renderModel);
        const z = getModValue(parts[2], renderModel);

        obid.scale.set(x, y, z);
    }
}

async function getTextureMaterial(textureInstruction, renderModel, transparent, withColor = null, depthWrite = true) {

    if(!textureInstruction) {
        return null;
    }

    const txInst = textureInstruction.split("|");

    if(txInst.length == 1) {

        let mapOptions = {
            map: await loadTexture(txInst[0],renderModel),
            transparent: transparent,
            depthWrite: depthWrite
        };

        if(withColor && withColor != "transparent") {
            mapOptions.color = withColor;
        }

        return new MeshLambertMaterial(mapOptions);
    }

    let mapping = [];

    for(let i = 0; i < txInst.length; i++) {
        let mapOptions = {
            map: await loadTexture(txInst[i],renderModel),
            side: DoubleSide,
            transparent: transparent,
            depthWrite: depthWrite
        };

        if(withColor && withColor != "transparent") {
            mapOptions.color = withColor;
        }

        mapping.push(new MeshLambertMaterial(mapOptions));
    }
    
    if(mapping.length == 0) {
        return null;
    }

    return mapping;
}

async function loadTexture(txInst,renderModel) {
        
    const instParts = txInst.split("&");

    if(instParts.length == 0 || instParts[0].trim().length == 0) {
        return null;
    }

    const txName = instParts[0].trim().substring(1);
    const txDef = renderModel.bmDat.src.textures[txName];

    if(!txDef) {
        return null;
    }

    // eventually, to support animated textures
    const frame = 0;

    const tx = await getFrameTexture(txDef,instParts,frame,renderModel);
    tx.colorSpace = SRGBColorSpace;
    return tx;
}

async function getFrameTexture(txDef, instructions, frame, renderModel) {
    if(!threeLoader) {
        threeLoader = new TextureLoader();
    }

    let imgURL = txDef.data;
    let raw = imgURL;

    if(txDef.type.indexOf("image/svg") == 0) {

        if(instructions.length > 1) {
            for(let i = 1; i < instructions.length; i++) {
                const parts = instructions[i].split("=");

                const from = getModValue(parts[0],renderModel);
                const to = getModValue(parts[1],renderModel);

                raw = raw.replaceAll("fill:" + from + ";","fill:" + to + ";");
                raw = raw.replaceAll("stroke:" + from + ";","stroke:" + to + ";");
            }
        }

        const blob = new Blob([raw], {type: txDef.type});
        imgURL = URL.createObjectURL(blob);
    }

    const img = await getImageFromStoredCanvas(txDef, imgURL, frame, raw);

    if(img) {
        return threeLoader.load(img);
    }

    return null;
}

async function getImageFromStoredCanvas(txDef, imgURL, frame, rawImgDat) {
    const imgName = hash(rawImgDat);

    let imCanvas = null;
    let imContext = null;

    if(storedImageCanvases[imgName]) {
        imCanvas = storedImageCanvases[imgName];
    } else {
        imCanvas = document.createElement("canvas");
        imContext = imCanvas.getContext("2d");

        await new Promise(function(resolve) {
            const image = new Image();
            image.onload = function() {
                imCanvas.height = image.height;
                imCanvas.width = image.width;
    
                imContext.drawImage(image, 0, 0);

                storedImageCanvases[imgName] = imCanvas;

                resolve();
            };
            image.src = imgURL;
        },function(){
            console.log("fail");
        });

    }

    if(txDef.frames == 1) {
        return imCanvas.toDataURL("image/webp", 0.85);
    }

    console.log("GRAB A FRAME!");
}

function rebuildBM(obj) {
    const bm = rebuildStandardObject(obj, BasicModel);

    for(let txName in bm.textures) {
        const tx = bm.textures[txName];
        bm.textures[txName] = rebuildStandardObject(tx, ModelTexture);
    }
    return bm;
}

function saveModelState(renderModel, ob) {
    if(!renderModel || !renderModel.bmDat || !ob || !ob.id) {
        return;
    }

    const stateOb = {
        rotation: ob.rotation.toArray(),
        position: ob.position.toArray(),
        scale: ob.scale.toArray(),
        orientation: ob.orientation ? ob.orientation.toArray() : [0, 0, 0],
    };

    renderModel.bmDat.defaultState[ob.id] = stateOb;

    if(ob.children && ob.children.length > 0) {
        for(let i = 0; i < ob.children.length; i++) {
            saveModelState(renderModel, ob.children[i]);
        }
    }
}

function restoreModelState(renderModel, ob) {
    if(!renderModel || !renderModel.bmDat || !ob || !ob.id) {
        return;
    }

    const stateOb = renderModel.bmDat.defaultState[ob.id];

    if(stateOb) {
        ob.rotation.fromArray(stateOb.rotation);
        ob.position.fromArray(stateOb.position);
        ob.scale.fromArray(stateOb.scale);
        if(ob.orientation) {
            ob.orientation.fromArray(stateOb.orientation);
        }
    }

    if(ob.children && ob.children.length > 0) {
        for(let i = 0; i < ob.children.length; i++) {
            restoreModelState(renderModel, ob.children[i]);
        }
    }
}

// Reset the model to its original .bm state
async function resetRenderModel(renderModel) {
    if (!renderModel || !renderModel.bmDat || !renderModel.bmDat._scriptLines) return;

    // Clear scene
    while (renderModel.children.length > 0) {
        renderModel.remove(renderModel.children[0]);
    }

    // Reset data
    renderModel.bmDat.variables = {};
    renderModel.bmDat.variableOverrides = {};
    renderModel.bmDat.animations = {};

    const currentGroup = { grp: null };
    for (const line of renderModel.bmDat._scriptLines) {
        await negotiateInstructionLine(line, renderModel, currentGroup);
    }

    if (currentGroup.grp) {
        renderModel.add(currentGroup.grp);
        currentGroup.grp = null;
    }
}

function addDecalToObject(obj, material, position = { x: 0, y: 0, z: 0 }, orientation = { x: 0, y: 0, z: 0 }, scale = { x: 1, y: 1, z: 1 }) {
    if (!obj || !material) return;

    const decalGeo = new DecalGeometry(obj, new Vector3(position.x, position.y, position.z), new Euler(orientation.x, orientation.y, orientation.z), new Vector3(scale.x, scale.y, scale.z));
    const decalMesh = new Mesh(decalGeo, material);

    obj.attach(decalMesh);

    return decalMesh;
}

export {  BMLoader, BasicModel, ModelTexture, RenderBasicModel };