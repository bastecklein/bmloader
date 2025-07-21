import { BMLoader, BasicModel, RenderBasicModel } from './bmloader.js';
import { BMOptimizer, OptimizedAnimationSystem } from './optimization-example.js';

// Test script to see how the optimization works
async function testOptimization() {
    console.log('Testing BMLoader optimization...');

    // Create a test model with both static and animated objects
    const testModel = new BasicModel('test-app', '1.0');
    testModel.script = `
        // Create some static objects that could be merged/instanced
        $staticBox1 = box(1,1,1,#ff0000) > position(0,0,0)
        $staticBox2 = box(1,1,1,#ff0000) > position(2,0,0)
        $staticBox3 = box(1,1,1,#ff0000) > position(4,0,0)
        $staticBox4 = box(1,1,1,#ff0000) > position(6,0,0)
        
        // Create some animated objects that should stay separate
        $animatedSphere = sphere(0.5,8,8,#00ff00) > position(0,2,0)
        $animatedCube = box(0.8,0.8,0.8,#0000ff) > position(2,2,0)
        
        // Define animations
        @spinAnimation = rotateY($animatedSphere, 45, 0, 90, 180, 270, 360)
        @bounceAnimation = positionY($animatedCube, 30, 2, 3, 2, 1, 2)
    `;

    try {
        // Load the model normally
        const loader = new BMLoader();
        const renderModel = await new Promise((resolve, reject) => {
            loader.load(testModel, resolve, null, reject);
        });

        console.log('Original model loaded');
        console.log('Children count:', renderModel.children.length);
        console.log('Variables:', Object.keys(renderModel.bmDat.variables));
        console.log('Animations:', Object.keys(renderModel.bmDat.animations));

        // Apply optimization
        console.log('\nApplying optimization...');
        const optimizer = new BMOptimizer(renderModel);
        optimizer.optimize();

        console.log('After optimization:');
        console.log('Children count:', renderModel.children.length);
        
        // Count draw calls (rough estimate)
        let drawCalls = 0;
        renderModel.traverse(child => {
            if (child.isMesh || child.isInstancedMesh) {
                drawCalls++;
            }
        });
        console.log('Estimated draw calls:', drawCalls);

        // Test animation system
        console.log('\nTesting animation...');
        renderModel.bmDat.animation = 'spinAnimation';
        
        // Simulate a few animation frames
        for (let i = 0; i < 3; i++) {
            console.log(`\nFrame ${i + 1}:`);
            OptimizedAnimationSystem.animateModel(renderModel, 0.016); // ~60fps
        }

        console.log('\nOptimization test completed successfully!');
        return renderModel;

    } catch (error) {
        console.error('Optimization test failed:', error);
        throw error;
    }
}

// Export for use in other contexts
export { testOptimization };

// If running directly, run the test
if (import.meta.url === new URL(process.argv[1], 'file://').href) {
    testOptimization().catch(console.error);
}
