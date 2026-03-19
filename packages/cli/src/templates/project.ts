/**
 * Project scaffolding templates
 */

export interface ProjectTemplate {
  packageJson: object;
  tsconfigJson: object;
  agentTemplate: string;
}

export function createProjectTemplate(projectName: string): ProjectTemplate {
  const packageJson = {
    name: projectName,
    version: "0.1.0",
    type: "module",
    scripts: {
      start: "bun run src/index.ts",
      build: "tsc",
    },
    dependencies: {
      "@obsku/framework": "^0.1.0",
    },
    devDependencies: {
      typescript: "^5.9.3",
      "@types/node": "^25.2.0",
    },
  };

  const tsconfigJson = {
    compilerOptions: {
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "bundler",
      lib: ["ES2022"],
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      forceConsistentCasingInFileNames: true,
      outDir: "./dist",
      rootDir: "./src",
    },
    include: ["src/**/*"],
    exclude: ["dist", "node_modules"],
  };

  const agentTemplate = `import { agent } from "@obsku/framework";

// Define your agent
const myAgent = agent({
  name: "${projectName}",
  prompt: "You are a helpful assistant.",
  // tools: [], // Add your tools here
});

// Run the agent
async function main() {
  // Example: Run with a provider
  // import { bedrock } from "@obsku/provider-bedrock";
  // const result = await myAgent.run(
  //   "Hello, world!",
  //   bedrock({ model: "your-model-id", maxOutputTokens: 4096 })
  // );
  // console.log(result);
  
  console.log("Agent '${projectName}' ready! Edit src/index.ts to add your logic.");
}

main().catch(console.error);
`;

  return { packageJson, tsconfigJson, agentTemplate };
}
