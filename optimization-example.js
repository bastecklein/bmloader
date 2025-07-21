// Example optimization system that works with your existing BMLoader

import { BufferGeometryUtils } from 'three/addons/utils/BufferGeometryUtils.js';
import { InstancedMesh, Matrix4, Object3D, Group, Mesh } from 'three';

class BMOptimizer {
    constructor(renderModel) {
        this.renderModel = renderModel;
        this.animatedObjects = new Set();
        this.staticGeometries = new Map(); // material -> geometries[]
        this.instanceGroups = new Map(); // geometry+material hash -> instances[]
    }

    optimize() {
        this.identifyAnimatedObjects();
        this.categorizeObjects();
        this.createOptimizedScene();
    }

    identifyAnimatedObjects() {
        // Scan all animations to find which objects are animated
        for (const animations of Object.values(this.renderModel.bmDat.animations)) {
            if (Array.isArray(animations)) {
                for (const anim of animations) {
                    this.animatedObjects.add(anim.target);
                }
            }
        }
    }

    categorizeObjects() {
        this.renderModel.traverse((child) => {
            if (!child.isMesh) return;

            const varName = this.findVariableNameForObject(child);
            
            if (this.animatedObjects.has(varName)) {
                // Keep animated objects separate
                child.userData.keepSeparate = true;
            } else {
                // Group static objects for potential optimization
                this.categorizeStaticObject(child);
            }
        });
    }

    categorizeStaticObject(mesh) {
        const materialKey = this.getMaterialKey(mesh.material);
        const geometryKey = this.getGeometryKey(mesh.geometry);
        const combinedKey = `${geometryKey}_${materialKey}`;

        // Check if this is a candidate for instancing (same geo + material)
        if (!this.instanceGroups.has(combinedKey)) {
            this.instanceGroups.set(combinedKey, []);
        }
        this.instanceGroups.get(combinedKey).push(mesh);

        // Also categorize for potential merging
        if (!this.staticGeometries.has(materialKey)) {
            this.staticGeometries.set(materialKey, []);
        }
        this.staticGeometries.get(materialKey).push(mesh);
    }

    createOptimizedScene() {
        const optimizedGroup = new Group();

        // Handle instancing for repeated objects
        for (const instances of this.instanceGroups.values()) {
            if (instances.length > 3) { // Only instance if we have multiple copies
                const instancedMesh = this.createInstancedMesh(instances);
                optimizedGroup.add(instancedMesh);
            } else {
                // Not worth instancing, add to merge candidates
                instances.forEach(mesh => {
                    if (!mesh.userData.keepSeparate) {
                        optimizedGroup.add(mesh);
                    }
                });
            }
        }

        // Handle merging for remaining static objects
        for (const meshes of this.staticGeometries.values()) {
            const nonInstancedMeshes = meshes.filter(m => !m.userData.instanced);
            if (nonInstancedMeshes.length > 1) {
                const mergedMesh = this.mergeMeshes(nonInstancedMeshes);
                optimizedGroup.add(mergedMesh);
            }
        }

        // Keep all animated objects unchanged
        this.renderModel.traverse((child) => {
            if (child.isMesh && child.userData.keepSeparate) {
                optimizedGroup.add(child.clone());
            }
        });

        // Replace the original scene content
        this.replaceSceneContent(optimizedGroup);
    }

    createInstancedMesh(instances) {
        const firstInstance = instances[0];
        const instancedMesh = new InstancedMesh(
            firstInstance.geometry,
            firstInstance.material,
            instances.length
        );

        // Set up instance matrices
        const dummy = new Object3D();
        instances.forEach((mesh, index) => {
            dummy.position.copy(mesh.position);
            dummy.rotation.copy(mesh.rotation);
            dummy.scale.copy(mesh.scale);
            dummy.updateMatrix();
            instancedMesh.setMatrixAt(index, dummy.matrix);
            mesh.userData.instanced = true;
        });

        instancedMesh.instanceMatrix.needsUpdate = true;
        return instancedMesh;
    }

    mergeMeshes(meshes) {
        const geometries = meshes.map(mesh => {
            const geo = mesh.geometry.clone();
            geo.applyMatrix4(mesh.matrixWorld);
            return geo;
        });

        const mergedGeometry = BufferGeometryUtils.mergeGeometries(geometries);
        return new Mesh(mergedGeometry, meshes[0].material);
    }

    findVariableNameForObject(object) {
        // Find which variable name corresponds to this object
        for (const [varName, varObj] of Object.entries(this.renderModel.bmDat.variables)) {
            if (varObj === object) {
                return varName;
            }
        }
        return null;
    }

    getMaterialKey(material) {
        // Create a key based on material properties for grouping
        return `${material.type}_${material.color?.getHexString() || 'none'}_${material.map?.uuid || 'none'}`;
    }

    getGeometryKey(geometry) {
        // Create a key based on geometry properties
        return `${geometry.type}_${geometry.parameters ? JSON.stringify(geometry.parameters) : geometry.uuid}`;
    }

    replaceSceneContent(newGroup) {
        // Clear existing content and add optimized version
        while (this.renderModel.children.length > 0) {
            this.renderModel.remove(this.renderModel.children[0]);
        }
        
        newGroup.children.forEach(child => {
            this.renderModel.add(child);
        });
    }
}

// Extended animation system that can handle optimized models
class OptimizedAnimationSystem {
    static animateModel(model, delta) {
        // Your existing animation logic, but with additional handling for instanced objects
        
        if (!model || !model.bmDat) return;
        
        if (!model.bmDat.animations || !model.bmDat.animation) {
            // Reset logic (same as before)
            if (model.bmDat.lastAnimation) {
                model.bmDat.lastAnimation = null;
                model.restoreState();
            }

            if (model.bmDat.animations) {
                for (const aniName in model.bmDat.animations) {
                    const ani = model.bmDat.animations[aniName];
                    if (Array.isArray(ani)) {
                        ani.forEach(a => a.step = 0);
                    }
                }
            }
            return;
        }

        if (model.bmDat.animation && !model.bmDat.lastAnimation) {
            model.saveState();
        }

        for (const aniName in model.bmDat.animations) {
            if (aniName == model.bmDat.animation) {
                continue;
            }
            
            const ani = model.bmDat.animations[aniName];
            if (Array.isArray(ani)) {
                ani.forEach(a => a.step = 0);
            }
        }

        model.bmDat.lastAnimation = model.bmDat.animation;

        if (!model.bmDat.animation) {
            return;
        }

        const animation = model.bmDat.animations[model.bmDat.animation];
        if (!animation) return;

        for (let i = 0; i < animation.length; i++) {
            const inst = animation[i];
            this.doAnimateOptimized(model, inst, delta);
        }
    }

    static doAnimateOptimized(model, inst, delta) {
        const ob = model.bmDat.variables[inst.target];
        
        if (!ob) return;

        // Check if this object is part of an instanced mesh
        if (ob.userData && ob.userData.instancedMeshRef) {
            this.animateInstancedObject(model, ob, inst, delta);
        } else {
            // Use simplified version of original animation logic for non-instanced objects
            this.doOriginalAnimate(model, inst, delta);
        }
    }

    static doOriginalAnimate(model, inst, delta) {
        const ob = model.bmDat.variables[inst.target];
        if (!ob) return;

        // Simplified version of your original doAnimate function
        const rawSpeed = this.getModValue(inst.speed, model);
        const speed = (parseFloat(rawSpeed) * Math.PI / 180) * delta;
        const rawVal = inst.steps[inst.step];
        const tgtVal = this.getModValue(rawVal, model);

        let changeBaseOb = null;
        let subProp = null;
        let target = null;

        if (inst.action.indexOf("scale") == 0) {
            changeBaseOb = "scale";
            subProp = inst.action.replace("scale","").toLowerCase();
            target = parseFloat(tgtVal);
        } else if (inst.action.indexOf("rotate") == 0) {
            changeBaseOb = "rotation";
            subProp = inst.action.replace("rotate","").toLowerCase();
            target = (parseFloat(tgtVal) * Math.PI / 180);
        } else if (inst.action.indexOf("position") == 0) {
            changeBaseOb = "position";
            subProp = inst.action.replace("position","").toLowerCase();
            target = parseFloat(tgtVal);
        }

        if (changeBaseOb && subProp && ob[changeBaseOb]) {
            const cur = ob[changeBaseOb][subProp];
            
            if (cur > target) {
                ob[changeBaseOb][subProp] -= speed;
                if (ob[changeBaseOb][subProp] <= target) {
                    ob[changeBaseOb][subProp] = target;
                    inst.step++;
                }
            } else {
                ob[changeBaseOb][subProp] += speed;
                if (ob[changeBaseOb][subProp] >= target) {
                    ob[changeBaseOb][subProp] = target;
                    inst.step++;
                }
            }

            if (inst.step >= inst.steps.length) {
                inst.step = 0;
            }
        }
    }

    static animateInstancedObject(model, ob, inst, delta) {
        // Custom logic for animating objects that are part of an InstancedMesh
        const instancedMesh = ob.userData.instancedMeshRef;
        const instanceIndex = ob.userData.instanceIndex;
        
        // Get current matrix
        const matrix = new Matrix4();
        instancedMesh.getMatrixAt(instanceIndex, matrix);
        
        // For now, just mark it as needing updates - full implementation would
        // decompose matrix, apply animation, and recompose
        console.log(`Animating instanced object ${inst.target} at index ${instanceIndex}`);
        
        instancedMesh.instanceMatrix.needsUpdate = true;
    }

    static getModValue(val, renderModel) {
        // Simplified version - you'd use your actual getModValue function
        if (typeof val !== 'string') return val;
        
        // Handle simple variable references
        if (val.startsWith('$')) {
            const varName = val.substring(1);
            return renderModel.bmDat.variables[varName] || 0;
        }
        
        return isNaN(val) ? val : parseFloat(val);
    }
}

export { BMOptimizer, OptimizedAnimationSystem };
