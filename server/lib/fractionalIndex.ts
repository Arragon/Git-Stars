// server/lib/fractionalIndex.ts
// Simple fractional key generator using base-26 letter scheme.
// Order: 'a' < 'b' < ... < 'z' < 'aa' < 'ab' ... < 'zz' < 'aaa' ...
// Used for list item ordering to avoid integer position conflicts.

const FIRST = "a".charCodeAt(0);

// Compare two fractional keys lexicographically by length then chars.
export function compareKeys(a: string, b: string): number {
  if (a.length !== b.length) return a.length - b.length;
  return a < b ? -1 : a > b ? 1 : 0;
}

// Generate a key that sorts strictly between `a` and `b`.
// Either bound may be null (meaning unbounded on that side).
export function generateBetween(a: string | null, b: string | null): string {
  // No bounds → start at 'm' (middle of alphabet for room both ways).
  if (!a && !b) return "m";

  // Only lower bound → append 'm' to extend.
  if (a && !b) return a + "m";

  // Only upper bound → take predecessor path.
  if (!a && b) {
    // If b starts with something > 'a', just use 'a' + something.
    if (b.charCodeAt(0) > FIRST)
      return String.fromCharCode(b.charCodeAt(0) - 1);
    // b = 'a...' → use 'a' + midpoint of rest
    return "a" + generateBetween(null, b.slice(1) || null);
  }

  // Both bounds present.
  const aStr = a!;
  const bStr = b!;

  // If a is a prefix of b or vice versa, handle specially.
  // Find first differing position.
  const minLen = Math.min(aStr.length, bStr.length);
  for (let i = 0; i < minLen; i++) {
    const ca = aStr.charCodeAt(i);
    const cb = bStr.charCodeAt(i);
    if (ca === cb) continue;
    // Found divergence at position i.
    if (cb - ca > 1) {
      // Room between: use midpoint char + rest of a (or empty).
      const mid = String.fromCharCode(Math.floor((ca + cb) / 2));
      return aStr.slice(0, i) + mid;
    }
    // Adjacent chars (e.g. 'c' and 'd'): take ca + 'm' suffix from a's rest.
    return aStr.slice(0, i + 1) + "m";
  }

  // One is prefix of the other (a < b guaranteed by caller).
  if (aStr.length < bStr.length) {
    // a is prefix of b. Next char of b determines.
    const nextB = bStr.charCodeAt(aStr.length);
    if (nextB > FIRST) {
      return aStr + String.fromCharCode(Math.floor((FIRST + nextB) / 2));
    }
    // nextB === 'a', use 'a' + recurse
    return (
      aStr + "a" + generateBetween(null, bStr.slice(aStr.length + 1) || null)
    );
  }

  // b is prefix of a → impossible since a < b. Fallback.
  return aStr + "m";
}
