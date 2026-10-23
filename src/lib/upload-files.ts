import { unlink } from "node:fs/promises";
import path from "node:path";

const uploadRoot = process.env.UPLOAD_DIR ?? path.join(process.cwd(), "uploads");

/** Deletes files served from the uploads directory; other URLs and missing files are ignored. */
export async function removeUploadedFiles(urls: (string | null | undefined)[]) {
  await Promise.all(urls.map(async (url) => {
    const match = url?.match(/^\/(?:api\/)?uploads\/([a-z-]+)\/([^/?#]+)$/);
    if (!match) return;
    await unlink(path.join(uploadRoot, match[1]!, path.basename(match[2]!))).catch(() => undefined);
  }));
}
