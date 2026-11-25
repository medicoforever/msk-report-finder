import JSZip from "jszip";
import type { RankedReport } from "../types";

export function reportDocxUrl(filename: string): string {
  return `./reports/${encodeURIComponent(filename)}`;
}

export async function downloadSingleDocx(filename: string): Promise<void> {
  const res = await fetch(reportDocxUrl(filename));
  if (!res.ok) {
    throw new Error(`Could not fetch ${filename} (HTTP ${res.status})`);
  }
  const blob = await res.blob();
  triggerBlobDownload(blob, filename);
}

export async function downloadTop5Zip(top5: RankedReport[]): Promise<void> {
  const zip = new JSZip();
  const folder = zip.folder("MSK_Top5_Reports");
  if (!folder) throw new Error("Failed to initialize zip archive.");

  await Promise.all(
    top5.map(async (item) => {
      const res = await fetch(reportDocxUrl(item.report.filename));
      if (!res.ok) {
        throw new Error(`Failed to fetch ${item.report.filename}`);
      }
      const buf = await res.arrayBuffer();
      const rankedName = `Rank${item.rank}_${item.report.filename}`;
      folder.file(rankedName, buf);
    })
  );

  const zipBlob = await zip.generateAsync({ type: "blob" });
  triggerBlobDownload(zipBlob, "MSK_Top5_Reports.zip");
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
