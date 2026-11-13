/** Explicit diagnostic-only serialization, never used in the animation loop. */
export function encodeFloatCapture(values:Float32Array){const bytes=new Uint8Array(values.buffer,values.byteOffset,values.byteLength);let text='';for(let i=0;i<bytes.length;i+=16384)text+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(text)}
export function halfToFloat(value:number){const sign=value&32768?-1:1,exponent=(value>>>10)&31,fraction=value&1023;return exponent===0?sign*fraction*2**-24:exponent===31?fraction?NaN:sign*Infinity:sign*(1+fraction/1024)*2**(exponent-15)}
