# BMLoader Operations Reference

Complete documentation of all available operations in BMLoader.

## Table of Contents
- [Geometry Operations](#geometry-operations)
- [Material Operations](#material-operations)
- [Transform Operations](#transform-operations)
- [Animation Operations](#animation-operations)
- [Lighting Operations](#lighting-operations)
- [Advanced Operations](#advanced-operations)

---

## Geometry Operations

### sphere(radius, widthSegments, heightSegments, [color], [texture], [materialType])
Creates a spherical geometry.

**Parameters:**
- `radius` - Sphere radius
- `widthSegments` - Number of horizontal segments
- `heightSegments` - Number of vertical segments
- `color` (optional) - Hex color code (e.g., `#ff0000`) or `transparent`
- `texture` (optional) - Texture reference (e.g., `$myTexture`)
- `materialType` (optional) - Material type: `lambert`, `phong`, `standard`, `toon`, `basic`

**Example:**
```javascript
$ball > sphere(1, 32, 32, #ff0000)
$texturedBall > sphere(2, 64, 64, #ffffff, $ballTex)
```

---

### box(width, height, depth, [color], [texture], [materialType])
Creates a box geometry.

**Parameters:**
- `width` - Box width (X axis)
- `height` - Box height (Y axis)
- `depth` - Box depth (Z axis)
- `color` (optional) - Hex color code or `transparent`
- `texture` (optional) - Texture reference
- `materialType` (optional) - Material type

**Example:**
```javascript
$cube > box(2, 2, 2, #00ff00)
$crate > box(1, 1, 1, #ffffff, $crateTex)
```

---

### plane(width, height, [color], [texture], [materialType])
Creates a flat plane geometry.

**Parameters:**
- `width` - Plane width
- `height` - Plane height
- `color` (optional) - Hex color code or `transparent` (affects depthWrite)
- `texture` (optional) - Texture reference
- `materialType` (optional) - Material type

**Example:**
```javascript
$ground > plane(10, 10, #808080)
$wall > plane(5, 3, transparent, $wallTex)
```

---

### cylinder(radiusTop, radiusBottom, height, segments, [color], [texture], [materialType], [capMode])
Creates a cylindrical geometry.

**Parameters:**
- `radiusTop` - Top radius
- `radiusBottom` - Bottom radius
- `height` - Cylinder height
- `segments` - Number of radial segments
- `color` (optional) - Hex color code
- `texture` (optional) - Texture reference
- `materialType` (optional) - Material type
- `capMode` (optional) - Cylinder cap mode: `closed` (default), `open`/`openEnded`, `openTop`, or `openBottom`

**Example:**
```javascript
$pillar > cylinder(1, 1, 5, 16, #cccccc)
$cone > cylinder(0, 1, 2, 16, #ff0000)
$can > cylinder(1, 1, 3, 24, #cccccc, , , open)
$pipe > cylinder(1, 1, 4, 24, #999999, , , openTop)
$cup > cylinder(1, 1, 4, 24, #999999, , , openBottom)
```

---

### cone(radius, height, segments, [color], [texture], [materialType])
Creates a cone geometry.

**Parameters:**
- `radius` - Base radius
- `height` - Cone height
- `segments` - Number of radial segments
- `color` (optional) - Hex color code
- `texture` (optional) - Texture reference
- `materialType` (optional) - Material type

**Example:**
```javascript
$traffic > cone(0.5, 1, 8, #ff6600)
```

---

### torus(radius, tube, radialSegments, tubularSegments, [color], [texture], [materialType])
Creates a torus (donut) geometry.

**Parameters:**
- `radius` - Torus radius
- `tube` - Tube thickness
- `radialSegments` - Radial segments
- `tubularSegments` - Tubular segments
- `color` (optional) - Hex color code
- `texture` (optional) - Texture reference
- `materialType` (optional) - Material type

**Example:**
```javascript
$donut > torus(2, 0.5, 16, 32, #ffcc00)
```

---

### capsule(radius, length, capSegments, radialSegments, [color], [texture], [materialType])
Creates a capsule geometry.

**Parameters:**
- `radius` - Capsule radius
- `length` - Capsule length (excluding caps)
- `capSegments` - Number of cap segments
- `radialSegments` - Number of radial segments
- `color` (optional) - Hex color code
- `texture` (optional) - Texture reference
- `materialType` (optional) - Material type

**Example:**
```javascript
$pill > capsule(0.3, 1.5, 4, 8, #ffffff)
```

---

### shape(points, extrudeDepth, [bevelSize], [bevelThickness], [bevelOffset], [color], [texture], [materialType])
Creates an extruded shape from 2D points.

**Parameters:**
- `points` - Pipe-separated coordinate pairs: `x|y|x|y|...`
- `extrudeDepth` - Extrusion depth
- `bevelSize` (optional) - Bevel size (0 = no bevel)
- `bevelThickness` (optional) - Bevel thickness
- `bevelOffset` (optional) - Bevel offset
- `color` (optional) - Hex color code
- `texture` (optional) - Texture reference
- `materialType` (optional) - Material type

**Example:**
```javascript
$star > shape(0|1|0.3|0.3|1|0.3|0.5|-0.5|-0.5|-0.5, 0.2, 0, 0, 0, #ffff00)
```

---

### lathe(points, phiLength, segments, [color], [texture], [materialType])
Creates a lathed geometry by rotating points around an axis.

**Parameters:**
- `points` - Pipe-separated coordinate pairs: `x|y|x|y|...`
- `phiLength` - Rotation angle in radians (Math.PI * 2 = full circle)
- `segments` - Number of segments
- `color` (optional) - Hex color code
- `texture` (optional) - Texture reference
- `materialType` (optional) - Material type

**Example:**
```javascript
$vase > lathe(0|0|1|0|1.2|1|1|2|0.5|3, 6.28, 32, #8B4513)
```

---

### ring(innerRadius, outerRadius, [segments], [color], [texture], [materialType])
Creates a flat ring (donut shape) geometry.

**Parameters:**
- `innerRadius` - Inner radius (hole size)
- `outerRadius` - Outer radius (ring size)
- `segments` (optional) - Number of segments (default: 32)
- `color` (optional) - Hex color code
- `texture` (optional) - Texture reference
- `materialType` (optional) - Material type

**Example:**
```javascript
$halo > ring(0.8, 1, 64, #ffff00) > rotate(90, 0, 0)
$portal > ring(2, 2.5, 48, #00ffff) > position(0, 0, 0)
$radar > ring(0, 5, 64, transparent, $radarTex)
```

---

### text(string, [size], [height], [bevelSize], [bevelThickness], [color], [texture], [materialType], [fontUrl])
Creates 3D text geometry.

**Parameters:**
- `string` - Text to display
- `size` (optional) - Font size (default: 1)
- `height` (optional) - Extrusion depth (default: 0.2)
- `bevelSize` (optional) - Bevel size (default: 0.02, set to 0 for no bevel)
- `bevelThickness` (optional) - Bevel thickness (default: 0.01)
- `color` (optional) - Hex color code
- `texture` (optional) - Texture reference
- `materialType` (optional) - Material type
- `fontUrl` (optional) - URL to a Three.js typeface.json font file (default: Helvetiker)

**Notes:**
- Default font is Helvetiker loaded from Three.js CDN
- Fonts are cached after first load
- Custom fonts must be in Three.js typeface.json format
- TrueType fonts (.ttf) must be converted first using [facetype.js](https://gero3.github.io/facetype.js/)

**Example:**
```javascript
// Default font (Helvetiker)
$sign > text(HELLO, 1, 0.2, 0.02, 0.01, #ff0000) > position(0, 2, 0)
$label > text(START, 0.5, 0.1, 0, 0, #00ff00) > rotate(0, 180, 0)

// Custom font (requires Three.js typeface.json format)
$custom > text(HELLO, 2, 0.3, 0, 0, #ffffff, , , https://example.com/fonts/custom_font.json)
```

---

### empty()
Creates an empty group object (no geometry).

**Example:**
```javascript
$container > empty() > position(0, 5, 0)
```

---

### clone($sourceObject)
Clones any object (mesh, group, light, etc.) with all its children and properties.

**Parameters:**
- `$sourceObject` - Variable reference to object to clone

**Features:**
- Works with meshes, groups, lights, and any Three.js object
- Deep clones all children recursively
- Shares geometries and materials (efficient)
- Can be assigned to a variable for further modification

**Example:**
```javascript
$original > sphere(1, 32, 32, #ff0000) > position(0, 0, 0)
$copy1 > clone($original) > position(3, 0, 0)
$copy2 > clone($original) > position(-3, 0, 0) > scale(1.5, 1.5, 1.5)

// Clone groups
$tree > empty()
$trunk > cylinder(0.2, 0.2, 2, 8, #8B4513) > add($tree)
$leaves > sphere(1, 16, 16, #228B22) > position(0, 2, 0) > add($tree)

$forest1 > clone($tree) > position(5, 0, 0)
$forest2 > clone($tree) > position(-5, 0, 5)
$forest3 > clone($tree) > position(10, 0, -3)
```

---

### usegeo($sourceObject)
Reuses geometry from another object (geometry sharing for performance).

**Example:**
```javascript
$original > sphere(1, 32, 32, #ff0000)
$copy > usegeo($original) > position(5, 0, 0)
```

---

## Material Operations

### material(color, [shininess], [metalness], [roughness], [lightMap], [bumpMap], [emissive], [emissiveIntensity], [sideMode])
Modifies material properties of an existing object.

**Parameters:**
- `color` - Hex color code (e.g., `#ff0000`)
- `shininess` (optional) - Shininess for phong materials (0-100)
- `metalness` (optional) - Metalness for standard materials (0-1)
- `roughness` (optional) - Roughness for standard materials (0-1)
- `lightMap` (optional) - Light map texture reference
- `bumpMap` (optional) - Bump map texture reference
- `emissive` (optional) - Emissive color (glow color)
- `emissiveIntensity` (optional) - Emissive intensity (brightness multiplier, default 1)
- `sideMode` (optional) - Face culling mode: `front` (default), `double`, or `back`

**Example:**
```javascript
$obj > sphere(1, 32, 32) > material(#ff0000, 30, 0.5, 0.2)
$glowing > box(1, 1, 1) > material(#222222, 0, 0, 0, 0, 0, #ff6600, 3)
$tube > cylinder(1, 1, 3, 24, #bbbbbb, , , open) > material(#bbbbbb, 0, 0, 0, 0, 0, 0, 1, double)
$insideOnly > plane(4, 4, #ffffff, $wallTex) > material(#ffffff, 0, 0, 0, 0, 0, 0, 1, back)
```

---

### lightmap($texture, 1.0)
Applies a light map texture to an object (baked lighting).

**Parameters:**
- `$texture` - Texture reference
- Intensity

**Example:**
```javascript
$room > box(10, 10, 10) > lightmap($roomLightmap)
```

---

### bumpmap($texture, 1.0)
Applies a bump map texture to an object (surface detail).

**Parameters:**
- `$texture` - Texture reference
- Intensity

**Example:**
```javascript
$wall > plane(5, 5) > bumpmap($brickBump)
```

---

### opacity(value)
Sets the opacity of an object's material.

**Parameters:**
- `value` - Opacity value (0 = fully transparent, 1 = fully opaque)

**Example:**
```javascript
$glass > box(1, 1, 1, #ccccff) > opacity(0.3)
```

---

### visible(value)
Sets the visibility of an object.

**Parameters:**
- `value` - Visibility state (0/false = hidden, 1/true = visible)

**Example:**
```javascript
$hidden > box(1, 1, 1, #ff0000) > visible(0)
$shown > sphere(1, 32, 32, #00ff00) > visible(1)
```

---

## Transform Operations

### position(x, y, z)
Sets the position of an object.

**Parameters:**
- `x` - X coordinate
- `y` - Y coordinate
- `z` - Z coordinate

**Example:**
```javascript
$obj > sphere(1, 32, 32) > position(5, 2, -3)
```

---

### rotate(x, y, z)
Sets the rotation of an object (in degrees).

**Parameters:**
- `x` - X rotation (pitch)
- `y` - Y rotation (yaw)
- `z` - Z rotation (roll)

**Example:**
```javascript
$obj > box(1, 2, 1) > rotate(0, 45, 0)
```

---

### scale(x, y, z)
Sets the scale of an object.

**Parameters:**
- `x` - X scale
- `y` - Y scale
- `z` - Z scale

**Example:**
```javascript
$obj > sphere(1, 32, 32) > scale(2, 1, 1)
```

---

### orientation(x, y, z)
Sets the orientation vector (custom property, not standard Three.js).

**Parameters:**
- `x` - X component
- `y` - Y component
- `z` - Z component

**Example:**
```javascript
$obj > sphere(1, 32, 32) > orientation(1, 0, 0)
```

---

### geotranslate(x, y, z)
Translates the geometry origin (affects subsequent geometry creation).

**Parameters:**
- `x` - X offset
- `y` - Y offset
- `z` - Z offset

**Example:**
```javascript
geotranslate(0, 0.5, 0)
$centered > box(1, 1, 1)
geotranslate(0, 0, 0)
```

---

### bottomAlign()
Aligns an object to sit on the Y=0 plane (bottom of bounding box at y=0).

**Example:**
```javascript
$tree > cylinder(0.2, 0.2, 5, 8) > bottomAlign()
```

---

## Animation Operations

Animations are defined with the syntax: `@name > $object > action > values > speed`

### Supported Actions

#### Position Animations
- `positionX` - Animate X position
- `positionY` - Animate Y position
- `positionZ` - Animate Z position

**Example:**
```javascript
@bounce > $ball > positionY > 0|2|0 > 2
```

---

#### Rotation Animations
- `rotateX` - Animate X rotation (degrees)
- `rotateY` - Animate Y rotation (degrees)
- `rotateZ` - Animate Z rotation (degrees)

**Example:**
```javascript
@spin > $propeller > rotateY > 0|360 > 5
```

---

#### Scale Animations
- `scaleX` - Animate X scale
- `scaleY` - Animate Y scale
- `scaleZ` - Animate Z scale

**Example:**
```javascript
@pulse > $heart > scaleX > 1|1.2|1 > 1
@pulse > $heart > scaleY > 1|1.2|1 > 1
@pulse > $heart > scaleZ > 1|1.2|1 > 1
```

---

#### Material Property Animations

##### emissiveIntensity
Animates the emissive intensity (glow brightness).

**Example:**
```javascript
@blink > $light > emissiveIntensity > 0|3|0 > 0.5
@pulse > $beacon > emissiveIntensity > 1|5|1|0.5 > 2
```

---

##### opacity
Animates the material opacity.

**Example:**
```javascript
@fade > $ghost > opacity > 1|0.2|1 > 3
```

---

##### visible
Toggles object visibility on/off. Uses time-based intervals (not smooth transitions).

**Example:**
```javascript
@blink > $warning > visible > 1|0|1|0 > 0.5
@flash > $strobe > visible > 1|0 > 0.1
```

---

#### Texture Change Animation

##### txChange
Cycles through different textures (frame animation).

**Example:**
```javascript
@animate > $sprite > txChange > $frame1|$frame2|$frame3 > 0.1
```

---

## Lighting Operations

### fakelight(color, size, [intensity])
Creates a performant fake light sprite using a radial gradient billboard.

**✨ RECOMMENDED:** Much faster than real point lights! Perfect for visual glow effects.

**Parameters:**
- `color` - Light color hex code (e.g., `#ff6600`)
- `size` - Sprite size (diameter)
- `intensity` (optional) - Brightness multiplier (default: 1, can go higher for brighter glows)

**Features:**
- Additive blending (glows stack naturally)
- Cached gradient textures (multiple instances share same texture)
- Always faces camera (billboard behavior)
- No depth write (renders on top)
- Zero lighting calculations (pure performance)

**Example:**
```javascript
$streetLight > fakelight(#ffaa00, 2, 1.5) > position(0, 5, 0)
$redBeacon > fakelight(#ff0000, 1, 2) > position(5, 2, 0)
$blueglow > fakelight(#0088ff, 3, 0.8) > position(-5, 1, 0)
```

**Animation Support:**
```javascript
$pulsing > fakelight(#ff00ff, 2, 1)
@pulse > $pulsing > scaleX > 1|1.5|1 > 1
@pulse > $pulsing > scaleY > 1|1.5|1 > 1
@blink > $pulsing > visible > 1|0|1|0 > 0.5
```

---

### pointlight([color], [intensity], [distance], [decay])
Creates a point light source.

**⚠️ PERFORMANCE WARNING:** Point lights are expensive! Use `fakelight()` or emissive materials instead for better performance.

**Parameters:**
- `color` (optional) - Light color hex code (default: `#ffffff`)
- `intensity` (optional) - Light intensity (default: 1)
- `distance` (optional) - Light range (default: 10, use 0 for infinite but slower)
- `decay` (optional) - Light decay (default: 2)

**Example:**
```javascript
$light > pointlight(#ff6600, 2, 5, 2) > position(0, 3, 0)
```

**Better Alternatives:**

*For visual glow (doesn't light other objects):*
```javascript
$light > fakelight(#ff6600, 2, 1.5) > position(0, 3, 0)
```

*For glowing object (emissive):*
```javascript
$light > sphere(0.5, 16, 16) > material(#222222, 0, 0, 0, 0, 0, #ff6600, 3) > position(0, 3, 0)
```

---

## Advanced Operations

### Variables
Store objects or values in variables using `$name = value` syntax.

**Example:**
```javascript
$height = 5
$myBox = box(1, $height, 1, #ff0000)
$myBox > position(0, 0, 0)
```

---

### Variable Overrides
Override variable values when cloning models (via loader options).

**Example:**
```javascript
const model1 = await loader.load('model.bm', { variableOverrides: { height: 10 } });
```

---

### Expressions
Use mathematical expressions in values.

**Example:**
```javascript
$radius = 2
$ball > sphere($radius * 2, 32, 32) > position(0, $radius + 1, 0)
```

---

### Decals
Apply decal textures to object surfaces.

**Syntax:** `decal($targetObject, $texture, posX, posY, posZ, orientX, orientY, orientZ, scaleX, scaleY, scaleZ)`

**Example:**
```javascript
$wall > plane(5, 5, #cccccc)
$logo > decal($wall, $logoTex, 0, 0, 0.1, 0, 0, 0, 1, 1, 1)
```

---

### Adding Objects
Add one object to another using `add($object)`.

**Example:**
```javascript
$parent > empty()
$child > sphere(1, 32, 32) > add($parent)
```

---

## Loader Options

Configure the BMLoader with these options:

```javascript
const loader = new BMLoader({
    imgQuality: 0.85,           // Image quality (0-1)
    defMaterial: 'lambert',     // Default material type
    enableLights: true          // Enable/disable lights (false = better performance)
});
```

---

## Performance Tips

1. **Use Fake Lights:** Use `fakelight()` instead of `pointlight()` for visual glow effects
2. **Avoid Real Point Lights:** Only use `pointlight()` if you need actual scene lighting
3. **Share Geometries:** Use `usegeo()` for repeated objects
4. **Use Basic Material:** Set `defMaterial: 'basic'` for unlit scenes
5. **Limit Light Distance:** Keep point light distance values low
6. **Cache Materials:** Identical materials are automatically cached
7. **Use Lightmaps:** Bake lighting into textures for static scenes
8. **Use Emissive:** For glowing objects, use emissive materials instead of lights

---

## Complete Example

```javascript
// Define variables
$towerHeight = 10
$towerRadius = 2

// Create tower base
$base > cylinder($towerRadius, $towerRadius + 0.5, 1, 16, #808080) > position(0, 0, 0)

// Create tower body
$tower > cylinder($towerRadius, $towerRadius, $towerHeight, 16, #cccccc) > position(0, $towerHeight / 2, 0)

// Create fake light on top (performant alternative to pointlight)
$beacon > fakelight(#ff0000, 1.5, 2) > position(0, $towerHeight + 0.5, 0)

// Add pulsing animation to beacon
@pulse > $beacon > scaleX > 1|1.3|1 > 1
@pulse > $beacon > scaleY > 1|1.3|1 > 1
@spin > $beacon > rotateZ > 0|360 > 3
```
