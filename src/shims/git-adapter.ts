/**
 * Git Adapter for isomorphic-git
 * Wraps IFileSystem (from just-bash) to provide the fs interface that isomorphic-git expects
 */

import type { IFileSystem, FsStat } from 'just-bash';

/**
 * Stats object compatible with isomorphic-git expectations
 */
interface GitStats {
    type: 'file' | 'dir' | 'symlink';
    mode: number;
    size: number;
    ino: number;
    mtimeMs: number;
    ctimeMs?: number;
    uid: number;
    gid: number;
    dev: number;
    isFile(): boolean;
    isDirectory(): boolean;
    isSymbolicLink(): boolean;
}

/**
 * Convert FsStat to GitStats format
 */
function toGitStats(stat: FsStat, ino: number = 1): GitStats {
    const mtimeMs = stat.mtime.getTime();
    return {
        type: stat.isFile ? 'file' : stat.isDirectory ? 'dir' : 'symlink',
        mode: stat.mode,
        size: stat.size,
        ino,
        mtimeMs,
        ctimeMs: mtimeMs,
        uid: 1000,
        gid: 1000,
        dev: 1,
        isFile: () => stat.isFile,
        isDirectory: () => stat.isDirectory,
        isSymbolicLink: () => stat.isSymbolicLink,
    };
}

/**
 * The fs interface that isomorphic-git expects (using fs.promises API)
 */
export interface IsomorphicGitFs {
    promises: {
        readFile(filepath: string, options?: { encoding?: 'utf8' } | 'utf8'): Promise<Uint8Array | string>;
        writeFile(filepath: string, data: Uint8Array | string, options?: { mode?: number }): Promise<void>;
        mkdir(filepath: string, options?: { recursive?: boolean; mode?: number }): Promise<void>;
        rmdir(filepath: string, options?: { recursive?: boolean }): Promise<void>;
        unlink(filepath: string): Promise<void>;
        stat(filepath: string): Promise<GitStats>;
        lstat(filepath: string): Promise<GitStats>;
        readdir(filepath: string): Promise<string[]>;
        readlink(filepath: string): Promise<string>;
        symlink(target: string, filepath: string): Promise<void>;
        chmod(filepath: string, mode: number): Promise<void>;
        rename(oldpath: string, newpath: string): Promise<void>;
    };
}

/**
 * Create an fs adapter for isomorphic-git from a just-bash IFileSystem
 * 
 * isomorphic-git checks for fs.promises and uses that if available,
 * otherwise it falls back to callback-style API. We provide fs.promises.
 */
export function createIsomorphicGitFs(fs: IFileSystem): IsomorphicGitFs {
    let inoCounter = 1;

    return {
        promises: {
            async readFile(filepath: string, options?: { encoding?: 'utf8' } | 'utf8'): Promise<Uint8Array | string> {
                const encoding = typeof options === 'string' ? options : options?.encoding;
                if (encoding === 'utf8') {
                    return fs.readFile(filepath, { encoding: 'utf8' });
                }
                return fs.readFileBuffer(filepath);
            },

            async writeFile(filepath: string, data: Uint8Array | string, _options?: { mode?: number }): Promise<void> {
                return fs.writeFile(filepath, data);
            },

            async mkdir(filepath: string, options?: { recursive?: boolean; mode?: number }): Promise<void> {
                return fs.mkdir(filepath, { recursive: options?.recursive });
            },

            async rmdir(filepath: string, options?: { recursive?: boolean }): Promise<void> {
                return fs.rm(filepath, { recursive: options?.recursive });
            },

            async unlink(filepath: string): Promise<void> {
                return fs.rm(filepath);
            },

            async stat(filepath: string): Promise<GitStats> {
                const stat = await fs.stat(filepath);
                return toGitStats(stat, inoCounter++);
            },

            async lstat(filepath: string): Promise<GitStats> {
                const stat = await fs.lstat(filepath);
                return toGitStats(stat, inoCounter++);
            },

            async readdir(filepath: string): Promise<string[]> {
                return fs.readdir(filepath);
            },

            async readlink(filepath: string): Promise<string> {
                return fs.readlink(filepath);
            },

            async symlink(target: string, filepath: string): Promise<void> {
                return fs.symlink(target, filepath);
            },

            async chmod(filepath: string, mode: number): Promise<void> {
                return fs.chmod(filepath, mode);
            },

            async rename(oldpath: string, newpath: string): Promise<void> {
                return fs.mv(oldpath, newpath);
            },
        },
    };
}

/**
 * Default CORS proxy for browser Git operations
 * Note: This is a free service with fair usage limits
 */
export const DEFAULT_CORS_PROXY = 'https://cors.isomorphic-git.org';

/**
 * Get authentication configuration from environment
 */
export function getAuthFromEnv(env: Map<string, string>): { username?: string; password?: string } | undefined {
    const token = env.get('GIT_TOKEN') || env.get('GITHUB_TOKEN');
    if (token) {
        // For token auth, use token as password with any username
        return { username: 'x-access-token', password: token };
    }

    const username = env.get('GIT_USERNAME');
    const password = env.get('GIT_PASSWORD');
    if (username && password) {
        return { username, password };
    }

    return undefined;
}
