import { App, TFile } from "obsidian";
import { FileSyncService } from "../../src/services/fileSyncService";
import { DryRunRecorder } from "../../src/services/dryRun";
import { DEFAULT_SETTINGS, GranolaSyncSettings } from "../../src/settings";
import type { PathResolver } from "../../src/services/pathResolver";

jest.mock("../../src/utils/logger", () => ({
  log: {
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  },
}));

describe("DryRunRecorder + FileSyncService integration", () => {
  let mockApp: jest.Mocked<App>;
  let svc: FileSyncService;
  let settings: GranolaSyncSettings;
  let recorder: DryRunRecorder;

  beforeEach(() => {
    settings = { ...DEFAULT_SETTINGS, saveAsIndividualFiles: true };
    mockApp = {
      vault: {
        getMarkdownFiles: jest.fn().mockReturnValue([]),
        getAbstractFileByPath: jest.fn().mockReturnValue(null),
        createFolder: jest.fn(),
        create: jest.fn(),
        read: jest.fn(),
        modify: jest.fn(),
        rename: jest.fn(),
      },
      metadataCache: { getFileCache: jest.fn() },
      fileManager: {
        getAvailablePathForAttachment: jest.fn(),
        processFrontMatter: jest.fn(),
      },
    } as any;

    const pathResolver = {} as PathResolver;
    svc = new FileSyncService(mockApp, pathResolver, () => settings);
    recorder = new DryRunRecorder();
    svc.setDryRunRecorder(recorder);
  });

  it("records would-create instead of calling vault.create", async () => {
    const saved = await svc.saveFile("Notes/a.md", "content", "uuid-1", "note");

    expect(saved).toBe(true);
    expect(mockApp.vault.create).not.toHaveBeenCalled();
    const records = recorder.all();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      outcome: "would-create",
      path: "Notes/a.md",
      granolaId: "uuid-1",
      type: "note",
    });
  });

  it("records would-modify (and not vault.modify) when an existing file's content differs", async () => {
    const existing = new TFile("Notes/a.md", "md");
    mockApp.vault.getMarkdownFiles.mockReturnValue([existing]);
    mockApp.metadataCache.getFileCache.mockReturnValue({
      frontmatter: { granola_id: "uuid-1" },
    } as any);
    mockApp.vault.read = jest.fn().mockResolvedValue("old content");

    await svc.buildCache();
    const saved = await svc.saveFile(
      "Notes/a.md",
      "new content",
      "uuid-1",
      "note"
    );

    expect(saved).toBe(true);
    expect(mockApp.vault.modify).not.toHaveBeenCalled();
    const outcomes = recorder.all().map((r) => r.outcome);
    expect(outcomes).toContain("would-modify");
  });

  it("records skip-unchanged when content is identical", async () => {
    const existing = new TFile("Notes/a.md", "md");
    mockApp.vault.getMarkdownFiles.mockReturnValue([existing]);
    mockApp.metadataCache.getFileCache.mockReturnValue({
      frontmatter: { granola_id: "uuid-1" },
    } as any);
    mockApp.vault.read = jest.fn().mockResolvedValue("same content");

    await svc.buildCache();
    const saved = await svc.saveFile(
      "Notes/a.md",
      "same content",
      "uuid-1",
      "note"
    );

    expect(saved).toBe(false);
    expect(mockApp.vault.modify).not.toHaveBeenCalled();
    expect(recorder.all().map((r) => r.outcome)).toContain("skip-unchanged");
  });

  it("records would-rename when the destination path differs from the existing file", async () => {
    const existing = new TFile("Notes/old.md", "md");
    mockApp.vault.getMarkdownFiles.mockReturnValue([existing]);
    mockApp.metadataCache.getFileCache.mockReturnValue({
      frontmatter: { granola_id: "uuid-1" },
    } as any);
    mockApp.vault.read = jest.fn().mockResolvedValue("old content");

    await svc.buildCache();
    await svc.saveFile("Notes/new.md", "new content", "uuid-1", "note");

    expect(mockApp.vault.rename).not.toHaveBeenCalled();
    const renameRecord = recorder
      .all()
      .find((r) => r.outcome === "would-rename");
    expect(renameRecord).toMatchObject({
      outcome: "would-rename",
      path: "Notes/old.md",
      toPath: "Notes/new.md",
    });
  });

  it("clearing the recorder restores live writes", async () => {
    svc.setDryRunRecorder(null);
    await svc.saveFile("Notes/a.md", "content", "uuid-1", "note");
    expect(mockApp.vault.create).toHaveBeenCalled();
  });
});

describe("DryRunRecorder + FileSyncService — ensureFolder", () => {
  let mockApp: jest.Mocked<App>;
  let svc: FileSyncService;
  let settings: GranolaSyncSettings;
  let recorder: DryRunRecorder;

  beforeEach(() => {
    settings = { ...DEFAULT_SETTINGS, saveAsIndividualFiles: true };
    mockApp = {
      vault: {
        getMarkdownFiles: jest.fn().mockReturnValue([]),
        getAbstractFileByPath: jest.fn().mockReturnValue(null),
        createFolder: jest.fn(),
        create: jest.fn(),
        read: jest.fn(),
        modify: jest.fn(),
        rename: jest.fn(),
        createBinary: jest.fn(),
      },
      metadataCache: { getFileCache: jest.fn() },
      fileManager: {
        getAvailablePathForAttachment: jest.fn(),
        processFrontMatter: jest.fn(),
      },
    } as any;

    const pathResolver = {} as any;
    svc = new FileSyncService(mockApp, pathResolver, () => settings);
    recorder = new DryRunRecorder();
    svc.setDryRunRecorder(recorder);
  });

  it("does not call vault.createFolder for a missing folder in dry-run", async () => {
    const ok = await svc.ensureFolder("Granola/2026-05");
    expect(ok).toBe(true);
    expect(mockApp.vault.createFolder).not.toHaveBeenCalled();
  });

  it("still passes through when the folder already exists (live or dry-run)", async () => {
    mockApp.vault.getAbstractFileByPath = jest
      .fn()
      .mockReturnValue({ path: "Granola/2026-05" });
    const ok = await svc.ensureFolder("Granola/2026-05");
    expect(ok).toBe(true);
    expect(mockApp.vault.createFolder).not.toHaveBeenCalled();
  });

  it("calls vault.createFolder normally when recorder is null (live mode)", async () => {
    svc.setDryRunRecorder(null);
    await svc.ensureFolder("Granola/2026-05");
    expect(mockApp.vault.createFolder).toHaveBeenCalledWith("Granola/2026-05");
  });
});

describe("DryRunRecorder + FileSyncService — appendImageEmbedsForAttachments", () => {
  let mockApp: jest.Mocked<App>;
  let svc: FileSyncService;
  let settings: GranolaSyncSettings;
  let recorder: DryRunRecorder;

  beforeEach(() => {
    settings = { ...DEFAULT_SETTINGS, saveAsIndividualFiles: true };
    mockApp = {
      vault: {
        getMarkdownFiles: jest.fn().mockReturnValue([]),
        getAbstractFileByPath: jest.fn().mockReturnValue(null),
        createBinary: jest.fn(),
      },
      metadataCache: { getFileCache: jest.fn() },
      fileManager: {
        getAvailablePathForAttachment: jest
          .fn()
          .mockReturnValue("attachments/x.png"),
      },
    } as any;

    const pathResolver = {} as any;
    svc = new FileSyncService(mockApp, pathResolver, () => settings);
    recorder = new DryRunRecorder();
    svc.setDryRunRecorder(recorder);
  });

  it("does not hit the network or call createBinary in dry-run, even with image attachments", async () => {
    const requestUrlMock = (
      require("obsidian") as { requestUrl: jest.Mock }
    ).requestUrl;
    requestUrlMock.mockReset();

    const doc: any = {
      id: "uuid-1",
      attachments: [
        { id: "att-1", url: "https://granola.example/img.png", type: "image" },
        { id: "att-2", url: "https://granola.example/img2.png", type: "image" },
      ],
    };
    const content = "# Note\nbody";

    const result = await svc.appendImageEmbedsForAttachments(
      doc,
      content,
      "Notes/x.md"
    );

    expect(requestUrlMock).not.toHaveBeenCalled();
    expect(mockApp.vault.createBinary).not.toHaveBeenCalled();
    expect(result).toBe(content); // content unchanged in dry-run
    const records = recorder.all();
    expect(records).toHaveLength(2);
    expect(records.every((r) => r.outcome === "would-create")).toBe(true);
  });

  it("returns content unchanged when there are no attachments (no record)", async () => {
    const doc: any = { id: "uuid-1", attachments: [] };
    const result = await svc.appendImageEmbedsForAttachments(
      doc,
      "body",
      "Notes/x.md"
    );
    expect(result).toBe("body");
    expect(recorder.all()).toHaveLength(0);
  });
});

describe("DryRunRecorder.summarize", () => {
  it("produces a counted summary of records", () => {
    const r = new DryRunRecorder();
    r.record({ outcome: "would-create", path: "a.md" });
    r.record({ outcome: "would-create", path: "b.md" });
    r.record({ outcome: "would-modify", path: "c.md" });
    r.record({ outcome: "skip-unchanged", path: "d.md" });

    const summary = r.summarize();
    expect(summary).toContain("would-create: 2");
    expect(summary).toContain("would-modify: 1");
    expect(summary).toContain("skip-unchanged: 1");
    expect(summary).toContain("a.md");
  });
});
