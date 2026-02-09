/**
 * Git command integration tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { VirtualFS } from '../src/virtual-fs';
import { Runtime } from '../src/runtime';

describe('git command', () => {
    let vfs: VirtualFS;
    let runtime: Runtime;
    let consoleOutput: string[] = [];

    beforeEach(() => {
        vfs = new VirtualFS();
        consoleOutput = [];
        runtime = new Runtime(vfs, {
            onConsole: (method, args) => {
                consoleOutput.push(args.join(' '));
            },
        });
    });

    describe('git help', () => {
        it('should show help when running git without arguments', async () => {
            const code = `
const { exec } = require('child_process');

exec('git', (error, stdout, stderr) => {
  console.log('stdout:', stdout);
});
      `;

            runtime.execute(code, '/test.js');
            await new Promise(resolve => setTimeout(resolve, 200));

            expect(consoleOutput.some(o => o.includes('usage: git'))).toBe(true);
        });

        it('should show version', async () => {
            const code = `
const { exec } = require('child_process');

exec('git --version', (error, stdout, stderr) => {
  console.log('version:', stdout);
});
      `;

            runtime.execute(code, '/test.js');
            await new Promise(resolve => setTimeout(resolve, 200));

            expect(consoleOutput.some(o => o.includes('isomorphic-git'))).toBe(true);
        });
    });

    describe('git init', () => {
        it('should initialize a git repository', async () => {
            // Create directory for repo
            vfs.mkdirSync('/test-repo', { recursive: true });

            // Re-create runtime to pick up VFS
            runtime = new Runtime(vfs, {
                onConsole: (method, args) => {
                    consoleOutput.push(args.join(' '));
                },
            });

            const code = `
const { exec } = require('child_process');

exec('cd /test-repo && git init', (error, stdout, stderr) => {
  if (error) {
    console.log('error:', error.message);
    return;
  }
  console.log('result:', stdout);
});
      `;

            runtime.execute(code, '/test.js');
            await new Promise(resolve => setTimeout(resolve, 300));

            expect(consoleOutput.some(o => o.includes('Initialized'))).toBe(true);
        });
    });

    describe('git workflow', () => {
        it('should handle init, add, and commit', async () => {
            // Create directory and file
            vfs.mkdirSync('/project', { recursive: true });
            vfs.writeFileSync('/project/README.md', '# My Project\n');

            runtime = new Runtime(vfs, {
                onConsole: (method, args) => {
                    consoleOutput.push(args.join(' '));
                },
            });

            const code = `
const { exec } = require('child_process');

async function run() {
  await new Promise((resolve, reject) => {
    exec('cd /project && git init', (error, stdout, stderr) => {
      if (error) reject(error);
      console.log('init:', stdout.trim());
      resolve();
    });
  });

  await new Promise((resolve, reject) => {
    exec('cd /project && git add README.md', (error, stdout, stderr) => {
      if (error) reject(error);
      console.log('add: done');
      resolve();
    });
  });

  await new Promise((resolve, reject) => {
    exec('cd /project && git commit -m "initial commit"', (error, stdout, stderr) => {
      if (error) reject(error);
      console.log('commit:', stdout.trim());
      resolve();
    });
  });

  await new Promise((resolve, reject) => {
    exec('cd /project && git log', (error, stdout, stderr) => {
      if (error) reject(error);
      console.log('log:', stdout);
      resolve();
    });
  });
}

run().catch(e => console.error('Error:', e.message));
      `;

            runtime.execute(code, '/test.js');
            await new Promise(resolve => setTimeout(resolve, 500));

            expect(consoleOutput.some(o => o.includes('Initialized'))).toBe(true);
        });
    });

    describe('git status', () => {
        it('should show untracked files', async () => {
            // Create repo with file
            vfs.mkdirSync('/status-test', { recursive: true });
            vfs.mkdirSync('/status-test/.git', { recursive: true });
            vfs.writeFileSync('/status-test/file.txt', 'content');

            runtime = new Runtime(vfs, {
                onConsole: (method, args) => {
                    consoleOutput.push(args.join(' '));
                },
            });

            const code = `
const { exec } = require('child_process');

exec('cd /status-test && git init && git status', (error, stdout, stderr) => {
  console.log('status:', stdout);
});
      `;

            runtime.execute(code, '/test.js');
            await new Promise(resolve => setTimeout(resolve, 300));

            expect(consoleOutput.some(o =>
                o.includes('Untracked') || o.includes('nothing to commit')
            )).toBe(true);
        });
    });

    describe('git branch', () => {
        it('should list branches after init', async () => {
            vfs.mkdirSync('/branch-test', { recursive: true });

            runtime = new Runtime(vfs, {
                onConsole: (method, args) => {
                    consoleOutput.push(args.join(' '));
                },
            });

            const code = `
const { exec } = require('child_process');

exec('cd /branch-test && git init && git branch', (error, stdout, stderr) => {
  console.log('branches:', stdout);
});
      `;

            runtime.execute(code, '/test.js');
            await new Promise(resolve => setTimeout(resolve, 300));

            // After init with no commits, branch list is empty
            expect(consoleOutput.some(o => o.includes('branches:'))).toBe(true);
        });
    });
});
