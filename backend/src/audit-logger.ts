import { appendFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";

const auditLogFile = process.env.AUDIT_LOG_FILE?.trim();

function ensureLogPath(filePath: string): void {
  const folder = dirname(filePath);
  if (!existsSync(folder)) {
    mkdirSync(folder, { recursive: true });
  }
}

export function auditLog(event: string, details: Record<string, unknown>): void {
  const payload = {
    event,
    ...details,
    timestamp: new Date().toISOString()
  };

  const line = JSON.stringify(payload);
  if (auditLogFile) {
    try {
      ensureLogPath(auditLogFile);
      appendFileSync(auditLogFile, `${line}\n`, { encoding: "utf8" });
    } catch (error) {
      console.warn(`Audit log write failed: ${(error as Error).message}`);
      console.warn(line);
    }
    return;
  }

  console.warn(line);
}
