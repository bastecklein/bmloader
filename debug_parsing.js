// Test to understand BMLoader instruction parsing flow
console.log('=== BMLoader Instruction Parsing Test ===\n');

// Simulate the parsing of: box(1,4,2,color) > rotate(10,0,0) > position(0,2.1,0);

function simulateInstructionParsing() {
    console.log('Parsing: box(1,4,2,color) > rotate(10,0,0) > position(0,2.1,0);');
    
    let usingVar = null;
    let usingObj = null;
    
    // Split by ">" to get individual operations
    const modParts = ['box(1,4,2,color)', 'rotate(10,0,0)', 'position(0,2.1,0)'];
    
    for (let i = 0; i < modParts.length; i++) {
        const mod = modParts[i].trim();
        console.log(`\nOperation ${i + 1}: "${mod}"`);
        console.log(`  Current usingObj: ${usingObj ? 'mesh object' : 'null'}`);
        console.log(`  Current usingVar: ${usingVar || 'null'}`);
        
        if (mod.startsWith('box(')) {
            console.log('  -> Creating box geometry');
            usingObj = { type: 'BoxMesh', position: {x:0, y:0, z:0}, rotation: {x:0, y:0, z:0} }; // Mock mesh
            console.log('  -> usingObj set to new mesh');
        }
        else if (mod.startsWith('rotate(')) {
            if (usingObj) {
                console.log('  -> Applying rotation to usingObj');
                usingObj.rotation = { x: 10 * Math.PI/180, y: 0, z: 0 };
                console.log('  -> Rotation applied successfully');
            } else {
                console.log('  -> ERROR: No usingObj to apply rotation to!');
            }
        }
        else if (mod.startsWith('position(')) {
            if (usingObj) {
                console.log('  -> Applying position to usingObj');
                usingObj.position = { x: 0, y: 2.1, z: 0 };
                console.log('  -> Position applied successfully');
            } else {
                console.log('  -> ERROR: No usingObj to apply position to!');
            }
        }
        
        console.log(`  Final usingObj: ${usingObj ? JSON.stringify(usingObj, null, 4) : 'null'}`);
    }
    
    console.log('\n=== Final Result ===');
    if (usingObj) {
        console.log('✅ Mesh created with transforms:');
        console.log(`   Position: (${usingObj.position.x}, ${usingObj.position.y}, ${usingObj.position.z})`);
        console.log(`   Rotation: (${(usingObj.rotation.x * 180/Math.PI).toFixed(1)}°, ${(usingObj.rotation.y * 180/Math.PI).toFixed(1)}°, ${(usingObj.rotation.z * 180/Math.PI).toFixed(1)}°)`);
    } else {
        console.log('❌ No mesh created or transforms lost');
    }
}

simulateInstructionParsing();

console.log('\n=== Analysis ===');
console.log('If this simulation works correctly, then the problem is NOT in the parsing logic.');
console.log('The issue must be in one of these areas:');
console.log('1. Matrix update timing - transforms applied but matrices not updated');
console.log('2. Matrix calculation - updateMatrix/updateMatrixWorld not working correctly');
console.log('3. Matrix application - applyMatrix4 not applying the correct transform');
console.log('4. Object reference issues - wrong objects being transformed');

console.log('\n=== Next Steps ===');
console.log('I need to add more detailed debugging to the actual merging process to see:');
console.log('- What the mesh.position/rotation/scale values are before matrix update');
console.log('- What the mesh.matrix contains after updateMatrix()');
console.log('- What the mesh.matrixWorld contains after updateMatrixWorld()');
console.log('- Whether the transforms are actually being applied to geometry');
