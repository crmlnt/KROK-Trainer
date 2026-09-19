const assert = require('assert');
const { buildAnatomyMatcher } = require('./anatomy-matcher.js');

// Mock a slice of the real approved dictionary for testing
const mockDict = [
  { id: "optic_tract", term: "optic tract", aliases: [], status: "approved" },
  { id: "middle_meningeal_artery", term: "middle meningeal artery", aliases: [], status: "approved" },
  { id: "right_coronary_artery", term: "right coronary artery", aliases: [], status: "approved" },
  { id: "coronary_artery", term: "coronary artery", aliases: [], status: "approved" },
  { id: "artery", term: "artery", aliases: [], status: "approved" },
  { id: "spinal_cord", term: "spinal cord", aliases: [], status: "approved" },
  { id: "foramen_ovale", term: "foramen ovale", aliases: ["oval foramen"], status: "approved" },
  { id: "greater_vestibular_gland", term: "greater vestibular gland", aliases: ["Bartholin gland", "Bartholin's gland"], status: "approved" },
  { id: "islets_of_langerhans", term: "islets of Langerhans", aliases: [], status: "approved" },
  // Synthetic triggers for testing complex overlap resolution
  { id: "a_very", term: "a very", aliases: [], status: "approved" },
  { id: "very_long_match", term: "very long match", aliases: [], status: "approved" }
];

const matcher = buildAnatomyMatcher(mockDict);

let passed = 0;
let total = 0;

function runTest(name, fn) {
  total++;
  try {
    fn();
    passed++;
    console.log(`[PASS] ${name}`);
  } catch (err) {
    console.error(`[FAIL] ${name}`);
    console.error(err.message);
  }
}

// 1. Canonical exact match
runTest("1. Canonical exact match", () => {
  const res = matcher("Damage to the middle meningeal artery may cause...");
  assert.strictEqual(res.length, 1);
  assert.strictEqual(res[0].conceptId, "middle_meningeal_artery");
  assert.strictEqual(res[0].canonicalTerm, "middle meningeal artery");
});

// 2. Case-insensitive match & original capitalization
runTest("2. Case-insensitive match & original capitalization", () => {
  const res = matcher("OPTIC tract and SPINAL CORD.");
  assert.strictEqual(res.length, 2);
  assert.strictEqual(res[0].matchedText, "OPTIC tract");
  assert.strictEqual(res[1].matchedText, "SPINAL CORD");
});

// 3. Alias mapping
runTest("3. Alias mapping", () => {
  const res = matcher("The oval foramen is open.");
  assert.strictEqual(res[0].conceptId, "foramen_ovale");
  assert.strictEqual(res[0].canonicalTerm, "foramen ovale");
  assert.strictEqual(res[0].matchedText, "oval foramen");
});

// 4. Punctuation handling
runTest("4. Punctuation handling", () => {
  const text = "(optic tract), [spinal cord].";
  const res = matcher(text);
  assert.strictEqual(res.length, 2);
  assert.strictEqual(res[0].matchedText, "optic tract");
  assert.strictEqual(res[1].matchedText, "spinal cord");
  assert.strictEqual(text.substring(res[0].start, res[0].end), "optic tract");
});

// 5. Multiple non-overlapping & offsets
runTest("5. Multiple non-overlapping & offsets", () => {
  const text = "The optic tract and the spinal cord.";
  const res = matcher(text);
  assert.strictEqual(res.length, 2);
  assert.strictEqual(res[0].start, 4);
  assert.strictEqual(res[0].end, 15);
  assert.strictEqual(text.substring(res[0].start, res[0].end), "optic tract");
});

// 6. Repeated same term
runTest("6. Repeated same term", () => {
  const res = matcher("The artery is a large artery.");
  assert.strictEqual(res.length, 2);
  assert.strictEqual(res[0].start, 4);
  assert.strictEqual(res[1].start, 22);
});

// 7. Longest-match overlap resolution (same start)
runTest("7. Longest-match overlap resolution (same start)", () => {
  const res = matcher("Blockage of the right coronary artery.");
  assert.strictEqual(res.length, 1);
  assert.strictEqual(res[0].conceptId, "right_coronary_artery");
});

// 8. No substring / stemming false positive
runTest("8. No substring / stemming false positive", () => {
  const res = matcher("The subarterial passage. Spinal cords.");
  assert.strictEqual(res.length, 0);
});

// 9. No fuzzy match
runTest("9. No fuzzy match", () => {
  const res = matcher("optik trackt");
  assert.strictEqual(res.length, 0);
});

// 10. Apostrophe variant
runTest("10. Apostrophe variant", () => {
  const text1 = "Bartholin's gland";
  const text2 = "Bartholin’s gland";
  assert.strictEqual(matcher(text1).length, 1);
  assert.strictEqual(matcher(text2).length, 1);
});

// 11. Empty text
runTest("11. Empty text", () => {
  assert.strictEqual(matcher("").length, 0);
  assert.strictEqual(matcher(null).length, 0);
});

// 12. No matches
runTest("12. No matches", () => {
  assert.strictEqual(matcher("The quick brown fox.").length, 0);
});

// 13. Malformed dictionary handling
runTest("13. Malformed dictionary handling", () => {
  try {
    buildAnatomyMatcher({});
    assert.fail("Should throw on non-array");
  } catch (e) {
    assert.ok(e.message.includes("array"));
  }
});

// 14. Unapproved concepts ignored
runTest("14. Unapproved concepts ignored", () => {
  const dict = [{ id: "test", term: "test", status: "rejected" }];
  const m = buildAnatomyMatcher(dict);
  assert.strictEqual(m("test").length, 0);
});

// 15. Different-start overlap resolution (longer wins)
runTest("15. Different-start overlap resolution (longer wins)", () => {
  const text = "a very long match";
  const res = matcher(text);
  
  // Under the old algorithm (start ascending greedy), "a very" (start=0, len=6) 
  // would be chosen over "very long match" (start=2, len=15) because it started earlier.
  // The new algorithm prioritizes length, so "very long match" must win.
  assert.strictEqual(res.length, 1);
  assert.strictEqual(res[0].conceptId, "very_long_match");
  assert.strictEqual(res[0].matchedText, "very long match");
  assert.strictEqual(res[0].start, 2);
  assert.strictEqual(res[0].end, 17);
  assert.strictEqual(text.substring(res[0].start, res[0].end), "very long match");
});

console.log(`\nTests passed: ${passed} / ${total}`);
