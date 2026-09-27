export type Region = { x: number; y: number; width: number; height: number };
export type Story = { id: string; title: string; prompt: string };
export type Slide = {
  id: string;
  name: string;
  src: string;
  width: number;
  height: number;
  origin: "example" | "upload";
  category: string;
  story: string;
  selectedStory: string;
  region: Region;
  protectedRegions: Region[];
  suggestions: Story[];
  video?: string;
};
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
export const MAX_SLIDES = 20;
export const INITIAL_REGION: Region = { x: 20, y: 45, width: 65, height: 45 };
export function normalizeRegion(region: Region): Region {
  const finite = (v: number, fallback: number) =>
    Number.isFinite(v) ? v : fallback;
  const width = Math.min(100, Math.max(5, finite(region.width, 65)));
  const height = Math.min(100, Math.max(5, finite(region.height, 45)));
  return {
    width,
    height,
    x: Math.max(0, Math.min(100 - width, finite(region.x, 0))),
    y: Math.max(0, Math.min(100 - height, finite(region.y, 0))),
  };
}
export function intersects(a: Region, b: Region) {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}
export function validateImage(
  file: Pick<File, "type" | "size" | "name">,
): string | null {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
    return `${file.name}: choose a PNG, JPG or WebP image.`;
  if (file.size > MAX_IMAGE_BYTES)
    return `${file.name}: this image is over 25 MB. Choose a smaller file.`;
  if (!file.size)
    return `${file.name}: this file is empty. Choose another image.`;
  return null;
}
export function imageDimensionsValid(width: number, height: number) {
  return (
    Number.isInteger(width) &&
    Number.isInteger(height) &&
    width > 0 &&
    height > 0 &&
    width * height <= 40_000_000
  );
}
export function updateSlide(
  slides: Slide[],
  id: string,
  patch: Partial<Slide>,
) {
  return slides.map((slide) =>
    slide.id === id
      ? {
          ...slide,
          ...patch,
          ...(patch.region ? { region: normalizeRegion(patch.region) } : {}),
        }
      : slide,
  );
}
export function moveSlide(slides: Slide[], id: string, direction: -1 | 1) {
  const index = slides.findIndex((s) => s.id === id),
    next = index + direction;
  if (index < 0 || next < 0 || next >= slides.length) return slides;
  const copy = [...slides];
  [copy[index], copy[next]] = [copy[next], copy[index]];
  return copy;
}
export function exportPlan(slide: Slide) {
  return {
    version: 1,
    name: slide.name,
    source: {
      width: slide.width,
      height: slide.height,
      aspectRatio: slide.width / slide.height,
      origin: slide.origin,
    },
    durationSeconds: 5,
    story: slide.story,
    motionRegionPercent: slide.region,
    protectedRegionsPercent: slide.protectedRegions,
    camera: "locked",
    pace: "natural",
    status: "draft-not-generated",
    analysis:
      slide.origin === "example"
        ? "manually-authored-example"
        : "user-authored-not-analyzed",
    generatedVideo: null,
  };
}
const exampleData: Slide[] = [
  {
    id: "understanding",
    name: "A moment of understanding",
    src: "/studio-samples/understanding.png",
    width: 1129,
    height: 1393,
    origin: "example",
    category: "Parenting",
    region: { x: 48, y: 33, width: 44, height: 51 },
    protectedRegions: [
      { x: 0, y: 0, width: 100, height: 31 },
      { x: 0, y: 31, width: 45, height: 48 },
    ],
    selectedStory: "soften",
    story: "",
    suggestions: [
      {
        id: "soften",
        title: "A softer moment",
        prompt:
          "She takes a small breath, loosens her crossed arms and looks up with a softer expression. Keep her seated in the same position, with the toys still and the camera locked.",
      },
      {
        id: "glance",
        title: "A curious glance",
        prompt:
          "Still seated, she glances at the wooden figures, uncrosses one hand and gently touches the nearest figure. Her expression shifts from frustration to curiosity. Keep her head below the title.",
      },
    ],
  },
  {
    id: "meal-prep",
    name: "Little bites, big joy",
    src: "/studio-samples/meal-prep.png",
    width: 1122,
    height: 1402,
    origin: "example",
    category: "Mealtime",
    region: { x: 26, y: 45, width: 64, height: 47 },
    protectedRegions: [
      { x: 0, y: 0, width: 100, height: 40 },
      { x: 42, y: 41, width: 16, height: 3.5 },
    ],
    selectedStory: "taste",
    story: "",
    video: "/studio-samples/meal-prep-proof.mp4",
    suggestions: [
      {
        id: "taste",
        title: "A little delight",
        prompt:
          "She picks up the small golden bite, brings it to her mouth, then lowers her hand with a pleased little smile. Natural speed, gentle expression. Keep her head below “PART 4” and the camera still.",
      },
      {
        id: "choose",
        title: "Decisions, decisions",
        prompt:
          "She looks across the plate, pauses over two pieces, then chooses a golden bite with a small smile. Keep her head at its original height. The plate, table and camera stay still.",
      },
    ],
  },
  {
    id: "salmon-cakes",
    name: "Made with a little love",
    src: "/studio-samples/salmon-cakes.jpg",
    width: 1122,
    height: 1402,
    origin: "example",
    category: "Recipes",
    region: { x: 35, y: 30, width: 58, height: 43 },
    protectedRegions: [
      { x: 0, y: 0, width: 100, height: 28 },
      { x: 0, y: 29, width: 32, height: 45 },
      { x: 0, y: 75, width: 100, height: 25 },
    ],
    selectedStory: "serve",
    story: "",
    suggestions: [
      {
        id: "serve",
        title: "Ready to share",
        prompt:
          "A fork enters from the right, gently breaks a small piece from the front salmon cake and lifts it to reveal the soft centre. Keep the action over the plate and away from every recipe label. No camera movement.",
      },
      {
        id: "lemon",
        title: "The finishing touch",
        prompt:
          "A hand enters from the right, lifts the existing lemon wedge and gives a small squeeze over the cakes. It replaces the wedge and leaves the frame. Keep the plate, labels and ingredients still.",
      },
    ],
  },
];
export function exampleSlides(): Slide[] {
  return structuredClone(exampleData).map((s) => ({
    ...s,
    story: s.suggestions[0].prompt,
  }));
}
