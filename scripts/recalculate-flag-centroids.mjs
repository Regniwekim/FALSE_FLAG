import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const MAP_CODES = [
  "us",
  "ca",
  "mx",
  "cu",
  "br",
  "ar",
  "co",
  "pe",
  "gb",
  "fr",
  "de",
  "it",
  "za",
  "ng",
  "eg",
  "ke",
  "cn",
  "in",
  "jp",
  "kr",
  "au",
  "nz",
  "tr",
  "sa"
];

const CLASS_FALLBACK = {
  US: "United States",
  CA: "Canada",
  AR: "Argentina",
  GB: "United Kingdom",
  FR: "France",
  IT: "Italy",
  CN: "China",
  JP: "Japan",
  AU: "Australia",
  NZ: "New Zealand",
  TR: "Turkey"
};

const svgPath = path.resolve("frontend/public/world.svg");
const svgText = await fs.readFile(svgPath, "utf8");

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

const centroids = await page.evaluate(
  async ({ inputSvg, mapCodes, classFallback }) => {
    const parseNumber = (value, fallback) => {
      const parsed = Number.parseFloat(value ?? "");
      return Number.isFinite(parsed) ? parsed : fallback;
    };

    const parser = new DOMParser();
    const sourceDoc = parser.parseFromString(inputSvg, "image/svg+xml");
    const sourceSvg = sourceDoc.documentElement;

    const width = parseNumber(sourceSvg.getAttribute("width"), 2000);
    const height = parseNumber(sourceSvg.getAttribute("height"), 857);

    const toDataUrl = (svgElement) => {
      const text = new XMLSerializer().serializeToString(svgElement);
      const encoded = encodeURIComponent(text)
        .replace(/'/g, "%27")
        .replace(/\(/g, "%28")
        .replace(/\)/g, "%29");
      return `data:image/svg+xml;charset=utf-8,${encoded}`;
    };

    const computeRasterCentroid = async (svgElement) => {
      const scale = 4;
      const canvas = document.createElement("canvas");
      canvas.width = width * scale;
      canvas.height = height * scale;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) {
        throw new Error("Unable to create canvas context.");
      }

      const img = new Image();
      img.decoding = "sync";

      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = toDataUrl(svgElement);
      });

      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let total = 0;
      let sumX = 0;
      let sumY = 0;

      for (let y = 0; y < canvas.height; y += 1) {
        for (let x = 0; x < canvas.width; x += 1) {
          const idx = (y * canvas.width + x) * 4;
          const alpha = data[idx + 3];
          if (alpha === 0) {
            continue;
          }

          total += alpha;
          sumX += (x + 0.5) * alpha;
          sumY += (y + 0.5) * alpha;
        }
      }

      if (total === 0) {
        return null;
      }

      return {
        x: Number(((sumX / total) / scale).toFixed(1)),
        y: Number(((sumY / total) / scale).toFixed(1))
      };
    };

    const buildCountrySvg = (paths) => {
      const countryDoc = document.implementation.createDocument("http://www.w3.org/2000/svg", "svg", null);
      const countrySvg = countryDoc.documentElement;
      countrySvg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      countrySvg.setAttribute("width", String(width));
      countrySvg.setAttribute("height", String(height));
      countrySvg.setAttribute("viewBox", `0 0 ${width} ${height}`);

      for (const pathNode of paths) {
        const clone = pathNode.cloneNode(true);
        clone.removeAttribute("id");
        clone.removeAttribute("class");
        clone.setAttribute("fill", "#ffffff");
        clone.setAttribute("stroke", "none");
        countrySvg.appendChild(clone);
      }

      return countrySvg;
    };

    const output = {};

    for (const code of mapCodes) {
      const upper = code.toUpperCase();
      let paths = Array.from(sourceSvg.querySelectorAll(`path#${upper}`));

      if (paths.length === 0 && classFallback[upper]) {
        const className = classFallback[upper];
        paths = Array.from(sourceSvg.querySelectorAll(`path[class=\"${className}\"]`));
      }

      if (paths.length === 0) {
        output[code] = null;
        continue;
      }

      const countrySvg = buildCountrySvg(paths);
      output[code] = await computeRasterCentroid(countrySvg);
    }

    return output;
  },
  { inputSvg: svgText, mapCodes: MAP_CODES, classFallback: CLASS_FALLBACK }
);

await browser.close();

for (const code of MAP_CODES) {
  const point = centroids[code];
  if (!point) {
    console.log(`${code}: MISSING`);
    continue;
  }
  console.log(`${code}: { x: ${point.x}, y: ${point.y} }`);
}
