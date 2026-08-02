// Real-process proof for commentary identity: feeds the compositor the exact
// transport report shape recorded live on Telegram in #116413 (each note once
// with the provider item id, once without), plus two distinct items that share
// the same text. Asserts the duplicate renders once and counts once while the
// second same-text item keeps its own line and count.
import { describe, expect, it } from "vitest";
import {
  createChannelProgressDraftCompositor,
  createChannelProgressReceiptTracker,
} from "./progress-draft-compositor.js";

async function renderTurn(
  reports: Array<{ text: string; itemId?: string }>,
): Promise<{ rendered: string; summary: string }> {
  const updates: string[] = [];
  const compositor = createChannelProgressDraftCompositor({
    entry: { streaming: { mode: "progress", progress: { commentary: true } } },
    mode: "progress",
    active: true,
    seed: "",
    update: (text) => {
      updates.push(text);
    },
    now: () => 0,
  });
  const receipt = createChannelProgressReceiptTracker({ now: () => 0 });
  for (const report of reports) {
    await compositor.pushCommentaryProgress(
      report.text,
      report.itemId ? { itemId: report.itemId } : {},
    );
    receipt.noteCommentary(report.itemId, report.text);
  }
  return { rendered: updates.at(-1) ?? "", summary: receipt.buildSummaryLine() };
}

describe("commentary identity real-process proof", () => {
  it("keeps one line per note and distinct same-text items separate", async () => {
    // The live Telegram shape from #116413: each commentary note is pushed
    // twice, once with the provider item id and once without.
    const { rendered, summary } = await renderTurn([
      { text: "First I check the workspace.", itemId: "msg_e2e_preamble-1" },
      { text: "First I check the workspace." },
      { text: "Now I look at the second thing.", itemId: "msg_e2e_preamble-2" },
      { text: "Now I look at the second thing." },
      { text: "Last one, then I answer.", itemId: "msg_e2e_preamble-3" },
      { text: "Last one, then I answer." },
    ]);

    expect(rendered.match(/First I check the workspace\./gu) ?? []).toHaveLength(1);
    expect(rendered.match(/Now I look at the second thing\./gu) ?? []).toHaveLength(1);
    expect(rendered.match(/Last one, then I answer\./gu) ?? []).toHaveLength(1);
    expect(summary).toContain("💬 3 notes");
  });

  it("renders two distinct same-text items as two lines and two notes", async () => {
    const { rendered, summary } = await renderTurn([
      { text: "Done.", itemId: "msg_e2e_1" },
      { text: "Done." },
      { text: "Done.", itemId: "msg_e2e_2" },
      { text: "Done." },
    ]);

    expect(rendered.match(/Done\./gu) ?? []).toHaveLength(2);
    expect(summary).toContain("💬 2 notes");
  });
});
