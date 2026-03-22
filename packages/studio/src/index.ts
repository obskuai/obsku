/**
 * Obsku Studio - Visual studio for agent development
 *
 * @packageDocumentation
 */

// CLI entry point (separate from library API)
export { main as cliMain } from "./cli.js";
export * from "./scanner/index.js";

// Placeholder exports for future modules
export const version = "0.1.0";
