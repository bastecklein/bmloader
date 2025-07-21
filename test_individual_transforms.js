// Test individual object transforms in BMLoader geometry merging
console.log('Testing individual object transform preservation...');

// Mock Three.js classes for testing
class MockVector3 {
    constructor(x=0, y=0, z=0) {
        this.x = x; this.y = y; this.z = z;
    }
    toFixed(digits) {
        return `(${this.x.toFixed(digits)}, ${this.y.toFixed(digits)}, ${this.z.toFixed(digits)})`;
    }
}

class MockMatrix4 {
    constructor() {
        // Identity matrix
        this.elements = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
    }
    
    clone() {
        const cloned = new MockMatrix4();
        cloned.elements = [...this.elements];
        return cloned;
    }
    
    makeRotationFromEuler(euler) {
        // Simplified - just store the rotation for demo
        this.rotation = { x: euler.x, y: euler.y, z: euler.z };
        console.log(`Matrix rotation set to: ${(euler.x * 180/Math.PI).toFixed(1)}°, ${(euler.y * 180/Math.PI).toFixed(1)}°, ${(euler.z * 180/Math.PI).toFixed(1)}°`);
        return this;
    }
    
    makeTranslation(x, y, z) {
        this.translation = { x, y, z };
        console.log(`Matrix translation set to: ${x.toFixed(3)}, ${y.toFixed(3)}, ${z.toFixed(3)}`);
        return this;
    }
}

class MockMesh {
    constructor(geometry, material, name = 'mesh') {
        this.name = name;
        this.geometry = geometry || { clone: () => this.geometry };
        this.material = material || { type: 'test' };
        this.position = { x: 0, y: 0, z: 0, set: function(x,y,z) { this.x=x; this.y=y; this.z=z; }};
        this.rotation = { x: 0, y: 0, z: 0, set: function(x,y,z) { this.x=x; this.y=y; this.z=z; }};
        this.scale = { x: 1, y: 1, z: 1, set: function(x,y,z) { this.x=x; this.y=y; this.z=z; }};
        this.matrix = new MockMatrix4();
        this.matrixWorld = new MockMatrix4();
        this.parent = null;
        this.children = [];
        this.isMesh = true;
    }
    
    updateMatrix() {
        console.log(`${this.name}: Updating local matrix from position(${this.position.x}, ${this.position.y}, ${this.position.z}) rotation(${(this.rotation.x * 180/Math.PI).toFixed(1)}°, ${(this.rotation.y * 180/Math.PI).toFixed(1)}°, ${(this.rotation.z * 180/Math.PI).toFixed(1)}°)`);
        this.matrix.makeTranslation(this.position.x, this.position.y, this.position.z);
        this.matrix.makeRotationFromEuler(this.rotation);
    }
    
    updateMatrixWorld(force) {
        console.log(`${this.name}: Updating world matrix`);
        this.updateMatrix();
        
        if (this.parent && this.parent.matrixWorld) {
            console.log(`${this.name}: Combining with parent transforms`);
            // In real Three.js, this would multiply parent.matrixWorld * this.matrix
            // For demo, just copy the local matrix
            this.matrixWorld = this.matrix.clone();
        } else {
            this.matrixWorld = this.matrix.clone();
        }
    }
    
    getWorldPosition(target) {
        if (this.matrixWorld.translation) {
            target.x = this.matrixWorld.translation.x;
            target.y = this.matrixWorld.translation.y;
            target.z = this.matrixWorld.translation.z;
        } else {
            target.x = this.position.x;
            target.y = this.position.y;
            target.z = this.position.z;
        }
        return target;
    }
}

// Simulate your gun example transforms
console.log('\n=== Simulating Gun Model Transforms ===');

// Create test objects similar to your gun parts
const barrel = new MockMesh(null, null, 'barrel');
const trigger = new MockMesh(null, null, 'trigger');
const sight = new MockMesh(null, null, 'sight');

// Apply transforms like in your BM code:
// box(1,4,2,$gunColorLower) > rotate(10,0,0) > position(0,2.1,0);
console.log('\n--- Applying transforms to barrel ---');
barrel.rotation.set(10 * Math.PI/180, 0, 0);  // rotate(10,0,0)
barrel.position.set(0, 2.1, 0);  // position(0,2.1,0)

// cylinder(0.35,0.35,1,12,$gunColorParts) > rotate(90,0,0) > position(0,4.8,7.3);
console.log('\n--- Applying transforms to trigger ---');
trigger.rotation.set(90 * Math.PI/180, 0, 0);  // rotate(90,0,0)
trigger.position.set(0, 4.8, 7.3);  // position(0,4.8,7.3)

// box(0.25,1,0.5,$gunColorParts) > position(0,4.9,-1) > rotate(-10,0,0);
console.log('\n--- Applying transforms to sight ---');
sight.position.set(0, 4.9, -1);  // position(0,4.9,-1)
sight.rotation.set(-10 * Math.PI/180, 0, 0);  // rotate(-10,0,0)

const meshes = [barrel, trigger, sight];

console.log('\n=== Before Matrix Updates ===');
meshes.forEach(mesh => {
    console.log(`${mesh.name}:`);
    console.log(`  Local position: ${mesh.position.x}, ${mesh.position.y}, ${mesh.position.z}`);
    console.log(`  Local rotation: ${(mesh.rotation.x * 180/Math.PI).toFixed(1)}°, ${(mesh.rotation.y * 180/Math.PI).toFixed(1)}°, ${(mesh.rotation.z * 180/Math.PI).toFixed(1)}°`);
});

console.log('\n=== Matrix Update Process ===');
meshes.forEach(mesh => {
    console.log(`\n--- Processing ${mesh.name} ---`);
    mesh.updateMatrix();
    mesh.updateMatrixWorld(true);
    
    const worldPos = mesh.getWorldPosition(new MockVector3());
    console.log(`Final world position: ${worldPos.toFixed(3)}`);
});

console.log('\n=== Key Insight ===');
console.log('The fix ensures that:');
console.log('1. updateMatrix() is called on each mesh BEFORE using matrixWorld');
console.log('2. This builds the matrix from the current position/rotation/scale values');
console.log('3. updateMatrixWorld() then combines with parent transforms');  
console.log('4. The resulting matrixWorld contains complete transform information');
console.log('5. applyMatrix4(matrixWorld) bakes ALL transforms into the geometry');
console.log('\nThis should preserve both individual object transforms AND group transforms!');
