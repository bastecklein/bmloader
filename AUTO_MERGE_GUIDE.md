# Auto-Merge System for Game Engines

This guide shows how game engines can automatically determine whether to merge BMLoader models at runtime, especially important for games with user-generated content where modders may not know optimization best practices.

## 🤖 Automatic Decision System

The `shouldAutoMerge()` method analyzes models and usage patterns to make intelligent merging decisions:

```javascript
// Game engine usage example
async function loadModelForGame(modelPath, usageContext) {
    const model = await bmLoader.load(modelPath);
    
    // Let the system decide automatically
    const decision = model.shouldAutoMerge(usageContext);
    
    console.log(`Auto-merge decision for ${modelPath}:`);
    console.log(`- Should merge: ${decision.shouldMerge}`);
    console.log(`- Confidence: ${decision.confidence * 100}%`);
    console.log(`- Risk level: ${decision.riskLevel}`);
    console.log(`- Reasoning: ${decision.reasoning.join(', ')}`);
    
    if (decision.shouldMerge && decision.confidence > 0.6) {
        // High confidence - apply merge
        const result = model.createMergedMesh({ 
            dryRun: false, 
            allowMerging: true 
        });
        
        if (result.success) {
            console.log(`✅ Merged: ${result.analysis.savings} draw calls saved`);
        }
    }
    
    return model;
}
```

## 📊 Usage Contexts for Different Scenarios

### 1. **Forest/Environment Generation**
```javascript
// Loading trees for a forest scene
const usageContext = {
    instanceCount: 150,     // 150 trees in forest
    isStatic: true,         // Trees don't animate
    allowBreaking: true,    // Performance > individual control
    performanceThreshold: 0.3  // Accept 30% improvement
};

const tree = await loadModelForGame('tree.bm', usageContext);
// Result: High confidence merge (complex model + massive instances)
```

### 2. **Player Character Loading**
```javascript
// Loading a player character model
const usageContext = {
    instanceCount: 1,       // Single player
    isStatic: false,        // Needs animations
    allowBreaking: false,   // Must preserve animations
    performanceThreshold: 0.8  // Need huge improvement to risk it
};

const player = await loadModelForGame('player.bm', usageContext);
// Result: Never merge (animations detected)
```

### 3. **Prop Spawning System**
```javascript
// Loading props that might be spawned dynamically
const usageContext = {
    instanceCount: 25,      // Moderate instance count
    isStatic: null,         // Auto-detect from model
    allowBreaking: false,   // Safe by default
    performanceThreshold: 0.5  // Need 50% improvement
};

const prop = await loadModelForGame('usermod_prop.bm', usageContext);
// Result: Analyzed case-by-case based on model complexity
```

### 4. **Modding Support with Safety**
```javascript
// Loading user-generated content safely
async function loadModdedModel(modelPath, expectedUsage) {
    const model = await bmLoader.load(modelPath);
    
    // Conservative approach for user content
    const safeContext = {
        instanceCount: expectedUsage,
        isStatic: null,         // Always auto-detect for mods
        allowBreaking: false,   // Never break user models
        performanceThreshold: 0.7  // Higher bar for user content
    };
    
    const decision = model.shouldAutoMerge(safeContext);
    
    // Only merge if very high confidence and clear benefit
    if (decision.shouldMerge && 
        decision.confidence > 0.8 && 
        decision.riskLevel === 'low') {
        
        model.createMergedMesh({ dryRun: false, allowMerging: true });
        console.log(`🎮 Auto-merged user model: ${modelPath}`);
    } else {
        console.log(`🛡️ Preserved user model safely: ${modelPath}`);
    }
    
    return model;
}
```

## 🎯 Decision Matrix

The system uses this logic tree:

```
Model Analysis
├── Has Animations?
│   ├── YES → ❌ NEVER MERGE (confidence: 100%)
│   └── NO → Continue Analysis
│
├── Complex Model (10+ objects)?
│   ├── YES + allowBreaking=false → ❌ DON'T MERGE (confidence: 80%)
│   └── Continue Analysis
│
├── Instance Count Analysis
│   ├── 50+ instances + complex → ✅ ALWAYS MERGE (confidence: 90%)
│   ├── 10+ instances + good savings → ✅ MERGE (confidence: 70%)
│   ├── 5+ instances + static → ✅ MERGE (confidence: 60%)
│   └── Otherwise → ❌ SKIP (confidence: 50%)
```

## 🚨 Safety Features

### 1. **Risk Assessment**
- **Critical**: Has animations (never merge)
- **High**: Many named objects (likely needs individual control)
- **Medium**: Moderate complexity
- **Low**: Simple static model

### 2. **Conservative Defaults**
- `allowBreaking: false` by default
- Higher thresholds for user-generated content
- Detailed reasoning provided for debugging

### 3. **Confidence Scoring**
```javascript
if (decision.confidence < 0.5) {
    console.log('⚠️ Low confidence decision - manual review recommended');
}
```

## 🎮 Game Engine Integration Examples

### Unity-Style Component System
```javascript
class ModelComponent {
    async loadModel(path, expectedInstances) {
        this.model = await loadModelForGame(path, {
            instanceCount: expectedInstances,
            isStatic: !this.hasAnimator,
            allowBreaking: this.optimizationLevel > 0,
            performanceThreshold: this.optimizationLevel * 0.2 + 0.3
        });
    }
}
```

### Scene-Level Batch Processing
```javascript
async function optimizeSceneModels(scene) {
    const modelUsage = analyzeSceneModelUsage(scene);
    
    for (const [modelPath, usage] of modelUsage) {
        const context = {
            instanceCount: usage.count,
            isStatic: usage.isStatic,
            allowBreaking: scene.allowOptimizations,
            performanceThreshold: scene.targetFPS < 60 ? 0.3 : 0.5
        };
        
        await loadModelForGame(modelPath, context);
    }
}
```

## 📈 Performance Monitoring

Track auto-merge decisions to improve the system:

```javascript
class MergeTracker {
    static trackDecision(modelPath, decision, actualPerformance) {
        console.log(`📊 Model: ${modelPath}`);
        console.log(`   Decision: ${decision.shouldMerge} (${decision.confidence})`);
        console.log(`   Actual benefit: ${actualPerformance}%`);
        
        // Use this data to tune thresholds over time
        if (decision.shouldMerge && actualPerformance < 20) {
            console.log('⚠️ False positive - consider raising thresholds');
        }
    }
}
```

## 🎯 Summary

This auto-merge system:

✅ **Protects animations** - Never breaks animated models
✅ **Handles user content safely** - Conservative defaults for mods  
✅ **Maximizes performance** - Identifies high-impact optimizations
✅ **Provides transparency** - Clear reasoning for all decisions
✅ **Adapts to usage** - Different logic for different scenarios

Perfect for games with modding support where you can't control what users create!
