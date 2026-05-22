import { App, Modal, Notice, Setting } from "obsidian";
import type { DryRunRecord, DryRunRecorder } from "./dryRun";

/**
 * Modal that displays a dry-run report inline in Obsidian instead of forcing
 * the user to dig through the debug log file.
 *
 * Layout: a summary block of counts at the top, then a per-record table of
 * intended writes. A "Copy report to clipboard" button at the bottom dumps
 * the full markdown report for sharing in a bug report or sync diary.
 *
 * Stateless beyond the records snapshot — re-running a dry-run creates a
 * fresh modal with the new recorder.
 */
export class DryRunReportModal extends Modal {
  private readonly recorder: DryRunRecorder;
  private readonly startedAt: Date;
  private readonly finishedAt: Date;

  constructor(
    app: App,
    recorder: DryRunRecorder,
    startedAt: Date,
    finishedAt: Date
  ) {
    super(app);
    this.recorder = recorder;
    this.startedAt = startedAt;
    this.finishedAt = finishedAt;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("granola-sync-dry-run-modal");

    contentEl.createEl("h2", { text: "Granola dry-run report" });

    const timingEl = contentEl.createEl("p", {
      cls: "granola-sync-dry-run-timing",
    });
    const elapsedMs = this.finishedAt.getTime() - this.startedAt.getTime();
    timingEl.setText(
      `Completed ${this.finishedAt.toLocaleTimeString()} ` +
        `(took ${(elapsedMs / 1000).toFixed(1)}s). ` +
        `No files were modified.`
    );

    this.renderCounts(contentEl);
    this.renderDetails(contentEl);

    new Setting(contentEl)
      .addButton((btn) =>
        btn
          .setButtonText("Copy report to clipboard")
          .setCta()
          .onClick(async () => {
            try {
              await navigator.clipboard.writeText(this.recorder.summarize());
              new Notice("Dry-run report copied to clipboard.");
            } catch (err) {
              new Notice(
                "Failed to copy: " +
                  (err instanceof Error ? err.message : String(err))
              );
            }
          })
      )
      .addButton((btn) => btn.setButtonText("Close").onClick(() => this.close()));
  }

  onClose(): void {
    this.contentEl.empty();
  }

  /**
   * Counts block. Renders zero-buckets too so users have a stable mental
   * model of "what could change" — empty rows are useful signal (e.g.
   * `would-modify-frontmatter: 0` confirms the cross-link path didn't run).
   */
  private renderCounts(parent: HTMLElement): void {
    const records = this.recorder.all();
    const counts = {
      "would-create": 0,
      "would-modify": 0,
      "would-modify-frontmatter": 0,
      "would-rename": 0,
      "skip-unchanged": 0,
      "skip-not-newer": 0,
      "skip-body-write-disabled": 0,
    } as Record<DryRunRecord["outcome"], number>;
    for (const r of records) counts[r.outcome]++;

    const summary = parent.createEl("div", { cls: "granola-sync-dry-run-counts" });
    summary.createEl("h3", { text: "Summary" });
    const list = summary.createEl("ul");
    const friendly: Record<DryRunRecord["outcome"], string> = {
      "would-create": "Would create",
      "would-modify": "Would modify",
      "would-modify-frontmatter": "Would modify frontmatter",
      "would-rename": "Would rename",
      "skip-unchanged": "Skip (unchanged)",
      "skip-not-newer": "Skip (remote not newer)",
      "skip-body-write-disabled": "Skip (body writes disabled)",
    };
    for (const outcome of Object.keys(counts) as Array<DryRunRecord["outcome"]>) {
      const li = list.createEl("li");
      li.createEl("strong", { text: `${counts[outcome]}` });
      li.appendText(` ${friendly[outcome]}`);
    }
  }

  /**
   * Per-record detail table. Shows each intended change with its path,
   * granolaId, and reason. Long lists scroll inside the modal so wide
   * vaults don't blow out the dialog.
   */
  private renderDetails(parent: HTMLElement): void {
    const records = this.recorder.all();
    parent.createEl("h3", { text: `Details (${records.length} record(s))` });

    if (records.length === 0) {
      parent.createEl("p", {
        text: "No changes would be made. (Sync is up-to-date or returned no documents.)",
      });
      return;
    }

    const scrollEl = parent.createEl("div", {
      cls: "granola-sync-dry-run-details",
    });
    const table = scrollEl.createEl("table");
    const thead = table.createEl("thead");
    const headRow = thead.createEl("tr");
    for (const h of ["Outcome", "Path", "Reason"]) {
      headRow.createEl("th", { text: h });
    }
    const tbody = table.createEl("tbody");
    for (const r of records) {
      const tr = tbody.createEl("tr");
      tr.createEl("td", {
        text: r.outcome,
        cls: "granola-sync-dry-run-outcome",
      });

      const pathCell = tr.createEl("td", { cls: "granola-sync-dry-run-path" });
      const pathText = r.toPath ? `${r.path} → ${r.toPath}` : r.path;
      pathCell.appendText(pathText);
      if (r.granolaId) {
        const idEl = pathCell.createEl("div", {
          cls: "granola-sync-dry-run-granola-id",
        });
        idEl.setText(`granolaId=${r.granolaId}`);
      }

      tr.createEl("td", {
        text: r.reason ?? "",
        cls: "granola-sync-dry-run-reason",
      });
    }
  }
}
