# bmloader

threejs loader for Basic Model (.bm) files

https://basicmodeler.com/

## package.json

```json
"dependencies": {
    "bmloader": "git+ssh://git@github.com:bastecklein/bmloader.git#main"
}
```

## usage

```javascript
import { BMLoader } from "bmloader";

const loader = new BMLoader();

// basic load
loader.load("models/character.bm", function(mesh) {
    scene.add(mesh);
});
```