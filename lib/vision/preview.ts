export type Dimensions = { width: number; height: number };

export function previewTransform(source: Dimensions, container: Dimensions) {
  const scale = Math.min(container.width / source.width, container.height / source.height);
  return {
    scale,
    x: (container.width - source.width * scale) / 2,
    y: (container.height - source.height * scale) / 2,
  };
}
