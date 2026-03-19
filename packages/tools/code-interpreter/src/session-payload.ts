import type { SupportedLanguage } from "./types";

export type SessionLanguage = Extract<SupportedLanguage, "python" | "javascript" | "typescript">;

export type UserCodeOutcome = {
  stdout: string;
  userCodeFailed: boolean;
};

export function formatExecutionPayload(
  language: SessionLanguage,
  code: string,
  delimiter: string
): string {
  if (language === "python") {
    const trimmed = code.trimEnd();
    const prefix = trimmed.length ? `${trimmed}\n` : "";
    return `${prefix}import sys\n_ = sys.stdout.write("${delimiter}\\n")\nsys.stdout.flush()\n`;
  }

  const statusMarker = userCodeStatusMarker(delimiter);
  return `/* catch (e) { console.error(e); } finally { process.stdout.write("${delimiter}\\n"); } */ let __obskuUserCodeFailed__ = false; try { try { ${code}; } catch (e) { __obskuUserCodeFailed__ = true; throw e; } } catch (e) { console.error(e); } finally { process.stdout.write("${statusMarker}" + (__obskuUserCodeFailed__ ? "error" : "ok") + "\\n"); process.stdout.write("${delimiter}\\n"); }\n`;
}

export function formatInitializationPayload(language: SessionLanguage, delimiter: string): string {
  return language === "python"
    ? `import sys\nsys.ps1 = ""\nsys.ps2 = ""\n_ = sys.stdout.write("${delimiter}\\n")\nsys.stdout.flush()\n`
    : `process.stdout.write("${delimiter}\\n")\n`;
}

export function extractUserCodeOutcome(
  language: SessionLanguage,
  stdout: string,
  delimiter: string
): UserCodeOutcome {
  if (language === "python") {
    return { stdout, userCodeFailed: false };
  }

  const marker = userCodeStatusMarker(delimiter);
  const index = stdout.lastIndexOf(marker);
  if (index === -1) {
    return { stdout, userCodeFailed: false };
  }

  const statusStart = index + marker.length;
  const statusEnd = stdout.indexOf("\n", statusStart);
  if (statusEnd === -1) {
    return { stdout, userCodeFailed: false };
  }

  return {
    stdout: stdout.slice(0, index) + stdout.slice(statusEnd + 1),
    userCodeFailed: stdout.slice(statusStart, statusEnd) === "error",
  };
}

export function userCodeStatusMarker(delimiter: string): string {
  return `__OBSKU_EXEC_STATUS__${delimiter}__`;
}
