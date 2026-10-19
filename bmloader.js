import { hash, guid, rebuildStandardObject } from "common-helpers";

import {
    Loader,
    MeshLambertMaterial,
    Mesh,
    Group,
    MathUtils,
    Matrix4,
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
    Color,
    FrontSide,
    BackSide,
    SpriteMaterial,
    Sprite,
    PointLight,
    HemisphereLight,
    DirectionalLight,
    Texture,
    ClampToEdgeWrapping,
    MirroredRepeatWrapping,
    RepeatWrapping,
    AdditiveBlending,
    RingGeometry
} from "three";

import { DecalGeometry } from "three/addons/geometries/DecalGeometry.js";
import { TextGeometry } from "three/addons/geometries/TextGeometry.js";
import { FontLoader } from "three/addons/loaders/FontLoader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import { Parser } from "expr-eval";

const storedGeometries = {};
// Reverse index of storedGeometries: a merge names its sources without scanning the whole cache.
const storedGeometryKeys = new WeakMap();
const storedImageCanvases = {};
const storedMaterials = {};
const loadedRenderModels = {}; // Cache for fully-loaded render models
const pendingRenderModels = new Map(); // cacheKey -> Promise of a render model still being parsed
const loadedFonts = {}; // Cache for loaded fonts

// Interned (shared, immutable) materials and textures. Anything that mutates one
// must go through makeMaterialWritable() first so instances never contaminate each other.
const internedMaterials = new Map();
const internedTextures = new Map();
const _matClassIds = new Map();

function storeGeometry(key, geometry) {
    storedGeometries[key] = geometry;

    if(!storedGeometryKeys.has(geometry)) {
        storedGeometryKeys.set(geometry, key);
    }
}

function getMatClassId(matClass) {
    let id = _matClassIds.get(matClass);

    if(id === undefined) {
        id = _matClassIds.size;
        _matClassIds.set(matClass, id);
    }

    return id;
}

/**
 * Returns a shared material for the given class/options, creating it if needed.
 * The returned material is flagged as shared and must never be mutated in place.
 */
function internMaterial(matClass, options = {}) {
    const mapKey = options.map ? (options.map.userData.__bmTxKey || options.map.uuid) : "nomap";

    const key = [
        getMatClassId(matClass),
        mapKey,
        options.color === undefined ? "def" : options.color,
        options.side === undefined ? "def" : options.side,
        options.transparent ? 1 : 0,
        options.depthWrite === false ? 0 : 1
    ].join("|");

    let material = internedMaterials.get(key);

    if(!material) {
        material = new matClass(options);
        material.userData.__bmShared = true;
        internedMaterials.set(key, material);
    }

    return material;
}

function unshareMaterial(material) {
    if(!material || !material.userData.__bmShared) {
        return material;
    }

    const copy = material.clone();
    copy.userData.__bmShared = false;

    return copy;
}

/**
 * Copy-on-write: swaps any shared material on the object for a private clone so
 * it can be safely mutated. Returns the now-writable material (or array).
 */
function makeMaterialWritable(obj) {
    if(!obj || !obj.material) {
        return null;
    }

    if(Array.isArray(obj.material)) {
        obj.material = obj.material.map(mat => unshareMaterial(mat));
    } else {
        obj.material = unshareMaterial(obj.material);
    }

    return obj.material;
}

/**
 * Stable signature for a model + its variable overrides, used to key interned textures.
 * @param {RenderBasicModel} renderModel
 */
function getModelOverrideSignature(renderModel) {
    const bmDat = renderModel.bmDat;

    if(bmDat._overrideSig === undefined || bmDat._overrideSig === null) {
        const overrides = bmDat.variableOverrides || {};
        const keys = Object.keys(overrides).sort();

        bmDat._overrideSig = (bmDat.src ? bmDat.src.id : "?") + "_" + keys.map(k => k + ":" + overrides[k]).join("|");
    }

    return bmDat._overrideSig;
}

/**
 * Generates a cache key including variable overrides
 * @param {string} baseKey - Base cache key (url or model id)
 * @param {Object} variables - Variable overrides object
 * @return {string} Cache key with overrides hash
 */
function getCacheKeyWithOverrides(baseKey, variables) {
    if (!variables || Object.keys(variables).length === 0) {
        return baseKey;
    }
    // Create deterministic string from variables
    const varKeys = Object.keys(variables).sort();
    const varString = varKeys.map(k => `${k}:${variables[k]}`).join('|');
    return `${baseKey}_vars_${hash(varString)}`;
}

const DEF_MODEL_COLOR = "#999999";
const FULLTURN = MathUtils.degToRad(360);

const parser = new Parser();

let threeLoader = null;
let remoteModels = {};

class BMLoader extends Loader {

    constructor(manager = undefined, options = {}) {
        super(manager);

        this.defMaterial = options.defMaterial || "lambert";
        this.imgQuality = options.imgQuality || 0.85;
        this.enableLights = options.enableLights !== false; // Set to false to disable all lights for performance
    }

    load(url, onLoad, onProgress, onError) {
        const scope = this;

        let options = {};

        if(typeof url === "object") {

            if(url.script && url.id) {
                const modelDat = rebuildBM(url);
                
                // Model ID, revision AND variable overrides, exactly as the {json} path
                // below does. Without the override term two loads of the same script
                // with different variables share one cache entry, so the second one is
                // handed the first one's geometry.
                const cacheKey = getCacheKeyWithOverrides(`object_${modelDat.id}_r${modelDat.revision || 0}`, url.variables);

                /* `url`, not null: the wrapper carries `variables`, and loadBM() reads
                   options.variables. This was null, which discarded every override on
                   the flat `{ id, script }` form while `{ url }` and `{ json }` honoured
                   them — the divergence OPERATIONS.md called out as a trap. */
                loadCachedRenderModel(cacheKey, () => loadBM(modelDat, url, scope), onLoad, onError, url.shared === true);
                return;
            }

            if(url.json && url.json.script && url.json.id) {
                const modelDat = rebuildBM(url.json);
                
                // Use model ID, revision, AND variable overrides in cache key
                const baseKey = `object_${modelDat.id}_r${modelDat.revision || 0}`;
                const cacheKey = getCacheKeyWithOverrides(baseKey, url.variables);

                loadCachedRenderModel(cacheKey, () => loadBM(modelDat, url, scope), onLoad, onError, url.shared === true);
                return;
            }

            if(url.url) {
                options = url;
                url = options.url;
            } else {
                onError(new Error("Invalid model data"));
                return;
            }
        }

        // Include variable overrides in cache key
        const cacheKey = getCacheKeyWithOverrides(url, options?.variables);

        loadCachedRenderModel(cacheKey, function() {
            if(remoteModels[url]) {
                return loadBM(remoteModels[url], options, scope);
            }

            return new Promise(function(resolve, reject) {
                const loader = new FileLoader(scope.manager);
                loader.setResponseType("json");
                loader.setPath(scope.path);
                loader.load(url, function(data) {
                    const modelDat = rebuildBM(data);
                    remoteModels[url] = modelDat;
                    resolve(loadBM(modelDat, options, scope));
                }, onProgress, reject);
            });
        }, onLoad, onError, options.shared === true);
    }
}

/**
 * Parses (or fetches and parses) a model at most once per cache key, however many
 * loads ask for it while the first is still in flight, and hands every caller a clone.
 *
 * Without the in-flight entry, every load that arrived before the first parse finished
 * started its own: a scene placing 5,000 copies of one model in one pass parsed it 5,000
 * times, which is what made a large scene slow to appear.
 * @param {string} cacheKey
 * @param {function(): Promise<RenderBasicModel>} build - Parses the model on a cache miss
 * @param {function(RenderBasicModel): void} onLoad
 * @param {function(*): void} [onError]
 * @param {boolean} [shared] - hand back the cached model itself, not a clone. The caller
 *   must treat it as read-only: it is the source every later clone is made from.
 */
function loadCachedRenderModel(cacheKey, build, onLoad, onError, shared = false) {
    const cached = loadedRenderModels[cacheKey];

    if(cached && shared) {
        onLoad(cached);
        return;
    }

    if(cached) {
        // ALWAYS hand out a clone to prevent material sharing between instances
        const clone = cached.clone();

        if(clone) {
            onLoad(clone);
            return;
        }

        // Cache was corrupted, remove it and rebuild
        delete loadedRenderModels[cacheKey];
    }

    let pending = pendingRenderModels.get(cacheKey);

    if(!pending) {
        pending = Promise.resolve().then(build).then(function(renderModel) {
            renderModel.bmDat.cacheKey = cacheKey;

            if(!loadedRenderModels[cacheKey]) {
                loadedRenderModels[cacheKey] = renderModel;
            }

            return loadedRenderModels[cacheKey];
        });

        pendingRenderModels.set(cacheKey, pending);

        const settle = () => pendingRenderModels.delete(cacheKey);
        pending.then(settle, settle);
    }

    pending.then(function(renderModel) {
        onLoad(shared ? renderModel : renderModel.clone());
    }, function(err) {
        if(onError) {
            onError(err);
        } else {
            console.error("bmloader: model failed to load", cacheKey, err);
        }
    });
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

class RenderBasicModelProperties {
    constructor() {
        this.src = null; // The original model data
        this.variables = {}; // Variables defined in the model
        this.variableOverrides = {}; // Overrides for variables
        this.geoTranslate = { x: 0, y: 0, z: 0 }; // Geometry translation offsets
        this.animations = {}; // Animation definitions
        this.animation = null; // Current animation being played
        this._scriptLines = null; // Original script lines for reference
        this.lastAnimation = null; // Last animation played
        this.defaultState = {}; // Default state of the model
        this.loaderRef = null; // Reference to the loader instance
        this.cacheKey = null; // Loader cache key, shared by all clones of this template
        this._overrideSig = null; // Lazily built signature of src id + variable overrides
        this.mergeGroups = null; // Reversible static-geometry merges, see finalizeRenderModel
        this.fog = null; // Scene-level fog declared by fog(); no Scene exists here, so the engine applies it
    }
}

/**
 * Represents a renderable basic model in Three.js.
 * This class extends the Three.js Group class and provides methods for animating, resetting, saving, and restoring the model's state.
 * It encapsulates the model's properties, including its source data, animations, and variable overrides.
 * It also provides methods to handle animations defined in the model's script.
 * @extends Group
 * @property {RenderBasicModelProperties} bmDat - The properties of the basic model, including source data, animations, and variable overrides.
 */
class RenderBasicModel extends Group {

    /**
     * Creates an instance of RenderBasicModel.
     * @param {BasicModel} model - The source model data to render.
     * @param {BMLoader} [loader=null] - An optional loader instance for loading textures and materials.
     */
    constructor(model, loader = null) {
        super();

        this.bmDat = new RenderBasicModelProperties();

        this.bmDat.src = model;
        this.bmDat.loaderRef = loader || null;
    }

    dispose() {
        this.bmDat = null;
    }

    animate(delta) {
        animateModel(this, delta);
    }

    reset() {
        return resetRenderModel(this);
    }

    /**
     * Returns the live object for a model variable, undoing any static merge it takes
     * part in first so the caller can safely move, hide or restyle it.
     * @param {string} name - Variable name, with or without the leading $
     * @return {*} The variable's value
     */
    getPart(name) {
        const key = (typeof name === "string" && name.startsWith("$")) ? name.substring(1) : name;
        const value = this.bmDat.variables[key];

        if(value && value.isObject3D) {
            unmergeContaining(this, value);
        }

        return value;
    }

    /**
     * Overrides a model variable and rebuilds the model from its script, since a
     * variable change can alter geometry and not just appearance.
     * @param {string} name - Variable name, with or without the leading $
     * @param {*} value - New value
        * @return {Promise<void>} Resolves when the model has finished rebuilding
     */
    setVariable(name, value) {
        const key = (typeof name === "string" && name.startsWith("$")) ? name.substring(1) : name;

        this.bmDat.variableOverrides[key] = value;
        this.bmDat._overrideSig = null;

        this.clearCaches();

        return resetRenderModel(this);
    }

    /**
     * Undoes every static merge, restoring the model to individually addressable parts.
     * Use when something outside the loader has changed the model in an unknown way.
     */
    invalidate() {
        const mergeGroups = this.bmDat.mergeGroups;

        if(!mergeGroups) {
            return;
        }

        for(let i = 0; i < mergeGroups.length; i++) {
            unmergeGroup(this, i);
        }
    }

    saveState() {
        saveModelState(this, this);
    }

    restoreState() {
        restoreModelState(this, this);
    }

    /**
     * Clears performance caches when variables or animations change
     * Call this after modifying variables or variable overrides
     */
    clearCaches() {
        clearModValueCaches();
        clearAnimationCaches(this);
    }

    /**
     * Creates a clone of this model with shared geometries and materials.
     * This is much faster than re-parsing the model script.
     * @param {Object} variableOverrides - Optional variable overrides for the clone
     * @return {RenderBasicModel} A new instance sharing geometries and materials
     */
    clone(variableOverrides = null) {
        return cloneRenderModel(this, variableOverrides);
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
        
        // Performance optimization: cache for resolved values
        this._cachedSpeed = undefined;

        parseAnimationInstructions(this);
    }
    
    // Clear cached values when variables change
    clearCache() {
        this._cachedSpeed = undefined;
        this._cachedSteps = undefined;
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

    if(!model || !model.bmDat) {
        return;
    }

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

    if(model.bmDat.animation && !model.bmDat.lastAnimation) {
        model.saveState();
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
        // Cache parsed speed value to avoid re-evaluation on every frame
        if (inst._cachedSpeed === undefined) {
            inst._cachedSpeed = getModValue(inst.speed, model);
        }
        const speed = MathUtils.degToRad(parseFloat(inst._cachedSpeed)) * delta;
        
        const rawVal = inst.steps[inst.step];
        
        // Cache step values to avoid repeated evaluation of the same step
        if (!inst._cachedSteps) {
            inst._cachedSteps = {};
        }
        
        let tgtVal;
        if (inst._cachedSteps[inst.step] !== undefined) {
            tgtVal = inst._cachedSteps[inst.step];
        } else {
            tgtVal = getModValue(rawVal, model);
            inst._cachedSteps[inst.step] = tgtVal;
        }

        let changeBaseOb = null;
        let subProp = null;
        let target = null;

        if(inst.action.indexOf("txChange") == 0) {
            inst.renTime += delta;

            if(inst.renTime >= inst.speed) {
                inst.renTime = 0;

                getTextureMaterial(rawVal, model, ob.material.transparent, undefined, ob.material.depthWrite, ob.material.type).then(function(mat) {
                    if(mat) {
                        // Swapping the reference, not mutating - no needsUpdate required
                        ob.material = mat;
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

        // Handle material property animations (emissiveIntensity, opacity, etc.)
        if(inst.action.indexOf("emissiveIntensity") == 0) {

            if(!ob.material) return;
            
            target = parseFloat(tgtVal);
            if(isNaN(target)) {
                console.warn("Invalid emissiveIntensity target value:", tgtVal);
                return;
            }

            makeMaterialWritable(ob);

            const cur = ob.material.emissiveIntensity || 0;
            
            if(Math.abs(cur - target) < 0.01) {
                ob.material.emissiveIntensity = target;
                ob.material.needsUpdate = true;
                inst.step++;
                if(inst.step >= inst.steps.length) {
                    inst.step = 0;
                }
                return;
            }

            if(cur > target) {
                ob.material.emissiveIntensity = Math.max(target, cur - speed * 10);
            } else {
                ob.material.emissiveIntensity = Math.min(target, cur + speed * 10);
            }
            
            ob.material.needsUpdate = true;
            return;
        }

        if(inst.action.indexOf("opacity") == 0) {
            if(!ob.material) return;
            
            target = parseFloat(tgtVal);
            if(isNaN(target)) {
                console.warn("Invalid opacity target value:", tgtVal);
                return;
            }

            makeMaterialWritable(ob);

            const cur = ob.material.opacity || 1;
            
            if(Math.abs(cur - target) < 0.01) {
                ob.material.opacity = target;
                ob.material.transparent = target < 1;
                ob.material.needsUpdate = true;
                inst.step++;
                if(inst.step >= inst.steps.length) {
                    inst.step = 0;
                }
                return;
            }

            if(cur > target) {
                ob.material.opacity = Math.max(target, cur - speed * 10);
            } else {
                ob.material.opacity = Math.min(target, cur + speed * 10);
            }
            
            ob.material.transparent = ob.material.opacity < 1;
            ob.material.needsUpdate = true;
            return;
        }

        if(inst.action.indexOf("visible") == 0) {
            // Visibility is instant toggle - no smooth transition
            inst.renTime += delta;

            if(inst.renTime >= inst.speed) {
                inst.renTime = 0;

                // Support 0/1, true/false values
                let visible = true;
                if(tgtVal === 0 || tgtVal === "0" || tgtVal === false || tgtVal === "false") {
                    visible = false;
                } else if(tgtVal === 1 || tgtVal === "1" || tgtVal === true || tgtVal === "true") {
                    visible = true;
                }

                ob.visible = visible;

                inst.step++;
                if(inst.step >= inst.steps.length) {
                    inst.step = 0;
                }
            }

            return;
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

    const renderModel = new RenderBasicModel(modelData, loader);

    if(options) {
        if(options.variables) {
            for(let varName in options.variables) {
                renderModel.bmDat.variableOverrides[varName] = options.variables[varName];
            }
        }
    }

    const currentGroup = {
        grp: null,
        merging: false,
        mergeList: [],
        mergeName: null
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
    finalizeRenderModel(renderModel);

    return renderModel;
}

/**
 * Marks every node that no animation targets as rigid (matrixAutoUpdate off) after
 * baking its local matrix once, then merges the rigid meshes into as few draw calls
 * as their materials allow. The merge is reversible - see getPart()/invalidate().
 * @param {RenderBasicModel} renderModel
 */
function finalizeRenderModel(renderModel) {
    const animated = collectAnimationTargets(renderModel);

    renderModel.traverse(function(node) {
        if(node === renderModel) {
            return;
        }

        node.updateMatrix();
        node.matrixAutoUpdate = animated.has(node);
    });

    // A clone already carries the merged meshes and hidden sources, so just re-index them
    if(adoptExistingMergeGroups(renderModel)) {
        return;
    }

    buildMergeGroups(renderModel, collectDynamicNodes(renderModel, animated));
}

/**
 * Nodes an animation directly moves. Only these need per-frame matrix recomposition.
 */
function collectAnimationTargets(renderModel) {
    const targets = new Set();

    for(const aniName in renderModel.bmDat.animations) {
        const animationSet = renderModel.bmDat.animations[aniName];

        if(!Array.isArray(animationSet)) {
            continue;
        }

        for(const inst of animationSet) {
            if(!inst || !inst.target) {
                continue;
            }

            const ob = renderModel.bmDat.variables[inst.target];

            if(ob && ob.isObject3D) {
                targets.add(ob);
            }
        }
    }

    return targets;
}

/**
 * Everything an animation could move: the targets themselves, whatever they carry
 * along (descendants) and whatever moves them (ancestors). None of it may be merged.
 */
function collectDynamicNodes(renderModel, targets) {
    const dynamic = new Set();

    for(const target of targets) {
        target.traverse(node => dynamic.add(node));

        let parent = target.parent;

        while(parent && parent !== renderModel) {
            dynamic.add(parent);
            parent = parent.parent;
        }
    }

    return dynamic;
}

const _mergeMatrix = new Matrix4();
const _invRootMatrix = new Matrix4();

// Three's raycaster ignores `visible`, so merge sources need picking silenced explicitly
function noopRaycast() {}

function getGeometryLayoutKey(geometry) {
    return Object.keys(geometry.attributes).sort().join(",") + "|" + (geometry.index ? "i" : "n");
}

/**
 * Bakes rigid meshes into one merged mesh per (material, attribute layout) pair.
 * Sources stay in the hierarchy but hidden, so the merge can be undone at any time
 * and so clones pick both halves up for free.
 */
function buildMergeGroups(renderModel, dynamic) {
    renderModel.updateMatrixWorld(true);
    _invRootMatrix.copy(renderModel.matrixWorld).invert();

    const byMaterial = new Map();

    renderModel.traverse(function(node) {
        if(node === renderModel || !node.isMesh || dynamic.has(node)) {
            return;
        }

        // Hidden parts are authored intent, and multi-material meshes carry draw groups
        if(!node.visible || !node.geometry || Array.isArray(node.material) || !node.material) {
            return;
        }

        if(node.userData.__bmNoMerge || node.userData.__bmMergeGroup !== undefined) {
            return;
        }

        let byLayout = byMaterial.get(node.material);

        if(!byLayout) {
            byLayout = new Map();
            byMaterial.set(node.material, byLayout);
        }

        const layoutKey = getGeometryLayoutKey(node.geometry);
        let list = byLayout.get(layoutKey);

        if(!list) {
            list = [];
            byLayout.set(layoutKey, list);
        }

        list.push(node);
    });

    const mergeGroups = [];

    for(const [material, byLayout] of byMaterial) {
        for(const list of byLayout.values()) {

            if(list.length < 2) {
                continue;
            }

            const geometries = [];

            for(const mesh of list) {
                const geo = mesh.geometry.clone();

                _mergeMatrix.multiplyMatrices(_invRootMatrix, mesh.matrixWorld);
                geo.applyMatrix4(_mergeMatrix);

                geometries.push(geo);
            }

            let mergedGeometry = null;

            try {
                mergedGeometry = mergeGeometries(geometries, false);
            } catch(e) {
                console.warn("BM static merge failed, leaving parts separate:", e);
            }

            for(const geo of geometries) {
                geo.dispose();
            }

            if(!mergedGeometry) {
                continue;
            }

            const index = mergeGroups.length;
            const mergedMesh = new Mesh(mergedGeometry, material);

            mergedMesh.matrixAutoUpdate = false;
            mergedMesh.updateMatrix();
            mergedMesh.userData.__bmMergeGroup = index;

            for(const mesh of list) {
                mesh.visible = false;
                mesh.raycast = noopRaycast;
                mesh.userData.__bmMergeSource = index;
            }

            renderModel.add(mergedMesh);
            mergeGroups.push({ merged: mergedMesh, sources: list, active: true });
        }
    }

    renderModel.bmDat.mergeGroups = mergeGroups;
}

/**
 * Rebuilds the merge group index from userData markers already present in the graph.
 * @return {boolean} True if this model was already merged.
 */
function adoptExistingMergeGroups(renderModel) {
    const mergedNodes = new Map();
    const sourceNodes = new Map();

    renderModel.traverse(function(node) {
        const groupIndex = node.userData.__bmMergeGroup;

        if(groupIndex !== undefined) {
            mergedNodes.set(groupIndex, node);
        }

        const sourceIndex = node.userData.__bmMergeSource;

        if(sourceIndex !== undefined) {
            let list = sourceNodes.get(sourceIndex);

            if(!list) {
                list = [];
                sourceNodes.set(sourceIndex, list);
            }

            list.push(node);
        }
    });

    if(mergedNodes.size === 0) {
        return false;
    }

    const mergeGroups = [];

    for(const [index, mesh] of mergedNodes) {
        const sources = sourceNodes.get(index) || [];
        const active = mesh.visible;

        if(active) {
            for(const source of sources) {
                source.raycast = noopRaycast;
            }
        }

        mergeGroups[index] = {
            merged: mesh,
            sources: sources,
            active: active
        };
    }

    renderModel.bmDat.mergeGroups = mergeGroups;

    return true;
}

/**
 * Restores the individual meshes of a merged group so they can be manipulated again.
 */
function unmergeGroup(renderModel, index) {
    const mergeGroups = renderModel.bmDat.mergeGroups;

    if(!mergeGroups || !mergeGroups[index] || !mergeGroups[index].active) {
        return;
    }

    const group = mergeGroups[index];

    group.merged.visible = false;

    for(const source of group.sources) {
        source.visible = true;
        delete source.raycast;
    }

    group.active = false;
}

/**
 * Un-merges every group that contributed geometry from the given node or its subtree.
 */
function unmergeContaining(renderModel, node) {
    if(!renderModel.bmDat.mergeGroups || !node || !node.isObject3D) {
        return;
    }

    const indices = new Set();

    node.traverse(function(child) {
        const index = child.userData.__bmMergeSource;

        if(index !== undefined) {
            indices.add(index);
        }
    });

    for(const index of indices) {
        unmergeGroup(renderModel, index);
    }
}

/**
 * Deep-clones an object for the clone() operation. Geometry and interned (shared)
 * materials are shared; private materials are copied, because makeMaterialWritable()
 * only copies SHARED materials — an aliased private material would let a later
 * material() or animation on the clone leak back into the source.
 * @param {Object3D} source - The object to clone
 * @return {Object3D} The clone
 */
function cloneSceneObject(source) {
    const copy = source.clone(true);
    const cloneMaterial = (mat) => (mat && !mat.userData.__bmShared) ? mat.clone() : mat;

    copy.traverse((node) => {
        if (node.material) {
            node.material = Array.isArray(node.material)
                ? node.material.map(cloneMaterial)
                : cloneMaterial(node.material);
        }

        // Re-aim directional lights at their own cloned target (see cloneObject3D).
        if (node instanceof DirectionalLight) {
            const target = node.children.find((c) => c.userData && c.userData.bmLightTarget);
            if (target) node.target = target;
        }
    });

    return copy;
}

/**
 * Checks if a string contains geometry creation operations
 * @param {string} str - The string to check
 * @return {boolean} True if it contains geometry operations
 */
function hasGeometryOperation(str) {
    const geometryOps = [
        'sphere(', 'box(', 'cylinder(', 'cone(', 'torus(', 'capsule(',
        'shape(', 'plane(', 'lathe(', 'ring(', 'text(', 'pointlight(',
        'fakelight(', 'hemispherelight(', 'directionallight(', 'decal(',
        'empty()', 'startgroup()', 'startmerge()', 'usegeo(', 'clone('
    ];
    
    return geometryOps.some(op => str.includes(op));
}

/**
 * Checks if a string contains transform operations
 * @param {string} str - The string to check
 * @return {boolean} True if it contains transform operations
 */
function isTransformString(str) {
    const transformOps = [
        'position(', 'rotate(', 'scale(', 'orientation(',
        'material(', 'texture(', 'lightmap(', 'bumpmap(', 'opacity('
    ];
    
    return typeof str === 'string' && transformOps.some(op => str.includes(op));
}

/**
 * Applies stored transform operations to an object
 * @param {string} transformStr - The transform string (e.g., "position(0,1,0) > rotate(45,0,0)")
 * @param {Object} targetObj - The object to apply transforms to
 * @param {RenderBasicModel} renderModel - The render model
 * @param {BMLoader} loader - The loader instance
 */
// eslint-disable-next-line no-unused-vars
async function applyTransformString(transformStr, targetObj, renderModel, loader) {
    const transforms = transformStr.split('>');
    
    console.log('Applying transforms:', transformStr, 'to object:', targetObj);
    
    for (let transform of transforms) {
        transform = transform.trim();
        if (!transform) continue;
        
        console.log('Applying transform:', transform);
        
        // Apply each transform operation
        if (transform.startsWith('position(')) {
            doPositionOperation(targetObj, transform, renderModel);
        } else if (transform.startsWith('rotate(')) {
            doRotateOperation(targetObj, transform, renderModel);
        } else if (transform.startsWith('scale(')) {
            doScaleOperation(targetObj, transform, renderModel);
        } else if (transform.startsWith('orientation(')) {
            doOrientationOperation(targetObj, transform, renderModel);
        } else if (transform.startsWith('material(')) {
            await doMaterialOperation(targetObj, transform, renderModel);
        } else if (transform.startsWith('texture(')) {
            await doTextureOperation(targetObj, transform, renderModel);
        } else if (transform.startsWith('lightmap(')) {
            await doLightmapOperation(targetObj, transform, renderModel);
        } else if (transform.startsWith('bumpmap(')) {
            await doBumpmapOperation(targetObj, transform, renderModel);
        } else if (transform.startsWith('opacity(')) {
            doOpacityOperation(targetObj, transform, renderModel);
        }
    }
}

/**
 * @param {String} line The instruction line to parse
 * @param {RenderBasicModel} renderModel The model to modify
 * @param {Object} currentGroup The current group context for grouping operations
 * @param {BMLoader} loader The loader instance for texture loading
 * @param {boolean} recordInstruction Whether to retain the line for future rebuilds
 */
async function negotiateInstructionLine(line, renderModel, currentGroup, loader, recordInstruction = true) {
    if (line.trim().startsWith("//") || !line.trim()) return;

    if (recordInstruction) {
        if (!renderModel.bmDat._scriptLines) {
            renderModel.bmDat._scriptLines = [];
        }

        renderModel.bmDat._scriptLines.push(line);
    }

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
    // BUT exclude transform operations - those should be stored as strings for later application
    if (modParts.length === 1 && usingVar && !modParts[0].includes("(") && !modParts[0].startsWith("@")) {
        renderModel.bmDat.variables[usingVar] = modParts[0].trim();
        return;
    }
    
    // Check if this is a transform-only assignment (no geometry creation in any part)
    if (usingVar) {
        const hasGeometry = modParts.some(part => hasGeometryOperation(part));
        if (!hasGeometry && isTransformString(codeParts)) {
            // Store the transform operations as a string (single or multiple operations)
            renderModel.bmDat.variables[usingVar] = codeParts;
            return;
        }
    }

    for (let mod of modParts) {
        mod = mod.trim();
        if (!mod) continue;

        // Handle variable references
        if (mod.startsWith("$")) {
            const evals = mod.replace("$", "");
            const varValue = renderModel.bmDat.variables[evals];

            // Check if variable contains transform operations and we have an object to apply to
            if (usingObj && typeof varValue === 'string' && isTransformString(varValue)) {
                // Apply stored transforms to the current object
                await applyTransformString(varValue, usingObj, renderModel, loader);
                continue;
            }
            
            if (usingVar && varValue) {
                renderModel.bmDat.variables[usingVar] = varValue;
            } else {
                usingVar = evals;
                usingObj = varValue || null;
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

        // Handle geometry merging
        if (mod === "startmerge()") {
            currentGroup.merging = true;
            currentGroup.mergeList = [];
            currentGroup.mergeName = usingVar; // Save the variable name from this line
            // Create a dummy group that doesn't actually add to scene
            currentGroup.grp = {
                add: function() {}
            };
            continue;
        }

        if (mod === "endmerge()") {
            if (currentGroup.merging && currentGroup.mergeList.length > 0) {
                const mergedObj = createMergedGeometry(currentGroup.mergeList);
                
                // Assign to the variable from startmerge() line
                if (currentGroup.mergeName) {
                    renderModel.bmDat.variables[currentGroup.mergeName] = mergedObj;
                }
                
                // Also set as usingObj if this line has a variable assignment
                if (usingVar) {
                    renderModel.bmDat.variables[usingVar] = mergedObj;
                    usingObj = mergedObj;
                }
            }
            currentGroup.merging = false;
            currentGroup.mergeList = [];
            currentGroup.mergeName = null;
            currentGroup.grp = null;
            continue;
        }

        // Handle usegeo operation
        if (mod.startsWith("usegeo(") && mod.endsWith(")")) {
            let raw = mod.replace("usegeo(", "");
            raw = raw.replace(")", "");
            
            const parts = raw.split(",");
            const varName = parts[0].trim().replace("$", "");
            const sourceObj = renderModel.bmDat.variables[varName];
            
            if (sourceObj && sourceObj.geometry) {
                // Get optional color (defaults to DEF_MODEL_COLOR)
                let color = DEF_MODEL_COLOR;
                if (parts.length > 1 && parts[1].trim()) {
                    color = getModValue(parts[1].trim(), renderModel);
                }
                
                // Get optional material type (defaults to loader's default)
                let useMaterial = loader.defMaterial || "lambert";
                if (parts.length > 2 && parts[2].trim()) {
                    useMaterial = parts[2].trim();
                }
                
                // Create new mesh with shared geometry and specified material
                const matClass = getMaterialClass(useMaterial);
                const material = internMaterial(matClass, { color: color });
                usingObj = new Mesh(sourceObj.geometry, material);
                
                // Add to scene or current group
                if (currentGroup.merging) {
                    // Inside merge block - just track it
                    currentGroup.mergeList.push(usingObj);
                } else if (currentGroup.grp) {
                    currentGroup.grp.add(usingObj);
                } else {
                    renderModel.add(usingObj);
                }
                
                // Store in variable if specified
                if (usingVar) renderModel.bmDat.variables[usingVar] = usingObj;
            } else {
                console.warn("usegeo: Invalid or missing geometry reference:", varName);
            }
            continue;
        }

        // Handle clone operation: deep copy of any object (mesh, group, light, ...)
        if (mod.startsWith("clone(") && mod.endsWith(")")) {
            const varName = mod.slice(6, -1).trim().replace("$", "");
            const sourceObj = renderModel.bmDat.variables[varName];

            if (sourceObj && sourceObj.isObject3D) {
                usingObj = cloneSceneObject(sourceObj);

                if (currentGroup.merging && usingObj.geometry) {
                    currentGroup.mergeList.push(usingObj);
                } else if (currentGroup.grp) {
                    currentGroup.grp.add(usingObj);
                } else {
                    renderModel.add(usingObj);
                }

                if (usingVar) renderModel.bmDat.variables[usingVar] = usingObj;
            } else {
                console.warn("clone: Invalid or missing object reference:", varName);
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
            { keyword: "ring(", func: createRingOperation },
            { keyword: "text(", func: createTextOperation },
            { keyword: "empty()", func: createGroupOperation },
            { keyword: "decal(", func: createDecalOperation },
            { keyword: "lathe(", func: createLatheOperation },
            { keyword: "pointlight(", func: createPointLightOperation },
            { keyword: "hemispherelight(", func: createHemisphereLightOperation },
            { keyword: "directionallight(", func: createDirectionalLightOperation },
            { keyword: "fakelight(", func: createFakeLightOperation },
            { keyword: "fog(", func: createFogOperation }
        ];

        let handled = false;

        for (const op of ops) {
            if (mod.startsWith(op.keyword)) {
                usingObj = await op.func(mod, renderModel, currentGroup.grp, loader);
                
                // If we're in merge mode, collect geometries instead of adding to scene
                if (currentGroup.merging && usingObj && usingObj.geometry) {
                    currentGroup.mergeList.push(usingObj);
                } else if (usingVar) {
                    renderModel.bmDat.variables[usingVar] = usingObj;
                } else if (usingObj && !currentGroup.grp) {
                    // No variable assignment and no group - add directly to scene
                    // This handles cases like: box(1,1,1) > position(0,5,0)
                    renderModel.add(usingObj);
                }
                
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
            continue;
        }

        if (mod.startsWith("texture(")) {
            (usingVar ? await doTextureOperation(usingVar, mod, renderModel)
                : usingObj && await doTextureOperation(usingObj, mod, renderModel));
            continue;
        }

        // Handle lightmap operation
        if (mod.startsWith("lightmap(")) {
            (usingVar ? await doLightmapOperation(usingVar, mod, renderModel)
                : usingObj && await doLightmapOperation(usingObj, mod, renderModel));
            continue;
        }

        // Handle bumpmap operation
        if (mod.startsWith("bumpmap(")) {
            (usingVar ? await doBumpmapOperation(usingVar, mod, renderModel)
                : usingObj && await doBumpmapOperation(usingObj, mod, renderModel));
            continue;
        }

        // Handle bumpmap operation
        if (mod.startsWith("emissive(")) {
            (usingVar ? await doEmissiveOperation(usingVar, mod, renderModel)
                : usingObj && await doEmissiveOperation(usingObj, mod, renderModel));
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
        if (mod.startsWith("visible(")) {
            (usingVar ? doVisibleOperation(usingVar, mod, renderModel)
                : usingObj && doVisibleOperation(usingObj, mod, renderModel));
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

            storeGeometry(geoName, geometry);
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

/**
 * Creates a merged geometry from a list of meshes
 * @param {Array<Mesh>} meshList - Array of meshes to merge
 * @return {Mesh} A single mesh with merged geometry
 */
function createMergedGeometry(meshList) {
    if (!meshList || meshList.length === 0) {
        console.warn("createMergedGeometry: Empty mesh list");
        return null;
    }

    // Generate cache key based on geometry properties and transforms
    // This enables caching across different model instances
    const hashParts = meshList.map(m => {
        if (!m || !m.geometry) return '';
        
        // Find the storedGeometries key for this geometry
        let geoKey = storedGeometryKeys.get(m.geometry) || null;
        
        // If not found in cache, use geometry type and basic params
        if (!geoKey) {
            geoKey = `${m.geometry.type}_${m.geometry.uuid}`;
        }
        
        // Include transform data in hash
        const pos = m.position;
        const rot = m.rotation;
        const scl = m.scale;
        const transform = `p${pos.x.toFixed(3)},${pos.y.toFixed(3)},${pos.z.toFixed(3)}_r${rot.x.toFixed(3)},${rot.y.toFixed(3)},${rot.z.toFixed(3)}_s${scl.x.toFixed(3)},${scl.y.toFixed(3)},${scl.z.toFixed(3)}`;
        
        return `${geoKey}@${transform}`;
    }).join('|');
    
    const geoHash = `merged_${hash(hashParts)}`;
    
    // Check if this exact merge already exists
    if (storedGeometries[geoHash]) {
        const defaultMaterial = internMaterial(MeshLambertMaterial, { color: DEF_MODEL_COLOR });
        return new Mesh(storedGeometries[geoHash], defaultMaterial);
    }

    // Extract geometries and apply transforms
    const geometriesToMerge = [];
    
    for (const mesh of meshList) {
        if (mesh && mesh.geometry) {
            // Clone geometry to preserve original
            const geo = mesh.geometry.clone();
            
            // Update the mesh's matrix to include position, rotation, scale
            mesh.updateMatrix();
            
            // Apply mesh's transform matrix to the geometry vertices
            geo.applyMatrix4(mesh.matrix);
            
            geometriesToMerge.push(geo);
        }
    }

    if (geometriesToMerge.length === 0) {
        console.warn("createMergedGeometry: No valid geometries to merge");
        return null;
    }

    // Merge all geometries into one
    const mergedGeometry = mergeGeometries(geometriesToMerge, false);
    
    // Cache the merged geometry
    storeGeometry(geoHash, mergedGeometry);
    
    // Create mesh with default material (user can override with material() operation)
    const defaultMaterial = internMaterial(MeshLambertMaterial, { color: DEF_MODEL_COLOR });
    const mergedMesh = new Mesh(mergedGeometry, defaultMaterial);
    
    return mergedMesh;
}

// Cache for parsed expressions to avoid re-parsing
const _expressionCache = new Map();
const _simpleVarRegex = /^(-?)\$(\w+)$/;
const _mathRegex = /[+\-*/()]/;
const _varRegex = /\$\w+/;

/**
 * Clears all performance caches. Call this when variables change significantly.
 */
function clearModValueCaches() {
    _expressionCache.clear();
}

/**
 * Clears animation caches for a specific model
 */
function clearAnimationCaches(renderModel) {
    if (renderModel && renderModel.bmDat && renderModel.bmDat.animations) {
        for (const animationSet of Object.values(renderModel.bmDat.animations)) {
            if (Array.isArray(animationSet)) {
                for (const animation of animationSet) {
                    if (animation && typeof animation.clearCache === 'function') {
                        animation.clearCache();
                    }
                }
            }
        }
    }
}

/**
 * Returns the value of a variable or expression, resolving any variable references.
 * Supports simple math expressions and variable references in the form of $varName.
 * Handles circular references by returning 0 and logging a warning.
 * Optimized for animation performance with caching and early returns.
 * @param {string|number} val The value or expression to evaluate.
 * @param {RenderBasicModel} renderModel The model containing variable definitions.
 * @param {Set} visited A set to track visited variable names to prevent circular references.
 * @return {number|string} The resolved value, which can be a number, string, or expression result.
 */
function getModValue(val, renderModel, visited = new Set()) {
    // Early return for non-strings
    if (typeof val !== 'string') return val;

    // Get merged variables once (avoid object spreading in hot path)
    const variables = renderModel.bmDat.variables || {};
    const overrides = renderModel.bmDat.variableOverrides || {};
    
    function resolveVar(key) {
        if (visited.has(key)) {
            console.warn(`Circular reference detected for variable: ${key}`);
            return 0;
        }

        // Check overrides first, then variables
        let value = overrides[key];
        if (typeof value === 'undefined') {
            value = variables[key];
        }
        if (typeof value === 'undefined') return 0;

        // `visited` is the current reference CHAIN, not everything seen so far: a key
        // is only circular if it appears in its own ancestry. Removing it after the
        // recursion lets two terms share a variable ($b=$a+$tile, $a=$tile*2) without
        // that reuse being mistaken for a cycle and silently resolved to 0.
        visited.add(key);
        try {
            return getModValue(value, renderModel, visited);
        } finally {
            visited.delete(key);
        }
    }

    // Fast path: simple variable reference ($foo or -$foo)
    const varOnlyMatch = val.match(_simpleVarRegex);
    if (varOnlyMatch) {
        const [, neg, varName] = varOnlyMatch;
        const resolved = resolveVar(varName);
        return typeof resolved === 'number' && neg === '-' ? -resolved : resolved;
    }

    // Fast path: check if it contains math or variables
    const hasMath = _mathRegex.test(val);
    const hasVars = _varRegex.test(val);
    
    if (!hasMath && !hasVars) {
        // Simple literal value - only convert to number if it's a pure numeric string
        // Preserve strings that might contain delimiters like "|", ",", ":", ";" for splitting
        const parsed = parseFloat(val);
        if (isNaN(parsed) || val.includes('|') || val.includes(',') || val.includes(';') || val.includes(':')) {
            return val; // Keep as string for splitting operations
        }
        return parsed;
    }

    // Need to evaluate expression - check cache first
    let expr = _expressionCache.get(val);
    if (!expr) {
        try {
            // Replace $var with real variable names (expr-eval expects bare names)
            const cleanExpr = val.replace(/\$(\w+)/g, (_, name) => name);
            expr = parser.parse(cleanExpr);
            
            // Cache the parsed expression (limit cache size to prevent memory leaks)
            if (_expressionCache.size >= 1000) {
                _expressionCache.clear(); // Simple cache eviction
            }
            _expressionCache.set(val, expr);
        } catch (e) {
            console.warn(`Failed to parse expression: ${val}`, e);
            return val;
        }
    }

    try {
        // Create scope object for variable resolution
        const scope = {};
        
        // Pre-populate scope with resolved variables to avoid proxy overhead
        val.replace(/\$(\w+)/g, (_, name) => {
            if (!(name in scope)) {
                scope[name] = resolveVar(name);
            }
            return name;
        });
        
        return expr.evaluate(scope);
    } catch (e) {
        console.warn(`Failed to evaluate expression: ${val}`, e);
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

            storeGeometry(geoName, geometry);
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

            storeGeometry(geoName, geometry);
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

async function createRingOperation(code, renderModel, currentGroup, loader) {
    let raw = code.replace("ring(","");
    raw = raw.replace(")","");

    const parts = raw.split(",");

    let useMaterial = loader.defMaterial || "lambert";

    if(parts.length >= 2) {

        const innerRadius = getModValue(parts[0], renderModel);
        const outerRadius = getModValue(parts[1], renderModel);
        const thetaSegments = parts.length >= 3 ? getModValue(parts[2], renderModel) : 32;

        let geoName = "ring." + innerRadius + "." + outerRadius + "." + thetaSegments + "." + renderModel.bmDat.geoTranslate.x + "." + renderModel.bmDat.geoTranslate.y + "." + renderModel.bmDat.geoTranslate.z;

        let geometry = null;

        if(storedGeometries[geoName]) {
            geometry = storedGeometries[geoName];
        } else {
            geometry = new RingGeometry(innerRadius, outerRadius, thetaSegments);

            geometry.translate(renderModel.bmDat.geoTranslate.x, renderModel.bmDat.geoTranslate.y, renderModel.bmDat.geoTranslate.z);

            storeGeometry(geoName, geometry);
        }

        if(parts.length > 5) {
            useMaterial = parts[5].trim();
        }

        return await setupNewMaterial(renderModel, geometry, currentGroup, parts[3] || null, parts[4] || null, useMaterial, true, DoubleSide);
    }

    return null;
}

async function createTextOperation(code, renderModel, currentGroup, loader) {
    let raw = code.replace("text(","");
    raw = raw.replace(")","");

    const parts = raw.split(",");

    let useMaterial = loader.defMaterial || "lambert";

    if(parts.length >= 1) {
        let text = getModValue(parts[0], renderModel);
        const size = parts.length >= 2 ? getModValue(parts[1], renderModel) : 1;
        const height = parts.length >= 3 ? getModValue(parts[2], renderModel) : 0.2;
        const bevelSize = parts.length >= 4 ? getModValue(parts[3], renderModel) : 0.02;
        const bevelThickness = parts.length >= 5 ? getModValue(parts[4], renderModel) : 0.01;

        // Custom font URL support (parameter index 8)
        // Default font URL (helvetiker from three.js examples)
        let fontUrl = 'https://threejs.org/examples/fonts/helvetiker_regular.typeface.json';
        
        if(parts.length >= 9 && parts[8].trim()) {
            fontUrl = getModValue(parts[8].trim(), renderModel);
        }
        
        // Load font if not cached
        if(!loadedFonts[fontUrl]) {
            const fontLoader = new FontLoader();
            try {
                loadedFonts[fontUrl] = await new Promise((resolve, reject) => {
                    fontLoader.load(fontUrl, resolve, undefined, reject);
                });
            } catch(e) {
                console.warn("Failed to load font:", e);
                return null;
            }
        }

        const font = loadedFonts[fontUrl];

        // Generate cache key (include font URL to prevent geometry reuse across different fonts)
        const fontHash = hash(fontUrl);
        let geoName = "text." + text + "." + size + "." + height + "." + bevelSize + "." + bevelThickness + "." + fontHash + "." + renderModel.bmDat.geoTranslate.x + "." + renderModel.bmDat.geoTranslate.y + "." + renderModel.bmDat.geoTranslate.z;

        let geometry = null;

        if(storedGeometries[geoName]) {
            geometry = storedGeometries[geoName];
        } else {
            geometry = new TextGeometry(text, {
                font: font,
                size: parseFloat(size),
                depth: parseFloat(height),
                curveSegments: 12,
                bevelEnabled: bevelSize > 0 && bevelThickness > 0,
                bevelThickness: parseFloat(bevelThickness),
                bevelSize: parseFloat(bevelSize),
                bevelOffset: 0,
                bevelSegments: 5
            });

            geometry.translate(renderModel.bmDat.geoTranslate.x, renderModel.bmDat.geoTranslate.y, renderModel.bmDat.geoTranslate.z);

            storeGeometry(geoName, geometry);
        }

        if(parts.length > 7) {
            useMaterial = parts[7].trim();
        }

        return await setupNewMaterial(renderModel, geometry, currentGroup, parts[5] || null, parts[6] || null, useMaterial, true, undefined);
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

            storeGeometry(geoName, geometry);
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

            storeGeometry(geoName, geometry);
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
        storeGeometry(geoName, geometry);
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
            storeGeometry(geoName, geometry);
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
    let capMode = "closed";

    if(parts.length >= 4) {

        radTop = getModValue(parts[0], renderModel);
        radBottom = getModValue(parts[1], renderModel);
        height = getModValue(parts[2], renderModel);
        segs = getModValue(parts[3], renderModel);

        if(parts.length > 7) {
            capMode = parts[7].trim();
        }

        const normalizedCapMode = normalizeCylinderCapMode(capMode);
        let geoName = "cylinder." + radTop + "." + radBottom + "." + height + "." + segs + "." + normalizedCapMode + "." + renderModel.bmDat.geoTranslate.x + "." + renderModel.bmDat.geoTranslate.y + "." + renderModel.bmDat.geoTranslate.z;

        let geometry = null;

        if(storedGeometries[geoName]) {
            geometry = storedGeometries[geoName];
        } else {
            geometry = createCylinderGeometryWithCaps(radTop, radBottom, height, segs, normalizedCapMode);

            geometry.translate(renderModel.bmDat.geoTranslate.x, renderModel.bmDat.geoTranslate.y, renderModel.bmDat.geoTranslate.z);

            storeGeometry(geoName, geometry);
        }

        if(parts.length > 6) {
            useMaterial = parts[6].trim();
        }

        return await setupNewMaterial(renderModel, geometry, currentGroup, parts[4] || null, parts[5] || null, useMaterial);
    }

    return null;
}

function normalizeCylinderCapMode(capMode) {
    if(!capMode) {
        return "closed";
    }

    const normalized = String(capMode).trim().toLowerCase();

    if(normalized === "open" || normalized === "openended" || normalized === "open-ended") {
        return "open";
    }

    if(normalized === "opentop") {
        return "openTop";
    }

    if(normalized === "openbottom") {
        return "openBottom";
    }

    if(normalized === "closed") {
        return "closed";
    }

    return normalized;
}

function createCylinderGeometryWithCaps(radTop, radBottom, height, segs, capMode) {
    const normalizedCapMode = normalizeCylinderCapMode(capMode);

    if(normalizedCapMode === "closed") {
        return new CylinderGeometry(radTop, radBottom, height, segs, 1, false);
    }

    // Native CylinderGeometry supports only fully closed or fully open-ended caps.
    // Treat partial cap modes as open-ended to avoid custom-merge shading artifacts.
    return new CylinderGeometry(radTop, radBottom, height, segs, 1, true);
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

function getMaterialSideFromMode(sideMode) {
    if(!sideMode) {
        return undefined;
    }

    const normalized = String(sideMode).trim().toLowerCase();

    if(normalized === "double" || normalized === "doubleside" || normalized === "double-sided") {
        return DoubleSide;
    }

    if(normalized === "back" || normalized === "backside") {
        return BackSide;
    }

    if(normalized === "front" || normalized === "frontside") {
        return FrontSide;
    }

    return undefined;
}

function doRotateOperation(id,code,renderModel) {

    let obid = id;

    if(typeof id == "string" && renderModel.bmDat.variables[id]) {
        obid = renderModel.bmDat.variables[id];
    }

    if(!obid || !obid.rotation) {
        console.warn("Invalid object for rotate operation:", id);
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

    let opVal = parseFloat(raw);

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
        makeMaterialWritable(obid);

        if(Array.isArray(obid.material)) {
            for(const mat of obid.material) {
                if(mat) {
                    mat.opacity = opVal;
                    mat.transparent = true;
                }
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

    if(!obid || !obid.scale) {
        console.warn("Invalid object for scale operation:", id);
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

function doVisibleOperation(id, code, renderModel) {

    let obid = id;

    if(typeof id == "string" && renderModel.bmDat.variables[id]) {
        obid = renderModel.bmDat.variables[id];
    }

    if(!obid) {
        return;
    }

    let raw = code.replace("visible(","");
    raw = raw.replace(")","");

    const value = getModValue(raw, renderModel);

    // Support both boolean-like values: 0/1, true/false, "true"/"false"
    if(value === 0 || value === "0" || value === false || value === "false") {
        obid.visible = false;
    } else if(value === 1 || value === "1" || value === true || value === "true") {
        obid.visible = true;
    }
}

async function getTextureMaterial(textureInstruction, renderModel, transparent, withColor = null, depthWrite = true, useMaterial = "lambert", side = FrontSide) {

    if(!textureInstruction) {
        return null;
    }

    const txInst = textureInstruction.split("|");

    if(txInst.length == 1) {
        const texture = await loadTexture(txInst[0], renderModel);

        let mapOptions = {
            map: texture,
            side: side,
            transparent: transparent,
            depthWrite: depthWrite
        };

        if(withColor && withColor != "transparent") {
            mapOptions.color = withColor;
        }

        const matClass = getMaterialClass(useMaterial);

        return internMaterial(matClass, mapOptions);
    }

    let mapping = [];

    for(let i = 0; i < txInst.length; i++) {
        const texture = await loadTexture(txInst[i], renderModel);

        let mapOptions = {
            map: texture,
            side: side,
            transparent: transparent,
            depthWrite: depthWrite
        };

        if(withColor && withColor != "transparent") {
            mapOptions.color = withColor;
        }

        const matClass = getMaterialClass(useMaterial);

        mapping.push(internMaterial(matClass, mapOptions));
    }
    
    if(mapping.length == 0) {
        return null;
    }

    return mapping;
}

/**
 * Loads a texture based on the provided instruction.
 * @param {string} txInst - The texture instruction string.
 * @param {RenderBasicModel} renderModel - The render model containing texture definitions.
 * @return {Promise<Texture|null>} - A promise that resolves to the loaded texture or null if not found.
 */
async function loadTexture(txInst, renderModel) {
        
    const instParts = txInst.split("&");

    if(instParts.length == 0 || instParts[0].trim().length == 0) {
        return null;
    }

    const txCacheKey = getModelOverrideSignature(renderModel) + "::" + txInst;
    const cachedTexture = internedTextures.get(txCacheKey);

    if(cachedTexture) {
        return cachedTexture;
    }

    const txNameRaw = instParts[0].trim();
    const txName = txNameRaw.substring(1);
    let txDef = renderModel.bmDat.src.textures[txName];

    if(!txDef) {

        const tryVal = getModValue(txNameRaw, renderModel);

        if(tryVal && (tryVal.indexOf("data:") == 0 || tryVal.indexOf("http") == 0)) {
            txDef = {
                type: getTypeFromImageUrl(tryVal),
                data: tryVal,
                frames: 1,
                varName: txName
            };
        } else {
            console.warn("Texture definition not found for:", txNameRaw);
            return null;
        }
    }

    // eventually, to support animated textures
    const frame = 0;

    const tx = await getFrameTexture(txDef, instParts, frame, renderModel);

    if(!tx) {
        return null;
    }

    applyTextureInstructions(tx, instParts, renderModel);

    tx.colorSpace = SRGBColorSpace;
    tx.userData.__bmTxKey = txCacheKey;

    internedTextures.set(txCacheKey, tx);

    return tx;
}

function applyTextureInstructions(texture, instructions, renderModel) {
    if(!texture || !instructions || instructions.length < 2) {
        return;
    }

    let repeatX = null;
    let repeatY = null;
    let offsetX = null;
    let offsetY = null;
    let rotation = null;
    let centerX = null;
    let centerY = null;
    let wrap = null;
    let wrapX = null;
    let wrapY = null;

    for(let i = 1; i < instructions.length; i++) {
        const parts = instructions[i].split("=");

        if(parts.length !== 2) {
            continue;
        }

        const key = parts[0].trim().toLowerCase();
        const value = getModValue(parts[1].trim(), renderModel);

        if(value === undefined || value === null || value === "") {
            continue;
        }

        const numericValue = parseFloat(value);

        if(key === "repeatx" && !isNaN(numericValue)) {
            repeatX = numericValue;
        } else if(key === "repeaty" && !isNaN(numericValue)) {
            repeatY = numericValue;
        } else if(key === "offsetx" && !isNaN(numericValue)) {
            offsetX = numericValue;
        } else if(key === "offsety" && !isNaN(numericValue)) {
            offsetY = numericValue;
        } else if(key === "rotation" && !isNaN(numericValue)) {
            rotation = numericValue;
        } else if(key === "centerx" && !isNaN(numericValue)) {
            centerX = numericValue;
        } else if(key === "centery" && !isNaN(numericValue)) {
            centerY = numericValue;
        } else if(key === "wrap") {
            wrap = value;
        } else if(key === "wrapx") {
            wrapX = value;
        } else if(key === "wrapy") {
            wrapY = value;
        }
    }

    const normalizeWrapMode = (wrapMode) => {
        const normalized = String(wrapMode).trim().toLowerCase();

        if(normalized === "repeat") {
            return RepeatWrapping;
        }

        if(normalized === "mirror" || normalized === "mirrored" || normalized === "mirroredrepeat") {
            return MirroredRepeatWrapping;
        }

        if(normalized === "clamp" || normalized === "clamptoedge") {
            return ClampToEdgeWrapping;
        }

        return null;
    };

    const wrapModeX = normalizeWrapMode(wrapX || wrap);
    const wrapModeY = normalizeWrapMode(wrapY || wrap);

    if(repeatX !== null || repeatY !== null) {
        texture.wrapS = wrapModeX || RepeatWrapping;
        texture.wrapT = wrapModeY || RepeatWrapping;
        texture.repeat.set(repeatX ?? texture.repeat.x, repeatY ?? texture.repeat.y);
    }

    if(wrapModeX) {
        texture.wrapS = wrapModeX;
    }

    if(wrapModeY) {
        texture.wrapT = wrapModeY;
    }

    if(offsetX !== null || offsetY !== null) {
        texture.offset.set(offsetX ?? texture.offset.x, offsetY ?? texture.offset.y);
    }

    if(centerX !== null || centerY !== null) {
        texture.center.set(centerX ?? texture.center.x, centerY ?? texture.center.y);
    }

    if(rotation !== null) {
        texture.rotation = MathUtils.degToRad(rotation);
    }

    texture.needsUpdate = true;
}

function isTextureInstructionModifier(key) {
    return key === "repeatx"
        || key === "repeaty"
        || key === "offsetx"
        || key === "offsety"
        || key === "rotation"
        || key === "centerx"
    || key === "centery"
    || key === "wrap"
    || key === "wrapx"
    || key === "wrapy";
}

/**
 * Generates a unique cache key for a material based on its properties.
 * @param {Object} options - Material properties to generate key from
 * @return {string} - A unique key string for caching
 */
function generateMaterialKey(options) {
    const parts = [
        options.materialType || 'lambert',
        options.textureHash || 'notex',
        options.color || 'nocol',
        options.transparent ? 't' : 'f',
        options.depthWrite ? 'd' : 'n',
        options.side === DoubleSide ? 'double' : (options.side === undefined ? 'front' : 'other')
    ];
    return parts.join('_');
}

/**
 * Retrieves a texture for a specific frame based on the texture definition and instructions.
 * @param {ModelTexture} txDef - The texture definition containing type and data.
 * @param {Array} instructions - The instructions for modifying the texture.
 * @param {number} frame - The frame number to retrieve the texture for.
 * @param {RenderBasicModel} renderModel - The render model containing texture definitions.
 * @return {Promise<Texture|null>} - A promise that resolves to the loaded texture or null if not found.
 * @description This function handles both static and animated textures, including SVG modifications.
 */
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

                if(parts.length !== 2) {
                    continue;
                }

                if(isTextureInstructionModifier(parts[0].trim().toLowerCase())) {
                    continue;
                }

                const from = getModValue(parts[0],renderModel);
                const to = getModValue(parts[1],renderModel);

                raw = raw.replaceAll("fill:" + from + ";","fill:" + to + ";");
                raw = raw.replaceAll("stroke:" + from + ";","stroke:" + to + ";");
            }
        }

        const blob = new Blob([raw], {type: txDef.type});
        imgURL = URL.createObjectURL(blob);
    }

    const img = await getImageFromStoredCanvas(txDef, imgURL, frame, raw, renderModel);

    if(img) {
        return threeLoader.load(img);
    }

    return null;
}

/**
 * Retrieves an image from a stored canvas or creates a new canvas if not found.
 * @param {ModelTexture} txDef - The texture definition containing type and data.
 * @param {string} imgURL - The URL of the image to load.
 * @param {number} frame - The frame number to retrieve the image for.
 * @param {string} rawImgDat - The raw image data for SVG modifications.
 * @param {RenderBasicModel} renderModel - The render model containing texture definitions.
 * @return {Promise<string|null>} - A promise that resolves to the image data URL or null if not found.
 * @description This function checks if the image is already stored in a canvas. If not, it creates a new canvas, draws the image, and stores it for future use.
 */
async function getImageFromStoredCanvas(txDef, imgURL, frame, rawImgDat, renderModel) {
    const imgName = hash(rawImgDat);

    let imCanvas = null;
    let imContext = null;

    let imgQuality = 0.85;

    if(renderModel && renderModel.bmDat && renderModel.bmDat.loaderRef) {
        imgQuality = renderModel.bmDat.loaderRef.imgQuality || 0.85;
    }

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

            if(imgURL.indexOf("http") == 0 || imgURL.indexOf("https") == 0) {
                image.crossOrigin = "anonymous"; // Handle CORS for external images
            }

            image.src = imgURL;
        },function(){
            console.warn("fail");
        });

    }

    if(txDef.frames == 1) {
        return imCanvas.toDataURL("image/webp", imgQuality);
    }

}

function getTypeFromImageUrl(imgURL) {
    if(imgURL.indexOf("data:image/webp") == 0) {
        return "image/webp";
    }

    if(imgURL.indexOf("data:image/png") == 0) {
        return "image/png";
    }

    if(imgURL.indexOf("data:image/jpeg") == 0) {
        return "image/jpeg";
    }

    if(imgURL.indexOf("data:image/svg") == 0) {
        return "image/svg+xml";
    }

    if(imgURL.indexOf("data:image/gif") == 0) {
        return "image/gif";
    }

    if(imgURL.endsWith(".webp")) {
        return "image/webp";
    }

    if(imgURL.endsWith(".png")) {
        return "image/png";
    }

    if(imgURL.endsWith(".jpg") || imgURL.endsWith(".jpeg")) {
        return "image/jpeg";
    }

    if(imgURL.endsWith(".svg")) {
        return "image/svg+xml";
    }

    if(imgURL.endsWith(".gif")) {
        return "image/gif";
    }

    return "image/webp"; // Default to webp if nothing matches
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

        if(!ob.matrixAutoUpdate) {
            ob.updateMatrix();
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

    // Clear performance caches
    clearModValueCaches();
    clearAnimationCaches(renderModel);

    // Clear scene
    while (renderModel.children.length > 0) {
        renderModel.remove(renderModel.children[0]);
    }

    // Reset data
    renderModel.bmDat.variables = {};
    renderModel.bmDat.animations = {};
    renderModel.bmDat.defaultState = {};
    renderModel.bmDat.mergeGroups = null;

    const currentGroup = {
        grp: null,
        merging: false,
        mergeList: [],
        mergeName: null
    };

    for (const line of renderModel.bmDat._scriptLines) {
        await negotiateInstructionLine(line, renderModel, currentGroup, renderModel.bmDat.loaderRef, false);
    }

    if (currentGroup.grp) {
        renderModel.add(currentGroup.grp);
        currentGroup.grp = null;
    }

    renderModel.saveState();
    finalizeRenderModel(renderModel);
}

/**
 * Clones a RenderBasicModel by recursively cloning its three.js hierarchy.
 * Shares geometries and materials for optimal performance.
 * @param {RenderBasicModel} sourceModel - The model to clone
 * @param {Object} variableOverrides - Optional variable overrides for the clone
 * @return {RenderBasicModel} A new model instance sharing geometries and materials
 */
function cloneRenderModel(sourceModel, variableOverrides = null) {
    // Safety check - ensure source model is valid
    if (!sourceModel || !sourceModel.bmDat || !sourceModel.bmDat.src) {
        console.error("cloneRenderModel: Invalid source model", sourceModel);
        return null;
    }
    
    const clone = new RenderBasicModel(sourceModel.bmDat.src, sourceModel.bmDat.loaderRef);
    
    // Copy model data properties (but not variables yet - we'll rebuild those)
    clone.bmDat.variables = {}; // Will be populated during cloning
    clone.bmDat.geoTranslate = { ...sourceModel.bmDat.geoTranslate };
    clone.bmDat.cacheKey = sourceModel.bmDat.cacheKey;
    clone.bmDat._scriptLines = sourceModel.bmDat._scriptLines ? [...sourceModel.bmDat._scriptLines] : null;
    // Fog is data rather than a graph node, so cloneObject3D() cannot carry it and it has
    // to be copied explicitly like every other bmDat field.
    clone.bmDat.fog = sourceModel.bmDat.fog ? { ...sourceModel.bmDat.fog } : null;
    
    // Apply variable overrides if provided
    if (variableOverrides) {
        for (let varName in variableOverrides) {
            clone.bmDat.variableOverrides[varName] = variableOverrides[varName];
        }
    } else {
        clone.bmDat.variableOverrides = { ...sourceModel.bmDat.variableOverrides };
    }
    
    // Deep clone animations
    clone.bmDat.animations = {};
    for (let aniName in sourceModel.bmDat.animations) {
        const sourceAni = sourceModel.bmDat.animations[aniName];
        if (Array.isArray(sourceAni)) {
            clone.bmDat.animations[aniName] = sourceAni.map(inst => {
                const clonedInst = new RenderAnimation(inst.src);
                clonedInst.target = inst.target;
                clonedInst.action = inst.action;
                clonedInst.speed = inst.speed;
                clonedInst.steps = [...inst.steps];
                return clonedInst;
            });
        }
    }
    
    // Clone the three.js hierarchy (meshes, groups, etc.)
    // This shares geometries but clones materials to prevent color mixing bugs
    function cloneObject3D(source, parent) {
        source.children.forEach(child => {
            let clonedChild;
            
            if (child instanceof Mesh) {
                // Share geometry always, and share interned materials too; only
                // model-specific (already unshared) materials get cloned per instance.
                const cloneMaterial = (mat) => (mat && mat.userData.__bmShared) ? mat : mat.clone();

                const clonedMaterial = Array.isArray(child.material)
                    ? child.material.map(cloneMaterial)
                    : cloneMaterial(child.material);
                    
                clonedChild = new Mesh(child.geometry, clonedMaterial);
                clonedChild.position.copy(child.position);
                clonedChild.rotation.copy(child.rotation);
                clonedChild.scale.copy(child.scale);
                clonedChild.userData = { ...child.userData };
                
                // Copy custom properties
                if (child.name) clonedChild.name = child.name;
                if (child.visible !== undefined) clonedChild.visible = child.visible;
                if (child.castShadow !== undefined) clonedChild.castShadow = child.castShadow;
                if (child.receiveShadow !== undefined) clonedChild.receiveShadow = child.receiveShadow;
                
            } else if (child instanceof PointLight) {
                // Skip lights entirely if disabled in loader (major performance boost)
                if (sourceModel.bmDat.loaderRef && sourceModel.bmDat.loaderRef.enableLights === false) {
                    return; // Don't clone lights when disabled
                }
                
                // Create new point light with same properties (avoid expensive clone)
                clonedChild = new PointLight(child.color, child.intensity, child.distance, child.decay);
                clonedChild.position.copy(child.position);
                clonedChild.rotation.copy(child.rotation);
                clonedChild.scale.copy(child.scale);
                
                // Copy light-specific properties
                clonedChild.castShadow = false; // Always disable shadows for performance
                if (child.name) clonedChild.name = child.name;
                if (child.visible !== undefined) clonedChild.visible = child.visible;
                
            } else if (child instanceof HemisphereLight) {
                // Skip lights entirely if disabled in loader (major performance boost)
                if (sourceModel.bmDat.loaderRef && sourceModel.bmDat.loaderRef.enableLights === false) {
                    return; // Don't clone lights when disabled
                }

                // HemisphereLight copies cleanly: sky, ground and intensity are all plain
                // properties, so there is no trap here the way there is for a directional.
                clonedChild = new HemisphereLight(child.color, child.groundColor, child.intensity);
                clonedChild.position.copy(child.position);
                clonedChild.rotation.copy(child.rotation);
                clonedChild.scale.copy(child.scale);

                clonedChild.castShadow = false; // Always disable shadows for performance
                if (child.name) clonedChild.name = child.name;
                if (child.visible !== undefined) clonedChild.visible = child.visible;

            } else if (child instanceof DirectionalLight) {
                // Skip lights entirely if disabled in loader (major performance boost)
                if (sourceModel.bmDat.loaderRef && sourceModel.bmDat.loaderRef.enableLights === false) {
                    return; // Don't clone lights when disabled
                }

                // The target is re-linked after this light's children are cloned, below.
                clonedChild = new DirectionalLight(child.color, child.intensity);
                clonedChild.position.copy(child.position);
                clonedChild.rotation.copy(child.rotation);
                clonedChild.scale.copy(child.scale);

                clonedChild.castShadow = false; // Always disable shadows for performance
                if (child.name) clonedChild.name = child.name;
                if (child.visible !== undefined) clonedChild.visible = child.visible;

            } else if (child instanceof Group) {
                // Create new group
                clonedChild = new Group();
                clonedChild.position.copy(child.position);
                clonedChild.rotation.copy(child.rotation);
                clonedChild.scale.copy(child.scale);
                clonedChild.userData = { ...child.userData };
                
                if (child.name) clonedChild.name = child.name;
            } else {
                // For other object types, use three.js clone
                clonedChild = child.clone();
            }
            
            parent.add(clonedChild);
            
            // Update variable references if this object was stored
            for (let varName in sourceModel.bmDat.variables) {
                if (sourceModel.bmDat.variables[varName] === child) {
                    clone.bmDat.variables[varName] = clonedChild;
                }
            }
            
            // Recursively clone children
            if (child.children && child.children.length > 0) {
                cloneObject3D(child, clonedChild);
            }

            // A directional light aims at its target, and the target has to be part of the
            // CLONE's own graph. Without this re-link the clone keeps pointing at the
            // template's target, which is never added to a scene — so its world matrix is
            // never refreshed and the aim silently collapses to the world origin. Doing it
            // here (after the children are cloned) is what makes the cloned target exist.
            if (clonedChild instanceof DirectionalLight) {
                const clonedTarget = clonedChild.children.find(
                    (c) => c.userData && c.userData.bmLightTarget
                );
                if (clonedTarget) clonedChild.target = clonedTarget;
            }
        });
    }
    
    cloneObject3D(sourceModel, clone);
    
    // Copy any non-object variables (primitive values, strings, numbers)
    for (let varName in sourceModel.bmDat.variables) {
        const value = sourceModel.bmDat.variables[varName];
        // Only copy if it's not already set (not a cloned object) and it's a primitive
        if (!clone.bmDat.variables[varName]) {
            if (typeof value !== 'object' || value === null) {
                clone.bmDat.variables[varName] = value;
            }
        }
    }
    
    // Save default state for animations
    clone.saveState();
    finalizeRenderModel(clone);
    
    return clone;
}

function addDecalToObject(obj, material, position = { x: 0, y: 0, z: 0 }, orientation = { x: 0, y: 0, z: 0 }, scale = { x: 1, y: 1, z: 1 }) {
    if (!obj || !material) return;

    const decalGeo = new DecalGeometry(obj, new Vector3(position.x, position.y, position.z), new Euler(orientation.x, orientation.y, orientation.z), new Vector3(scale.x, scale.y, scale.z));
    const decalMesh = new Mesh(decalGeo, material);

    obj.attach(decalMesh);

    return decalMesh;
}

function getMaterialClass(matname) {
    if(matname === undefined || matname === null) {
        return MeshLambertMaterial;
    }

    const normalized = String(matname).trim();

    if(normalized.length === 0) {
        return MeshLambertMaterial;
    }

    if(normalized == "lambert" || normalized == "MeshLambertMaterial") {
        return MeshLambertMaterial;
    }

    if(normalized == "phong" || normalized == "MeshPhongMaterial") {
        return MeshPhongMaterial;
    }

    if(normalized == "standard" || normalized == "MeshStandardMaterial") {
        return MeshStandardMaterial;
    }

    if(normalized == "toon" || normalized == "MeshToonMaterial") {
        return MeshToonMaterial;
    }

    if(normalized == "basic" || normalized == "MeshBasicMaterial") {
        return MeshBasicMaterial;
    }

    return MeshBasicMaterial;
}

function createPointLightOperation(code, renderModel, currentGroup, loader) {
    // PERFORMANCE NOTE: PointLights are expensive in Three.js as they require per-pixel lighting calculations.
    // For better performance, consider:
    // - Using emissive materials instead: material(#color,0,0,0) for glowing effects
    // - Baking lighting into textures using lightmap() for static scenes
    // - Using MeshBasicMaterial (set defMaterial: "basic" in loader options) which ignores lights
    // - Setting enableLights: false in loader options to disable all lights
    
    // Skip light creation if lights are disabled
    if (loader && loader.enableLights === false) {
        return null;
    }
    
    let raw = code.replace("pointlight(","");
    raw = raw.replace(")","");

    const parts = raw.split(",");

    let color = "#ffffff";
    let intensity = 1;
    let distance = 10; // Default to limited range for performance (was 0 = infinite)
    let decay = 2;

    if(parts.length >= 1 && parts[0].trim()) {
        color = getModValue(parts[0], renderModel);
    }

    if(parts.length >= 2 && parts[1].trim()) {
        intensity = getModValue(parts[1], renderModel);
    }

    if(parts.length >= 3 && parts[2].trim()) {
        distance = getModValue(parts[2], renderModel);
    }

    if(parts.length >= 4 && parts[3].trim()) {
        decay = getModValue(parts[3], renderModel);
    }

    const light = new PointLight(color, intensity, distance, decay);
    light.castShadow = false;

    if(currentGroup) {
        currentGroup.add(light);
    } else {
        renderModel.add(light);
    }

    return light;
}

/**
 * Places a light in the model.
 *
 * three.js collects lights by traversing the scene graph, so a light parented anywhere
 * under the model starts lighting the scene the moment the engine adds the model. That is
 * why these operations need no engine plumbing at all — unlike fog, which has no object
 * to parent.
 */
function addLightToModel(light, renderModel, currentGroup) {
    if(currentGroup) {
        currentGroup.add(light);
    } else {
        renderModel.add(light);
    }
}

/**
 * hemispherelight([skyColor], [groundColor], [intensity])
 *
 * A sky/ground light pair: sky colours whatever faces up, ground whatever faces down, the
 * two blending by surface normal. Much cheaper than pointlight() — one per-pixel blend
 * with no positional falloff — which makes it the natural fill for a lane.
 */
function createHemisphereLightOperation(code, renderModel, currentGroup, loader) {
    if (loader && loader.enableLights === false) {
        return null;
    }

    const parts = code.replace("hemispherelight(","").replace(")","").split(",");

    let skyColor = "#ffffff";
    let groundColor = "#444444";
    let intensity = 1;

    if(parts.length >= 1 && parts[0].trim()) {
        skyColor = getModValue(parts[0], renderModel);
    }

    if(parts.length >= 2 && parts[1].trim()) {
        groundColor = getModValue(parts[1], renderModel);
    }

    if(parts.length >= 3 && parts[2].trim()) {
        intensity = Number(getModValue(parts[2], renderModel));
    }

    const light = new HemisphereLight(skyColor, groundColor, intensity);
    light.castShadow = false;

    addLightToModel(light, renderModel, currentGroup);

    return light;
}

/**
 * directionallight([color], [intensity], [dirX], [dirY], [dirZ])
 *
 * A sun-like light, aimed by the direction it travels (default straight down).
 *
 * ⚠️ THE TARGET TRAP — read before "simplifying" the code below.
 * A DirectionalLight's aim is its target's WORLD position minus its own, and three.js only
 * refreshes the world matrix of a target that is in the scene graph. A target that is
 * merely positioned — the obvious implementation — is silently ignored and the light aims
 * at the world origin instead, whatever the file says. THREE's own .clone() copies
 * target.position, so it inspects as correct and renders as wrong.
 *
 * Parenting the target TO THE LIGHT fixes this and reads better: the target offset
 * becomes the light's own local aim vector, and as a child it is always in the graph and
 * always updated with the model.
 *
 * Shadows stay with the engine (castShadow = false): a lane owns colour, intensity and
 * direction, not shadow-map budget.
 */
function createDirectionalLightOperation(code, renderModel, currentGroup, loader) {
    if (loader && loader.enableLights === false) {
        return null;
    }

    const parts = code.replace("directionallight(","").replace(")","").split(",");

    let color = "#ffffff";
    let intensity = 1;
    let dirX = 0;
    let dirY = -1; // travelling straight down
    let dirZ = 0;

    if(parts.length >= 1 && parts[0].trim()) {
        color = getModValue(parts[0], renderModel);
    }

    if(parts.length >= 2 && parts[1].trim()) {
        intensity = Number(getModValue(parts[1], renderModel));
    }

    if(parts.length >= 3 && parts[2].trim()) {
        dirX = Number(getModValue(parts[2], renderModel));
    }

    if(parts.length >= 4 && parts[3].trim()) {
        dirY = Number(getModValue(parts[3], renderModel));
    }

    if(parts.length >= 5 && parts[4].trim()) {
        dirZ = Number(getModValue(parts[4], renderModel));
    }

    const light = new DirectionalLight(color, intensity);
    light.castShadow = false;

    // The target is a CHILD of the light — see THE TARGET TRAP above. cloneObject3D()
    // re-links each clone to its own copy of this node by this marker.
    light.target.name = "__bmDirlightTarget";
    light.target.userData.bmLightTarget = true;
    light.target.position.set(dirX, dirY, dirZ);
    light.add(light.target);

    addLightToModel(light, renderModel, currentGroup);

    return light;
}

/**
 * fog([color], [near], [far])
 *
 * Declares scene fog — and is the one operation here that is NOT an object.
 *
 * Fog lives on THREE.Scene (scene.fog) and this loader never holds a Scene reference, so
 * there is nothing to parent it to and nothing for cloneObject3D() to copy. It is recorded
 * as data on bmDat for the engine to apply:
 *
 *     const fog = model.bmDat.fog;   // { color, near, far } or null
 *
 * Use it standalone. It has no position, so a transform after it does nothing.
 */
function createFogOperation(code, renderModel, currentGroup, loader) {
    const parts = code.replace("fog(","").replace(")","").split(",");

    let color = "#ffffff";
    let near = 1;
    let far = 100;

    if(parts.length >= 1 && parts[0].trim()) {
        color = getModValue(parts[0], renderModel);
    }

    if(parts.length >= 2 && parts[1].trim()) {
        near = Number(getModValue(parts[1], renderModel));
    }

    if(parts.length >= 3 && parts[2].trim()) {
        far = Number(getModValue(parts[2], renderModel));
    }

    renderModel.bmDat.fog = { color, near, far };

    // Deliberately returns nothing: fog is not an object, so there is no node to add, no
    // transform to chain onto it, and nothing to store in a variable.
    return null;
}

/**
 * Creates a fake light sprite with radial gradient for performance.
 * Much faster than real point lights - perfect for visual glow effects.
 */
// eslint-disable-next-line no-unused-vars
function createFakeLightOperation(code, renderModel, currentGroup, loader) {
    let raw = code.replace("fakelight(","");
    raw = raw.replace(")","");

    const parts = raw.split(",");

    let color = "#ffffff";
    let size = 1;
    let intensity = 1;

    if(parts.length >= 1 && parts[0].trim()) {
        color = getModValue(parts[0], renderModel);
    }

    if(parts.length >= 2 && parts[1].trim()) {
        size = getModValue(parts[1], renderModel);
    }

    if(parts.length >= 3 && parts[2].trim()) {
        intensity = getModValue(parts[2], renderModel);
    }

    // Generate cache key for gradient texture based on color and intensity
    const textureKey = `fakelight_${color}_${intensity}`;
    
    let texture = null;

    if(storedImageCanvases[textureKey]) {
        // Use cached texture
        texture = internedTextures.get(textureKey);

        if(!texture) {
            texture = new Texture(storedImageCanvases[textureKey]);
            texture.userData.__bmTxKey = textureKey;
            texture.needsUpdate = true;
            internedTextures.set(textureKey, texture);
        }
    } else {
        // Generate radial gradient texture
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        
        const centerX = 64;
        const centerY = 64;
        const radius = 64;
        
        const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);
        
        // Parse color and apply intensity
        const colorObj = new Color(color);
        const r = Math.min(255, Math.floor(colorObj.r * 255 * intensity));
        const g = Math.min(255, Math.floor(colorObj.g * 255 * intensity));
        const b = Math.min(255, Math.floor(colorObj.b * 255 * intensity));
        
        gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, 1)`);
        gradient.addColorStop(0.3, `rgba(${r}, ${g}, ${b}, 0.8)`);
        gradient.addColorStop(0.6, `rgba(${r}, ${g}, ${b}, 0.3)`);
        gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
        
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 128, 128);
        
        // Cache the canvas
        storedImageCanvases[textureKey] = canvas;
        
        texture = new Texture(canvas);
        texture.userData.__bmTxKey = textureKey;
        texture.needsUpdate = true;
        internedTextures.set(textureKey, texture);
    }
    
    // Create plane geometry for the sprite
    //const geometry = new PlaneGeometry(size, size);
    
    // Create material with additive blending for glow effect
    const matKey = "fakelightmat_" + textureKey;
    let material = internedMaterials.get(matKey);

    if(!material) {
        material = new SpriteMaterial({
            map: texture,
            transparent: true,
            blending: AdditiveBlending
        });
        material.userData.__bmShared = true;
        internedMaterials.set(matKey, material);
    }

    const mesh = new Sprite(material);
    
    // Mark as billboard so it can face camera (if billboard system is added)
    mesh.userData.isFakeLight = true;
    mesh.userData.billboard = true;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.scale.set(size, size, size);

    if(currentGroup) {
        currentGroup.add(mesh);
    } else {
        renderModel.add(mesh);
    }
    
    return mesh;
}

async function createLatheOperation(code, renderModel, currentGroup, loader) {
    let raw = code.replace("lathe(","");
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
        geometry.computeVertexNormals();
        geometry.translate(renderModel.bmDat.geoTranslate.x, renderModel.bmDat.geoTranslate.y, renderModel.bmDat.geoTranslate.z);
        storeGeometry(geoName, geometry);
    }

    if(parts.length > 5) {
        useMaterial = parts[5].trim();
    }

    return await setupNewMaterial(renderModel, geometry, currentGroup, parts[3] || null, parts[4] || null, useMaterial, true, DoubleSide);
}

async function setupNewMaterial(renderModel, geometry, currentGroup, colPart, txPart, useMaterial, depthWrite = true, side = FrontSide) {
    
    if(!geometry) {
        return null;
    }

    if(!side) {
        side = FrontSide;
    }
    
    let mesh = null;
    let material = null;

    if(colPart && colPart.indexOf("$") == 0) {
        colPart = getModValue(colPart, renderModel);
    }

    // texture
    if(txPart && txPart.indexOf("$") == 0) {
        let transparent = false;

        if(colPart == "transparent" || (colPart && colPart.length == 7 && colPart[0] == "#")) {
            transparent = true;
        }

        material = await getTextureMaterial(txPart, renderModel, transparent, colPart, depthWrite, useMaterial, side);
    }
        
    if(!material) {
        const matClass = getMaterialClass(useMaterial);
        const color = (colPart && colPart.length == 7 && colPart[0] == "#") ? colPart : DEF_MODEL_COLOR;

        material = internMaterial(matClass, {
            color: color,
            side: side
        });
    }

    mesh = new Mesh(geometry, material);

    if(currentGroup) {
        currentGroup.add(mesh);
    } else {
        renderModel.add(mesh);
    }

    return mesh;
}

function setMaterialProperty(material, property, value) {
    if(Array.isArray(material)) {
        for(const mat of material) {
            if(mat) {
                mat[property] = value;
            }
        }
    } else if(material) {
        material[property] = value;
    }
}

function rebuildMaterialWithMap(material, texture, textureInstruction) {
    const rebuildSingleMaterial = (sourceMaterial) => {
        if(!sourceMaterial) {
            return sourceMaterial;
        }

        const matClass = sourceMaterial.constructor || MeshLambertMaterial;
        const nextMaterial = new matClass();

        nextMaterial.copy(sourceMaterial);
        nextMaterial.map = texture;
        nextMaterial.color = sourceMaterial.color ? sourceMaterial.color.clone() : new Color("#ffffff");

        if(sourceMaterial.color && sourceMaterial.color.equals(new Color(DEF_MODEL_COLOR))) {
            nextMaterial.color = new Color("#ffffff");
        }

        nextMaterial.name = sourceMaterial.name;
        nextMaterial.userData.__bmShared = false;
        nextMaterial.needsUpdate = true;

        if(textureInstruction && textureInstruction.includes("|") && Array.isArray(material)) {
            return nextMaterial;
        }

        return nextMaterial;
    };

    if(Array.isArray(material)) {
        return material.map(mat => rebuildSingleMaterial(mat));
    }

    return rebuildSingleMaterial(material);
}

function markMaterialNeedsUpdate(material) {
    if(Array.isArray(material)) {
        for(const mat of material) {
            if(mat) {
                mat.needsUpdate = true;
            }
        }
    } else if(material) {
        material.needsUpdate = true;
    }
}

function ensureLightMapUvChannel(object) {
    const applyUvCopy = (mesh) => {
        const geometry = mesh?.geometry;
        const uv = geometry?.attributes?.uv;

        if(!geometry || !uv || !geometry.setAttribute) {
            return;
        }

        if(!geometry.attributes.uv1) {
            geometry.setAttribute("uv1", uv.clone());
        }

        if(!geometry.attributes.uv2) {
            geometry.setAttribute("uv2", uv.clone());
        }
    };

    applyUvCopy(object);

    if(object?.traverse) {
        object.traverse(child => applyUvCopy(child));
    }
}

async function doLightmapOperation(id, code, renderModel) {
    let obid = id;

    if(typeof id == "string" && renderModel.bmDat.variables[id]) {
        obid = renderModel.bmDat.variables[id];
    }

    if(!obid || !obid.material) {
        console.warn("Invalid object for lightmap operation:", id);
        return;
    }

    let raw = code.replace("lightmap(","");
    raw = raw.replace(")","");

    const parts = raw.split(",");

    if(parts.length < 1) {
        console.warn("Lightmap operation requires a texture reference.");
        return;
    }

    const textureRef = parts[0].trim();
    
    if(textureRef && textureRef.indexOf("$") == 0) {
        const texture = await loadTexture(textureRef, renderModel);
        if(texture) {
            texture.channel = 1;
            ensureLightMapUvChannel(obid);
            makeMaterialWritable(obid);
            setMaterialProperty(obid.material, "lightMap", texture);
            markMaterialNeedsUpdate(obid.material);
        } else {
            console.warn("Lightmap texture not found:", textureRef);
        }
    }

    if(parts.length >= 2) {
        const intensityPart = getModValue(parts[1], renderModel);

        if(intensityPart !== undefined && !isNaN(parseFloat(intensityPart))) {
            makeMaterialWritable(obid);
            setMaterialProperty(obid.material, "lightMapIntensity", parseFloat(intensityPart));
            markMaterialNeedsUpdate(obid.material);
        }
    }
}

async function doTextureOperation(id, code, renderModel) {
    let obid = id;

    if(typeof id == "string" && renderModel.bmDat.variables[id]) {
        obid = renderModel.bmDat.variables[id];
    }

    if(!obid || !obid.material) {
        console.warn("Invalid object for texture operation:", id);
        return;
    }

    let raw = code.replace("texture(","");
    raw = raw.replace(")","");

    const textureRef = getModValue(raw.trim(), renderModel);

    if(!textureRef || textureRef.indexOf("$") !== 0) {
        console.warn("Texture operation requires a texture reference.");
        return;
    }

    const texture = await loadTexture(textureRef, renderModel);

    if(!texture) {
        console.warn("Texture not found:", textureRef);
        return;
    }

    obid.material = rebuildMaterialWithMap(obid.material, texture, textureRef);
    markMaterialNeedsUpdate(obid.material);
}

async function doEmissiveOperation(id, code, renderModel) {
    let obid = id;

    if(typeof id == "string" && renderModel.bmDat.variables[id]) {
        obid = renderModel.bmDat.variables[id];
    }

    if(!obid || !obid.material) {
        console.warn("Invalid object for emissive operation:", id);
        return;
    }

    let raw = code.replace("emissive(","");
    raw = raw.replace(")","");

    const parts = raw.split(",");

    if(parts.length < 1) {
        console.warn("Emissive operation requires at least a color value.");
        return;
    }

    const colorPart = getModValue(parts[0], renderModel);
    let intensityPart = 1;

    if(parts.length >= 2) {
        intensityPart = getModValue(parts[1], renderModel);
    }

    makeMaterialWritable(obid);

    if(colorPart && colorPart.length == 7 && colorPart[0] == "#") {
        obid.material.emissive = new Color(colorPart);
    }

    if(intensityPart !== undefined && !isNaN(parseFloat(intensityPart))) {
        obid.material.emissiveIntensity = parseFloat(intensityPart);
    }

    if(Array.isArray(obid.material)) {
        for(const mat of obid.material) {
            if(mat) {
                mat.needsUpdate = true;
            }
        }
    } else {
        obid.material.needsUpdate = true;
    }
}

async function doBumpmapOperation(id, code, renderModel) {
    let obid = id;

    if(typeof id == "string" && renderModel.bmDat.variables[id]) {
        obid = renderModel.bmDat.variables[id];
    }

    if(!obid || !obid.material) {
        console.warn("Invalid object for bumpmap operation:", id);
        return;
    }

    let raw = code.replace("bumpmap(","");
    raw = raw.replace(")","");

    const parts = raw.split(",");

    const textureRef = parts[0].trim();
    
    if(textureRef && textureRef.indexOf("$") == 0) {
        const texture = await loadTexture(textureRef, renderModel);
        if(texture) {
            makeMaterialWritable(obid);
            setMaterialProperty(obid.material, "bumpMap", texture);
            markMaterialNeedsUpdate(obid.material);
        } else {
            console.warn("Bumpmap texture not found:", textureRef);
        }
    }

    if(parts.length >= 2) {
        const intensityPart = getModValue(parts[1], renderModel);

        if(intensityPart !== undefined && !isNaN(parseFloat(intensityPart))) {
            makeMaterialWritable(obid);
            setMaterialProperty(obid.material, "bumpScale", parseFloat(intensityPart));
            markMaterialNeedsUpdate(obid.material);
        }
    }
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

    // Swap in a private copy so other objects sharing this material are unaffected
    makeMaterialWritable(obid);

    let raw = code.replace("material(","");
    raw = raw.replace(")","");

    let color = undefined;
    let shininess = obid.material.shininess || undefined;

    let metalness = undefined;
    let roughness = undefined;

    let emissive = undefined;
    let emissiveIntensity = undefined;
    let sideMode = undefined;

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
        shininess = getModValue(parts[1], renderModel);
    }

    if(parts.length >= 3) {
        metalness = getModValue(parts[2], renderModel);
    }

    if(parts.length >= 4) {
        roughness = getModValue(parts[3], renderModel);
    }

    if(parts.length >= 5) {
        lightMap = getModValue(parts[4], renderModel);

        if(lightMap && lightMap.indexOf("$") == 0) {
            lightMap = await loadTexture(lightMap, renderModel);
        } else {
            lightMap = null;
        }
    }

    if(parts.length >= 6) {
        bumpMap = getModValue(parts[5], renderModel);

        if(bumpMap && bumpMap.indexOf("$") == 0) {
            bumpMap = await loadTexture(bumpMap, renderModel);
        } else {
            bumpMap = null;
        }
    }

    if(parts.length >= 7) {
        emissive = getModValue(parts[6], renderModel);

        if(!emissive || emissive.length < 7 || emissive[0] != "#") {
            emissive = undefined;
        }
    }

    if(parts.length >= 8) {
        emissiveIntensity = getModValue(parts[7], renderModel);
    }

    if(parts.length >= 9) {
        sideMode = getModValue(parts[8], renderModel);
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
        lightMap.channel = 1;
        ensureLightMapUvChannel(obid);
        setMaterialProperty(obid.material, "lightMap", lightMap);
    } else {
        setMaterialProperty(obid.material, "lightMap", null);
    }

    if(bumpMap) {
        setMaterialProperty(obid.material, "bumpMap", bumpMap);
    } else {
        setMaterialProperty(obid.material, "bumpMap", null);
    }

    if(emissive && emissive.length == 7 && emissive[0] == "#") {
        obid.material.emissive = new Color(emissive);
    }

    if(emissiveIntensity !== undefined && !isNaN(parseFloat(emissiveIntensity))) {
        obid.material.emissiveIntensity = parseFloat(emissiveIntensity);
    }

    const side = getMaterialSideFromMode(sideMode);

    if(side !== undefined) {
        if(Array.isArray(obid.material)) {
            for(const mat of obid.material) {
                if(mat) {
                    mat.side = side;
                }
            }
        } else {
            obid.material.side = side;
        }
    }

    if(Array.isArray(obid.material)) {
        for(const mat of obid.material) {
            if(mat) {
                mat.needsUpdate = true;
            }
        }
    } else {
        obid.material.needsUpdate = true;
    }
}

export {  BMLoader, BasicModel, ModelTexture, RenderBasicModel };