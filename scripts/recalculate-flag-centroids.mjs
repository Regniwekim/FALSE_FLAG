import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const CLASS_TO_CODE = {
  Angola: "AO",
  Argentina: "AR",
  Australia: "AU",
  Azerbaijan: "AZ",
  Bahamas: "BS",
  Canada: "CA",
  "Canary Islands (Spain)": "ES",
  Chile: "CL",
  China: "CN",
  Cyprus: "CY",
  Denmark: "DK",
  "Falkland Islands": "FK",
  Fiji: "FJ",
  France: "FR",
  Greece: "GR",
  Indonesia: "ID",
  Italy: "IT",
  Japan: "JP",
  Malaysia: "MY",
  "New Caledonia": "NC",
  "New Zealand": "NZ",
  Norway: "NO",
  Oman: "OM",
  "Papua New Guinea": "PG",
  Philippines: "PH",
  "Puerto Rico": "PR",
  "Russian Federation": "RU",
  "Solomon Islands": "SB",
  "Trinidad and Tobago": "TT",
  Turkey: "TR",
  "United Kingdom": "GB",
  "United States": "US",
  Vanuatu: "VU"
};

const ID_TO_CODE = {
  BQBO: "BQ"
};

const FLAGS_FILE = path.resolve("shared/src/flags.ts");
const MARKERS_FILE = path.resolve("frontend/src/world-map-marker-positions.ts");
const SVG_FILE = path.resolve("frontend/public/world-coordinates.svg");

const TARGET_MAP_WIDTH = 2000;
const TARGET_MAP_HEIGHT = 857;

const shouldWrite = process.argv.includes("--write");
const svgText = await fs.readFile(SVG_FILE, "utf8");

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

const output = await page.evaluate(
  async ({ inputSvg, classToCode, idToCode }) => {
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

      const seen = new Set();
      for (const pathNode of paths) {
        const key = pathNode.getAttribute("d") ?? "";
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);

        const clone = pathNode.cloneNode(true);
        clone.removeAttribute("id");
        clone.removeAttribute("class");
        clone.setAttribute("fill", "#ffffff");
        clone.setAttribute("stroke", "none");
        countrySvg.appendChild(clone);
      }

      return countrySvg;
    };

    const bucket = new Map();

    const addPath = (code, element) => {
      if (!bucket.has(code)) {
        bucket.set(code, []);
      }
      bucket.get(code).push(element);
    };

    for (const node of sourceSvg.querySelectorAll("path[id]")) {
      const id = node.getAttribute("id") ?? "";
      if (!/^[A-Z][A-Z0-9]{1,3}$/.test(id)) {
        continue;
      }

      const mapped = idToCode[id] ?? id;
      if (!/^[A-Z]{2}$/.test(mapped)) {
        continue;
      }

      addPath(mapped, node);
    }

    for (const node of sourceSvg.querySelectorAll("path[class]")) {
      const className = node.getAttribute("class") ?? "";
      const mapped = classToCode[className];
      if (!mapped) {
        continue;
      }
      addPath(mapped, node);
    }

    const codes = Array.from(bucket.keys()).sort();
    const markers = {};

    for (const code of codes) {
      const paths = bucket.get(code) ?? [];
      const countrySvg = buildCountrySvg(paths);
      const centroid = await computeRasterCentroid(countrySvg);
      if (!centroid) {
        continue;
      }
      markers[code] = centroid;
    }

    return { codes, markers, width, height };
  },
  { inputSvg: svgText, classToCode: CLASS_TO_CODE, idToCode: ID_TO_CODE }
);

await browser.close();

const markerEntries = output.codes
  .filter((code) => output.markers[code])
  .map((code) => {
    const marker = output.markers[code];
    const scaledX = Number(((marker.x / output.width) * TARGET_MAP_WIDTH).toFixed(1));
    const scaledY = Number(((marker.y / output.height) * TARGET_MAP_HEIGHT).toFixed(1));
    return `  ${code.toLowerCase()}: { x: ${scaledX}, y: ${scaledY} },`;
  });

const markerSource = `export type FlagMarkerPositions = Record<string, { x: number; y: number }>;

export const WORLD_MAP_MARKER_POSITIONS: FlagMarkerPositions = {
${markerEntries.join("\n")}
};
`;

const catalogSource = output.codes.map((code) => `"${code.toLowerCase()}"`).join(", ");

if (shouldWrite) {
  await fs.writeFile(MARKERS_FILE, markerSource, "utf8");

  const flagsText = await fs.readFile(FLAGS_FILE, "utf8");
  const replaced = flagsText.replace(
    /export const FULL_FLAG_CATALOG = \[[\s\S]*?\] as const;/,
    `export const FULL_FLAG_CATALOG = [\n  ${catalogSource}\n] as const;`
  );
  await fs.writeFile(FLAGS_FILE, replaced, "utf8");

  console.log(`Updated ${path.relative(process.cwd(), MARKERS_FILE)} and ${path.relative(process.cwd(), FLAGS_FILE)}.`);
  console.log(`Country count: ${output.codes.length}`);
} else {
  console.log(`Country count: ${output.codes.length}`);
  console.log(output.codes.map((code) => code.toLowerCase()).join(","));
}
