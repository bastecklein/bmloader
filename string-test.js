// Test to verify the string handling fix
function testStringHandling(val) {
  if (typeof val !== 'string') return val;
  
  const hasMath = /[+\-*/()]/.test(val);
  const hasVars = /\$\w+/.test(val);
  
  if (!hasMath && !hasVars) {
    const parsed = parseFloat(val);
    if (isNaN(parsed) || val.includes('|') || val.includes(',') || val.includes(';')) {
      return val; // Keep as string
    }
    return parsed;
  }
  
  return val;
}

console.log('Testing string with delimiters:');
console.log('Input: "10|20|30"');
console.log('Output:', testStringHandling('10|20|30'));
console.log('Can split:', typeof testStringHandling('10|20|30') === 'string');

console.log('\nTesting pure number:');
console.log('Input: "5"');
console.log('Output:', testStringHandling('5'));
console.log('Type:', typeof testStringHandling('5'));

console.log('\nTesting coordinates with pipes:');
const coordString = '1.5|2.7|3.9';
const result = testStringHandling(coordString);
console.log('Input:', coordString);
console.log('Output:', result);
console.log('Type:', typeof result);
if (typeof result === 'string') {
  console.log('Split result:', result.split('|'));
} else {
  console.log('ERROR: Cannot split, got number instead of string!');
}

console.log('\nTesting shape coordinates:');
const shapeCoords = '0,0|10,10|20,0';
const shapeResult = testStringHandling(shapeCoords);
console.log('Input:', shapeCoords);
console.log('Output:', shapeResult);
console.log('Type:', typeof shapeResult);
if (typeof shapeResult === 'string') {
  console.log('Split result:', shapeResult.split('|'));
} else {
  console.log('ERROR: Cannot split, got number instead of string!');
}