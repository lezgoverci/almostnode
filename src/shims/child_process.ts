/**
 * Node.js child_process module shim
 * Uses just-bash for command execution in browser with VirtualFS adapter
 */

// Polyfill process for just-bash (it expects Node.js environment)
if (typeof globalThis.process === 'undefined') {
  (globalThis as any).process = {
    env: {
      HOME: '/home/user',
      USER: 'user',
      PATH: '/usr/local/bin:/usr/bin:/bin',
      NODE_ENV: 'development',
    },
    cwd: () => '/',
    platform: 'linux',
    version: 'v18.0.0',
    versions: { node: '18.0.0' },
    stdout: { write: () => { } },
    stderr: { write: () => { } },
  };
}

import { Bash, defineCommand } from 'just-bash';
import { EventEmitter } from './events';
import { Readable, Writable, Buffer } from './stream';
import type { VirtualFS } from '../virtual-fs';
import { VirtualFSAdapter } from './vfs-adapter';
import { Runtime } from '../runtime';
import git from 'isomorphic-git';
import http from 'isomorphic-git/http/web';
import { createIsomorphicGitFs, getAuthFromEnv, DEFAULT_CORS_PROXY } from './git-adapter';

// Singleton bash instance - uses VFS adapter for two-way file sync
let bashInstance: Bash | null = null;
let vfsAdapter: VirtualFSAdapter | null = null;
let currentVfs: VirtualFS | null = null;

/**
 * Initialize the child_process shim with a VirtualFS instance
 * Creates a single Bash instance with VirtualFSAdapter for efficient file access
 */
export function initChildProcess(vfs: VirtualFS): void {
  currentVfs = vfs;
  vfsAdapter = new VirtualFSAdapter(vfs);

  // Create custom 'node' command that runs JS files using the Runtime
  const nodeCommand = defineCommand('node', async (args, ctx) => {
    if (!currentVfs) {
      return { stdout: '', stderr: 'VFS not initialized\n', exitCode: 1 };
    }

    const scriptPath = args[0];
    if (!scriptPath) {
      return { stdout: '', stderr: 'Usage: node <script.js> [args...]\n', exitCode: 1 };
    }

    // Resolve the script path
    const resolvedPath = scriptPath.startsWith('/')
      ? scriptPath
      : `${ctx.cwd}/${scriptPath}`.replace(/\/+/g, '/');

    try {
      // Check if file exists
      if (!currentVfs.existsSync(resolvedPath)) {
        return { stdout: '', stderr: `Error: Cannot find module '${resolvedPath}'\n`, exitCode: 1 };
      }

      let stdout = '';
      let stderr = '';

      // Create a runtime with the current environment
      const runtime = new Runtime(currentVfs, {
        cwd: ctx.cwd,
        env: ctx.env,
        onConsole: (method, consoleArgs) => {
          const msg = consoleArgs.map(a => String(a)).join(' ') + '\n';
          if (method === 'error') {
            stderr += msg;
          } else {
            stdout += msg;
          }
        },
      });

      // Set up process.argv for the script
      const processShim = (globalThis as any).process || {};
      const originalArgv = processShim.argv;
      processShim.argv = ['node', resolvedPath, ...args.slice(1)];
      (globalThis as any).process = processShim;

      try {
        // Run the script
        runtime.runFile(resolvedPath);
        return { stdout, stderr, exitCode: 0 };
      } finally {
        // Restore original argv
        processShim.argv = originalArgv;
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return { stdout: '', stderr: `Error: ${errorMsg}\n`, exitCode: 1 };
    }
  });

  // Create custom 'convex' command that runs the Convex CLI
  const convexCommand = defineCommand('convex', async (args, ctx) => {
    if (!currentVfs) {
      return { stdout: '', stderr: 'VFS not initialized\n', exitCode: 1 };
    }

    // Find the Convex CLI bundle
    const cliBundlePath = '/node_modules/convex/dist/cli.bundle.cjs';
    if (!currentVfs.existsSync(cliBundlePath)) {
      return { stdout: '', stderr: 'Convex CLI not found. Run: npm install convex\n', exitCode: 1 };
    }

    let stdout = '';
    let stderr = '';

    try {
      // Create a runtime with the current environment
      const runtime = new Runtime(currentVfs, {
        cwd: ctx.cwd,
        env: ctx.env,
        onConsole: (method, consoleArgs) => {
          const msg = consoleArgs.map(a => String(a)).join(' ') + '\n';
          if (method === 'error') {
            stderr += msg;
          } else {
            stdout += msg;
          }
        },
      });

      // Set up process.argv for the CLI
      const processShim = (globalThis as any).process || {};
      const originalArgv = processShim.argv;
      const originalEnv = { ...processShim.env };

      processShim.argv = ['node', 'convex', ...args];
      processShim.env = { ...processShim.env, ...ctx.env };
      (globalThis as any).process = processShim;

      try {
        // Run the CLI bundle
        runtime.runFile(cliBundlePath);
        return { stdout, stderr, exitCode: 0 };
      } finally {
        // Restore original state
        processShim.argv = originalArgv;
        processShim.env = originalEnv;
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return { stdout, stderr: stderr + `Error: ${errorMsg}\n`, exitCode: 1 };
    }
  });

  // Create custom 'git' command using isomorphic-git
  const gitCommand = defineCommand('git', async (args, ctx) => {
    if (!vfsAdapter) {
      return { stdout: '', stderr: 'VFS not initialized\n', exitCode: 1 };
    }

    const subcommand = args[0];
    const subArgs = args.slice(1);
    const fs = createIsomorphicGitFs(vfsAdapter);
    const dir = ctx.cwd;
    const author = {
      name: ctx.env.get('GIT_AUTHOR_NAME') || ctx.env.get('USER') || 'User',
      email: ctx.env.get('GIT_AUTHOR_EMAIL') || 'user@localhost',
    };
    const corsProxy = ctx.env.get('GIT_CORS_PROXY') || DEFAULT_CORS_PROXY;
    const onAuth = () => getAuthFromEnv(ctx.env);

    try {
      switch (subcommand) {
        case 'init': {
          const bare = subArgs.includes('--bare');
          const targetDir = subArgs.find(a => !a.startsWith('-')) || dir;
          await git.init({ fs, dir: targetDir, bare });
          return { stdout: `Initialized empty Git repository in ${targetDir}/.git/\n`, stderr: '', exitCode: 0 };
        }

        case 'clone': {
          const url = subArgs.find(a => !a.startsWith('-'));
          if (!url) {
            return { stdout: '', stderr: 'Usage: git clone <url> [directory]\n', exitCode: 1 };
          }
          const targetDir = subArgs.find((a, i) => i > 0 && !a.startsWith('-')) || url.split('/').pop()?.replace('.git', '') || 'repo';
          const depth = subArgs.includes('--depth') ? parseInt(subArgs[subArgs.indexOf('--depth') + 1]) : undefined;
          const singleBranch = subArgs.includes('--single-branch');

          await git.clone({
            fs, http, dir: targetDir, url, corsProxy,
            depth, singleBranch, onAuth,
            onProgress: (event) => {
              // Progress could be streamed in a future enhancement
            },
          });
          return { stdout: `Cloning into '${targetDir}'...\ndone.\n`, stderr: '', exitCode: 0 };
        }

        case 'status': {
          const matrix = await git.statusMatrix({ fs, dir });
          let stdout = '';
          const staged: string[] = [];
          const modified: string[] = [];
          const untracked: string[] = [];

          for (const [filepath, head, workdir, stage] of matrix) {
            if (head === 0 && workdir === 2 && stage === 0) untracked.push(filepath);
            else if (head === 1 && workdir === 2 && stage === 1) modified.push(filepath);
            else if (head === 1 && workdir === 2 && stage === 2) staged.push(filepath);
            else if (head === 0 && workdir === 2 && stage === 2) staged.push(filepath);
            else if (head === 1 && workdir === 0 && stage === 0) staged.push(filepath); // deleted, staged
          }

          if (staged.length > 0) {
            stdout += 'Changes to be committed:\n';
            staged.forEach(f => stdout += `  new file:   ${f}\n`);
            stdout += '\n';
          }
          if (modified.length > 0) {
            stdout += 'Changes not staged for commit:\n';
            modified.forEach(f => stdout += `  modified:   ${f}\n`);
            stdout += '\n';
          }
          if (untracked.length > 0) {
            stdout += 'Untracked files:\n';
            untracked.forEach(f => stdout += `  ${f}\n`);
            stdout += '\n';
          }
          if (!stdout) stdout = 'nothing to commit, working tree clean\n';

          return { stdout, stderr: '', exitCode: 0 };
        }

        case 'add': {
          const files = subArgs.filter(a => !a.startsWith('-'));
          if (files.length === 0) {
            return { stdout: '', stderr: 'Nothing specified, nothing added.\n', exitCode: 0 };
          }
          for (const filepath of files) {
            if (filepath === '.') {
              // Add all files
              const matrix = await git.statusMatrix({ fs, dir });
              for (const [f] of matrix) {
                await git.add({ fs, dir, filepath: f });
              }
            } else {
              await git.add({ fs, dir, filepath });
            }
          }
          return { stdout: '', stderr: '', exitCode: 0 };
        }

        case 'commit': {
          const msgIndex = subArgs.indexOf('-m');
          const message = msgIndex >= 0 ? subArgs[msgIndex + 1] : 'No message';
          const sha = await git.commit({ fs, dir, message, author });
          return { stdout: `[${sha.slice(0, 7)}] ${message}\n`, stderr: '', exitCode: 0 };
        }

        case 'log': {
          const depth = subArgs.includes('-n') ? parseInt(subArgs[subArgs.indexOf('-n') + 1]) : 10;
          const commits = await git.log({ fs, dir, depth });
          let stdout = '';
          for (const commit of commits) {
            stdout += `commit ${commit.oid}\n`;
            stdout += `Author: ${commit.commit.author.name} <${commit.commit.author.email}>\n`;
            stdout += `Date:   ${new Date(commit.commit.author.timestamp * 1000).toUTCString()}\n`;
            stdout += `\n    ${commit.commit.message}\n\n`;
          }
          return { stdout, stderr: '', exitCode: 0 };
        }

        case 'push': {
          const remote = subArgs.find(a => !a.startsWith('-')) || 'origin';
          const ref = subArgs.find((a, i) => i > 0 && !a.startsWith('-'));
          await git.push({ fs, http, dir, remote, ref, corsProxy, onAuth });
          return { stdout: `Pushed to ${remote}\n`, stderr: '', exitCode: 0 };
        }

        case 'pull': {
          const remote = subArgs.find(a => !a.startsWith('-')) || 'origin';
          const ref = subArgs.find((a, i) => i > 0 && !a.startsWith('-'));
          await git.pull({ fs, http, dir, remote, ref, corsProxy, onAuth, author });
          return { stdout: `Pulled from ${remote}\n`, stderr: '', exitCode: 0 };
        }

        case 'fetch': {
          const remote = subArgs.find(a => !a.startsWith('-')) || 'origin';
          await git.fetch({ fs, http, dir, remote, corsProxy, onAuth });
          return { stdout: `Fetched from ${remote}\n`, stderr: '', exitCode: 0 };
        }

        case 'branch': {
          if (subArgs.includes('-a') || subArgs.includes('--all')) {
            const local = await git.listBranches({ fs, dir });
            const remote = await git.listBranches({ fs, dir, remote: 'origin' });
            let stdout = local.map(b => `  ${b}\n`).join('');
            stdout += remote.map(b => `  remotes/origin/${b}\n`).join('');
            return { stdout, stderr: '', exitCode: 0 };
          }
          if (subArgs.includes('-d') || subArgs.includes('-D')) {
            const branchName = subArgs.find(a => !a.startsWith('-'));
            if (branchName) {
              await git.deleteBranch({ fs, dir, ref: branchName });
              return { stdout: `Deleted branch ${branchName}\n`, stderr: '', exitCode: 0 };
            }
          }
          if (subArgs.length > 0 && !subArgs[0].startsWith('-')) {
            await git.branch({ fs, dir, ref: subArgs[0] });
            return { stdout: '', stderr: '', exitCode: 0 };
          }
          const branches = await git.listBranches({ fs, dir });
          const current = await git.currentBranch({ fs, dir });
          const stdout = branches.map(b => b === current ? `* ${b}\n` : `  ${b}\n`).join('');
          return { stdout, stderr: '', exitCode: 0 };
        }

        case 'checkout': {
          const ref = subArgs.find(a => !a.startsWith('-'));
          if (!ref) {
            return { stdout: '', stderr: 'Usage: git checkout <branch>\n', exitCode: 1 };
          }
          if (subArgs.includes('-b')) {
            await git.branch({ fs, dir, ref });
          }
          await git.checkout({ fs, dir, ref });
          return { stdout: `Switched to branch '${ref}'\n`, stderr: '', exitCode: 0 };
        }

        case 'merge': {
          const theirs = subArgs.find(a => !a.startsWith('-'));
          if (!theirs) {
            return { stdout: '', stderr: 'Usage: git merge <branch>\n', exitCode: 1 };
          }
          await git.merge({ fs, dir, theirs, author });
          return { stdout: `Merged ${theirs}\n`, stderr: '', exitCode: 0 };
        }

        case 'diff': {
          // Simple diff showing modified files
          const matrix = await git.statusMatrix({ fs, dir });
          let stdout = '';
          for (const [filepath, head, workdir] of matrix) {
            if (head !== workdir) {
              stdout += `diff --git a/${filepath} b/${filepath}\n`;
            }
          }
          if (!stdout) stdout = 'No changes\n';
          return { stdout, stderr: '', exitCode: 0 };
        }

        case 'remote': {
          if (subArgs[0] === 'add') {
            const name = subArgs[1];
            const url = subArgs[2];
            if (!name || !url) {
              return { stdout: '', stderr: 'Usage: git remote add <name> <url>\n', exitCode: 1 };
            }
            await git.addRemote({ fs, dir, remote: name, url });
            return { stdout: '', stderr: '', exitCode: 0 };
          }
          if (subArgs[0] === 'remove' || subArgs[0] === 'rm') {
            const name = subArgs[1];
            if (!name) {
              return { stdout: '', stderr: 'Usage: git remote remove <name>\n', exitCode: 1 };
            }
            await git.deleteRemote({ fs, dir, remote: name });
            return { stdout: '', stderr: '', exitCode: 0 };
          }
          const remotes = await git.listRemotes({ fs, dir });
          if (subArgs.includes('-v')) {
            const stdout = remotes.map(r => `${r.remote}\t${r.url} (fetch)\n${r.remote}\t${r.url} (push)\n`).join('');
            return { stdout, stderr: '', exitCode: 0 };
          }
          const stdout = remotes.map(r => `${r.remote}\n`).join('');
          return { stdout, stderr: '', exitCode: 0 };
        }

        case 'config': {
          const path = subArgs.find(a => !a.startsWith('-'));
          const value = subArgs.find((a, i) => i > 0 && !a.startsWith('-'));
          if (path && value) {
            await git.setConfig({ fs, dir, path, value });
            return { stdout: '', stderr: '', exitCode: 0 };
          }
          if (path) {
            const val = await git.getConfig({ fs, dir, path });
            return { stdout: val ? `${val}\n` : '', stderr: '', exitCode: 0 };
          }
          return { stdout: '', stderr: 'Usage: git config <key> [value]\n', exitCode: 1 };
        }

        case '--version':
        case 'version': {
          return { stdout: 'git version 2.x (isomorphic-git)\n', stderr: '', exitCode: 0 };
        }

        case '--help':
        case 'help':
        case undefined: {
          return {
            stdout: `usage: git <command> [<args>]

Commands:
  init        Create an empty Git repository
  clone       Clone a repository
  status      Show the working tree status
  add         Add file contents to the index
  commit      Record changes to the repository
  log         Show commit logs
  push        Update remote refs
  pull        Fetch from and integrate with remote
  fetch       Download objects and refs from remote
  branch      List, create, or delete branches
  checkout    Switch branches
  merge       Join two or more development histories
  diff        Show changes between commits
  remote      Manage set of tracked repositories
  config      Get and set repository options
`,
            stderr: '',
            exitCode: 0,
          };
        }

        default:
          return { stdout: '', stderr: `git: '${subcommand}' is not a git command\n`, exitCode: 1 };
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return { stdout: '', stderr: `fatal: ${errorMsg}\n`, exitCode: 128 };
    }
  });

  bashInstance = new Bash({
    fs: vfsAdapter,
    cwd: '/',
    env: {
      HOME: '/home/user',
      USER: 'user',
      PATH: '/usr/local/bin:/usr/bin:/bin:/node_modules/.bin',
      NODE_ENV: 'development',
    },
    customCommands: [nodeCommand, convexCommand, gitCommand],
  });
}

export interface ExecOptions {
  cwd?: string;
  env?: Record<string, string>;
  encoding?: BufferEncoding | 'buffer';
  timeout?: number;
  maxBuffer?: number;
  shell?: string | boolean;
}

export interface ExecResult {
  stdout: string | Buffer;
  stderr: string | Buffer;
}

export type ExecCallback = (
  error: Error | null,
  stdout: string | Buffer,
  stderr: string | Buffer
) => void;

/**
 * Execute a command in a shell
 */
export function exec(
  command: string,
  optionsOrCallback?: ExecOptions | ExecCallback,
  callback?: ExecCallback
): ChildProcess {
  let options: ExecOptions = {};
  let cb: ExecCallback | undefined;

  if (typeof optionsOrCallback === 'function') {
    cb = optionsOrCallback;
  } else if (optionsOrCallback) {
    options = optionsOrCallback;
    cb = callback;
  }

  const child = new ChildProcess();

  // Execute asynchronously
  (async () => {
    if (!bashInstance) {
      const error = new Error('child_process not initialized');
      child.emit('error', error);
      if (cb) cb(error, '', '');
      return;
    }

    try {
      const result = await bashInstance!.exec(command, {
        cwd: options.cwd,
        env: options.env,
      });

      const stdout = result.stdout || '';
      const stderr = result.stderr || '';

      // Emit data events
      if (stdout) {
        child.stdout?.push(Buffer.from(stdout));
      }
      child.stdout?.push(null);

      if (stderr) {
        child.stderr?.push(Buffer.from(stderr));
      }
      child.stderr?.push(null);

      // Emit close/exit
      child.emit('close', result.exitCode, null);
      child.emit('exit', result.exitCode, null);

      if (cb) {
        if (result.exitCode !== 0) {
          const error = new Error(`Command failed: ${command}`);
          (error as any).code = result.exitCode;
          cb(error, stdout, stderr);
        } else {
          cb(null, stdout, stderr);
        }
      }
    } catch (error) {
      child.emit('error', error);
      if (cb) cb(error as Error, '', '');
    }
  })();

  return child;
}

/**
 * Execute a command synchronously
 */
export function execSync(
  command: string,
  options?: ExecOptions
): string | Buffer {
  if (!bashInstance) {
    throw new Error('child_process not initialized');
  }

  // Note: just-bash exec is async, so we can't truly do sync execution
  // This is a limitation of the browser environment
  // For now, throw an error suggesting to use exec() instead
  throw new Error(
    'execSync is not supported in browser environment. Use exec() with async/await or callbacks instead.'
  );
}

export interface SpawnOptions {
  cwd?: string;
  env?: Record<string, string>;
  shell?: boolean | string;
  stdio?: 'pipe' | 'inherit' | 'ignore' | Array<'pipe' | 'inherit' | 'ignore'>;
}

/**
 * Spawn a new process
 */
export function spawn(
  command: string,
  args?: string[] | SpawnOptions,
  options?: SpawnOptions
): ChildProcess {
  let spawnArgs: string[] = [];
  let spawnOptions: SpawnOptions = {};

  if (Array.isArray(args)) {
    spawnArgs = args;
    spawnOptions = options || {};
  } else if (args) {
    spawnOptions = args;
  }

  const child = new ChildProcess();

  // Build the full command
  const fullCommand = spawnArgs.length > 0
    ? `${command} ${spawnArgs.map(arg =>
      arg.includes(' ') ? `"${arg}"` : arg
    ).join(' ')}`
    : command;

  // Execute asynchronously
  (async () => {
    if (!bashInstance) {
      const error = new Error('child_process not initialized');
      child.emit('error', error);
      return;
    }

    try {
      const result = await bashInstance!.exec(fullCommand, {
        cwd: spawnOptions.cwd,
        env: spawnOptions.env,
      });

      const stdout = result.stdout || '';
      const stderr = result.stderr || '';

      // Emit data events
      if (stdout) {
        child.stdout?.push(Buffer.from(stdout));
      }
      child.stdout?.push(null);

      if (stderr) {
        child.stderr?.push(Buffer.from(stderr));
      }
      child.stderr?.push(null);

      // Emit close/exit
      child.emit('close', result.exitCode, null);
      child.emit('exit', result.exitCode, null);
    } catch (error) {
      child.emit('error', error);
    }
  })();

  return child;
}

/**
 * Spawn a new process synchronously
 */
export function spawnSync(
  command: string,
  args?: string[],
  options?: SpawnOptions
): { stdout: Buffer; stderr: Buffer; status: number; error?: Error } {
  throw new Error(
    'spawnSync is not supported in browser environment. Use spawn() instead.'
  );
}

/**
 * Execute a file
 */
export function execFile(
  file: string,
  args?: string[] | ExecOptions | ExecCallback,
  options?: ExecOptions | ExecCallback,
  callback?: ExecCallback
): ChildProcess {
  let execArgs: string[] = [];
  let execOptions: ExecOptions = {};
  let cb: ExecCallback | undefined;

  if (Array.isArray(args)) {
    execArgs = args;
    if (typeof options === 'function') {
      cb = options;
    } else if (options) {
      execOptions = options;
      cb = callback;
    }
  } else if (typeof args === 'function') {
    cb = args;
  } else if (args) {
    execOptions = args;
    cb = options as ExecCallback;
  }

  const command = execArgs.length > 0 ? `${file} ${execArgs.join(' ')}` : file;
  return exec(command, execOptions, cb);
}

/**
 * Fork is not supported in browser
 */
export function fork(): never {
  throw new Error('fork is not supported in browser environment');
}

/**
 * ChildProcess class
 */
export class ChildProcess extends EventEmitter {
  pid: number;
  connected: boolean = false;
  killed: boolean = false;
  exitCode: number | null = null;
  signalCode: string | null = null;
  spawnargs: string[] = [];
  spawnfile: string = '';

  stdin: Writable | null;
  stdout: Readable | null;
  stderr: Readable | null;

  constructor() {
    super();
    this.pid = Math.floor(Math.random() * 10000) + 1000;
    this.stdin = new Writable();
    this.stdout = new Readable();
    this.stderr = new Readable();
  }

  kill(signal?: string): boolean {
    this.killed = true;
    this.emit('exit', null, signal || 'SIGTERM');
    return true;
  }

  disconnect(): void {
    this.connected = false;
  }

  send(message: unknown, callback?: (error: Error | null) => void): boolean {
    // IPC not supported
    if (callback) callback(new Error('IPC not supported'));
    return false;
  }

  ref(): this {
    return this;
  }

  unref(): this {
    return this;
  }
}

export default {
  exec,
  execSync,
  execFile,
  spawn,
  spawnSync,
  fork,
  ChildProcess,
  initChildProcess,
};
