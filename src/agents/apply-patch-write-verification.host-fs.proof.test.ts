/**
 * Real-filesystem proof for apply_patch write verification.
 *
 * The unit regression suite (`apply-patch-verification.test.ts`) runs against an
 * in-memory bridge, so it cannot prove the verification contract on a real disk.
 * These tests run the real `applyPatch` against real `node:fs` I/O:
 *   - happy path: add/update/move persist the exact UTF-8 bytes and are NOT
 *     false-rejected by the size + readback check;
 *   - fault path: a real write that persists the wrong bytes is rejected with the
 *     verification error and the corrupted bytes are what the disk actually has.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyPatch } from "./apply-patch.test-support.js";
import type { SandboxFsBridge } from "./sandbox/fs-bridge.js";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "apply-patch-proof-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function realFsBridge(root: string): SandboxFsBridge {
  // resolvePath sees the raw hunk path; containerPath is what every later bridge
  // call receives, so it must be an absolute path under the real root.
  const toAbsolute = (filePath: string) =>
    path.isAbsolute(filePath) ? filePath : path.join(root, filePath);
  const stat = async (filePath: string) => {
    try {
      const s = await fs.stat(toAbsolute(filePath));
      return {
        type: s.isFile()
          ? ("file" as const)
          : s.isDirectory()
            ? ("directory" as const)
            : ("other" as const),
        size: s.size,
        mtimeMs: s.mtimeMs,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
  };
  return {
    resolvePath: ({ filePath }) => ({
      relativePath: filePath,
      containerPath: toAbsolute(filePath),
    }),
    readFile: async ({ filePath }) => fs.readFile(toAbsolute(filePath)),
    writeFile: async ({ filePath, data }) => {
      await fs.mkdir(path.dirname(toAbsolute(filePath)), { recursive: true });
      await fs.writeFile(toAbsolute(filePath), data);
    },
    createFileExclusive: async ({ filePath, data }) => {
      await fs.mkdir(path.dirname(toAbsolute(filePath)), { recursive: true });
      try {
        await fs.writeFile(toAbsolute(filePath), data, { flag: "wx" });
        return "created";
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") {
          return "exists";
        }
        throw error;
      }
    },
    remove: async ({ filePath }) => {
      await fs.rm(toAbsolute(filePath), { force: true });
    },
    rename: async ({ from, to }) => {
      await fs.rename(toAbsolute(from), toAbsolute(to));
    },
    mkdirp: async ({ filePath }) => {
      await fs.mkdir(toAbsolute(filePath), { recursive: true });
    },
    stat: async ({ filePath }) => stat(filePath),
  };
}

describe("applyPatch write verification on a real filesystem", () => {
  it("persists exact UTF-8 bytes for add/update/move without false rejection", async () => {
    const dir = await makeTempDir();
    // Real UTF-8 payloads: multi-byte CJK, combining-ish Latin-1, emoji.
    await fs.writeFile(path.join(dir, "source.txt"), "old line\n", "utf8");
    await fs.writeFile(path.join(dir, "mover.txt"), "旧内容\n", "utf8");

    const patch = `*** Begin Patch
*** Add File: added.txt
+hello ✓ 你好
+第二行 café ümlaut
*** Update File: source.txt
@@
-old line
+新行 ✓
*** Update File: mover.txt
*** Move to: moved.txt
@@
-旧内容
+新内容 ✓
*** End Patch`;

    const result = await applyPatch(patch, { cwd: dir, workspaceOnly: false });

    // Success is reported, and the disk really has the exact requested bytes.
    expect(result.summary.added).toContain("added.txt");
    expect(result.summary.modified).toContain("source.txt");
    expect(await fs.readFile(path.join(dir, "added.txt"))).toEqual(
      Buffer.from("hello ✓ 你好\n第二行 café ümlaut\n", "utf8"),
    );
    expect(await fs.readFile(path.join(dir, "source.txt"))).toEqual(
      Buffer.from("新行 ✓\n", "utf8"),
    );
    expect(await fs.readFile(path.join(dir, "moved.txt"))).toEqual(
      Buffer.from("新内容 ✓\n", "utf8"),
    );
    await expect(fs.access(path.join(dir, "mover.txt"))).rejects.toThrow();
  });

  it("rejects a real write whose persisted bytes differ from the requested content", async () => {
    const dir = await makeTempDir();
    const bridge = realFsBridge(dir);
    // A write that completes but persists the wrong bytes (corrupted write).
    const corruptingBridge: SandboxFsBridge = {
      ...bridge,
      writeFile: async ({ filePath }) => {
        await fs.writeFile(
          path.isAbsolute(filePath) ? filePath : path.join(dir, filePath),
          Buffer.from("corrupted"),
        );
      },
    };

    await fs.writeFile(path.join(dir, "source.txt"), "before\n", "utf8");

    const patch = `*** Begin Patch
*** Update File: source.txt
@@
-before
+after
*** End Patch`;

    await expect(
      applyPatch(patch, { cwd: dir, sandbox: { root: dir, bridge: corruptingBridge } }),
    ).rejects.toThrow("ApplyPatch verification failed for source.txt");

    // The corrupted bytes are really on disk: no false-success receipt.
    expect(await fs.readFile(path.join(dir, "source.txt"), "utf8")).toBe("corrupted");
  });
});
