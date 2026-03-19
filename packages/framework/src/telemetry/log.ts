export function debugLog(msg: string): void {
  if (!process.env.OBSKU_DEBUG) return;
  process.stderr.write(`[obsku:debug] ${msg}\n`);
}
