# Audit — truncate-compaction/index.ts (2026-09-29)

Audited against runtime v1.0.102 source (`/home/theoses/icm-workspaces/theoses2/packages/coding-agent`), verified how `session_before_compact` results are consumed (`agent-session.ts:2127-2196` manual path, `2455-2540` auto path; `extensions/runner.ts:808-842`; `compaction/compaction.ts`).

## Real bugs / risks (most severe first)

1. **Split-turn dropped span has no safety net.** The header claims `_distillDroppedMemory` fires "unconditionally" as the safety net for dropped detail. True for `messagesToSummarize`, but it is called only with that array (`agent-session.ts:2115, 2442`) — `turnPrefixMessages` never reach memory distillation, and this extension replaces the default path's turn-prefix summarization with a static marker. On a split-turn compaction those messages are dropped from live context with neither summary nor distillation. Reproduce: force a threshold compaction whose cut lands mid-turn; inspect the compaction entry — only the marker, no distilled facts from the prefix span.

2. **Running truncation history is lost on every pass.** Each compaction replaces the previous compaction entry's summary (that is what `previousSummary` is, `compaction.ts:1019`), and the marker only counts the *latest* dropped span. After two truncations the model sees "[3 earlier turns truncated]" with no trace of the first pass's count, so it cannot judge how much context is missing. This is the gap the new opt-in `ledger` feature addresses.

3. **File-op chain is broken across truncation compactions.** The extension returns no `details`, and `appendCompaction` records `fromExtension` (mapped to the `fromHook` flag); `extractFileOperations` (`compaction.ts:50-62`) only seeds read/modified files from entries where `!fromHook && details`. So any later *default* compaction loses modified-file tracking for spans dropped under this extension. Inherent to the no-LLM design, but undocumented.

4. **`countTurns` miscounts split turns.** It counts `role === "user"` messages in `turnPrefixMessages` too, but in a split turn that user message belongs to the still-in-progress turn and is represented by the turn-prefix summary, not truncated wholesale. Cosmetic: marker says one turn more than was actually truncated in the first pass of a split cut.

5. **`console.error("[truncate-compaction] factory invoked")` on every session start, even when the feature is disabled.** Pure stderr noise in every agent log. Minor.

## Checked and fine

- Config handling: ENOENT silent (correct opt-out default), invalid JSON warned once per distinct message, re-read per event is intentional (live flag flip). No TOCTOU concern for a flag file.
- `ctx.mode === "tui"` guard: correct after the noted print/rpc defaulting; an unset mode runs the extension, which is the intended fail-open for chat surfaces.
- `trivialReset` short-circuit matches core behavior (core also skips the LLM call there).
- Empty-dropped check correctly covers both arrays (`messagesToSummarize` + `turnPrefixMessages`), matching the core's own "anything to do" test.
- No `usage` in the returned compaction is valid — the field is optional and no LLM call is made.
- Abort signal ignored is fine — the handler does no long-running work.
- Echoing `firstKeptEntryId`/`tokensBefore` verbatim is correct; core uses them as-is.
- Multiple handlers: the runner keeps the last non-undefined result; this extension being last/only compaction provider is consistent with `hasHandlers` gating.
