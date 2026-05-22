import { log } from "../utils/logger";

export type DryRunOutcome =
  | "would-create"
  | "would-modify"
  | "would-modify-frontmatter"
  | "would-rename"
  | "skip-unchanged"
  | "skip-not-newer"
  | "skip-body-write-disabled";

export interface DryRunRecord {
  outcome: DryRunOutcome;
  path: string;
  granolaId?: string;
  type?: "note" | "transcript" | "combined";
  /** Human-readable explanation (e.g. "remote newer by 142s"). */
  reason?: string;
  /** When the outcome is `would-rename`, the destination path. */
  toPath?: string;
}

/**
 * Records intended file-system writes during a dry-run sync. When attached to
 * a `FileSyncService` (or accessed via `GranolaSync.dryRunRecorder`), all
 * `vault.create / vault.modify / vault.rename` calls become record-only and
 * the sync pipeline produces a report instead of touching disk.
 *
 * The recorder is intentionally process-global per sync run; callers should
 * `new DryRunRecorder()` for each invocation and clear it afterwards so
 * subsequent live syncs don't accidentally inherit dry-run mode.
 */
export class DryRunRecorder {
  private records: DryRunRecord[] = [];

  record(rec: DryRunRecord): void {
    this.records.push(rec);
    log.debug(
      `dry-run — ${rec.outcome} ${rec.path}` +
        (rec.toPath ? ` → ${rec.toPath}` : "") +
        (rec.reason ? ` (${rec.reason})` : "")
    );
  }

  all(): readonly DryRunRecord[] {
    return this.records;
  }

  /**
   * Returns a markdown-formatted report suitable for the debug log or a
   * Notice's "open log" hint.
   */
  summarize(): string {
    const counts: Record<DryRunOutcome, number> = {
      "would-create": 0,
      "would-modify": 0,
      "would-modify-frontmatter": 0,
      "would-rename": 0,
      "skip-unchanged": 0,
      "skip-not-newer": 0,
      "skip-body-write-disabled": 0,
    };
    for (const r of this.records) counts[r.outcome]++;

    const lines: string[] = [];
    lines.push("Dry-run summary:");
    lines.push(`  would-create: ${counts["would-create"]}`);
    lines.push(`  would-modify: ${counts["would-modify"]}`);
    lines.push(
      `  would-modify-frontmatter: ${counts["would-modify-frontmatter"]}`
    );
    lines.push(`  would-rename: ${counts["would-rename"]}`);
    lines.push(`  skip-unchanged: ${counts["skip-unchanged"]}`);
    lines.push(`  skip-not-newer: ${counts["skip-not-newer"]}`);
    lines.push(
      `  skip-body-write-disabled: ${counts["skip-body-write-disabled"]}`
    );

    if (this.records.length > 0) {
      lines.push("");
      lines.push("Details:");
      for (const r of this.records) {
        lines.push(
          `  [${r.outcome}] ${r.path}` +
            (r.toPath ? ` → ${r.toPath}` : "") +
            (r.granolaId ? ` (granolaId=${r.granolaId})` : "") +
            (r.reason ? ` — ${r.reason}` : "")
        );
      }
    }
    return lines.join("\n");
  }

  shortNotice(): string {
    const c = this.records.reduce(
      (acc, r) => {
        if (r.outcome === "would-create") acc.create++;
        else if (r.outcome === "would-modify") acc.modify++;
        else if (r.outcome === "would-modify-frontmatter") acc.fmModify++;
        else if (r.outcome === "would-rename") acc.rename++;
        else acc.skip++;
        return acc;
      },
      { create: 0, modify: 0, fmModify: 0, rename: 0, skip: 0 }
    );
    return (
      `Granola dry-run: would create ${c.create}, modify ${c.modify}, ` +
      `modify-frontmatter ${c.fmModify}, rename ${c.rename}, skip ${c.skip}. ` +
      `See debug log for per-file detail.`
    );
  }
}

