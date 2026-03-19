export function telemetryLog(msg: string): void {
  process.stderr.write(`[obsku:telemetry] ${msg}\n`);
}
