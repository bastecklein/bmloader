// Simple test showing how to use the new safe optimization

// Example usage:
async function testSafeOptimization() {
    // Assuming you have a loaded model
    const model = await yourBMLoader.loadAsync(yourModelData);
    
    console.log('=== BEFORE OPTIMIZATION ===');
    
    // First, do a dry run to see what could be optimized
    const analysis = model.optimizeSafe({ 
        instanceThreshold: 3,  // Need at least 3 identical objects to instance
        dryRun: true          // Don't actually change anything, just analyze
    });
    
    console.log('Analysis results:', analysis);
    
    // Test that animations still work BEFORE any optimization
    console.log('\n=== TESTING ANIMATIONS (Before) ===');
    model.bmDat.animation = 'yourAnimationName';
    for (let i = 0; i < 5; i++) {
        model.animate(0.016); // Simulate a few frames
        console.log(`Frame ${i + 1} completed`);
    }
    
    // Only apply optimization if there are significant benefits AND you want to proceed
    if (analysis.potentialSavings > 2) {
        console.log('\n=== APPLYING OPTIMIZATION ===');
        // For now, the safe optimization just analyzes - actual implementation pending
        // model.optimizeSafe({ instanceThreshold: 3, dryRun: false });
        
        console.log('Optimization would be applied here when implementation is complete');
    }
    
    console.log('\n=== TESTING ANIMATIONS (After) ===');
    // Test animations again to ensure they still work
    model.bmDat.animation = 'yourAnimationName';
    for (let i = 0; i < 5; i++) {
        model.animate(0.016);
        console.log(`Frame ${i + 1} completed`);
    }
}

// For your current testing, I recommend:
console.log(`
RECOMMENDED USAGE FOR NOW:

1. Load your model normally:
   const model = await loader.loadAsync(modelData);

2. Test that animations work:
   model.bmDat.animation = 'yourAnimationName';
   model.animate(0.016);

3. Run analysis only (don't optimize yet):
   const analysis = model.optimizeSafe({ dryRun: true });

4. This will show you potential savings without breaking anything

5. Once we fix the issues, you can use:
   model.optimizeSafe({ dryRun: false });
`);

export { testSafeOptimization };
