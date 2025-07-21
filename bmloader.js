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
    Color,
    FrontSide,
    InstancedMesh,
    Object3D
} from "three";

import { DecalGeometry } from "three/addons/geometries/DecalGeometry.js";
import * as BufferGeometryUtils from "three/addons/utils/BufferGeometryUtils.js"

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
        this.imgQuality = options.imgQuality || 0.85;
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

            if(url.url) {
                options = url;
                url = options.url;
            } else {
                console.log(options);
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
        resetRenderModel(this);
    }

    saveState() {
        saveModelState(this, this);
    }

    restoreState() {
        restoreModelState(this, this);
    }

    /**
     * Optimizes the model for better performance by merging static geometries and using instancing
     * @param {Object} options - Optimization options
     * @param {number} options.instanceThreshold - Minimum number of identical objects needed for instancing (default: 3)
     * @param {boolean} options.preserveAnimated - Whether to preserve animated objects as separate meshes (default: true)
     */
    optimize(options = {}) {
        const { instanceThreshold = 3, preserveAnimated = true } = options;
        
        try {
            console.log('Starting optimization...');
            
            const animatedObjects = new Set();
            
            // Identify animated objects if preserveAnimated is true
            if (preserveAnimated) {
                for (const animations of Object.values(this.bmDat.animations || {})) {
                    if (Array.isArray(animations)) {
                        for (const anim of animations) {
                            animatedObjects.add(anim.target);
                        }
                    }
                }
                console.log('Animated objects to preserve:', Array.from(animatedObjects));
            }
            
            // Collect all meshes and categorize them
            const allMeshes = [];
            const animatedMeshes = [];
            const staticMeshes = [];
            const instanceGroups = new Map();
            
            this.traverse((child) => {
                if (!child.isMesh) return;
                
                allMeshes.push(child);
                const varName = this.findVariableNameForObject(child);
                
                if (preserveAnimated && animatedObjects.has(varName)) {
                    animatedMeshes.push(child);
                    console.log(`Preserving animated object: ${varName}`);
                } else {
                    staticMeshes.push(child);
                    
                    // Group for potential instancing
                    const geometryKey = this.getGeometryKey(child.geometry);
                    const materialKey = this.getMaterialKey(child.material);
                    const combinedKey = `${geometryKey}_${materialKey}`;
                    
                    if (!instanceGroups.has(combinedKey)) {
                        instanceGroups.set(combinedKey, []);
                    }
                    instanceGroups.get(combinedKey).push({
                        mesh: child,
                        varName: varName
                    });
                }
            });
            
            console.log(`Found ${allMeshes.length} meshes total: ${animatedMeshes.length} animated, ${staticMeshes.length} static`);
            
            // Only proceed if we have meshes to optimize
            if (staticMeshes.length === 0) {
                console.log('No static meshes to optimize');
                return;
            }
            
            // Clear current scene but preserve references
            while (this.children.length > 0) {
                this.remove(this.children[0]);
            }
            
            // Add back animated objects unchanged (these maintain their variable references)
            animatedMeshes.forEach(mesh => {
                this.add(mesh);
            });
            
            // Process static objects for optimization
            const processedMeshes = new Set();
            let instancedCount = 0;
            
            for (const [combinedKey, instances] of instanceGroups.entries()) {
                if (instances.length >= instanceThreshold) {
                    console.log(`Creating instanced mesh for ${instances.length} objects with key: ${combinedKey}`);
                    
                    // Create instanced mesh
                    const instancedMesh = this.createInstancedMesh(instances.map(i => i.mesh));
                    this.add(instancedMesh);
                    
                    // Mark these meshes as processed
                    instances.forEach(instance => {
                        processedMeshes.add(instance.mesh);
                        
                        // IMPORTANT: Update variable references to point to the instanced mesh
                        // For now, we'll keep the original reference but mark it as instanced
                        // A more sophisticated approach would create proxy objects
                        if (instance.varName) {
                            // Keep the original object reference for animations
                            // but mark it as part of an instanced mesh
                            const originalMesh = instance.mesh;
                            originalMesh.userData.isInstanced = true;
                            originalMesh.userData.instancedMesh = instancedMesh;
                            originalMesh.userData.instanceIndex = instances.findIndex(i => i.mesh === originalMesh);
                            
                            // Keep the variable reference intact for animations
                            this.bmDat.variables[instance.varName] = originalMesh;
                        }
                    });
                    
                    instancedCount++;
                } else {
                    // Not enough instances, add individually
                    instances.forEach(instance => {
                        if (!processedMeshes.has(instance.mesh)) {
                            this.add(instance.mesh);
                            processedMeshes.add(instance.mesh);
                        }
                    });
                }
            }
            
            console.log(`Optimization completed successfully!`);
            console.log(`- Preserved ${animatedMeshes.length} animated objects`);
            console.log(`- Created ${instancedCount} instanced meshes`);
            console.log(`- Added ${staticMeshes.length - processedMeshes.size} individual static meshes`);
            
        } catch (error) {
            console.error('Optimization failed:', error);
            console.error('Restoring original state...');
            
            // Try to restore original state on failure
            try {
                this.reset();
            } catch (resetError) {
                console.error('Failed to restore original state:', resetError);
            }
        }
    }

    /**
     * A safer, more conservative optimization that only instances truly identical static objects
     * and preserves all variable references for animations. Now smarter about detecting actual
     * animation usage vs theoretical animation potential.
     */
    optimizeSafe(options = {}) {
        const { instanceThreshold = 2, dryRun = true, allowOptimization = false } = options;
        
        console.log('Running smart-safe optimization analysis...');
        
        if (!dryRun && !allowOptimization) {
            console.warn('Optimization disabled by default for safety. Use allowOptimization: true to enable actual changes.');
            return;
        }
        
        try {
            // First, check if there are ANY animations defined in the model
            const hasAnimations = Object.keys(this.bmDat.animations || {}).length > 0;
            console.log(`Model has animations: ${hasAnimations}`);
            
            // For simple models (few objects), use a lower threshold
            const totalMeshes = Array.from(this.children).filter(child => child.isMesh || (child.children && child.children.some(c => c.isMesh))).length;
            let adaptiveThreshold = instanceThreshold;
            
            if (totalMeshes <= 5 && !hasAnimations) {
                adaptiveThreshold = Math.max(2, Math.floor(instanceThreshold / 2));
                console.log(`Simple model detected (${totalMeshes} objects, no animations) - using adaptive threshold: ${adaptiveThreshold}`);
            }
            
            // Identify objects that are ACTUALLY animated (not just potentially)
            const actuallyAnimatedObjects = new Set();
            
            if (hasAnimations) {
                // Only check for animated objects if animations exist
                for (const [animName, animations] of Object.entries(this.bmDat.animations || {})) {
                    console.log(`Processing animation '${animName}':`, animations);
                    if (Array.isArray(animations)) {
                        for (const anim of animations) {
                            console.log(`  - Animation instruction targets: '${anim.target}'`);
                            actuallyAnimatedObjects.add(anim.target);
                        }
                    }
                }
                console.log('Actually animated objects:', Array.from(actuallyAnimatedObjects));
            } else {
                console.log('No animations defined - all named objects are safe to optimize');
            }
            
            // Find groups of identical meshes for optimization
            const instanceCandidates = new Map();
            const meshInfo = [];
            let optimizableMeshes = 0;
            
            this.traverse((child) => {
                if (!child.isMesh) return;
                
                const varName = this.findVariableNameForObject(child);
                const hasVariableName = !!varName;
                
                // Determine if this object is actually animated
                let isActuallyAnimated = false;
                
                if (hasAnimations && hasVariableName) {
                    // Check if this specific object is animated
                    isActuallyAnimated = actuallyAnimatedObjects.has(varName);
                    
                    // If not directly animated, check if any parent object is animated
                    if (!isActuallyAnimated) {
                        let parent = child.parent;
                        while (parent && parent !== this) {
                            const parentVarName = this.findVariableNameForObject(parent);
                            if (parentVarName && actuallyAnimatedObjects.has(parentVarName)) {
                                isActuallyAnimated = true;
                                console.log(`  -> Object '${varName}' is animated via parent '${parentVarName}'`);
                                break;
                            }
                            parent = parent.parent;
                        }
                    }
                }
                
                // If no animations exist, or this object isn't animated, it's optimizable
                const canOptimize = !isActuallyAnimated;
                
                if (canOptimize) {
                    optimizableMeshes++;
                }
                
                console.log(`Mesh: varName='${varName || "anonymous"}', isActuallyAnimated=${isActuallyAnimated}, canOptimize=${canOptimize}, geometryType=${child.geometry.type}`);
                
                // Consider all non-animated meshes for instancing
                if (canOptimize) {
                    const geoKey = this.getSimpleGeometryKey(child.geometry);
                    const matKey = this.getSimpleMaterialKey(child.material);
                    const combinedKey = `${geoKey}_${matKey}`;
                    
                    if (!instanceCandidates.has(combinedKey)) {
                        instanceCandidates.set(combinedKey, []);
                    }
                    
                    instanceCandidates.get(combinedKey).push({
                        mesh: child,
                        varName: varName,
                        position: child.position.clone(),
                        rotation: child.rotation.clone(),
                        scale: child.scale.clone()
                    });
                }
                
                meshInfo.push({
                    varName: varName || "anonymous",
                    isActuallyAnimated: isActuallyAnimated,
                    hasVariableName: hasVariableName,
                    canOptimize: canOptimize,
                    type: child.geometry.type
                });
            });
            
            // Report what we found
            console.log('Smart optimization analysis results:');
            console.log(`- Total meshes: ${meshInfo.length}`);
            console.log(`- Actually animated objects: ${meshInfo.filter(m => m.isActuallyAnimated).length}`);
            console.log(`- Optimizable meshes: ${optimizableMeshes}`);
            console.log(`- Named but static objects: ${meshInfo.filter(m => m.hasVariableName && !m.isActuallyAnimated).length}`);
            
            let potentialSavings = 0;
            let instanceGroups = 0;
            
            for (const [key, candidates] of instanceCandidates.entries()) {
                if (candidates.length >= adaptiveThreshold) {
                    const namedCandidates = candidates.filter(c => c.varName).length;
                    const anonymousCandidates = candidates.length - namedCandidates;
                    console.log(`- Found ${candidates.length} identical meshes that can be safely instanced (${key})`);
                    console.log(`  -> ${namedCandidates} named objects, ${anonymousCandidates} anonymous objects`);
                    potentialSavings += candidates.length - 1;
                    instanceGroups++;
                }
            }
            
            if (potentialSavings > 0) {
                console.log(`Smart optimization potential: ${instanceGroups} instance groups could save ${potentialSavings} draw calls`);
                if (!hasAnimations) {
                    console.log('No animations defined - safe to optimize all objects including named ones.');
                } else {
                    console.log('Only non-animated objects will be optimized, preserving animation system.');
                }
            } else {
                console.log(`No optimization opportunities found with threshold ${adaptiveThreshold}.`);
                if (totalMeshes <= 5 && !hasAnimations) {
                    console.log('Note: This simple model may benefit from scene-level instancing when used multiple times.');
                }
            }
            
            if (dryRun) {
                console.log('Analysis complete - no changes made (dry run mode)');
                return {
                    totalObjects: meshInfo.length,
                    actuallyAnimatedObjects: meshInfo.filter(m => m.isActuallyAnimated).length,
                    optimizableObjects: optimizableMeshes,
                    potentialSavings: potentialSavings,
                    instanceGroups: instanceGroups,
                    hasAnimations: hasAnimations,
                    safe: potentialSavings > 0
                };
            }
            
            // If we get here, user explicitly enabled optimization
            if (potentialSavings > 0 && allowOptimization) {
                console.log('Applying smart optimization...');
                console.log('Implementation: Create InstancedMesh for all non-animated identical objects');
                // Future implementation would go here - includes named objects that aren't animated
            }
            
        } catch (error) {
            console.error('Safe optimization analysis failed:', error);
        }
    }

    /**
     * Analyzes the model's animation targets and provides detailed information
     * about what objects are being animated and how.
     * @returns {Object} Analysis of animation targets and patterns
     */
    analyzeAnimationTargets() {
        const analysis = {
            animationCount: Object.keys(this.bmDat.animations || {}).length,
            animations: {},
            allTargets: new Set(),
            targetTypes: new Map(),
            hierarchyInfo: {}
        };

        // Analyze each animation
        for (const [animName, animations] of Object.entries(this.bmDat.animations || {})) {
            const animInfo = {
                instructionCount: animations.length,
                targets: new Set(),
                actions: new Set()
            };

            if (Array.isArray(animations)) {
                for (const anim of animations) {
                    animInfo.targets.add(anim.target);
                    animInfo.actions.add(anim.action);
                    analysis.allTargets.add(anim.target);
                }
            }

            analysis.animations[animName] = {
                ...animInfo,
                targets: Array.from(animInfo.targets),
                actions: Array.from(animInfo.actions)
            };
        }

        // Analyze target types and hierarchy
        for (const targetName of analysis.allTargets) {
            const targetObj = this.bmDat.variables[targetName];
            if (targetObj) {
                const type = targetObj.type || (targetObj.isGroup ? 'Group' : 'Mesh');
                analysis.targetTypes.set(targetName, type);
                
                // Check if this target has children
                const children = [];
                if (targetObj.children) {
                    for (const child of targetObj.children) {
                        const childVarName = this.findVariableNameForObject(child);
                        if (childVarName) {
                            children.push(childVarName);
                        } else {
                            children.push(`anonymous_${child.type || 'object'}`);
                        }
                    }
                }
                
                analysis.hierarchyInfo[targetName] = {
                    type: type,
                    hasChildren: children.length > 0,
                    children: children,
                    childCount: targetObj.children ? targetObj.children.length : 0
                };
            }
        }

        return {
            ...analysis,
            allTargets: Array.from(analysis.allTargets),
            targetTypes: Object.fromEntries(analysis.targetTypes)
        };
    }

    /**
     * Lists all named objects in the model with their hierarchy relationships
     * @returns {Object} Complete naming hierarchy and object information
     */
    analyzeModelStructure() {
        const structure = {
            totalVariables: Object.keys(this.bmDat.variables || {}).length,
            namedObjects: {},
            anonymousObjects: 0,
            hierarchyMap: {},
            geometryDistribution: new Map(),
            materialDistribution: new Map()
        };

        // Analyze all meshes and objects
        this.traverse((child) => {
            const varName = this.findVariableNameForObject(child);
            
            if (varName) {
                // This is a named object
                structure.namedObjects[varName] = {
                    type: child.type || (child.isGroup ? 'Group' : child.isMesh ? 'Mesh' : 'Object3D'),
                    hasChildren: child.children && child.children.length > 0,
                    childCount: child.children ? child.children.length : 0,
                    isAnimated: false // Will be filled in later
                };

                // Track parent-child relationships
                const parent = child.parent;
                const parentVarName = this.findVariableNameForObject(parent);
                if (parentVarName && parent !== this) {
                    if (!structure.hierarchyMap[parentVarName]) {
                        structure.hierarchyMap[parentVarName] = [];
                    }
                    structure.hierarchyMap[parentVarName].push(varName);
                }
            } else {
                structure.anonymousObjects++;
            }

            // Track geometry and material distribution
            if (child.isMesh) {
                const geoType = child.geometry.type;
                structure.geometryDistribution.set(
                    geoType, 
                    (structure.geometryDistribution.get(geoType) || 0) + 1
                );

                const matType = child.material.type;
                structure.materialDistribution.set(
                    matType,
                    (structure.materialDistribution.get(matType) || 0) + 1
                );
            }
        });

        // Mark animated objects
        for (const animations of Object.values(this.bmDat.animations || {})) {
            if (Array.isArray(animations)) {
                for (const anim of animations) {
                    if (structure.namedObjects[anim.target]) {
                        structure.namedObjects[anim.target].isAnimated = true;
                    }
                }
            }
        }

        return {
            ...structure,
            geometryDistribution: Object.fromEntries(structure.geometryDistribution),
            materialDistribution: Object.fromEntries(structure.materialDistribution)
        };
    }

    /**
     * Provides optimization recommendations based on model analysis
     * @returns {Object} Specific recommendations for optimization approaches
     */
    getOptimizationRecommendations() {
        const animAnalysis = this.analyzeAnimationTargets();
        const structAnalysis = this.analyzeModelStructure();
        const optimizationAnalysis = this.optimizeSafe({ dryRun: true });

        const recommendations = {
            safety: 'conservative',
            canOptimize: optimizationAnalysis.potentialSavings > 0,
            recommendations: [],
            risks: [],
            insights: []
        };

        // Analyze animation patterns
        if (animAnalysis.animationCount > 0) {
            recommendations.risks.push('Model has active animations - any optimization must preserve animation targets');
            
            const groupTargets = Object.values(animAnalysis.targetTypes).filter(type => type === 'Group').length;
            if (groupTargets > 0) {
                recommendations.insights.push(`${groupTargets} animation targets are Groups - child meshes might be optimizable`);
            }
        }

        // Analyze geometry reuse potential
        const geometryTypes = Object.entries(structAnalysis.geometryDistribution);
        for (const [geoType, count] of geometryTypes) {
            if (count >= 4) {
                recommendations.insights.push(`${count} ${geoType} geometries found - good instancing candidate`);
            }
        }

        // Provide specific recommendations
        if (optimizationAnalysis.anonymousObjects > 0) {
            recommendations.recommendations.push('Safe to instance anonymous meshes with identical geometry/materials');
        }

        if (animAnalysis.animationCount === 0) {
            recommendations.safety = 'moderate';
            recommendations.recommendations.push('No animations detected - more aggressive optimization possible');
        } else {
            recommendations.recommendations.push('Use ultra-conservative optimization due to animation system');
        }

        if (structAnalysis.totalVariables > 20) {
            recommendations.insights.push('Large number of named objects suggests complex model with limited optimization potential');
        }

        // Performance impact estimates
        recommendations.estimatedBenefit = {
            drawCallReduction: optimizationAnalysis.potentialSavings || 0,
            instanceGroups: optimizationAnalysis.instanceGroups || 0,
            safetyLevel: recommendations.safety
        };

        return recommendations;
    }

    /**
     * Automatically determines if a model should be merged based on usage patterns and model characteristics.
     * This is the intelligent runtime decision system for game engines with user-generated content.
     * @param {Object} context - Usage context for decision making
     * @param {number} context.instanceCount - How many times this model will be used in scene
     * @param {boolean} context.isStatic - Whether model will remain static (no runtime animations)
     * @param {boolean} context.allowBreaking - Whether breaking changes are acceptable for performance
     * @param {number} context.framebudgetMs - Available milliseconds per frame for rendering
     * @returns {Object} Recommendation and reasoning
     */
    shouldAutoMerge(context = {}) {
        const {
            instanceCount = 1,
            isStatic = null, // null means auto-detect
            allowBreaking = false,
            performanceThreshold = 0.5 // 50% performance improvement needed
        } = context;
        
        console.log('🤖 Auto-merge analysis starting...');
        
        // Step 1: Analyze model structure
        const structure = this.analyzeModelStructure();
        const hasAnimations = Object.keys(this.bmDat.animations || {}).length > 0;
        const mergeAnalysis = this.createMergedMesh({ dryRun: true });
        
        if (!mergeAnalysis.canMerge) {
            return {
                shouldMerge: false,
                reason: mergeAnalysis.reason,
                confidence: 1.0,
                riskLevel: 'none'
            };
        }
        
        const drawCallSavings = mergeAnalysis.analysis.savings || 0;
        const originalDrawCalls = mergeAnalysis.analysis.originalDrawCalls || 0;
        
        // Step 2: Risk Assessment
        let riskLevel = 'low';
        const risks = [];
        
        if (hasAnimations) {
            riskLevel = 'critical';
            risks.push('Model has animations - merging will break them completely');
        }
        
        // Only consider named objects risky if animations exist (indicating potential runtime control)
        if (hasAnimations && structure.totalVariables > 15) {
            riskLevel = 'critical'; // Already critical due to animations
            risks.push(`Model has ${structure.totalVariables} named objects AND animations - runtime control likely needed`);
        } else if (!hasAnimations && structure.totalVariables > 30) {
            // Much higher threshold for static models - lots of names is just organization
            riskLevel = 'medium';
            risks.push(`Model has ${structure.totalVariables} named objects - may need runtime control (but no animations detected)`);
        }
        
        if (originalDrawCalls <= 2) {
            risks.push('Model is already well-optimized - minimal benefit from merging');
        }
        
        // Step 3: Performance Benefit Calculation
        const estimatedPerformanceGain = (drawCallSavings * instanceCount) / (originalDrawCalls * instanceCount);
        const isWorthwhile = estimatedPerformanceGain >= performanceThreshold;
        
        // Step 4: Usage Pattern Analysis
        const isHighInstanceCount = instanceCount >= 10;
        const isMassiveInstanceCount = instanceCount >= 50;
        
        // Step 5: Auto-detection logic
        let shouldMerge = false;
        let confidence = 0;
        let reasoning = [];
        
        if (riskLevel === 'critical') {
            // Never merge if critical risks (animations)
            shouldMerge = false;
            confidence = 1.0;
            reasoning.push('❌ CRITICAL: Animations detected - merging forbidden');
        } else if (isMassiveInstanceCount && originalDrawCalls > 3) {
            // Always merge for massive instance counts with reasonable complexity
            shouldMerge = true;
            confidence = 0.95;
            reasoning.push('✅ MASSIVE SCALE: 50+ instances - performance critical, no animations');
        } else if (isHighInstanceCount && drawCallSavings > 2) {
            // Merge for high instance counts with decent savings
            shouldMerge = true;
            confidence = 0.85;
            reasoning.push('✅ HIGH BENEFIT: 10+ instances with 2+ draw call savings, no animations');
        } else if (instanceCount >= 5 && originalDrawCalls >= 5 && isStatic !== false) {
            // More aggressive for moderate usage - no animations means likely static
            shouldMerge = true;
            confidence = 0.75;
            reasoning.push('✅ GOOD CANDIDATE: 5+ instances of multi-mesh static model');
        } else if (instanceCount >= 3 && originalDrawCalls >= 8 && !hasAnimations) {
            // Even lower threshold for complex static models
            shouldMerge = true;
            confidence = 0.7;
            reasoning.push('✅ COMPLEX STATIC: 3+ instances of complex model, no animations detected');
        } else if (riskLevel === 'medium' && !allowBreaking) {
            // Only skip medium risk if user explicitly doesn't allow breaking
            shouldMerge = false;
            confidence = 0.6;
            reasoning.push('⚠️ MEDIUM RISK: Many named objects detected - merging disabled for safety');
        } else {
            // Default: don't merge unless proven beneficial
            shouldMerge = false;
            confidence = 0.5;
            reasoning.push('🤔 UNCERTAIN: Insufficient benefit or unclear usage pattern');
        }
        
        // Override for user preference
        if (allowBreaking && isWorthwhile) {
            shouldMerge = true;
            reasoning.push('🎯 USER OVERRIDE: Breaking changes allowed and performance gain sufficient');
        }
        
        console.log(`🤖 Auto-merge decision: ${shouldMerge ? 'MERGE' : 'SKIP'} (confidence: ${Math.round(confidence * 100)}%)`);
        
        return {
            shouldMerge,
            confidence,
            riskLevel,
            risks,
            reasoning,
            analysis: {
                instanceCount,
                originalDrawCalls,
                drawCallSavings,
                estimatedPerformanceGain: Math.round(estimatedPerformanceGain * 100),
                hasAnimations,
                namedObjectCount: structure.totalVariables,
                geometryComplexity: originalDrawCalls > 10 ? 'high' : originalDrawCalls > 5 ? 'medium' : 'low'
            },
            recommendation: shouldMerge ? 
                'Model is suitable for merging - significant performance benefit expected' :
                'Model should remain unmerged - risks outweigh benefits or insufficient performance gain'
        };
    }

    /**
     * Creates a completely merged version of the model - converts the entire Group into a single Mesh.
     * This is the ultimate optimization for static models but completely breaks animations and variable references.
     * Use only for static models that will be used many times in a scene.
     * @param {Object} options - Merging options
     * @returns {Object} Analysis and merged mesh (if successful)
     */
    createMergedMesh(options = {}) {
        const { preserveUVs = true, preserveColors = true, dryRun = true, allowMerging = false } = options;
        
        console.log('Analyzing model for geometry merging...');
        
        if (!dryRun && !allowMerging) {
            console.warn('Merging disabled by default for safety. Use allowMerging: true to enable actual changes.');
            return;
        }
        
        // Check if model has animations
        const hasAnimations = Object.keys(this.bmDat.animations || {}).length > 0;
        if (hasAnimations) {
            console.error('Cannot merge animated models - animations would be completely broken');
            return {
                canMerge: false,
                reason: 'Model has animations',
                recommendation: 'Only use merging on completely static models'
            };
        }
        
        // Collect all meshes with their materials
        const meshes = [];
        const materialGroups = new Map();
        let totalVertices = 0;
        let totalFaces = 0;
        
        this.traverse((child) => {
            if (child.isMesh) {
                meshes.push(child);
                totalVertices += child.geometry.attributes.position.count;
                totalFaces += child.geometry.index ? child.geometry.index.count / 3 : child.geometry.attributes.position.count / 3;
                
                // Group by material for potential multi-material merging
                const matKey = this.getSimpleMaterialKey(child.material);
                if (!materialGroups.has(matKey)) {
                    materialGroups.set(matKey, []);
                }
                materialGroups.get(matKey).push(child);
            }
        });
        
        if (meshes.length === 0) {
            return {
                canMerge: false,
                reason: 'No meshes found to merge'
            };
        }
        
        if (meshes.length === 1) {
            console.log('Model already consists of a single mesh');
            return {
                canMerge: true,
                alreadyOptimal: true,
                currentMesh: meshes[0],
                analysis: {
                    originalDrawCalls: 1,
                    mergedDrawCalls: 1,
                    savings: 0,
                    totalVertices: totalVertices,
                    totalFaces: Math.floor(totalFaces)
                }
            };
        }
        
        console.log(`Found ${meshes.length} meshes to potentially merge:`);
        console.log(`- Total vertices: ${totalVertices}`);
        console.log(`- Total faces: ${Math.floor(totalFaces)}`);
        console.log(`- Unique materials: ${materialGroups.size}`);
        
        // Analysis for different merging strategies
        const analysis = {
            originalDrawCalls: meshes.length,
            materials: materialGroups.size,
            canMergeAll: materialGroups.size === 1,
            multiMaterialMerge: materialGroups.size > 1,
            worstCaseVertices: totalVertices,
            estimatedFaces: Math.floor(totalFaces)
        };
        
        if (dryRun) {
            console.log('Merge analysis results:');
            if (analysis.canMergeAll) {
                console.log(`✅ Perfect merge candidate: All meshes use same material`);
                console.log(`   Draw calls: ${meshes.length} → 1 (${meshes.length - 1} saved)`);
            } else {
                console.log(`⚠️ Multi-material model: ${analysis.materials} different materials`);
                console.log(`   Draw calls: ${meshes.length} → ${analysis.materials} (${meshes.length - analysis.materials} saved)`);
            }
            console.log(`   Vertices: ${totalVertices}, Faces: ${Math.floor(totalFaces)}`);
            console.log(`   Warning: Merging will completely break bmDat.variables and animations!`);
            
            return {
                canMerge: true,
                analysis: {
                    ...analysis,
                    mergedDrawCalls: analysis.canMergeAll ? 1 : analysis.materials,
                    savings: analysis.canMergeAll ? meshes.length - 1 : meshes.length - analysis.materials,
                    totalVertices: totalVertices,
                    totalFaces: Math.floor(totalFaces)
                }
            };
        }
        
        // Actually perform the merge
        if (!allowMerging) {
            console.error('Merging not explicitly allowed');
            return;
        }
        
        console.log('Performing geometry merge...');
        
        try {
            let mergedMesh;
            
            if (analysis.canMergeAll) {
                // Single material - simple merge
                mergedMesh = this.createSingleMaterialMerge(meshes, { preserveUVs, preserveColors });
            } else {
                // Multiple materials - more complex merge
                mergedMesh = this.createMultiMaterialMerge(materialGroups, { preserveUVs, preserveColors });
            }
            
            if (mergedMesh) {
                // Replace all children with the merged mesh(es)
                while (this.children.length > 0) {
                    this.remove(this.children[0]);
                }
                
                // Handle both single mesh and array of meshes
                if (Array.isArray(mergedMesh)) {
                    // Multi-material merge returns array of meshes
                    mergedMesh.forEach(mesh => this.add(mesh));
                } else {
                    // Single material merge returns single mesh
                    this.add(mergedMesh);
                }
                
                console.log(`✅ Merge successful!`);
                console.log(`   Draw calls reduced: ${meshes.length} → ${Array.isArray(mergedMesh) ? mergedMesh.length : 1}`);
                console.log(`   ⚠️ WARNING: bmDat.variables now broken! Model is no longer animatable.`);
                
                return {
                    success: true,
                    mergedMesh: mergedMesh,
                    analysis: {
                        originalDrawCalls: meshes.length,
                        finalDrawCalls: Array.isArray(mergedMesh) ? mergedMesh.length : 1,
                        savings: Array.isArray(mergedMesh) ? meshes.length - mergedMesh.length : meshes.length - 1
                    }
                };
            }
            
        } catch (error) {
            console.error('Merge failed:', error);
            return {
                canMerge: false,
                reason: 'Merge operation failed',
                error: error.message
            };
        }
    }

    /**
     * Merge meshes that all share the same material
     */
    createSingleMaterialMerge(meshes, options = {}) {
        const { preserveUVs = true, preserveColors = true } = options;
        
        // Clone and transform geometries to preserve their local transforms
        const geometries = meshes.map(mesh => {
            const geometry = mesh.geometry.clone();
            
            // Apply the mesh's local transform (position, rotation, scale) to the geometry
            // This preserves the mesh's transform relative to its parent
            mesh.updateMatrix();
            geometry.applyMatrix4(mesh.matrix);
            
            // Preserve attributes if requested
            if (!preserveUVs && geometry.attributes.uv) {
                geometry.deleteAttribute('uv');
            }
            if (!preserveColors && geometry.attributes.color) {
                geometry.deleteAttribute('color');
            }
            
            return geometry;
        });
        
        try {
            const mergedGeometry = BufferGeometryUtils.mergeGeometries(geometries);
            const mergedMesh = new Mesh(mergedGeometry, meshes[0].material);
            
            // The merged mesh should be positioned at the origin since we baked transforms into geometry
            mergedMesh.position.set(0, 0, 0);
            mergedMesh.rotation.set(0, 0, 0);
            mergedMesh.scale.set(1, 1, 1);
            
            // Clean up cloned geometries
            geometries.forEach(geo => geo.dispose());
            
            return mergedMesh;
        } catch (error) {
            console.error('Single material merge failed:', error);
            // Clean up on failure
            geometries.forEach(geo => geo.dispose());
            throw error;
        }
    }

    /**
     * Merge meshes with multiple materials - results in multiple meshes, one per material
     */
    createMultiMaterialMerge(materialGroups, options = {}) {
        const { preserveUVs = true, preserveColors = true } = options;
        const mergedMeshes = [];
        
        try {
            for (const [, meshes] of materialGroups.entries()) {
                if (meshes.length === 1) {
                    // Only one mesh with this material, no need to merge
                    mergedMeshes.push(meshes[0]);
                } else {
                    // Multiple meshes with same material, merge them
                    const mergedMesh = this.createSingleMaterialMerge(meshes, { preserveUVs, preserveColors });
                    mergedMeshes.push(mergedMesh);
                }
            }
            
            return mergedMeshes;
        } catch (error) {
            console.error('Multi-material merge failed:', error);
            throw error;
        }
    }

    /**
     * Analyzes model structure for potential scene-level optimizations.
     * NOTE: BMLoader models are hierarchical Groups and cannot be directly instanced
     * at the scene level like simple meshes. This method provides analysis only.
     * @returns {Object} Analysis of the model's structure and optimization potential
     */
    prepareForSceneInstancing() {
        console.log('Analyzing model structure for scene-level considerations...');
        
        const hasAnimations = Object.keys(this.bmDat.animations || {}).length > 0;
        if (hasAnimations) {
            console.warn('Model has animations - not suitable for scene-level optimization');
            return { 
                canInstance: false, 
                reason: 'Model has animations',
                recommendation: 'Use multiple individual model instances instead'
            };
        }
        
        // Count current draw calls
        let drawCalls = 0;
        this.traverse((child) => {
            if (child.isMesh) drawCalls++;
        });
        
        console.warn('ARCHITECTURE LIMITATION: BMLoader models are Groups, not single meshes');
        console.warn('Scene-level instancing requires manual implementation with simple geometries');
        
        return {
            canInstance: false,
            reason: 'BMLoader models are hierarchical Groups, not instanceable meshes',
            currentDrawCalls: drawCalls,
            analysisOnly: true,
            recommendation: drawCalls === 1 
                ? 'Consider extracting geometry/material and creating manual InstancedMesh'
                : `Complex model (${drawCalls} draw calls) - not suitable for scene instancing`,
            alternativeApproaches: [
                'Create simplified Three.js geometry version for repeated use',
                'Use Level-of-Detail (LOD) system for distant objects',
                'Implement object pooling for dynamic objects',
                'Consider using sprites for very distant/small objects'
            ]
        };
    }

    /**
     * Simple geometry key that focuses on type and basic parameters
     */
    getSimpleGeometryKey(geometry) {
        const params = geometry.parameters || {};
        const key = `${geometry.type}_${JSON.stringify(params)}`;
        return key;
    }

    /**
     * Simple material key that focuses on basic visual properties
     */
    getSimpleMaterialKey(material) {
        const color = material.color ? material.color.getHexString() : 'none';
        const map = material.map ? material.map.uuid : 'none';
        const type = material.type;
        return `${type}_${color}_${map}`;
    }
    createInstancedMesh(meshes) {
        const firstMesh = meshes[0];
        const instancedMesh = new InstancedMesh(
            firstMesh.geometry,
            firstMesh.material,
            meshes.length
        );
        
        const dummy = new Object3D();
        meshes.forEach((mesh, index) => {
            dummy.position.copy(mesh.position);
            dummy.rotation.copy(mesh.rotation);
            dummy.scale.copy(mesh.scale);
            dummy.updateMatrix();
            instancedMesh.setMatrixAt(index, dummy.matrix);
        });
        
        instancedMesh.instanceMatrix.needsUpdate = true;
        return instancedMesh;
    }

    /**
     * Find variable name for a given object
     */
    findVariableNameForObject(object) {
        for (const [varName, varObj] of Object.entries(this.bmDat.variables || {})) {
            if (varObj === object) {
                return varName;
            }
        }
        return null;
    }

    /**
     * Generate a key for geometry based on its properties
     */
    getGeometryKey(geometry) {
        try {
            const params = geometry.parameters || {};
            // Create a stable key based on geometry type and parameters
            const paramString = Object.keys(params).sort().map(key => `${key}:${params[key]}`).join('|');
            return `${geometry.type}_${paramString}`;
        } catch (error) {
            console.warn('Failed to generate geometry key:', error);
            return `${geometry.type}_${geometry.uuid}`;
        }
    }

    /**
     * Generate a key for material based on its properties
     */
    getMaterialKey(material) {
        try {
            const color = material.color ? material.color.getHexString() : 'none';
            const map = material.map ? material.map.uuid : 'none';
            const opacity = material.opacity !== undefined ? material.opacity : 1;
            const transparent = material.transparent || false;
            return `${material.type}_${color}_${map}_${opacity}_${transparent}`;
        } catch (error) {
            console.warn('Failed to generate material key:', error);
            return `${material.type}_${material.uuid || 'unknown'}`;
        }
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

    const renderModel = new RenderBasicModel(modelData, loader);

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

/**
 * Returns the value of a variable or expression, resolving any variable references.
 * Supports simple math expressions and variable references in the form of $varName.
 * Handles circular references by returning 0 and logging a warning.
 * @param {string|number} val The value or expression to evaluate.
 * @param {RenderBasicModel} renderModel The model containing variable definitions.
 * @param {Set} visited A set to track visited variable names to prevent circular references.
 * @return {number|string} The resolved value, which can be a number, string, or expression result.
 */
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
            map: await loadTexture(txInst[0], renderModel),
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
    tx.colorSpace = SRGBColorSpace;

    return tx;
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
            console.log("fail");
        });

    }

    if(txDef.frames == 1) {
        return imCanvas.toDataURL("image/webp", imgQuality);
    }

    console.log("GRAB A FRAME!");
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
        geometry.translate(renderModel.bmDat.geoTranslate.x, renderModel.bmDat.geoTranslate.y, renderModel.bmDat.geoTranslate.z);
        storedGeometries[geoName] = geometry;
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

        if(colPart == "transparent" || (colPart.length == 7 && colPart[0] == "#")) {
            transparent = true;
        }

        material = await getTextureMaterial(txPart, renderModel, transparent, colPart, depthWrite, useMaterial);
    }
        
    if(!material) {

        const matClass = getMaterialClass(useMaterial);

        if(colPart && colPart.length == 7 && colPart[0] == "#") {
            material = new matClass({
                color: colPart,
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

    if(parts.length >= 5) {
        bumpMap = getModValue(parts[5], renderModel);

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