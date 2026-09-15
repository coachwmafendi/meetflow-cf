import { mkdirSync, writeFileSync } from "node:fs";
import DottedMap from "dotted-map";

// One-off generator: renders a dotted equirectangular world map to a static SVG
// asset. Run with `node scripts/generate-world-dots.mjs` after tweaking params.
const map = new DottedMap({ height: 60, grid: "diagonal" });
const svg = map.getSVG({ radius: 0.22, color: "#000000", shape: "circle" });

mkdirSync("public/images", { recursive: true });
writeFileSync("public/images/world-map-dots.svg", svg);
console.log(`world-map-dots.svg written (${svg.length} bytes)`);
