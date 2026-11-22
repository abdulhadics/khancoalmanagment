import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { sha256 } from "./common.mjs";

const run = promisify(execFile);

export async function mirrorEncryptedArchive(config, source, archive, signal) {
  try {
    const remote = `${config.remotePath}/${archive.name}`;
    const options = {
      windowsHide: true,
      signal: AbortSignal.any([signal, AbortSignal.timeout(300_000)]),
      maxBuffer: 16_384,
      env: Object.fromEntries(
        Object.entries(process.env).filter(([key]) =>
          /^(SYSTEMROOT|WINDIR|PATH|TEMP|TMP)$/i.test(key),
        ),
      ),
    };
    const args = ["--config", config.configFile];
    if ((await sha256(source, options.signal)) !== archive.hash)
      return "failed";
    await run(
      config.executable,
      [...args, "copyto", "--ignore-existing", source, remote],
      options,
    );
    const { stdout } = await run(
      config.executable,
      [...args, "hashsum", "SHA-256", "--download", remote],
      options,
    );
    return stdout.trim().split(/\s+/, 1)[0]?.toLowerCase() === archive.hash
      ? "succeeded"
      : "failed";
  } catch {
    return "failed";
  }
}
