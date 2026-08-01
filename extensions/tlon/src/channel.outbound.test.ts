// Tlon outbound chunking tests cover the declared text delivery limit.
import { describe, expect, it } from "vitest";
import { tlonPlugin } from "./channel.js";

describe("tlon channel outbound", () => {
  it("declares bounded Markdown chunking for text delivery", () => {
    const outbound = tlonPlugin.outbound;
    expect(outbound.chunkerMode).toBe("markdown");
    expect(outbound.textChunkLimit).toBe(10_000);
    expect(outbound.chunker).toBeTypeOf("function");
  });

  it("splits text above the declared limit into bounded chunks", () => {
    const outbound = tlonPlugin.outbound;
    const chunker = outbound.chunker;
    if (!chunker) {
      throw new Error("expected tlon outbound to declare a chunker");
    }
    const chunks = chunker("x".repeat(10_001), 10_000);
    expect(chunks).toEqual(["x".repeat(10_000), "x"]);
    expect(chunks.every((chunk) => chunk.length <= 10_000)).toBe(true);
  });
});
