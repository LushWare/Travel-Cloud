export function actorIdOf(user: unknown): string | null {
  const candidate = user as { _id?: unknown; id?: unknown } | null | undefined;
  const raw = candidate?._id ?? candidate?.id;
  if (raw === undefined || raw === null) return null;
  const value = String(raw).trim();
  return value.length > 0 ? value : null;
}