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
- `capMode` (optional) - Cylinder cap mode: `closed` (default) or `open`/`openEnded`
- `openTop` and `openBottom` are accepted aliases and currently behave like `open`

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

// Clone groups — build the parts first, then parent them into the group.
// See "Adding Objects" for why the direction matters.
$tree > empty()
$trunk > cylinder(0.2, 0.2, 2, 8, #8B4513)
$leaves > sphere(1, 16, 16, #228B22) > position(0, 2, 0)
$tree > add($trunk)
$tree > add($leaves)

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

### texture($texture)
Applies or replaces the main color texture on an existing object.

This is useful for merged geometry created with `startmerge()` / `endmerge()`, because merged meshes do not have a creation-time texture slot.

Texture references can include optional modifiers using `&key=value`, such as `&repeatX=2`, `&repeatY=2`, `&offsetX=0.25`, `&offsetY=0.1`, `&rotation=45`, `&centerX=0.5`, `&centerY=0.5`, `&wrap=repeat`, `&wrap=clamp`, `&wrap=mirror`, `&wrapX=repeat`, and `&wrapY=clamp`.

See `examples/merged-texture-demo.bm` for a minimal merged-geometry example.
See `examples/texture-transform-demo.bm` for offset and rotation on a plane texture.

**Parameters:**
- `$texture` - Texture reference

**Example:**
```javascript
$merged = startmerge()
box(1, 1, 1) > position(-1, 0, 0)
box(1, 1, 1) > position(1, 0, 0)
endmerge()
$merged > texture($crateTex&repeatX=2&repeatY=2&wrap=repeat)
```

---

### lightmap($texture, 1.0)
Applies a light map texture to an object (baked lighting).

The texture reference accepts the same `&key=value` modifiers as `texture($texture)`.

**Parameters:**
- `$texture` - Texture reference
- Intensity

> **Note:** the light map is a separate texture object from the object's color
> texture, and it does not inherit that texture's repeat, offset, or wrap
> settings. If the two need to line up, repeat the color texture's numbers on the
> light map reference as well.

**Example:**
```javascript
$room > box(10, 10, 10) > lightmap($roomLightmap)
```

---

### bumpmap($texture, 1.0)
Applies a bump map texture to an object (surface detail).

The texture reference accepts the same `&key=value` modifiers as `texture($texture)`.

**Parameters:**
- `$texture` - Texture reference
- Intensity

> **Note:** the bump texture is a separate texture object from the object's color
> texture, and it does not inherit that texture's repeat, offset, or wrap
> settings. A bare `bumpmap($brickBump)` therefore tiles once (`repeatX=1`,
> `repeatY=1`, clamped) even when the color texture on the same object repeats
> many times. The surface is still bumped and the color texture is still correct,
> and nothing warns — but the relief lines up with nothing and reads as large
> soft blobs. Repeat the color texture's repeat numbers verbatim on the bump
> reference.

**Example:**
```javascript
$wall > plane(5, 5) > bumpmap($brickBump)
```

Matching a color texture that repeats 4 x 4:
```javascript
$wall > plane(5, 5) > bumpmap($brickBump&repeatX=4&repeatY=4&wrap=repeat)
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

### hemispherelight([skyColor], [groundColor], [intensity])
A sky/ground light pair: `skyColor` colours whatever faces up, `groundColor` whatever faces
down, and the two blend across the surface normal.

**Parameters:**
- `skyColor` (optional) - Default: `#ffffff`
- `groundColor` (optional) - Default: `#444444`
- `intensity` (optional) - Default: 1

**Example:**
```javascript
$sky > hemispherelight(#bfd9ff, #1a120b, 0.85)
```

Far cheaper than `pointlight()` — it is one blend per pixel with no positional falloff — so
it is the sensible broad fill light for a large surface, where a point light would be paying
for falloff it does not need.

---

### directionallight([color], [intensity], [dirX], [dirY], [dirZ])
A sun-like light. `dirX, dirY, dirZ` is the direction the light **travels** — the default
`(0, -1, 0)` shines straight down.

**Parameters:**
- `color` (optional) - Default: `#ffffff`
- `intensity` (optional) - Default: 1
- `dirX`, `dirY`, `dirZ` (optional) - Default: `0, -1, 0`

**Example:**
```javascript
$sun > directionallight(#fff1dd, 1.2, 0, 0.6, -0.8) > position(4, 9, 3)
```

> **⚠️ Do not "simplify" the aim into a target position.** A three.js `DirectionalLight`
> aims at its `target`, and three.js only refreshes the world matrix of a target that is
> **in the scene graph**. A target that is merely positioned is silently ignored and the
> light aims at the world **origin** — and because `THREE`'s own `.clone()` copies
> `target.position`, the object inspects as correct and renders as wrong.
>
> This is why `directionallight()` parents its target *into the light itself*: the offset
> then IS the aim vector, and as a child it is always in the graph. If you write a new
> light operation, do the same — and test the **effective aim** after
> `updateMatrixWorld()`, never `light.target.position`, which passes on a broken light.

`directionallight()` does not cast shadows (`castShadow` stays `false`). Shadow budget
belongs to the host engine, not to a model.

---

### fog([color], [near], [far])
Declares scene fog.

**Parameters:**
- `color` (optional) - Default: `#ffffff`
- `near` (optional) - Default: 1
- `far` (optional) - Default: 100

**Example:**
```javascript
fog(#c8d8ff, 20, 140)
```

Unlike every other operation here, **fog is not an object**. It is a `Scene` property
(`scene.fog`) and this loader never holds a `Scene` reference, so there is nothing to parent
it to and nothing for the clone to carry. It is recorded as data instead:

```javascript
const fog = model.bmDat.fog; // { color, near, far }, or null
scene.fog = fog ? new Fog(fog.color, fog.near, fog.far) : null;
```

Use it standalone — it has no position, so a transform chained after it does nothing.
Fog is atmosphere rather than lighting, so it is still recorded when `enableLights: false`.

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

Variables resolve **top-down**, and a name that is not assigned yet is not an
error.

> **Warning:** a variable used before it is declared evaluates to nothing, and the
> geometry it sizes comes out wrong rather than failing.
>
> A bare use gives a zero-sized object:
>
> ```javascript
> $box > box($width, 1, 1, #ff0000)   // built zero wide
> // ...
> $width = 6
> ```
>
> That is the harmless version, because a zero-sized object is visibly missing.
> Inside an expression it is worse: the missing term contributes `0` and the result
> still looks plausible.
>
> ```javascript
> $span = $front + $length + $back   // 2 + 0 + 2, not 2 + 30 + 2
> // ...
> $length = 30
> ```
>
> Declare the values a model is *parameterised by* at the top of the script, above
> everything that reads them.

---

### Derived Variables
A variable assigned an expression keeps that expression as **text**, and evaluates
it wherever it is used.

```javascript
$width = 2.2
$half = $width / 2
$left > box($half, 1, 1, #ff0000)   // evaluates to 1.1
```

That is what lets one override carry a long way. A parameter read by a derived
variable, read by a position, all move together:

```javascript
$gutterX = $laneWidth / 2 + $gutterWidth / 2
$gutterL > box($gutterWidth, 0.16, 30, #232c3d, 0, standard) > position(-$gutterX, -0.12, 0)
```

Loading that with `{ variables: { laneWidth: 4.4 } }` moves the gutter out with the
boards, because `$gutterX` is re-evaluated against the override rather than baked
in at assignment.

> **Note:** a derived variable is not readable as a number. `getPart('half')`
> returns the string `"$width/2"`, so `Number()` of it is `NaN`. Only a literal is
> readable back — write a value another system has to READ as a literal, not as a
> derivation.

> **Warning:** an expression is evaluated with `$` stripped, so a variable whose
> name matches a built-in of the expression evaluator is **shadowed by it**. The
> arithmetic then returns nonsense with no error:
>
> ```javascript
> $length = 3
> $other = 10
> $span = $length + $other   // 3, not 13 — `length` is the evaluator's own length()
> ```
>
> This affects 53 names: `length`, `abs`, `ceil`, `floor`, `round`, `trunc`, `sign`,
> `sqrt`, `cbrt`, `exp`, `log`, `log2`, `log10`, `lg`, `ln`, `log1p`, `expm1`, `min`,
> `max`, `pow`, `random`, `fac`, `gamma`, `hypot`, `pyt`, `roundTo`, `atan2`, `sin`,
> `cos`, `tan`, `asin`, `acos`, `atan`, `sinh`, `cosh`, `tanh`, `asinh`, `acosh`,
> `atanh`, `if`, `in`, `and`, `or`, `not`, `map`, `filter`, `fold`, `join`,
> `indexOf`, `E`, `PI`, `true`, `false`.
>
> A name that merely contains one is fine — `laneLength` and `lengthOfLane` are both
> safe — so the collision is exact-match, and easy to miss. It also only fires inside
> an expression: the same variable used as a bare argument resolves normally, which
> is why trying it once is not proof that it works.

---

### Variable Overrides
Override a model's variables at load time by passing a `variables` object in the
loader options. Values are applied before the script is evaluated, so an override
can change geometry as well as appearance.

**Example:**
```javascript
const model = await loader.load('model.bm', { variables: { height: 10 } });
```

This works with all three object sources — `url`, `json`, and the flat
`{ id, script }` form. A bare URL **string** cannot carry overrides; use the
options-object form.

```javascript
loader.load({ id, script, variables: { height: 10 } });          // applied
loader.load({ json: { id, script }, variables: { height: 10 } }); // applied
loader.load({ url, variables: { height: 10 } });                 // applied
```

> **Fixed.** The flat `{ id, script }` form used to discard `variables` silently,
> because it called `loadBM(modelDat, null, scope)` while the other two paths passed
> the wrapper through. If you have code that relies on the old behaviour — an
> override deliberately passed and expected to be ignored — that reliance is gone.

An override is also not readable back off the model. `getPart('height')` returns
the script's declared default and never the value that was passed in, because an
override lives beside the script rather than in it. Whatever supplied an override
has to remember what it supplied.

An override naming a variable the script never declares is **dropped silently**:
`{ hieght: 10 }` against `$height` loads with the default and reports nothing.
Validate override names against the model if a typo would be expensive.

Each distinct override set is cached separately, so loading one model with two
different override objects produces two independent variants.

---

### Changing Variables After Load
`setVariable(name, value)` overrides a variable and rebuilds the model from its
script, since a variable change can alter geometry and not just appearance.

**This method is asynchronous and must be awaited.** During the rebuild the model
is empty, so inspecting it without awaiting will show no children.

**Example:**
```javascript
// The "$" prefix is optional.
await model.setVariable('height', 10);
await model.setVariable('$height', 12);
```

Use `getPart(name)` to reach the rebuilt meshes.

> **Note:** `clone(overrides)` records the overrides it is given but does not
> rebuild the model, so on its own it does not change appearance. For a recoloured
> copy, load the model again with a `variables` option, or `await` a
> `setVariable()` call on the clone.

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
Parent one object under another with `add($object)`.

**Example:**
```javascript
$parent > empty()
$child > sphere(1, 32, 32)
$parent > add($child)   // $child becomes a child of $parent
```

The object being modified is the one on the **left** of the `>`, so
`$parent > add($child)` puts `$child` inside `$parent`. Reading the line as "add
this object to the one in brackets" gives the direction backwards: the argument
is the object being added, not the destination.

Write the parts first and parent them afterwards, because `add()` always acts on
the object named on its own line. One `add()` per level nests to any depth:

```javascript
$alley > empty()
$section > empty()
$pinDeck > empty() > position(0, 0, -30)

$alley > add($section)     // section inside alley
$section > add($pinDeck)   // deck inside section
```

An object can only have one parent, so adding it to a second one **moves** it
instead of copying it. Use `clone()` when the same part is needed in two places.

---

### Groups
`empty()` creates a group with no geometry, which is the usual way to mark a
position that other objects hang from.

**Example:**
```javascript
$container > empty() > position(0, 5, 0)
```

`startgroup()` / `endgroup()` wrap geometry creation into an implicit group,
without naming the group on every line:

**Example:**
```javascript
$flock > startgroup()
$bird1 > sphere(0.2, 8, 8)
$bird2 > sphere(0.2, 8, 8) > position(1, 0, 0)
endgroup()
```

> **Warning:** the loader tracks one open group, not a stack of them. A
> `startgroup()` inside another one abandons the outer group: its variable stops
> resolving, and the objects created after the inner `endgroup()` end up outside
> it. The outer group is not left empty — it is gone.
>
> This is easy to miss, because everything created before the inner `startgroup()`
> still renders. Only the grouping and the name are lost, so the symptom is a
> `getPart()` returning `undefined` rather than anything visibly broken.
>
> For anything nested — a lane with sections, a deck with individual pin spots —
> use `empty()` plus explicit `add()`, as shown under
> [Adding Objects](#adding-objects). That composes to any depth, and keeps every
> part addressable by name.

---

### getPart(name)
Returns the object a model variable was assigned to.

**Parameters:**
- `name` - Variable name, with or without the leading `$`

**Returns:** The Three.js object, or `undefined` if nothing was assigned to that
name. The lookup is exact, so `' pinDeck'` is not `'pinDeck'`.

Only objects that were given a variable are reachable this way. A bare
`box(1, 1, 1)` line still builds geometry, but nothing outside the script can name
it, so it cannot be moved, hidden or replaced later.

**Example:**
```javascript
$deck > empty() > position(0, 0, -30)
$plate > box(1.5, 0.05, 1.5, #14100c, 0, standard)
$deck > add($plate)

const deck = model.getPart('deck');
deck.getWorldPosition(new Vector3());   // 0, 0, -30
```

If the object had been rolled into a merged mesh, `getPart()` restores it before
returning, so the result is always individually visible and pickable.

> **Note:** a variable holds whatever was assigned to it, and a literal is stored
> as written, so a number comes back as a **string**: `getPart('laneWidth')` on
> `$laneWidth = 2.2` returns `"2.2"`. Convert with `Number()` before using the
> value arithmetically.

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
