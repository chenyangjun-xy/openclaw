/**
 * Tests apply_patch write verification: a delegated write/create that silently
 * fails to persist the requested bytes must not be reported as success.
 */
import { describe, expect, it, vi } from "vitest";
import { applyPatch } from "./apply-patch.test-support.js";
import type { SandboxFsBridge } from "./sandbox/fs-bridge.js";

function createVerificationSandbox(initialFiles: Record<string, string>) {
  const files = new Map<string, string | Buffer>(
    Object.entries(initialFiles).map(([filePath, contents]) => [`/sandbox/${filePath}`, contents]),
  );
  const bridge: SandboxFsBridge = {
    resolvePath: ({ filePath }) => ({
      relativePath: filePath,
      containerPath: `/sandbox/${filePath}`,
    }),
    readFile: async ({ filePath }) => {
      const contents = files.get(filePath);
      if (typeof contents === "string") {
        return Buffer.from(contents, "utf8");
      }
      return Buffer.from(contents ?? "");
    },
    writeFile: async ({ filePath, data }) => {
      files.set(filePath, Buffer.isBuffer(data) ? Buffer.from(data) : data);
    },
    createFileExclusive: async ({ filePath, data }) => {
      if (files.has(filePath)) {
        return "exists";
      }
      files.set(filePath, Buffer.isBuffer(data) ? Buffer.from(data) : data);
      return "created";
    },
    remove: async ({ filePath }) => {
      files.delete(filePath);
    },
    rename: async ({ from, to }) => {
      const contents = files.get(from);
      if (contents !== undefined) {
        files.set(to, contents);
        files.delete(from);
      }
    },
    mkdirp: async () => {},
    stat: async ({ filePath }) => {
      const contents = files.get(filePath);
      return contents === undefined
        ? null
        : { type: "file", size: Buffer.byteLength(contents), mtimeMs: 0 };
    },
    entryExists: async ({ filePath }) => files.has(filePath),
  };
  return {
    files,
    bridge,
    options: { cwd: "/local/workspace", sandbox: { root: "/local/workspace", bridge } },
  };
}

describe("applyPatch write verification", () => {
  it("rejects an update whose delegated write does not persist the requested bytes", async () => {
    const sandbox = createVerificationSandbox({ "source.txt": "before\n" });
    // Simulate a delegated write that silently fails to persist the requested content.
    vi.spyOn(sandbox.bridge, "writeFile").mockImplementation(async ({ filePath }) => {
      sandbox.files.set(filePath, Buffer.from("corrupted"));
    });

    const patch = `*** Begin Patch
*** Update File: source.txt
@@
-before
+after
*** End Patch`;

    await expect(applyPatch(patch, sandbox.options)).rejects.toThrow(
      "ApplyPatch verification failed for source.txt",
    );
  });

  it("rejects an add whose delegated create does not persist the requested bytes", async () => {
    const sandbox = createVerificationSandbox({});
    vi.spyOn(sandbox.bridge, "createFileExclusive").mockImplementation(async ({ filePath }) => {
      sandbox.files.set(filePath, Buffer.from("corrupted"));
      return "created";
    });

    const patch = `*** Begin Patch
*** Add File: new.txt
+escaped
*** End Patch`;

    await expect(applyPatch(patch, sandbox.options)).rejects.toThrow(
      "ApplyPatch verification failed for new.txt",
    );
  });

  it("rejects a delete whose delegated remove resolves without deleting the entry", async () => {
    const sandbox = createVerificationSandbox({ "source.txt": "x\n" });
    // Simulate a delegated remove that resolves but leaves the entry behind.
    vi.spyOn(sandbox.bridge, "remove").mockImplementation(async () => {});

    const patch = `*** Begin Patch
*** Delete File: source.txt
*** End Patch`;

    await expect(applyPatch(patch, sandbox.options)).rejects.toThrow(
      "ApplyPatch verification failed for source.txt: the entry still exists after removal.",
    );
    expect(sandbox.files.has("/sandbox/source.txt")).toBe(true);
  });

  it("rejects a move whose delegated source removal resolves without deleting", async () => {
    const sandbox = createVerificationSandbox({ "source.txt": "foo\nbar\n" });
    // The destination write is verified, but the source removal is a no-op, so
    // the move must not report success while both entries exist.
    vi.spyOn(sandbox.bridge, "remove").mockImplementation(async () => {});

    const patch = `*** Begin Patch
*** Update File: source.txt
*** Move to: dest.txt
@@
 foo
-bar
+baz
*** End Patch`;

    await expect(applyPatch(patch, sandbox.options)).rejects.toThrow(
      "ApplyPatch verification failed for source.txt: the entry still exists after removal.",
    );
    expect(sandbox.files.has("/sandbox/dest.txt")).toBe(true);
    expect(sandbox.files.has("/sandbox/source.txt")).toBe(true);
  });
});
