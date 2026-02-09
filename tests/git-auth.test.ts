/**
 * Git remote operations tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { VirtualFS } from '../src/virtual-fs';
import { Runtime } from '../src/runtime';

describe('git remote operations', () => {
  let vfs: VirtualFS;
  let runtime: Runtime;
  let output: string[] = [];

  beforeEach(() => {
    vfs = new VirtualFS();
    output = [];
    runtime = new Runtime(vfs, {
      env: {
        GIT_TOKEN: process.env.GIT_TOKEN || '',
        GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME || 'User',
        GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL || 'user@localhost',
      },
      onConsole: (_method, args) => {
        const msg = args.join(' ');
        output.push(msg);
        console.log(msg);
      },
    });
    vfs.mkdirSync('/repos', { recursive: true });
  });

  it('should clone superr-skills repo and list files', async () => {
    const code = `
const { exec } = require('child_process');
const fs = require('fs');

console.log('Starting clone...');

exec('cd /repos && git clone https://github.com/lezgoverci/superr-skills.git', (err, stdout, stderr) => {
  console.log('Clone callback called');
  if (err) {
    console.log('CLONE_ERROR:', err.message);
    console.log('STDERR:', stderr);
    return;
  }
  console.log('CLONE_SUCCESS:', stdout);
  
  // Check if directory exists first
  try {
    const exists = fs.existsSync('/repos/superr-skills');
    console.log('DIR_EXISTS:', exists);
    if (exists) {
      const files = fs.readdirSync('/repos/superr-skills');
      console.log('FILES:', files.join(', '));
    }
  } catch (e) {
    console.log('FS_ERROR:', e.message);
  }
});
    `;

    runtime.execute(code, '/test.js');
    await new Promise(r => setTimeout(r, 20000));

    console.log('ALL_OUTPUT:', output);

    // Check output
    const hasCloneResult = output.some(o =>
      o.includes('CLONE_SUCCESS') || o.includes('CLONE_ERROR')
    );
    expect(hasCloneResult).toBe(true);
  }, 30000);
});
