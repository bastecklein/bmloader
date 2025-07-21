# BMLoader Geometry Merging Example

This example demonstrates the feasibility and implementation of geometry merging in BMLoader models.

## Overview

Geometry merging combines multiple meshes into a single mesh, dramatically reducing draw calls but completely breaking animations and variable references. This is the ultimate optimization for static models that will be used many times in a scene.

## When Geometry Merging Works Best

### ✅ Perfect Candidates
- **Static models** (no animations)
- **Powerups, collectibles, props**
- **Environment objects used 50+ times**
- **Models with many small parts** (complex static objects)
- **Same material models** (single draw call result)

### ❌ Not Suitable For
- **Animated models** (completely breaks animations)
- **Models needing variable access** (bmDat.variables becomes invalid)
- **Models with interactive parts**
- **Models requiring individual transforms**

## Implementation Example

```javascript
// Load a complex static model (e.g., a detailed tree with many parts)
const tree = await loader.loadAsync('complex_tree.bm');

// Analyze merging potential
const analysis = tree.createMergedMesh({ dryRun: true });
console.log(analysis);
// Output:
// {
//     canMerge: true,
//     analysis: {
//         originalDrawCalls: 25,    // Tree has many parts
//         mergedDrawCalls: 1,       // All same material
//         savings: 24,              // 24 fewer draw calls!
//         totalVertices: 8450,
//         totalFaces: 4220
//     }
// }

// Actually perform the merge
if (analysis.canMerge && analysis.analysis.savings > 10) {
    const result = tree.createMergedMesh({ 
        dryRun: false, 
        allowMerging: true,
        preserveUVs: true,
        preserveColors: true 
    });
    
    if (result.success) {
        console.log(`Merged ${result.analysis.originalDrawCalls} meshes into ${result.analysis.finalDrawCalls}`);
        // Tree is now a single optimized mesh!
    }
}
```

## Use Cases by Model Type

### 1. Simple Props (5-10 parts, same material)
```javascript
const powerup = await loader.loadAsync('powerup.bm');
const analysis = powerup.createMergedMesh({ dryRun: true });
// Result: 8 meshes → 1 mesh (7 draw calls saved)

// Perfect for scene-level use:
for (let i = 0; i < 100; i++) {
    const instance = powerup.clone();
    instance.position.set(Math.random() * 100, 0, Math.random() * 100);
    scene.add(instance);
}
// Total: 100 draw calls instead of 800!
```

### 2. Complex Models (20+ parts, multiple materials)
```javascript
const building = await loader.loadAsync('complex_building.bm');
const analysis = building.createMergedMesh({ dryRun: true });
// Result: 35 meshes → 4 meshes (31 draw calls saved)
//         Different materials: concrete, glass, metal, wood

// Still beneficial for repeated use
for (let i = 0; i < 20; i++) {
    const instance = building.clone();
    // Position buildings in city...
    scene.add(instance);
}
// Total: 80 draw calls instead of 700!
```

### 3. Detailed Static Characters
```javascript
const statue = await loader.loadAsync('detailed_statue.bm');
const analysis = statue.createMergedMesh({ dryRun: true });
// Result: 42 meshes → 3 meshes (stone, bronze, marble materials)

if (analysis.canMerge) {
    statue.createMergedMesh({ dryRun: false, allowMerging: true });
    // Now suitable for gardens with many statues
}
```

## Performance Impact

### Before Merging (Complex Tree Example)
```
- 25 individual meshes
- 25 draw calls per tree
- 100 trees = 2,500 draw calls
- Variable access: tree.bmDat.variables.trunk, .leaves, etc.
- Animatable: tree.bmDat.animation = 'sway'
```

### After Merging
```
- 1 merged mesh
- 1 draw call per tree  
- 100 trees = 100 draw calls (2,400 saved!)
- Variable access: ❌ BROKEN
- Animatable: ❌ BROKEN  
- Suitable for static placement only
```

## Material Handling

### Single Material Models
```javascript
// All parts use same material = perfect merge
const result = model.createMergedMesh({ dryRun: false, allowMerging: true });
// 15 meshes → 1 mesh (14 draw calls saved)
```

### Multi-Material Models  
```javascript
// Different materials = grouped merge
const result = model.createMergedMesh({ dryRun: false, allowMerging: true });
// 20 meshes with 3 materials → 3 meshes (17 draw calls saved)
```

## Workflow Integration

### 1. Development Phase (Keep Unmerged)
```javascript
// During development, keep models unmerged for debugging
const model = await loader.loadAsync('model.bm');
// Full variable access and animation support
model.bmDat.variables.door.rotation.y = Math.PI / 2;
```

### 2. Production Optimization
```javascript
// In production, merge static models
const model = await loader.loadAsync('model.bm');

if (isProduction && isStaticModel(model)) {
    const analysis = model.createMergedMesh({ dryRun: true });
    if (analysis.analysis.savings > 5) {
        model.createMergedMesh({ dryRun: false, allowMerging: true });
    }
}
```

### 3. Hybrid Approach
```javascript
// Keep some models merged, others unmerged
const models = {
    player: await loader.loadAsync('player.bm'),        // Keep unmerged (animated)
    trees: await loader.loadAsync('tree.bm'),           // Merge (static, repeated)
    buildings: await loader.loadAsync('building.bm')    // Merge (static, repeated)
};

// Merge static models
models.trees.createMergedMesh({ dryRun: false, allowMerging: true });
models.buildings.createMergedMesh({ dryRun: false, allowMerging: true });
```

## Best Practices

### 1. Always Analyze First
```javascript
const analysis = model.createMergedMesh({ dryRun: true });
console.log(`Potential savings: ${analysis.analysis.savings} draw calls`);
```

### 2. Consider Material Count
```javascript
if (analysis.analysis.materials === 1) {
    console.log('Perfect merge candidate - single material');
} else {
    console.log(`Multi-material merge: ${analysis.analysis.materials} final meshes`);
}
```

### 3. Preserve Important Attributes
```javascript
model.createMergedMesh({ 
    preserveUVs: true,      // Keep texture coordinates
    preserveColors: true,   // Keep vertex colors
    allowMerging: true 
});
```

### 4. Test Performance Impact
```javascript
const before = performance.now();
// Render scene with unmerged models
const beforeTime = performance.now() - before;

// Apply merging...

const after = performance.now();
// Render scene with merged models  
const afterTime = performance.now() - after;

console.log(`Performance improvement: ${((beforeTime - afterTime) / beforeTime * 100).toFixed(1)}%`);
```

## Limitations and Warnings

### ⚠️ Complete Animation Loss
```javascript
// This will NOT work after merging:
model.bmDat.animation = 'rotate';     // ❌ No longer works
model.animate(deltaTime);             // ❌ No longer works
```

### ⚠️ Variable System Broken
```javascript  
// This will NOT work after merging:
model.bmDat.variables.wheel.rotation.x += 0.1;  // ❌ No longer works
```

### ⚠️ UV Coordinate Considerations
```javascript
// Some complex merges may affect texturing:
model.createMergedMesh({ 
    preserveUVs: true,    // Usually keeps textures working
    preserveColors: true  // Preserves vertex colors if present
});
```

## Conclusion

Geometry merging is **extremely feasible** and **highly effective** for BMLoader models when:

1. **Model is completely static** (no animations needed)
2. **Model will be used many times** (10+ instances)  
3. **Draw call reduction is significant** (5+ meshes being merged)

The trade-off is **total loss of animation and variable functionality**, making it suitable only for static environment objects, props, and repeated decorative elements.

For a scene with 100 complex trees (25 parts each), merging reduces draw calls from **2,500 to 100** - a 96% reduction!
