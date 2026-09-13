import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "theoses-coding-agent";

/**
 * Mino-style truncation compaction (issue theoses2#245).
 *
 * theoses2's built-in compaction always calls an LLM to generate a fresh natural-language
 * summary of the dropped turns. That summary is non-deterministic (model sampling, retries),
 * so the live prompt's prefix changes unpredictably on every compaction pass — guaranteeing at
 * least one cache miss per compaction, on top of the extra model call's own cost/latency and its
 * own provider-routing/cache-health dependency.
 *
 * mino-oss (the predecessor agent) never summarizes: session.go's ContextMessages keeps the
 * last N turns verbatim and replaces everything older with a static marker string — no LLM call,
 * fully deterministic. theoses2 already distills anything worth keeping from the dropped span
 * into long-term memory on every compaction, via AgentSession's _distillDroppedMemory — that
 * call fires before the session_before_compact hook below runs, unconditionally, regardless of
 * which compaction strategy is used. So nothing new is needed to keep the mino-style safety net
 * (dropped detail already gets a chance to land in memory) — this extension only replaces WHAT
 * goes into the live prompt at a compaction boundary, not whether anything is remembered.
 *
 * Scope: RPC-mode sessions only (Telegram, dashboard, other channel integrations). Interactive
 * TUI coding-agent sessions keep the default LLM-summarization path — losing narrative
 * continuity (e.g. "we already tried X, it failed, don't redo it") is costlier there than in a
 * casual chat, and this hasn't been validated for that use case yet. See the design discussion
 * in theoses2#245 for the reasoning.
 *
 * Reversible at three layers, cheapest first: (1) the `enabled` flag in
 * truncate-compaction.json flips behavior back with no redeploy; (2) this extension can simply
 * not be installed in a given agent's extensions/ directory (its whole footprint); (3) it never
 * modifies theoses2's own compaction.ts, so uninstalling this file fully restores stock
 * behavior with zero core-repo changes to revert.
 */

interface TruncateConfig {
	enabled?: boolean;
}

interface AgentMessageLike {
	role?: string;
}

/** Structural subset of CompactionPreparation (packages/coding-agent/src/core/compaction/compaction.ts)
 * that this extension actually reads. Not imported directly — the extension host only exposes
 * ExtensionAPI from the "theoses-coding-agent" package, so this mirrors the fields by shape. */
interface CompactionPreparationLike {
	firstKeptEntryId: string;
	tokensBefore: number;
	messagesToSummarize: AgentMessageLike[];
	trivialReset?: boolean;
}

interface SessionBeforeCompactEventLike {
	type: "session_before_compact";
	preparation: CompactionPreparationLike;
}

const agentDir = process.env.THEOSES_CODING_AGENT_DIR || join(homedir(), ".theoses", "agent");
const configPath = join(agentDir, "truncate-compaction.json");

async function readConfig(): Promise<TruncateConfig> {
	try {
		return JSON.parse(await readFile(configPath, "utf8")) as TruncateConfig;
	} catch {
		// Missing/invalid config = disabled. A brand-new install should not silently start
		// truncating context before someone has deliberately opted in.
		return { enabled: false };
	}
}

function countTurns(messages: AgentMessageLike[]): number {
	return messages.filter((m) => m.role === "user").length;
}

export default function theosesTruncateCompaction(theoses: ExtensionAPI) {
	console.error("[truncate-compaction] factory invoked");

	theoses.on("session_before_compact", async (event, ctx) => {
		// RPC scope only (see header comment) — never intervene in TUI coding-agent sessions.
		if (ctx.mode !== "rpc") return;

		const config = await readConfig();
		if (!config.enabled) return;

		const preparation = (event as unknown as SessionBeforeCompactEventLike).preparation;
		// trivialReset already skips the summarization LLM call in the default path (issue #204)
		// — nothing for this extension to improve on, let the cheap default handle it.
		if (preparation.trivialReset) return;
		if (!preparation.messagesToSummarize.length) return;

		const turns = countTurns(preparation.messagesToSummarize);
		const summary = `[${turns} earlier turn${turns === 1 ? "" : "s"} truncated — no summary was generated. ` +
			`Relevant facts from this span may already be in long-term memory; use remember/recall if you need details.]`;

		console.error(`[truncate-compaction] truncating ${turns} turns instead of summarizing`);

		return {
			compaction: {
				summary,
				firstKeptEntryId: preparation.firstKeptEntryId,
				tokensBefore: preparation.tokensBefore,
				// No usage: unlike the default path, this never calls an LLM.
			},
		};
	});
}
