# BMLoader Optimization Guide

This guide covers the performance optimization features available in BMLoader, including analysis tools, safe optimization methods, and best practices for different use cases.

## Table of Contents

1. [Overview](#overview)
2. [Quick Start](#quick-start)
3. [Analysis Methods](#analysis-methods)
4. [Optimization Methods](#optimization-methods)
5. [Use Case Examples](#use-case-examples)
6. [Best Practices](#best-practices)
7. [Troubleshooting](#troubleshooting)

## Overview

BMLoader includes intelligent optimization features that can significantly improve performance while maintaining compatibility with animations and variable references. The system uses:

- **Smart animation detection** - Only protects objects that are actually animated
- **Adaptive thresholds** - Lower requirements for simple models
- **Scene-level analysis** - Recommendations for models used multiple times
- **Conservative approach** - Safety-first design for public library use

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

Analyzes potential for scene-level instancing (when using many copies of the same model).

```javascript
const prep = model.prepareForSceneInstancing();
console.log(prep);
```

**Returns:**
```javascript
{
    canInstance: true,
    currentDrawCalls: 5,
    potentialDrawCalls: 2,
    savings: 3,
    recommendation: "Can reduce from 5 to 2 draw calls per instance"
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

## Use Case Examples

### 1. Simple Static Models (Powerups, Props)

**Scenario:** Small models with 2-5 objects, no animations, used 100+ times in scene.

```javascript
// Load model
const powerup = await loader.loadAsync('powerup.bm');

// Check scene instancing potential
const prep = powerup.prepareForSceneInstancing();
console.log(prep.recommendation);

// Optimize individual model first
if (prep.savings > 0) {
    powerup.optimizeSafe({ 
        dryRun: false, 
        allowOptimization: true,
        instanceThreshold: 1  // Very low threshold for simple models
    });
}

// Then use Three.js InstancedMesh for scene-level optimization
const instancedMesh = new THREE.InstancedMesh(
    powerup.geometry, 
    powerup.material, 
    100  // 100 instances in scene
);
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
