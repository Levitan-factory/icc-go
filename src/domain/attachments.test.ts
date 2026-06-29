import { describe, expect, it } from "vitest";
import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_CELL,
  attachmentContext,
  attachmentToUint8Array,
  filesToAttachments,
  formatBytes,
} from "./attachments";

describe("cell attachments", () => {
  it("stores readable text files as text content", async () => {
    const { attachments, rejected } = await filesToAttachments([
      new File(["alpha,beta\n1,2"], "data.csv", { type: "text/csv" }),
      new File([JSON.stringify({ ok: true })], "config.json", { type: "application/json" }),
    ], "cell_1");

    expect(rejected).toEqual([]);
    expect(attachments).toHaveLength(2);
    expect(attachments[0]).toMatchObject({
      displayName: "data.csv",
      extension: ".csv",
      encoding: "text",
      mimeType: "text/csv",
    });
    expect(attachments[1].content).toContain('"ok":true');
  });

  it("stores binary files as base64 and restores their bytes", async () => {
    const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const { attachments } = await filesToAttachments([
      new File([pngBytes], "chart.png", { type: "image/png" }),
    ], "cell_1");

    expect(attachments[0]).toMatchObject({
      displayName: "chart.png",
      encoding: "base64",
      mimeType: "image/png",
    });
    expect([...attachmentToUint8Array(attachments[0])]).toEqual([...pngBytes]);
  });

  it("deduplicates names within a cell", async () => {
    const first = new File(["one"], "note.md", { type: "text/markdown" });
    const second = new File(["two"], "note.md", { type: "text/markdown" });
    const { attachments } = await filesToAttachments([first, second], "cell_1");

    expect(attachments.map((attachment) => attachment.displayName)).toEqual(["note.md", "note 2.md"]);
  });

  it("rejects files above the per-file size limit", async () => {
    const largeFile = new File([new Uint8Array(MAX_ATTACHMENT_BYTES + 1)], "large.bin");
    const { attachments, rejected } = await filesToAttachments([largeFile], "cell_1");

    expect(attachments).toEqual([]);
    expect(rejected[0].reason).toContain(formatBytes(MAX_ATTACHMENT_BYTES));
  });

  it("caps attachment count per cell", async () => {
    const files = Array.from({ length: MAX_ATTACHMENTS_PER_CELL + 1 }, (_, index) =>
      new File([`file ${index}`], `file-${index}.txt`, { type: "text/plain" }),
    );
    const { attachments, rejected } = await filesToAttachments(files, "cell_1");

    expect(attachments).toHaveLength(MAX_ATTACHMENTS_PER_CELL);
    expect(rejected).toHaveLength(1);
  });

  it("builds prompt context from text and binary attachments", async () => {
    const { attachments } = await filesToAttachments([
      new File(["hello"], "brief.txt", { type: "text/plain" }),
      new File([new Uint8Array([1, 2, 3])], "image.png", { type: "image/png" }),
    ], "cell_1");

    const context = attachmentContext(attachments);

    expect(context).toContain("# Attached file: brief.txt");
    expect(context).toContain("hello");
    expect(context).toContain("Attached binary files");
    expect(context).toContain("image.png");
  });
});
