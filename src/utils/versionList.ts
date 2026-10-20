/**
 * Pure rules for the version history table (kept separate so they can be unit tested).
 * - the active version is always listed first, then the rest from newest to oldest;
 * - only the first 3 are shown until "Show more" is pressed;
 * - the active version and the built-in sample can never be deleted; the active version can never be rolled back to.
 */
export interface VersionLike {
  versionId: string;
  status?: string;
  isActive?: boolean;
  isSample?: boolean;
  isDefault?: boolean;
  publishedAt?: string | null;
}

export const DEFAULT_VISIBLE_VERSIONS = 3;

export function orderVersions<T extends VersionLike>(versions: T[]): T[] {
  const time = (v: T) => (v.publishedAt ? new Date(v.publishedAt).getTime() || 0 : 0);
  return [...versions].sort((a, b) => {
    if (!!a.isActive !== !!b.isActive) return a.isActive ? -1 : 1;
    return time(b) - time(a);
  });
}

export function visibleVersions<T extends VersionLike>(ordered: T[], showAll: boolean, limit: number = DEFAULT_VISIBLE_VERSIONS): T[] {
  return showAll ? ordered : ordered.slice(0, limit);
}

/** Stored historical versions that may be deleted. Never the active version, never the built-in sample. */
export function isDeletable(v: VersionLike): boolean {
  return !v.isActive && !v.isSample && !v.isDefault;
}

export function deletableVersions<T extends VersionLike>(versions: T[]): T[] {
  return versions.filter(isDeletable);
}

export function canRollback(v: VersionLike): boolean {
  return !v.isActive && v.status !== 'failed' && v.status !== 'deleting';
}
