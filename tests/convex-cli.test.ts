/**
 * Convex CLI Integration Test
 *
 * Tests whether we can run Convex CLI commands in our browser-based runtime.
 * This helps identify what's missing to support Convex.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { VirtualFS } from '../src/virtual-fs';
import { Runtime } from '../src/runtime';
import { PackageManager } from '../src/npm';

describe('Convex CLI Integration', () => {
  let vfs: VirtualFS;
  let runtime: Runtime;
  let pm: PackageManager;

  beforeEach(() => {
    vfs = new VirtualFS();
    runtime = new Runtime(vfs, { cwd: '/project' });
    pm = new PackageManager(vfs, { cwd: '/project' });

    // Create a basic project structure
    vfs.mkdirSync('/project', { recursive: true });
    vfs.mkdirSync('/project/convex', { recursive: true });

    // Create package.json
    vfs.writeFileSync('/project/package.json', JSON.stringify({
      name: 'test-convex-project',
      version: '1.0.0',
      dependencies: {}
    }, null, 2));

    // Create a simple Convex function
    vfs.writeFileSync('/project/convex/tasks.ts', `
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("tasks").collect();
  },
});

export const add = mutation({
  args: { text: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.insert("tasks", { text: args.text, completed: false });
  },
});
`);
  });

  it('should be able to require convex package after installation', async () => {
    // This test checks if we can load the convex package
    // First we need to install it

    console.log('Installing convex...');
    const result = await pm.install('convex', {});
    console.log('Install result - added:', result.added);

    expect(result.added).toContain('convex');

    // Try to require the convex package
    const code = `
      const convex = require('convex');
      module.exports = {
        hasConvex: !!convex,
        keys: Object.keys(convex)
      };
    `;

    try {
      const { exports } = runtime.execute(code, '/project/test.js');
      const execResult = exports as { hasConvex: boolean; keys: string[] };
      expect(execResult.hasConvex).toBe(true);
      console.log('Convex exports:', execResult.keys);
    } catch (error) {
      console.error('Failed to require convex:', error);
      throw error;
    }
  }, 60000);

  it('should be able to import convex/server', async () => {
    const result = await pm.install('convex', {});
    expect(result.added).toContain('convex');

    const code = `
      const server = require('convex/server');
      module.exports = {
        hasServer: !!server,
        keys: Object.keys(server)
      };
    `;

    try {
      const { exports } = runtime.execute(code, '/project/test.js');
      const execResult = exports as { hasServer: boolean; keys: string[] };
      expect(execResult.hasServer).toBe(true);
      console.log('convex/server exports:', execResult.keys);
    } catch (error) {
      console.error('Failed to require convex/server:', error);
      throw error;
    }
  }, 60000);

  it('should be able to import convex/values', async () => {
    const result = await pm.install('convex', {});
    expect(result.added).toContain('convex');

    const code = `
      const values = require('convex/values');
      module.exports = {
        hasValues: !!values,
        hasV: !!values.v,
        keys: Object.keys(values)
      };
    `;

    try {
      const { exports } = runtime.execute(code, '/project/test.js');
      const execResult = exports as { hasValues: boolean; hasV: boolean; keys: string[] };
      expect(execResult.hasValues).toBe(true);
      console.log('convex/values exports:', execResult.keys);
    } catch (error) {
      console.error('Failed to require convex/values:', error);
      throw error;
    }
  }, 60000);

  it('should identify missing dependencies for CLI', async () => {
    console.log('PM list before install:', pm.list());
    console.log('Installing convex...');
    const result = await pm.install('convex', {});
    console.log('PM list after install:', pm.list());
    console.log('Install result - added:', result.added);
    expect(result.added).toContain('convex');

    // List all files in the convex package to understand what's installed
    const convexDir = '/project/node_modules/convex';
    console.log('Convex package directory exists:', vfs.existsSync(convexDir));
    console.log('node_modules exists:', vfs.existsSync('/project/node_modules'));
    if (vfs.existsSync('/project/node_modules')) {
      console.log('node_modules contents:', vfs.readdirSync('/project/node_modules').slice(0, 20));
    }

    // Also check root node_modules
    console.log('Root node_modules exists:', vfs.existsSync('/node_modules'));
    if (vfs.existsSync('/node_modules')) {
      console.log('Root node_modules contents:', vfs.readdirSync('/node_modules').slice(0, 20));
    }

    // List all directories at root
    console.log('Root contents:', vfs.readdirSync('/'));

    // List top-level files/dirs
    if (vfs.existsSync(convexDir)) {
      const entries = vfs.readdirSync(convexDir);
      console.log('Convex package contents:', entries);

      // Check for bin directory
      const binDir = '/project/node_modules/convex/bin';
      if (vfs.existsSync(binDir)) {
        console.log('Bin directory contents:', vfs.readdirSync(binDir));
      } else {
        console.log('No bin directory found');
      }

      // Check for dist directory
      const distDir = '/project/node_modules/convex/dist';
      if (vfs.existsSync(distDir)) {
        console.log('Dist directory contents:', vfs.readdirSync(distDir));
      }
    }

    const pkgPath = '/project/node_modules/convex/package.json';
    if (vfs.existsSync(pkgPath)) {
      const pkg = JSON.parse(vfs.readFileSync(pkgPath, 'utf8'));
      console.log('Package bin field:', pkg.bin);
    }
  }, 60000);

  it.skip('should attempt to run convex CLI --help (blocked by dynamic imports)', async () => {
    const result = await pm.install('convex', {});
    expect(result.added).toContain('convex');

    // The bin/main.js just has a shebang and dynamic import to the bundled CLI
    // Let's try running the bundled CLI directly
    const cliBundlePath = '/project/node_modules/convex/dist/cli.bundle.cjs';

    if (!vfs.existsSync(cliBundlePath)) {
      console.log('CLI bundle not found at expected path');
      return;
    }

    // Check the first 500 chars of the bundle
    const cliCode = vfs.readFileSync(cliBundlePath, 'utf8');
    console.log('CLI bundle size:', cliCode.length, 'bytes');
    console.log('CLI bundle preview:', cliCode.substring(0, 500));

    // Set up process.argv to simulate CLI call
    const code = `
      process.argv = ['node', 'convex', '--help'];
      require('./node_modules/convex/dist/cli.bundle.cjs');
    `;

    try {
      runtime.execute(code, '/project/cli-test.js');
      console.log('CLI executed successfully');
    } catch (error) {
      console.log('CLI execution error:', error.message);
      // Log the stack trace to understand what's missing
      if (error.stack) {
        console.log('Stack trace:', error.stack.split('\n').slice(0, 10).join('\n'));
      }
      // Expected - CLI has many Node.js dependencies we don't fully support yet
      // This test documents what's currently blocking
    }
  }, 60000);

  it.skip('should run convex dev --once (not yet implemented)', async () => {
    // This test will be enabled once we have:
    // 1. Full crypto.sign/verify support for jose JWT library
    // 2. Dynamic import support in our runtime
    // 3. Better process.stdin/stdout handling for CLI
    expect(true).toBe(true);
  });
});
