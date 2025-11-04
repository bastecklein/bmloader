# BMLoader getModValue Fix for Split Operations

## Issue
After implementing performance optimizations for the `getModValue` function, errors occurred on lines 1661 and 2444:

```
TypeError: getModValue(...).split is not a function
```

## Root Cause
The optimized `getModValue` function was converting all numeric-looking strings to numbers, including strings like `"0,0|10,10|20,0"` which need to remain as strings for `.split()` operations.

## Solution
Modified the literal value handling in `getModValue` to preserve strings containing delimiter characters:

```javascript
// Before (problematic)
const parsed = parseFloat(val);
return isNaN(parsed) ? val : parsed;

// After (fixed)  
const parsed = parseFloat(val);
if (isNaN(parsed) || val.includes('|') || val.includes(',') || val.includes(';') || val.includes(':')) {
    return val; // Keep as string for splitting operations
}
return parsed;
```

## Affected Operations
1. **Shape creation** (line 1661): `getModValue(parts[0], renderModel).split("|")` - for coordinate strings like `"0,0|10,10|20,0"`
2. **Lathe creation** (line 2444): `getModValue(parts[0], renderModel).split("|")` - for lathe point strings like `"5,0|10,5|8,10"`

## Behavior Changes
- ✅ **Strings with delimiters** (`|`, `,`, `;`, `:`) remain as strings
- ✅ **Pure numeric strings** (`"42.5"`) still convert to numbers  
- ✅ **Variable resolution** works correctly for both cases
- ✅ **Performance optimizations** remain intact

## Test Cases
```javascript
getModValue("42.5", model)           // → 42.5 (number)
getModValue("1,2|3,4", model)        // → "1,2|3,4" (string)
getModValue("$coords", model)        // → "0,0|10,10" (string, if coords contains delimiters)
getModValue("$number", model)        // → 5 (number, if number contains "5")
```

## Validation
All cases now work correctly:
- Shape operations can split coordinate strings
- Lathe operations can split point strings  
- Numeric operations still receive numbers
- No performance regression

The fix maintains backward compatibility while preserving the performance optimizations.