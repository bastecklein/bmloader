// Simple test to verify the optimization system works
import { JSDOM } from 'jsdom';

// Setup DOM environment for Three.js
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
global.document = dom.window.document;
global.window = dom.window;
global.Image = dom.window.Image;
global.HTMLCanvasElement = dom.window.HTMLCanvasElement;

// Mock canvas context for Three.js
HTMLCanvasElement.prototype.getContext = function() {
    return {
        canvas: this,
        fillStyle: '',
        fillRect: () => {},
        drawImage: () => {},
        getImageData: () => ({ data: new Uint8ClampedArray(4) }),
        putImageData: () => {},
        createImageData: () => ({ data: new Uint8ClampedArray(4) }),
        setTransform: () => {},
        drawArrays: () => {},
        createShader: () => ({}),
        shaderSource: () => {},
        compileShader: () => {},
        createProgram: () => ({}),
        attachShader: () => {},
        linkProgram: () => {},
        useProgram: () => {},
        createBuffer: () => ({}),
        bindBuffer: () => {},
        bufferData: () => {},
        enableVertexAttribArray: () => {},
        vertexAttribPointer: () => {},
        uniform1i: () => {},
        uniformMatrix4fv: () => {},
        activeTexture: () => {},
        bindTexture: () => {},
        texImage2D: () => {},
        texParameteri: () => {},
        createTexture: () => ({}),
        deleteTexture: () => {},
        isContextLost: () => false,
        getShaderParameter: () => true,
        getProgramParameter: () => true,
        getError: () => 0
    };
};

import { BMLoader, BasicModel } from './bmloader.js';

async function testOptimization() {
    console.log('🚀 Starting BMLoader optimization test...\n');

    try {
        // Create a test model with repeated elements
        const testModel = new BasicModel('test-app', '1.0');
        testModel.script = `
            $box1 = box(1,1,1,#ff0000) > position(0,0,0)
            $box2 = box(1,1,1,#ff0000) > position(2,0,0)
            $box3 = box(1,1,1,#ff0000) > position(4,0,0)
            $box4 = box(1,1,1,#ff0000) > position(6,0,0)
            $box5 = box(1,1,1,#ff0000) > position(8,0,0)
            
            $sphere1 = sphere(0.5,8,8,#00ff00) > position(1,2,0)
            $sphere2 = sphere(0.5,8,8,#00ff00) > position(3,2,0)
            $sphere3 = sphere(0.5,8,8,#00ff00) > position(5,2,0)
            
            $animatedCube = box(0.8,0.8,0.8,#0000ff) > position(2,4,0)
            
            @rotateAnim = rotateY($animatedCube, 45, 0, 90, 180, 270, 360)
        `;

        console.log('📝 Test model script created');
        console.log(`   - 5 identical red boxes (candidates for instancing)`);
        console.log(`   - 3 identical green spheres (candidates for instancing)`);
        console.log(`   - 1 animated blue cube (should remain separate)`);

        // Load the model
        const loader = new BMLoader();
        const renderModel = await new Promise((resolve, reject) => {
            loader.load(testModel, resolve, null, reject);
        });

        console.log('\n✅ Model loaded successfully');
        
        // Analyze original model
        let originalMeshCount = 0;
        let originalInstancedCount = 0;
        
        renderModel.traverse(child => {
            if (child.isMesh) originalMeshCount++;
            if (child.isInstancedMesh) originalInstancedCount++;
        });

        console.log(`📊 Original model stats:`);
        console.log(`   - Regular meshes: ${originalMeshCount}`);
        console.log(`   - Instanced meshes: ${originalInstancedCount}`);
        console.log(`   - Variables: ${Object.keys(renderModel.bmDat.variables).length}`);
        console.log(`   - Animations: ${Object.keys(renderModel.bmDat.animations).length}`);

        // Apply optimization
        console.log('\n🔧 Applying optimization...');
        renderModel.optimize({
            instanceThreshold: 2, // Lower threshold for testing
            preserveAnimated: true
        });

        // Analyze optimized model
        let optimizedMeshCount = 0;
        let optimizedInstancedCount = 0;
        
        renderModel.traverse(child => {
            if (child.isMesh) optimizedMeshCount++;
            if (child.isInstancedMesh) optimizedInstancedCount++;
        });

        console.log(`📈 Optimized model stats:`);
        console.log(`   - Regular meshes: ${optimizedMeshCount}`);
        console.log(`   - Instanced meshes: ${optimizedInstancedCount}`);
        console.log(`   - Total draw calls reduced from ${originalMeshCount} to ${optimizedMeshCount + optimizedInstancedCount}`);

        // Test that animations still work
        console.log('\n🎬 Testing animation system...');
        renderModel.bmDat.animation = 'rotateAnim';
        
        // Get the animated object reference
        const animatedObj = renderModel.bmDat.variables['animatedCube'];
        const initialRotation = animatedObj ? animatedObj.rotation.y : 0;
        
        // Simulate animation frame
        renderModel.animate(0.016); // ~60fps
        
        const newRotation = animatedObj ? animatedObj.rotation.y : 0;
        const rotationChanged = Math.abs(newRotation - initialRotation) > 0.001;

        console.log(`   - Initial rotation: ${initialRotation.toFixed(3)}`);
        console.log(`   - After animation: ${newRotation.toFixed(3)}`);
        console.log(`   - Animation working: ${rotationChanged ? '✅ Yes' : '❌ No'}`);

        // Summary
        const drawCallReduction = ((originalMeshCount - (optimizedMeshCount + optimizedInstancedCount)) / originalMeshCount * 100).toFixed(1);
        
        console.log('\n🎉 Optimization test completed!');
        console.log(`📉 Draw call reduction: ${drawCallReduction}%`);
        console.log(`🔄 Animation compatibility: ${rotationChanged ? 'Maintained' : 'Broken'}`);
        
        if (optimizedInstancedCount > 0 && rotationChanged) {
            console.log('🏆 SUCCESS: Optimization working correctly!');
        } else {
            console.log('⚠️  WARNING: Optimization may need adjustments');
        }

    } catch (error) {
        console.error('❌ Test failed:', error);
        process.exit(1);
    }
}

// Run the test
testOptimization().catch(console.error);
