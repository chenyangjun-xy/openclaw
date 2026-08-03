/**
 * Shell command plans for sandbox filesystem bridge operations.
 *
 * Plans carry path-safety checks alongside the command so rechecks and execution stay coupled.
 */
import { PATH_ALIAS_POLICIES } from "../../infra/path-alias-guards.js";
import type { AnchoredSandboxEntry, PathSafetyCheck } from "./fs-bridge-path-safety.js";
import type { SandboxResolvedFsPath } from "./fs-paths.js";

export type SandboxFsCommandPlan = {
  checks: PathSafetyCheck[];
  script: string;
  args?: string[];
  stdin?: Buffer | string;
  recheckBeforeCommand?: boolean;
  allowFailure?: boolean;
};

/** Builds a stat command that anchors the path at its canonical parent before reading metadata. */
export function buildStatPlan(
  target: SandboxResolvedFsPath,
  anchoredTarget: AnchoredSandboxEntry,
): SandboxFsCommandPlan {
  return {
    checks: [{ target, options: { action: "stat files" } }],
    script: 'set -eu\ncd -- "$1"\nLC_ALL=C stat -c "%F|%s|%y" -- "$2"',
    args: [anchoredTarget.canonicalParentPath, anchoredTarget.basename],
    allowFailure: true,
  };
}

/** Exit code the entry-existence plan reserves for "no entry at the path". */
export const SANDBOX_ENTRY_EXISTS_ABSENT_EXIT_CODE = 3;

/**
 * Builds an entry-existence command that tests the final entry itself instead of
 * following it. `-e` is false for a dangling symlink, so `-L` is included to
 * keep such a still-present entry visible; together they mirror lstat semantics.
 */
export function buildEntryExistsPlan(
  target: SandboxResolvedFsPath,
  anchoredTarget: AnchoredSandboxEntry,
): SandboxFsCommandPlan {
  return {
    // The removal-target policy preserves a still-present final symlink so the
    // test can observe it; rejecting it would report the entry as absent.
    checks: [
      {
        target,
        options: { action: "check entry existence", aliasPolicy: PATH_ALIAS_POLICIES.unlinkTarget },
      },
    ],
    script: 'set -eu\ncd -- "$1"\nif [ -e "$2" ] || [ -L "$2" ]; then exit 0; fi\nexit 3',
    args: [anchoredTarget.canonicalParentPath, anchoredTarget.basename],
    allowFailure: true,
  };
}
