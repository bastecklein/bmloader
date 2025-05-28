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
    TextureLoader
} from "three";

const storedGeometries = {};
const storedImageCanvases = {};

const DEF_MODEL_COLOR = "#999999";
const FULLTURN = MathUtils.degToRad(360);

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

        console.log("onload");
        console.log(url);

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
            animation: null
        };
    }

    dispose() {
        this.bmDat = null;
    }

    animate(delta) {
        animateModel(this, delta);
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

function animateModel(model, delta) {
    if(!model.bmDat.animations || !model.bmDat.animation) {
        return;
    }

    const animation = model.bmDat.animations[model.bmDat.animation];

    for(let i = 0; i < animation.length; i++) {
        const inst = animation[i];
        doAnimate(model, inst, delta);
    }
}

function doAnimate(model, inst, delta) {
    const ob = model.bmDat.variables[inst.target];

    if(ob) {
        const rawSpeed = resolveValue(model, inst.speed);
        const speed = MathUtils.degToRad(parseFloat(rawSpeed)) * delta;
        const tgtVal = resolveValue(model, inst.steps[inst.step]);

        let changeBaseOb = null;
        let subProp = null;
        let target = null;

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

function resolveValue(model, value) {
    let use = value;

    if(use.indexOf("$") == 0) {
        use = model.bmDat.variables[use.replace("$","")];
    }

    if(use.indexOf("-$") == 0) {
        use = "-" + model.bmDat.variables[use.replace("-$","")];
    }

    return use;
}

/**
 * 
 * @param {BasicModel} modelData 
 * @param {*} options 
 * @returns RenderBasicModel
 */
async function loadBM(modelData, options) {

    console.log("Loading BM model");
    console.log(modelData);

    const renderModel = new RenderBasicModel(modelData);

    console.log(renderModel);

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

    return renderModel;
}

async function negotiateInstructionLine(line,renderModel,currentGroup) {

    if(line.indexOf("//") == 0) {
        return;
    }

    let usingVar = null;
    let usingObj = null;
    let usingAni = null;
    let aniOb = null;

    let codeParts = line;

    const assignments = line.split("=");

    if(assignments.length > 1) {
        const varPart = assignments[0];
        usingVar = varPart.replace("$","");
        codeParts = assignments[1];
    }

    let modParts = codeParts.split(">");

    for(let i = 0; i < modParts.length; i++) {
        const mod = modParts[i];

        if(mod.indexOf("$") == 0) {

            let evals = mod.replace("$","");

            if(usingVar) {
                if(renderModel.bmDat.variables[evals]) {
                    renderModel.bmDat.variables[usingVar] = renderModel.bmDat.variables[evals];
                }
            } else {
                usingVar = evals;

                if(renderModel.bmDat.variables[usingVar]) {
                    usingObj = renderModel.bmDat.variables[usingVar];
                }
            }

            continue;
        }

        if(mod.indexOf("@") == 0) {

            let evals = mod.replace("@","");

            if(usingAni) {
                if(renderModel.bmDat.animations[evals]) {
                    renderModel.bmDat.animations[usingAni] = renderModel.bmDat.animations[evals];
                }
            } else {
                usingAni = evals;

                if(renderModel.bmDat.animations[usingAni]) {
                    aniOb = renderModel.bmDat.animations[usingAni];
                }
            }

            continue;
        }

        if(usingAni) {
            if(!aniOb) {
                renderModel.bmDat.animations[usingAni] = [];
                aniOb = renderModel.bmDat.animations[usingAni];
            }

            aniOb.push(new RenderAnimation(mod));
        }

        if(mod == "endgroup()" || mod == "startgroup()") {
            if(currentGroup.grp) {
                renderModel.add(currentGroup.grp);
            }

            currentGroup.grp = null;

            if(mod == "endgroup()") {
                continue;
            }
        }

        if(mod == "startgroup()") {
            currentGroup.grp = new Group();

            usingObj = currentGroup.grp;

            if(usingVar) {
                renderModel.bmDat.variables[usingVar] = currentGroup.grp;
            }

            continue;
        }

        if(mod.indexOf("sphere(") == 0) {
            usingObj = await createSphereOperation(mod, renderModel, currentGroup.grp);

            if(usingVar) {
                renderModel.bmDat.variables[usingVar] = usingObj;
            }

            continue;
        }

        if(mod.indexOf("torus(") == 0) {
            usingObj = await createTorusOperation(mod, renderModel, currentGroup.grp);

            if(usingVar) {
                renderModel.bmDat.variables[usingVar] = usingObj;
            }

            continue;
        }

        if(mod.indexOf("box(") == 0) {
            usingObj = await createBoxOperation(mod, renderModel, currentGroup.grp);

            if(usingVar) {
                renderModel.bmDat.variables[usingVar] = usingObj;
            }

            continue;
        }

        if(mod.indexOf("cone(") == 0) {
            usingObj = await createConeOperation(mod, renderModel, currentGroup.grp);

            if(usingVar) {
                renderModel.bmDat.variables[usingVar] = usingObj;
            }

            continue;
        }

        if(mod.indexOf("cylinder(") == 0) {
            usingObj = await createCylinderOperation(mod, renderModel, currentGroup.grp);

            if(usingVar) {
                renderModel.bmDat.variables[usingVar] = usingObj;
            }

            continue;
        }

        if(mod.indexOf("geotranslate(") == 0) {
            handleGeoTranslate(mod, renderModel);
            continue;
        }

        if(mod.indexOf("position(") == 0) {
            if(usingVar) {
                doPositionOperation(usingVar, mod, renderModel);
            } else {
                if(usingObj) {
                    doPositionOperation(usingObj, mod, renderModel);
                }
            }

            continue;
        }

        if(mod.indexOf("rotate(") == 0) {

            if(usingVar) {
                doRotateOperation(usingVar, mod, renderModel);
            } else {
                if(usingObj) {
                    doRotateOperation(usingObj, mod, renderModel);
                }
            }

            continue;
        }


        if(usingVar) {
            if(isNaN) {
                renderModel.bmDat.variables[usingVar] = mod;
            } else {
                renderModel.bmDat.variables[usingVar] = parseFloat(mod);
            }
            
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
            material = await getTextureMaterial(parts[4], renderModel);
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

function getModValue(val, renderModel) {

    let isNeg = false;
    let baseVar = val;
    let isVariable = false;

    if(val.indexOf("-$") == 0) {
        isNeg = true;
        isVariable = true;
        baseVar = val.replace("-$","");
    }

    if(val.indexOf("$") == 0) {
        baseVar = val.replace("$","");
        isVariable = true;
    }

    if(!isVariable) {
        if(isNaN(val)) {
            return val;
        } else {
            return parseFloat(val);
        }
    }

    let varItm = renderModel.bmDat.variables[baseVar];

    if(renderModel.bmDat.variableOverrides[baseVar]) {
        varItm = renderModel.bmDat.variableOverrides[baseVar];
    }

    if(isNaN(varItm)) {
        return varItm;
    } else {
        if(isNeg) {
            return -parseFloat(varItm);
        }
    }

    return parseFloat(varItm);
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
            material = await getTextureMaterial(parts[4],renderModel);
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
            material = await getTextureMaterial(parts[4],renderModel);
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
            material = await getTextureMaterial(parts[5], renderModel);
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

function doPositionOperation(id, code, renderModel) {

    let obid = id;

    if(typeof id == "string" && renderModel.bmDat.variables[id]) {
        obid = renderModel.bmDat.variables[id];
    }

    if(!obid) {
        return;
    }

    let raw = code.replace("position(","");
    raw = raw.replace(")","");

    const parts = raw.split(",");

    if(parts.length >= 3) {

        let x = getModValue(parts[0],renderModel);
        let y = getModValue(parts[1],renderModel);
        let z = getModValue(parts[2],renderModel);

        obid.position.set(x,y,z);
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

async function getTextureMaterial(textureInstruction,renderModel) {

    if(!textureInstruction) {
        return null;
    }

    const txInst = textureInstruction.split("|");

    if(txInst.length == 1) {
        return new MeshLambertMaterial({
            map: await loadTexture(txInst[0],renderModel)
        });
    }

    let mapping = [];

    for(let i = 0; i < txInst.length; i++) {
        mapping.push(new MeshLambertMaterial({
            map: await loadTexture(txInst[i],renderModel),
            side: DoubleSide
        }));
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

async function getFrameTexture(txDef,instructions,frame,renderModel) {
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
        return imCanvas.toDataURL("image/webp", 0.8);
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

export {  BMLoader, BasicModel, ModelTexture, RenderBasicModel };