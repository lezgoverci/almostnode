# Implementation Plan: Git Support in almostnode

## Context
The goal is to provide native Git-like capabilities inside the `almostnode` environment. This enables the following use cases:
- **Cloud IDEs**: Users can clone repositories from GitHub/GitLab directly into the browser.
- **AI Agents**: Autonomous agents can fetch code, make changes, and push commits to remote repositories.
- **Interactive Tutorials**: Creating sandboxes that can be initialized from a Git repo.

Since `almostnode` runs in a browser sandbox, we cannot use a native `git` binary. Instead, we will use `isomorphic-git`, a pure JavaScript implementation of Git that works in browsers.

## Technical Architecture

### 1. The Core Engine: isomorphic-git
We will integrate `isomorphic-git` as the library that handles all git logic (parsing objects, packing/unpacking, diffing, etc.).

### 2. Networking: Browser HTTP Plugin
We will use `@isomorphic-git/http/web` to handle network requests. 
**Important**: Direct Git-over-HTTP requests to services like GitHub are blocked by CORS in the browser. A CORS proxy (provided by the user or using a default like `cors.isomorphic-git.org`) must be configured.

### 3. File System: VirtualFS Bridge
`isomorphic-git` expects a Node.js-compatible `fs` API. `almostnode` provides this via its `createFsShim` utility, which bridges its in-memory `VirtualFS` to the standard `fs` interface.

### 4. CLI Integration: just-bash Custom Command
The command will be exposed as `git` within the `just-bash` shell. This is achieved by using the `defineCommand` API in `src/shims/child_process.ts`.

## Implementation Steps

### Phase 1: Dependency Setup
- Add `isomorphic-git` to dependencies.
- Ensure `Buffer` and other required polyfills are correctly configured for the command context.

### Phase 2: Command Definition
Modify `src/shims/child_process.ts` to:
- Define the `git` command.
- Parse subcommands (e.g., `clone`, `status`, `add`, `commit`).
- Invoke the corresponding `isomorphic-git` API call.
- Pipe output (logs, progress) back to the terminal's `stdout`.

### Phase 3: Networking & Auth
- Implemet high-level wrapper for authentication (using environment variables for tokens).
- Configure the HTTP plugin with a default CORS proxy.

## Verification Plan

### Manual Tests
1. **Command Registration**: Execute `git` in the terminal and verify help output.
2. **Clone**: Attempt to clone a public repository to `/temp-repo`.
3. **Commit Flow**:
   - `mkdir test && cd test && git init`
   - `touch README.md`
   - `git add README.md`
   - `git commit -m "initial commit"`
   - `git log`

### Maintenance
This implementation will reside in `src/shims/child_process.ts`. Future enhancements could include full `npx` support or advanced credential management.
