export const TYPOGRAPHY_Z_INDEX = 1_000;

export function typographyLayerPolicy() {
  return { alwaysOnTop: true as const, zIndex: TYPOGRAPHY_Z_INDEX };
}
