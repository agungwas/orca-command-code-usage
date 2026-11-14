// Command Code flattens a project path into a slug: lowercase, every run of non-alphanumerics
// becomes one "-", leading and trailing dashes dropped. That is lossy
// (/Users/me/proj and /users/me/proj both become "users-me-proj"), so we recover a display path
// from Orca's workspace list first, then by probing the filesystem.
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'

export function slugForPath(path: string): string {
  return path
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function shortenHome(path: string): string {
  const home = homedir()
  if (!home) return path
  if (path === home) return '~'
  const prefix = home.endsWith('/') ? home : `${home}/`
  return path.startsWith(prefix) ? `~/${path.slice(prefix.length)}` : path
}

function capitalize(value: string): string {
  return value.length ? value[0]!.toUpperCase() + value.slice(1) : value
}

/** Name spellings a flattened segment may have had: case and separator were both lost. */
function nameVariants(segments: readonly string[]): string[] {
  const variants: string[] = []
  for (const separator of ['-', '.']) {
    const joined = segments.join(separator)
    variants.push(
      joined,
      capitalize(joined),
      segments.map(capitalize).join(separator),
      segments.map((segment) => segment.toUpperCase()).join(separator)
    )
  }
  return variants
}

/**
 * Best-effort reverse of `slugForPath` against an arbitrary `exists` probe. Walks the slug from
 * the filesystem root, trying longer runs of hyphen-separated tokens first, with "-" and "."
 * joins and common capitalisations. Returns null when no path on this machine matches.
 */
export function reconstructPath(
  slug: string,
  exists: (path: string) => boolean
): string | null {
  const tokens = slug.split('-').filter(Boolean)
  if (tokens.length === 0 || tokens.length > 20) return null

  const seen = new Map<string, boolean>()
  const safeExists = (path: string): boolean => {
    let value = seen.get(path)
    if (value === undefined) {
      try {
        value = exists(path)
      } catch {
        value = false
      }
      seen.set(path, value)
    }
    return value
  }

  const failed = new Set<string>()
  let budget = 5_000

  const walk = (prefix: string, index: number): string | null => {
    if (index === tokens.length) return prefix || '/'
    const state = `${index}|${prefix}`
    if (failed.has(state)) return null
    if (budget-- <= 0) {
      failed.add(state)
      return null
    }

    const longest = Math.min(5, tokens.length - index)
    for (let length = longest; length >= 1; length--) {
      const segments = tokens.slice(index, index + length)
      for (const name of nameVariants(segments)) {
        const next = `${prefix}/${name}`
        if (!safeExists(next)) continue
        const found = walk(next, index + length)
        if (found) return found
      }
    }

    failed.add(state)
    return null
  }

  return walk('', 0)
}

/** Maps each slug to a display label: known workspace path, probed path, else the slug itself. */
export function createProjectLabeller(
  workspacePaths: readonly string[]
): (slug: string) => string {
  const known = new Map<string, string>()
  for (const path of workspacePaths) {
    if (typeof path === 'string' && path) known.set(slugForPath(path), path)
  }

  const resolved = new Map<string, string>()
  return (slug: string): string => {
    const cached = resolved.get(slug)
    if (cached) return cached
    const workspace = known.get(slug)
    const path = workspace ?? reconstructPath(slug, existsSync)
    const label = path ? shortenHome(path) : slug
    resolved.set(slug, label)
    return label
  }
}
