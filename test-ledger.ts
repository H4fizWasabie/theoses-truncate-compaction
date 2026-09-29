// Plain-node test for truncate-compaction's ledger feature (run with:
// node --experimental-strip-types test-ledger.ts). Exercises the exported pure helpers
// and the unused-flag invariance of marker text. No new dependencies.
import assert from "node:assert/strict";
import { buildTruncationSummary, parseTruncationLedger } from "./index.ts";

const LEGACY = (n: number) =>
	`[${n} earlier turn${n === 1 ? "" : "s"} truncated — no summary was generated. ` +
	`Relevant facts from this span may already be in long-term memory; use remember/recall if you need details.]`;
const LEDGER = (n: number, p: number) =>
	`[${n} earlier turn${n === 1 ? "" : "s"} truncated across ${p} compaction pass${p === 1 ? "" : "es"} — no summary was generated. ` +
	`Relevant facts from this span may already be in long-term memory; use remember/recall if you need details.]`;

// 1. Feature unused → behaviour exactly as today: buildTruncationSummary(n, undefined)
//    must equal the legacy marker byte-for-byte.
for (const n of [1, 2, 17]) assert.equal(buildTruncationSummary(n, undefined), LEGACY(n), `unused path, n=${n}`);

// 2. First ledger pass (no prior, or prior not ours) emits the legacy format — parsing that
//    back yields passes: 1, so chaining is uniform from pass 2 onward.
assert.equal(buildTruncationSummary(4, undefined), LEGACY(4));

// 3. Chained ledger: totals and pass counts accumulate.
assert.equal(buildTruncationSummary(4, { totalTurns: 3, passes: 1 }), LEDGER(7, 2));
assert.equal(buildTruncationSummary(10, { totalTurns: 7, passes: 2 }), LEDGER(17, 3));

// 4. parseTruncationLedger: legacy marker → {n, 1}; ledger marker → {n, p}.
assert.deepEqual(parseTruncationLedger(LEGACY(3)), { totalTurns: 3, passes: 1 });
assert.deepEqual(parseTruncationLedger(LEGACY(1)), { totalTurns: 1, passes: 1 });
assert.deepEqual(parseTruncationLedger(LEDGER(7, 2)), { totalTurns: 7, passes: 2 });

// 5. Non-marker summaries (LLM-generated) → undefined (ledger resets).
assert.equal(parseTruncationLedger(undefined), undefined);
assert.equal(parseTruncationLedger(""), undefined);
assert.equal(
	parseTruncationLedger("We discussed the compaction design; user prefers deterministic summaries."),
	undefined,
);

// 6. Garbage / near-miss markers don't parse.
assert.equal(parseTruncationLedger("[earlier turns truncated — no summary was generated. x]"), undefined);
assert.equal(parseTruncationLedger("[abc earlier turns truncated — no summary was generated. x]"), undefined);

// 7. Round-trip: a chained sequence of parses stays consistent (3 passes).
let s = buildTruncationSummary(2, undefined);
s = buildTruncationSummary(5, parseTruncationLedger(s));
s = buildTruncationSummary(3, parseTruncationLedger(s));
assert.equal(s, LEDGER(10, 3));

console.log("all ledger tests passed");
