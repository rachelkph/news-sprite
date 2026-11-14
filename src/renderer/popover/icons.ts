// Hand-made 5x5 pixel icons, drawn at 2 px per pixel in the current text color.
// Built with DOM calls (no innerHTML).

const ICONS: Record<string, string[]> = {
  "us-news": ["..#..", ".###.", "#####", "#.#.#", "#####"], // capitol
  "world-news": [".###.", "#.#.#", "#####", "#.#.#", ".###."], // globe
  "ai-tech": ["#####", "#...#", "#.#.#", "#...#", "#####"], // chip
  "creative-coding-devtools": ["#....", ".#...", "#....", ".....", "..###"], // >_
  "business-markets": ["....#", "...##", "..###", ".####", "#####"], // rising bars
  science: [".###.", "..#..", ".#.#.", "#...#", "#####"], // flask
  "film-tv": ["#.#.#", "#####", "#...#", "#...#", "#####"], // clapperboard
  music: ["..##.", "..#.#", "..#..", "###..", "###.."], // note
  gaming: ["..#..", "..#..", "#####", "..#..", "..#.."], // d-pad
  sports: [".###.", "##.##", "#...#", "##.##", ".###."], // ball
  "culture-books": ["#...#", "##.##", "##.##", "##.##", "#####"], // open book
  design: ["...##", "..###", ".###.", "###..", "#...."], // pencil
  refresh: [".##.#", "#..##", "#....", "#...#", ".###."],
  settings: [".#.#.", "#####", "##.##", "#####", ".#.#."],
  sun: ["#.#.#", ".###.", "##.##", ".###.", "#.#.#"],
  moon: [".###.", "##...", "#....", "##...", ".###."],
  topic: [".....", ".###.", ".###.", ".###.", "....."], // fallback for unknown topics
};

const SVG = "http://www.w3.org/2000/svg";

export function pixelIcon(name: string): SVGSVGElement {
  const rows = ICONS[name] ?? ICONS.topic;
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("width", "10");
  svg.setAttribute("height", "10");
  svg.setAttribute("viewBox", "0 0 5 5");
  svg.setAttribute("shape-rendering", "crispEdges");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "icon");
  const path = document.createElementNS(SVG, "path");
  path.setAttribute("d", rows.map((r, y) => [...r].map((c, x) => (c === "#" ? `M${x} ${y}h1v1h-1z` : "")).join("")).join(""));
  svg.append(path);
  return svg;
}
