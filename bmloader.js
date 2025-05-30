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
    Vector3,
    Euler,
    MeshBasicMaterial,
    LatheGeometry,
    MeshPhongMaterial,
    MeshStandardMaterial,
    MeshToonMaterial,
    Color
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

    constructor(manager = undefined, options = {}) {
        super(manager);

        this.defMaterial = options.defMaterial || "lambert";
    }

    load(url, onLoad, onProgress, onError) {
        const scope = this;

        let options = {};
        let modelDat = null;

        if(typeof url === "object") {

            if(url.script && url.id) {
                modelDat = rebuildBM(url);

                loadBM(modelDat, null, scope).then(function(renderModel) {
                    onLoad(renderModel);
                });

                return;
            }

            if(url.json && url.json.script && url.json.id) {
                modelDat = rebuildBM(url.json);

                loadBM(modelDat, url, scope).then(function(renderModel) {
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
            loadBM(remoteModels[url], options, scope).then(function(renderModel) {
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

            loadBM(modelDat, options, scope).then(function(renderModel) {
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
        resetRenderModel(this);
    }

    saveState() {
        saveModelState(this, this);
    }

    restoreState() {
        restoreModelState(this, this);
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

                getTextureMaterial(rawVal, model, ob.material.transparent, undefined, ob.material.depthWrite, ob.material.type).then(function(mat) {
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
 * @param {BMLoader} loader
 * @returns RenderBasicModel
 */
async function loadBM(modelData, options, loader) {

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
        await negotiateInstructionLine(line, renderModel, currentGroup, loader);
    }

    renderModel.saveState();

    return renderModel;
}


/**
 * @param {String} line The instruction line to parse
 * @param {RenderBasicModel} renderModel The model to modify
 * @param {Object} currentGroup The current group context for grouping operations
 * @param {BMLoader} loader The loader instance for texture loading
 */
async function negotiateInstructionLine(line, renderModel, currentGroup, loader) {
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
            { keyword: "decal(", func: createDecalOperation },
            { keyword: "lathe(", func: createLatheOperation }
        ];

        let handled = false;
        for (const op of ops) {
            if (mod.startsWith(op.keyword)) {
                usingObj = await op.func(mod, renderModel, currentGroup.grp, loader);
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
            (usingVar ? doMaterialOperation(usingVar, mod, renderModel)
                : usingObj && doMaterialOperation(usingObj, mod, renderModel));
            /*
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
            }*/
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

async function createSphereOperation(code, renderModel, currentGroup, loader) {
    let raw = code.replace("sphere(","");
    raw = raw.replace(")","");

    const parts = raw.split(",");

    let rad = 1;
    let wSegs = 1;
    let hSegs = 1;

    let useMaterial = loader.defMaterial || "lambert";

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

        if(parts.length > 5) {
            useMaterial = parts[5].trim();
        }

        return await setupNewMaterial(renderModel, geometry, currentGroup, parts[3] || null, parts[4] || null, useMaterial);
    }

    return null;
}

// eslint-disable-next-line no-unused-vars
function createGroupOperation(code, renderModel, currentGroup, loader) {
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

async function createTorusOperation(code, renderModel, currentGroup, loader) {
    let raw = code.replace("torus(","");
    raw = raw.replace(")","");

    const parts = raw.split(",");

    let rad = 1;
    let tube = 1;
    let radSegs = 1;
    let tubeSegs = 1;

    let useMaterial = loader.defMaterial || "lambert";

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

        if(parts.length > 6) {
            useMaterial = parts[6].trim();
        }

        return await setupNewMaterial(renderModel, geometry, currentGroup, parts[4] || null, parts[5] || null, useMaterial);
    }

    return null;
}

async function createPlaneOperation(code, renderModel, currentGroup, loader) {
    let raw = code.replace("plane(","");
    raw = raw.replace(")","");

    const parts = raw.split(",");

    let useMaterial = loader.defMaterial || "lambert";

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

        let depthWrite = true;
        let side = DoubleSide;

        if(parts[2] && parts[2] == "transparent") {
            depthWrite = false;
        }

        if(parts[3]) {
            side = undefined;
        }

        if(parts.length > 4) {
            useMaterial = parts[4].trim();
        }

        return await setupNewMaterial(renderModel, geometry, currentGroup, parts[2] || null, parts[3] || null, useMaterial, depthWrite, side);
    }

    return null;
}

async function createBoxOperation(code, renderModel, currentGroup, loader) {
    let raw = code.replace("box(","");
    raw = raw.replace(")","");

    const parts = raw.split(",");

    let useMaterial = loader.defMaterial || "lambert";

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

        if(parts.length > 5) {
            useMaterial = parts[5].trim();
        }

        return await setupNewMaterial(renderModel, geometry, currentGroup, parts[3] || null, parts[4] || null, useMaterial, true, undefined);
    }

    return true;
}

async function createConeOperation(code, renderModel, currentGroup, loader) {
    let raw = code.replace("cone(","");
    raw = raw.replace(")","");

    const parts = raw.split(",");

    let useMaterial = loader.defMaterial || "lambert";

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

        if(parts.length > 5) {
            useMaterial = parts[5].trim();
        }

        return await setupNewMaterial(renderModel, geometry, currentGroup, parts[3] || null, parts[4] || null, useMaterial, true, undefined);
    }

    return null;
}

async function createShapeOperation(code, renderModel, currentGroup, loader) {
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

    let useMaterial = loader.defMaterial || "lambert";

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
        geometry.translate(renderModel.bmDat.geoTranslate.x, renderModel.bmDat.geoTranslate.y, renderModel.bmDat.geoTranslate.z);
        storedGeometries[geoName] = geometry;
    }

    if(parts.length > 7) {
        useMaterial = parts[7].trim();
    }

    return await setupNewMaterial(renderModel, geometry, currentGroup, parts[5] || null, parts[6] || null, useMaterial);
}

async function createCapsuleOperation(code, renderModel, currentGroup, loader) {
    let raw = code.replace("capsule(","");
    raw = raw.replace(")","");

    const parts = raw.split(",");

    let rad = 1;
    let height = 1;
    let seg = 1;
    let radseg = 1;
    let useMaterial = loader.defMaterial || "lambert";

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

        if(parts.length > 6) {
            useMaterial = parts[6].trim();
        }

        return await setupNewMaterial(renderModel, geometry, currentGroup, parts[4] || null, parts[5] || null, useMaterial);
    }

    return null;
}

async function createCylinderOperation(code, renderModel, currentGroup, loader) {
    let raw = code.replace("cylinder(","");
    raw = raw.replace(")","");

    const parts = raw.split(",");


    let radTop = 1;
    let radBottom = 1;
    let height = 1;
    let segs = 1;
    let useMaterial = loader.defMaterial || "lambert";

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

        if(parts.length > 6) {
            useMaterial = parts[6].trim();
        }

        return await setupNewMaterial(renderModel, geometry, currentGroup, parts[4] || null, parts[5] || null, useMaterial);
    }

    return null;
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

// eslint-disable-next-line no-unused-vars
async function createDecalOperation(code, renderModel, currentGroup, loader) {
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

async function getTextureMaterial(textureInstruction, renderModel, transparent, withColor = null, depthWrite = true, useMaterial = "lambert") {

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

        const matClass = getMaterialClass(useMaterial);

        return new matClass(mapOptions);
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

        const matClass = getMaterialClass(useMaterial);

        mapping.push(new matClass(mapOptions));
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
        rotation:   { x: ob.rotation.x, y: ob.rotation.y, z: ob.rotation.z },
        position:   { x: ob.position.x, y: ob.position.y, z: ob.position.z },
        scale:      { x: ob.scale.x, y: ob.scale.y, z: ob.scale.z }
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
        ob.rotation.set(stateOb.rotation.x, stateOb.rotation.y, stateOb.rotation.z);
        ob.position.set(stateOb.position.x, stateOb.position.y, stateOb.position.z);
        ob.scale.set(stateOb.scale.x, stateOb.scale.y, stateOb.scale.z);
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

function getMaterialClass(matname) {
    if(matname == "lambert" || matname == "MeshLambertMaterial") {
        return MeshLambertMaterial;
    }

    if(matname == "phong" || matname == "MeshPhongMaterial") {
        return MeshPhongMaterial;
    }

    if(matname == "standard" || matname == "MeshStandardMaterial") {
        return MeshStandardMaterial;
    }

    if(matname == "toon" || matname == "MeshToonMaterial") {
        return MeshToonMaterial;
    }

    return MeshBasicMaterial;
}

async function createLatheOperation(code, renderModel, currentGroup, loader) {
    let raw = code.replace("shape(","");
    raw = raw.replace(")","");

    const parts = raw.split(",");

    if(parts.length < 1) {
        console.warn("Lathe definition must have at least 1 point.");
        return null;
    }

    let useMaterial = loader.defMaterial || "lambert";

    const points = [];
    let curCoord = [];
    let shapeName = "";

    let phiLength = Math.PI * 2;
    let segments = 12;

    const latheCoords = getModValue(parts[0], renderModel).split("|");

    for(let i = 0; i < latheCoords.length; i++) {
        let part = latheCoords[i].trim();

        if(part.length > 0) {
            const rawPart = getModValue(part, renderModel);
            shapeName += rawPart + ".";

            curCoord.push(rawPart);

            if(curCoord.length == 2) {
                points.push(new Vector2(parseFloat(curCoord[0]), parseFloat(curCoord[1])));
                curCoord = [];
            }
        }
    }

    if(points.length < 2) {
        console.warn("Lathe definition must have at least 2 points.");
        return null;
    }

    if(parts.length > 1) {
        phiLength = getModValue(parts[1], renderModel);
    }

    if(parts.length > 2) {
        segments = getModValue(parts[2], renderModel);
    }
    
    let geoName = "lathe." + phiLength + "." + segments + "." + shapeName + "." + renderModel.bmDat.geoTranslate.x + "." + renderModel.bmDat.geoTranslate.y + "." + renderModel.bmDat.geoTranslate.z;
    let geometry = null;

    if(storedGeometries[geoName]) {
        geometry = storedGeometries[geoName];
    } else {
        geometry = new LatheGeometry(points, segments, 0, phiLength);
        geometry.translate(renderModel.bmDat.geoTranslate.x, renderModel.bmDat.geoTranslate.y, renderModel.bmDat.geoTranslate.z);
        storedGeometries[geoName] = geometry;
    }

    if(parts.length > 5) {
        useMaterial = parts[5].trim();
    }

    return await setupNewMaterial(renderModel, geometry, currentGroup, parts[3] || null, parts[4] || null, useMaterial);
}

async function setupNewMaterial(renderModel, geometry, currentGroup, colPart, txPart, useMaterial, depthWrite = true, side = undefined) {
    
    if(!geometry) {
        return null;
    }
    
    let mesh = null;
    let material = null;

    // texture
    if(txPart && txPart.indexOf("$") == 0) {
        let transparent = false;

        if(colPart == "transparent" || (colPart.length == 7 && colPart[0] == "#")) {
            transparent = true;
        }

        material = await getTextureMaterial(txPart, renderModel, transparent, colPart, depthWrite, useMaterial);
    }
        
    if(!material) {

        const matClass = getMaterialClass(useMaterial);

        if(colPart && colPart.length == 7 && colPart[0] == "#") {
            material = new matClass({
                color: getModValue(colPart, renderModel),
                side: side
            });
        } else {
            material = new matClass({
                color: DEF_MODEL_COLOR,
                side: side
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

async function doMaterialOperation(id, code, renderModel) {

    let obid = id;

    if(typeof id == "string" && renderModel.bmDat.variables[id]) {
        obid = renderModel.bmDat.variables[id];
    }

    if(!obid || !obid.position || !obid.material) {
        console.warn("Invalid object for material operation:", id);
        console.warn("Code:", code);
        console.warn("Render Model:", renderModel);
        console.warn(obid);
        return;
    }

    let raw = code.replace("material(","");
    raw = raw.replace(")","");

    let color = undefined;
    let shininess = obid.material.shininess || undefined;

    let metalness = undefined;
    let roughness = undefined;

    let lightMap = undefined;
    let bumpMap = undefined;

    const parts = raw.split(",");

    if(parts.length >= 1) {
        color = getModValue(parts[0], renderModel);

        if(!color || color.length < 7 || color[0] != "#") {
            color = undefined;
        }
    }

    if(parts.length >= 2) {
        shininess = getModValue(parts[2], renderModel);
    }

    if(parts.length >= 3) {
        metalness = getModValue(parts[3], renderModel);
    }

    if(parts.length >= 4) {
        roughness = getModValue(parts[4], renderModel);
    }

    if(parts.length >= 5) {
        lightMap = getModValue(parts[5], renderModel);

        if(lightMap && lightMap.indexOf("$") == 0) {
            lightMap = await loadTexture(lightMap, renderModel);
        } else {
            lightMap = null;
        }
    }

    if(parts.length >= 6) {
        bumpMap = getModValue(parts[6], renderModel);

        if(bumpMap && bumpMap.indexOf("$") == 0) {
            bumpMap = await loadTexture(bumpMap, renderModel);
        } else {
            bumpMap = null;
        }
    }

    if(color && color.length == 7 && color[0] == "#") {
        obid.material.color = new Color(color);
    }

    if(shininess !== undefined && !isNaN(parseFloat(shininess))) {
        obid.material.shininess = parseFloat(shininess);
    }

    if(metalness !== undefined && !isNaN(parseFloat(metalness))) {
        obid.material.metalness = parseFloat(metalness);
    }

    if(roughness !== undefined && !isNaN(parseFloat(roughness))) {
        obid.material.roughness = parseFloat(roughness);
    }

    if(lightMap) {
        obid.material.lightMap = lightMap;
    } else {
        obid.material.lightMap = null;
    }

    if(bumpMap) {
        obid.material.bumpMap = bumpMap;
    } else {
        obid.material.bumpMap = null;
    }


    obid.material.needsUpdate = true;
}

export {  BMLoader, BasicModel, ModelTexture, RenderBasicModel };