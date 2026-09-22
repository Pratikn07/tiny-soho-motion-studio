export function hasClaimedId(value: unknown): value is { id: string } {
  return Boolean(value)
    && typeof value === "object"
    && typeof (value as { id?: unknown }).id === "string"
    && (value as { id: string }).id.length > 0;
}
