// Test to simulate the exact scenario from lines 1661 and 2444
function getModValue(val, renderModel) {
    if (typeof val !== 'string') return val;
    
    const hasMath = /[+\-*/()]/.test(val);
    const hasVars = /\$\w+/.test(val);
    
    if (!hasMath && !hasVars) {
        const parsed = parseFloat(val);
        if (isNaN(parsed) || val.includes('|') || val.includes(',') || val.includes(';') || val.includes(':')) {
            return val; // Keep as string for splitting operations
        }
        return parsed;
    }
    
    return val;
}

// Mock model and test scenarios
const renderModel = {
    bmDat: {
        variables: {
            shapeData: "0,0|10,10|20,0|0,0", // Shape coordinates
            latheData: "5,0|10,5|8,10|3,15|0,10" // Lathe coordinates
        },
        variableOverrides: {}
    }
};

console.log('=== Testing Line 1661 Scenario (Shape) ===');
const parts = ["$shapeData"]; // Simulate parts[0] containing a variable reference
try {
    // This simulates: const shapeParts = getModValue(parts[0], renderModel).split("|");
    const result = getModValue(parts[0], renderModel);
    console.log('getModValue result:', result);
    console.log('Type:', typeof result);
    
    if (typeof result === 'string') {
        const shapeParts = result.split("|");
        console.log('Split successful! Parts:', shapeParts);
        console.log('Number of parts:', shapeParts.length);
    } else {
        console.error('ERROR: Cannot split - result is not a string!');
    }
} catch (error) {
    console.error('Error occurred:', error.message);
}

console.log('\n=== Testing Line 2444 Scenario (Lathe) ===');
const latheParams = ["$latheData"];
try {
    // This simulates: const latheCoords = getModValue(parts[0], renderModel).split("|");
    const result = getModValue(latheParams[0], renderModel);
    console.log('getModValue result:', result);
    console.log('Type:', typeof result);
    
    if (typeof result === 'string') {
        const latheCoords = result.split("|");
        console.log('Split successful! Coords:', latheCoords);
        console.log('Number of coordinates:', latheCoords.length);
    } else {
        console.error('ERROR: Cannot split - result is not a string!');
    }
} catch (error) {
    console.error('Error occurred:', error.message);
}

console.log('\n=== Testing Direct String Value ===');
// Test case where the value is directly a string (not a variable reference)
try {
    const directResult = getModValue("1,2|3,4|5,6", renderModel);
    console.log('Direct string result:', directResult);
    console.log('Type:', typeof directResult);
    
    if (typeof directResult === 'string') {
        const directParts = directResult.split("|");
        console.log('Split successful! Parts:', directParts);
    } else {
        console.error('ERROR: Cannot split direct string!');
    }
} catch (error) {
    console.error('Error occurred:', error.message);
}

console.log('\n=== Testing Pure Numeric String ===');
// This should still convert to number since it has no delimiters
try {
    const numResult = getModValue("42.5", renderModel);
    console.log('Numeric string result:', numResult);
    console.log('Type:', typeof numResult);
    console.log('Expected: number (should be 42.5)');
} catch (error) {
    console.error('Error occurred:', error.message);
}