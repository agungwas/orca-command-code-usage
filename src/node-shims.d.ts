// Minimal ambient types for the Node built-ins this plugin uses. Orca's plugin typings ship no
// Node types, and the plugin has no package.json to pull @types/node from.

declare module 'node:fs' {
  export interface ReadStream {
    destroy(error?: Error): void
  }
  export function createReadStream(path: string, options?: { encoding?: 'utf8' }): ReadStream
  export function existsSync(path: string): boolean
  export function readFileSync(path: string, encoding: 'utf8'): string
}

declare module 'node:fs/promises' {
  export interface Dirent {
    readonly name: string
    isDirectory(): boolean
    isFile(): boolean
  }
  export function readdir(path: string, options: { withFileTypes: true }): Promise<Dirent[]>
  export function mkdir(path: string, options?: { recursive?: boolean }): Promise<string | undefined>
  export function writeFile(path: string, data: string): Promise<void>
  export function mkdtemp(prefix: string): Promise<string>
  export function rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>
}

declare module 'node:os' {
  export function homedir(): string
  export function tmpdir(): string
}

declare module 'node:path' {
  export function join(...parts: string[]): string
}

declare module 'node:readline' {
  export interface Interface extends AsyncIterable<string> {
    close(): void
  }
  export function createInterface(options: { input: unknown; crlfDelay?: number }): Interface
}

declare const process: { env: Record<string, string | undefined> }
