# BMLoader Optimization Guide

This guide covers the performance optimization features available in BMLoader, including analysis tools, safe optimization methods, geometry merging, and best practices for different use cases.

## Table of Contents

1. [Overview](#overview)
2. [Architecture Limitations](#architecture-limitations)
3. [Quick Start](#quick-start)
4. [Analysis Methods](#analysis-methods)
5. [Optimization Methods](#optimization-methods)
6. [Geometry Merging](#geometry-merging)
7. [Use Case Examples](#use-case-examples)
8. [Best Practices](#best-practices)
9. [Troubleshooting](#troubleshooting)

## Overview

BMLoader includes intelligent optimization features that can significantly improve performance while maintaining compatibility with animations and variable references. The system offers three optimization approaches:

- **Smart instancing** - Groups identical meshes within a model
- **Adaptive thresholds** - Lower requirements for simple models  
- **Geometry merging** - Ultimate optimization that combines all meshes into one (breaks animations)
- **Conservative approach** - Safety-first design for public library use

## Architecture Limitations

**Important**: BMLoader models are hierarchical Three.js Groups containing multiple meshes, not single objects. This has significant implications for optimization:

### What BMLoader Optimization CAN Do
- ✅ **Internal optimization**: Optimize duplicate meshes *within* a single model instance
- ✅ **Smart analysis**: Identify which objects can be safely instanced inside the model
- ✅ **Animation preservation**: Keep all animation functionality intact (except with merging)
- ✅ **Variable system**: Maintain `bmDat.variables` references (except with merging)
- ✅ **Geometry merging**: Combine entire model into 1-3 meshes for static models

### What BMLoader Optimization CANNOT Do
- ❌ **Scene-level instancing**: Cannot instance entire models across a scene (100+ powerups)
- ❌ **Cross-model optimization**: Each model instance is optimized independently

### Why Scene-Level Instancing Doesn't Work
```javascript
// This won't work because BMLoader models are Groups, not single meshes:
const instancedMesh = new InstancedMesh(modelGeometry, modelMaterial, 100); // ❌

// BMLoader models are actually like this:
const modelGroup = new Group();
modelGroup.add(mesh1, mesh2, mesh3, ...); // Multiple meshes in hierarchy

// BUT geometry merging can solve this:
model.createMergedMesh({ dryRun: false, allowMerging: true });
// Now model is a single mesh, suitable for manual scene instancing!
```

For true scene-level performance with many identical objects, consider:
1. Using simple Three.js geometries instead of BMLoader
2. Creating simplified versions of complex models for repeated use
3. Level-of-detail (LOD) systems for distant objects

## Quick Start

### Basic Analysis
```javascript
// Load your model
const model = await loader.loadAsync('mymodel.bm');

// Get optimization recommendations
const recommendations = model.getOptimizationRecommendations();
console.log(recommendations);

// Run safe analysis (dry run)
const analysis = model.optimizeSafe({ dryRun: true });
console.log(`Can save ${analysis.potentialSavings} draw calls`);
```

### Apply Optimizations
```javascript
// Apply safe optimizations
if (analysis.potentialSavings > 0) {
    model.optimizeSafe({ 
        dryRun: false, 
        allowOptimization: true,
        instanceThreshold: 2  // Lower for simple models
    });
}
```

## Analysis Methods

### 1. `analyzeAnimationTargets()`

Provides detailed information about which objects are animated and how.

```javascript
const animAnalysis = model.analyzeAnimationTargets();
console.log(animAnalysis);
```

**Returns:**
```javascript
{
    animationCount: 2,
    animations: {
        "walk": {
            instructionCount: 4,
            targets: ["leftLeg", "rightLeg"],
            actions: ["rotateX", "rotateZ"]
        }
    },
    allTargets: ["leftLeg", "rightLeg", "head"],
    targetTypes: {
        "leftLeg": "Group",
        "rightLeg": "Group", 
        "head": "Mesh"
    },
    hierarchyInfo: {
        "leftLeg": {
            type: "Group",
            hasChildren: true,
            children: ["leftThigh", "leftShin"],
            childCount: 2
        }
    }
}
```

### 2. `analyzeModelStructure()`

Analyzes the complete model structure including hierarchy and object distribution.

```javascript
const structure = model.analyzeModelStructure();
console.log(structure);
```

**Returns:**
```javascript
{
    totalVariables: 25,
    namedObjects: {
        "head": { type: "Mesh", hasChildren: false, isAnimated: true },
        "body": { type: "Group", hasChildren: true, isAnimated: false }
    },
    anonymousObjects: 3,
    hierarchyMap: {
        "body": ["torso", "leftArm", "rightArm"]
    },
    geometryDistribution: {
        "BoxGeometry": 12,
        "SphereGeometry": 4,
        "CylinderGeometry": 2
    },
    materialDistribution: {
        "MeshLambertMaterial": 15,
        "MeshBasicMaterial": 3
    }
}
```

### 3. `getOptimizationRecommendations()`

Provides intelligent recommendations based on comprehensive analysis.

```javascript
const recommendations = model.getOptimizationRecommendations();
console.log(recommendations);
```

**Returns:**
```javascript
{
    safety: "moderate",
    canOptimize: true,
    recommendations: [
        "Safe to instance anonymous meshes with identical geometry/materials",
        "No animations detected - more aggressive optimization possible"
    ],
    risks: [],
    insights: [
        "12 BoxGeometry geometries found - good instancing candidate"
    ],
    estimatedBenefit: {
        drawCallReduction: 8,
        instanceGroups: 3,
        safetyLevel: "moderate"
    }
}
```

### 4. `prepareForSceneInstancing()`

**⚠️ IMPORTANT**: This method provides analysis only. BMLoader models cannot be directly instanced at scene level.

```javascript
const analysis = model.prepareForSceneInstancing();
console.log(analysis);
```

**Returns:**
```javascript
{
    canInstance: false,
    reason: "BMLoader models are hierarchical Groups, not instanceable meshes",
    currentDrawCalls: 5,
    analysisOnly: true,
    recommendation: "Complex model (5 draw calls) - not suitable for scene instancing",
    alternativeApproaches: [
        "Create simplified Three.js geometry version for repeated use",
        "Use Level-of-Detail (LOD) system for distant objects",
        "Implement object pooling for dynamic objects",
        "Consider using sprites for very distant/small objects"
    ]
}
```

## Optimization Methods

### 1. `optimizeSafe()` - Recommended Method

The primary optimization method that safely instances identical objects while preserving animations.

```javascript
model.optimizeSafe({
    instanceThreshold: 2,      // Min identical objects needed (default: 2)
    dryRun: false,            // Set to false to apply changes (default: true)
    allowOptimization: true   // Required to enable actual optimization
});
```

**Features:**
- **Animation-aware**: Only optimizes non-animated objects
- **Adaptive thresholds**: Lower requirements for simple models
- **Parent hierarchy checking**: Protects child objects of animated Groups
- **Conservative approach**: Errs on the side of safety

**Example Output:**
```
Running smart-safe optimization analysis...
Model has animations: false
Simple model detected (3 objects, no animations) - using adaptive threshold: 1
Smart optimization potential: 2 instance groups could save 4 draw calls
No animations defined - safe to optimize all objects including named ones.
```

### 2. `optimize()` - Legacy Method

The original optimization method with more aggressive options.

```javascript
model.optimize({
    instanceThreshold: 3,      // Min identical objects needed
    preserveAnimated: true,    // Preserve animated objects
    enableMerging: false       // Enable geometry merging (experimental)
});
```

**Note:** This method is less safe and may break variable references. Use `optimizeSafe()` instead.

## Geometry Merging

**⚠️ ULTIMATE OPTIMIZATION**: Geometry merging combines ALL meshes in a model into 1-3 single meshes, providing maximum performance but **completely breaking animations and variable references**.

### When to Use Geometry Merging

✅ **Perfect for:**
- Static models used 50+ times in scene (trees, rocks, buildings)
- Complex models with many small parts (25+ meshes)
- Environment props that never need individual control

❌ **Never use for:**
- Animated models (animations will be completely broken)
- Models needing bmDat.variables access
- Interactive models requiring individual part control

### Basic Usage

```javascript
// Analyze merging potential
const analysis = model.createMergedMesh({ dryRun: true });
console.log(`Can save ${analysis.analysis.savings} draw calls`);

// Apply merging (WARNING: breaks animations!)
if (analysis.canMerge && analysis.analysis.savings > 5) {
    const result = model.createMergedMesh({ 
        dryRun: false, 
        allowMerging: true,
        preserveUVs: true,      // Keep texture coordinates
        preserveColors: true    // Keep vertex colors
    });
    
    if (result.success) {
        console.log(`Model merged: ${result.analysis.originalDrawCalls} → ${result.analysis.finalDrawCalls} meshes`);
        // Model is now optimized for scene-level use!
    }
}
```

### Performance Impact Examples

```javascript
// Complex tree model before merging:
// - 25 meshes (trunk, branches, leaves, etc.)
// - 100 trees in scene = 2,500 draw calls

const tree = await loader.loadAsync('complex_tree.bm');
const analysis = tree.createMergedMesh({ dryRun: true });
// Result: 25 meshes → 1 mesh (all same material)

tree.createMergedMesh({ dryRun: false, allowMerging: true });
// Now: 100 trees in scene = 100 draw calls (2,400 saved!)
```

### Material Handling

```javascript
// Single material model (perfect merge):
const analysis = model.createMergedMesh({ dryRun: true });
// Result: 20 meshes → 1 mesh (19 draw calls saved)

// Multi-material model (grouped merge):
const analysis2 = building.createMergedMesh({ dryRun: true });  
// Result: 30 meshes with 3 materials → 3 meshes (27 draw calls saved)
```

### Limitations and Warnings

```javascript
// After merging, these NO LONGER WORK:
model.bmDat.animation = 'spin';                    // ❌ Broken
model.animate(deltaTime);                          // ❌ Broken  
model.bmDat.variables.door.rotation.y = Math.PI;  // ❌ Broken

// Model is now suitable only for static placement:
for (let i = 0; i < 100; i++) {
    const instance = model.clone();
    instance.position.set(Math.random() * 100, 0, Math.random() * 100);
    scene.add(instance);
}
```

### Combined with Scene Instancing

After merging, models become single meshes suitable for manual scene instancing:

```javascript
// 1. Merge the model
const tree = await loader.loadAsync('tree.bm');
tree.createMergedMesh({ dryRun: false, allowMerging: true });

// 2. Extract the merged mesh
let mergedMesh;
tree.traverse(child => {
    if (child.isMesh) mergedMesh = child;
});

// 3. Create scene-level instanced mesh  
const instancedTrees = new THREE.InstancedMesh(
    mergedMesh.geometry,
    mergedMesh.material, 
    1000  // 1000 trees in the forest
);

// Position each tree instance
const dummy = new THREE.Object3D();
for (let i = 0; i < 1000; i++) {
    dummy.position.set(
        Math.random() * 200 - 100,
        0,
        Math.random() * 200 - 100
    );
    dummy.updateMatrix();
    instancedTrees.setMatrixAt(i, dummy.matrix);
}
instancedTrees.instanceMatrix.needsUpdate = true;
scene.add(instancedTrees);

// Result: 1000 trees = 1 draw call!
```

## Use Case Examples

### 1. Simple Static Models (Powerups, Props)

**Scenario:** Small models with 2-5 objects, no animations, used 100+ times in scene.

⚠️ **Architecture Limitation**: BMLoader models are Groups, not single meshes, so direct scene instancing isn't possible.

```javascript
// Load model
const powerup = await loader.loadAsync('powerup.bm');

// Check what optimization is possible
const analysis = powerup.prepareForSceneInstancing();
console.log(analysis.alternativeApproaches);

// Optimize the individual model internally
const optAnalysis = powerup.optimizeSafe({ dryRun: true });
if (optAnalysis.potentialSavings > 0) {
    powerup.optimizeSafe({ 
        dryRun: false, 
        allowOptimization: true,
        instanceThreshold: 1  // Very low threshold for simple models
    });
}

// For scene-level performance, you'll need to:
// 1. Extract geometry/material if the model is simple (1 mesh)
// 2. Create a manual InstancedMesh
// 3. Or consider object pooling for dynamic objects

// Example for single-mesh models:
if (analysis.currentDrawCalls === 1) {
    // Extract the single mesh's geometry and material
    let singleMesh;
    powerup.traverse(child => {
        if (child.isMesh && !singleMesh) singleMesh = child;
    });
    
    if (singleMesh) {
        const instancedMesh = new THREE.InstancedMesh(
            singleMesh.geometry, 
            singleMesh.material, 
            100  // 100 instances in scene
        );
        // Position instances as needed...
    }
}
```

### 2. Complex Animated Models (Characters)

**Scenario:** Complex models with many parts and animations.

```javascript
// Load character model
const character = await loader.loadAsync('character.bm');

// Analyze what can be optimized
const recommendations = character.getOptimizationRecommendations();
console.log(recommendations.recommendations);

// Apply conservative optimization
if (recommendations.canOptimize) {
    character.optimizeSafe({ 
        dryRun: false, 
        allowOptimization: true,
        instanceThreshold: 3  // Higher threshold for complex models
    });
}
```

### 3. Environment Models (Buildings, Vehicles)

**Scenario:** Medium complexity models, some animations (doors, wheels), moderate reuse.

```javascript
// Load building model
const building = await loader.loadAsync('building.bm');

// Get detailed analysis
const animAnalysis = building.analyzeAnimationTargets();
const structAnalysis = building.analyzeModelStructure();

console.log(`Animated objects: ${animAnalysis.allTargets.length}`);
console.log(`Static objects: ${structAnalysis.totalVariables - animAnalysis.allTargets.length}`);

// Apply optimization
const analysis = building.optimizeSafe({ dryRun: true });
if (analysis.potentialSavings > 2) {  // Only optimize if meaningful benefit
    building.optimizeSafe({ 
        dryRun: false, 
        allowOptimization: true 
    });
}
```

## Best Practices

### 1. Always Analyze First

```javascript
// Don't optimize blindly
const recommendations = model.getOptimizationRecommendations();
if (recommendations.canOptimize && recommendations.estimatedBenefit.drawCallReduction > 1) {
    // Proceed with optimization
}
```

### 2. Use Appropriate Thresholds

```javascript
// Adjust thresholds based on model complexity
const structAnalysis = model.analyzeModelStructure();
const threshold = structAnalysis.totalVariables <= 5 ? 1 : 3;

model.optimizeSafe({ instanceThreshold: threshold });
```

### 3. Test Animations After Optimization

```javascript
// Verify animations still work
model.optimizeSafe({ dryRun: false, allowOptimization: true });

// Test animation
model.bmDat.animation = "walk";
model.animate(0.016); // Test frame
```

### 4. Consider Scene-Level Optimization

```javascript
// For models used many times, check scene instancing potential
const prep = model.prepareForSceneInstancing();
if (prep.savings > 2 && numberOfInstances > 10) {
    // Consider Three.js InstancedMesh instead of model optimization
}
```

### 5. Monitor Performance Impact

```javascript
// Before optimization
const beforeDrawCalls = countDrawCalls(scene);

// After optimization  
model.optimizeSafe({ dryRun: false, allowOptimization: true });
const afterDrawCalls = countDrawCalls(scene);

console.log(`Draw call reduction: ${beforeDrawCalls - afterDrawCalls}`);
```

## Best Practices by Model Type

### Simple Static Models (≤5 objects, no animations)
- Use `instanceThreshold: 1`
- Consider geometry merging for scene instancing
- Optimize aggressively

### Complex Static Models (>5 objects, no animations)  
- Use `instanceThreshold: 2-3`
- Focus on identical geometry groups
- Test performance impact

### Animated Models (any complexity)
- Use `instanceThreshold: 3-4` 
- Let the system protect animated objects
- Test animations after optimization

### Environment Models (mixed static/animated)
- Analyze animation targets first
- Use default thresholds
- Consider scene-level strategies

## Troubleshooting

### "No optimization opportunities found"

**Causes:**
- All objects are unique (different geometry/materials)
- Threshold too high for model complexity
- All objects are animated

**Solutions:**
```javascript
// Lower the threshold
model.optimizeSafe({ instanceThreshold: 1 });

// Check what's preventing optimization
const analysis = model.analyzeModelStructure();
console.log(analysis.geometryDistribution);
```

### Animations broken after optimization

**Causes:**
- Bug in animation detection
- Complex parent-child animation relationships

**Solutions:**
```javascript
// Use dry run to analyze first
const analysis = model.optimizeSafe({ dryRun: true });
console.log(`Would affect ${analysis.actuallyAnimatedObjects} animated objects`);

// Check animation targets
const animAnalysis = model.analyzeAnimationTargets();
console.log(animAnalysis.allTargets);
```

### Performance not improved significantly

**Causes:**
- Model already well-optimized
- Limited identical geometry
- Scene-level optimization needed

**Solutions:**
```javascript
// Check scene instancing potential
const prep = model.prepareForSceneInstancing();
if (prep.savings > model.optimizeSafe({dryRun: true}).potentialSavings) {
    // Consider scene-level optimization instead
}
```

### Variable references broken

**Causes:**
- Using legacy `optimize()` method
- Bug in variable preservation

**Solutions:**
```javascript
// Always use optimizeSafe()
model.optimizeSafe({ dryRun: false, allowOptimization: true });

// Test variable access
console.log(model.bmDat.variables.someObject); // Should still work
```

## Advanced Usage

### Custom Analysis Pipeline

```javascript
async function analyzeModel(model) {
    const results = {
        structure: model.analyzeModelStructure(),
        animations: model.analyzeAnimationTargets(), 
        optimization: model.optimizeSafe({ dryRun: true }),
        sceneInstancing: model.prepareForSceneInstancing(),
        recommendations: model.getOptimizationRecommendations()
    };
    
    // Custom logic based on results
    if (results.animations.animationCount === 0 && results.structure.totalVariables <= 3) {
        results.strategy = 'aggressive-scene-instancing';
    } else if (results.optimization.potentialSavings > 3) {
        results.strategy = 'model-optimization';
    } else {
        results.strategy = 'no-optimization';
    }
    
    return results;
}
```

### Batch Processing

```javascript
async function optimizeModelBatch(modelUrls) {
    const results = [];
    
    for (const url of modelUrls) {
        const model = await loader.loadAsync(url);
        const analysis = await analyzeModel(model);
        
        if (analysis.strategy === 'model-optimization') {
            model.optimizeSafe({ dryRun: false, allowOptimization: true });
        }
        
        results.push({ url, analysis, model });
    }
    
    return results;
}
```

### Performance Monitoring

```javascript
function measureOptimizationImpact(model) {
    const before = {
        drawCalls: countDrawCalls(model),
        vertices: countVertices(model),
        triangles: countTriangles(model)
    };
    
    model.optimizeSafe({ dryRun: false, allowOptimization: true });
    
    const after = {
        drawCalls: countDrawCalls(model),
        vertices: countVertices(model),
        triangles: countTriangles(model)
    };
    
    return {
        drawCallReduction: before.drawCalls - after.drawCalls,
        vertexReduction: before.vertices - after.vertices,
        triangleReduction: before.triangles - after.triangles,
        percentImprovement: (before.drawCalls - after.drawCalls) / before.drawCalls * 100
    };
}
```

## Summary

The BMLoader optimization system provides:

1. **Safe, intelligent optimization** that preserves animations
2. **Comprehensive analysis tools** for understanding model structure
3. **Adaptive behavior** that adjusts to different model types
4. **Scene-level guidance** for models used multiple times
5. **Conservative approach** suitable for public library use

The key is to analyze first, understand your model's characteristics, and apply appropriate optimization strategies. The system is designed to be safe by default while providing maximum performance benefits where possible.

For questions or issues, refer to the troubleshooting section or examine the detailed console output from the analysis methods.
