/**
 * Project initialization command - creates scaffold for new obsku projects
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createProjectTemplate } from "../templates/project";

export function initProject(projectName: string): void {
  const targetDir = join(process.cwd(), projectName);

  if (existsSync(targetDir)) {
    console.error(`Error: Directory '${projectName}' already exists`);
    process.exit(1);
  }

  mkdirSync(targetDir, { recursive: true });
  mkdirSync(join(targetDir, "src"), { recursive: true });

  const template = createProjectTemplate(projectName);

  writeFileSync(join(targetDir, "package.json"), JSON.stringify(template.packageJson, null, 2));
  writeFileSync(join(targetDir, "tsconfig.json"), JSON.stringify(template.tsconfigJson, null, 2));
  writeFileSync(join(targetDir, "src", "index.ts"), template.agentTemplate);

  console.log(`✓ Created '${projectName}' project`);
  console.log(`  cd ${projectName}`);
  console.log(`  bun install`);
  console.log(`  bun start`);
}
