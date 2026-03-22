import { describe, it, expect } from 'bun:test';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

describe('Vite Frontend Build', () => {
  const frontendDir = resolve(import.meta.dir, '../../src/frontend');
  const distDir = resolve(import.meta.dir, '../../dist/frontend');

  it('should have vite.config.ts', () => {
    const configPath = resolve(frontendDir, 'vite.config.ts');
    expect(existsSync(configPath)).toBe(true);
  });

  it('should have index.html', () => {
    const htmlPath = resolve(frontendDir, 'index.html');
    expect(existsSync(htmlPath)).toBe(true);
    const content = readFileSync(htmlPath, 'utf-8');
    expect(content).toContain('<div id="root">');
    expect(content).toContain('main.tsx');
  });

  it('should have main.tsx', () => {
    const mainPath = resolve(frontendDir, 'main.tsx');
    expect(existsSync(mainPath)).toBe(true);
    const content = readFileSync(mainPath, 'utf-8');
    expect(content).toContain('ReactDOM.createRoot');
    expect(content).toContain('<App />');
  });

  it('should have App.tsx', () => {
    const appPath = resolve(frontendDir, 'App.tsx');
    expect(existsSync(appPath)).toBe(true);
    const content = readFileSync(appPath, 'utf-8');
    expect(content).toContain('Obsku Studio');
  });

  it('should have vite-env.d.ts', () => {
    const typesPath = resolve(frontendDir, 'vite-env.d.ts');
    expect(existsSync(typesPath)).toBe(true);
  });

  it('vite.config.ts should have correct configuration', () => {
    const configPath = resolve(frontendDir, 'vite.config.ts');
    const content = readFileSync(configPath, 'utf-8');
    expect(content).toContain('lib:');
    expect(content).toContain("formats: ['es']");
    expect(content).toContain("target: 'http://localhost:3000'");
    expect(content).toContain("'/api':");
  });
});
