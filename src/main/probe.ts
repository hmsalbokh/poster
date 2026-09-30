import { execFile } from "node:child_process";
import ffprobeStatic from "ffprobe-static";

export interface ProbeResult {
  ok: boolean;
  reason: string;
}

export async function isShort(filePath: string): Promise<ProbeResult> {
  return new Promise((resolve) => {
    execFile(
      ffprobeStatic.path,
      ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", filePath],
      (err, stdout) => {
        if (err) return resolve({ ok: true, reason: "probe-unavailable-warning-only" });
        try {
          const j = JSON.parse(stdout as string) as {
            format?: { duration?: string };
            streams?: Array<{ codec_type: string; width?: number; height?: number }>;
          };
          const dur = Number(j.format?.duration ?? 0);
          const v = (j.streams ?? []).find((s) => s.codec_type === "video");
          const vertical = Number(v?.height ?? 0) > Number(v?.width ?? 0);
          if (dur >= 61) return resolve({ ok: false, reason: "longer-than-60s" });
          if (!vertical) return resolve({ ok: false, reason: "not-vertical" });
          return resolve({ ok: true, reason: "short-ok" });
        } catch {
          return resolve({ ok: true, reason: "probe-parse-warning-only" });
        }
      }
    );
  });
}
