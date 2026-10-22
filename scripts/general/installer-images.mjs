#!/usr/bin/env node
// Renders the NSIS installer bitmaps from src-tauri/icons/icon.svg into
// src-tauri/icons/installer/: header.bmp (150x57, the page header of the
// installer and uninstaller) and sidebar.bmp (164x314, the Welcome and
// Finish pages). NSIS takes only BMP at these exact sizes, which `tauri icon`
// does not produce, so rerun this whenever icon.svg changes and commit the
// output. No dependencies: it reads the tile and the mark straight from the
// SVG (rects and M/L/H/V/Z paths, the only things icon.svg uses), samples
// each pixel on a grid and writes 24-bit BMPs.
//
// Usage: node scripts/general/installer-images.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const svgPath = path.join(root, "src-tauri/icons/icon.svg");
const outDir = path.join(root, "src-tauri/icons/installer");

// 8x8 samples per pixel: the edges stay smooth at a 40px tile
const SS = 8;
const HEADER_BG = "#FFFFFF";
// the website's dark background, so the white tile stands out on the
// light installer page next to it
const SIDEBAR_BG = "#15181C";

const attr = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];
const hex = (s) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));

function parsePath(d) {
  const polys = [];
  let poly = [];
  let x = 0;
  let y = 0;
  for (const [, cmd, args] of d.matchAll(/([MLHVZ])([^MLHVZ]*)/gi)) {
    const n = args.trim().split(/[\s,]+/).filter(Boolean).map(Number);
    switch (cmd) {
      case "M":
        if (poly.length) polys.push(poly);
        poly = [];
        [x, y] = n;
        break;
      case "L":
        [x, y] = n;
        break;
      case "H":
        [x] = n;
        break;
      case "V":
        [y] = n;
        break;
      case "Z":
        continue;
      default:
        throw new Error(`installer-images: unsupported path command ${cmd} in icon.svg`);
    }
    poly.push([x, y]);
  }
  if (poly.length) polys.push(poly);
  return polys;
}

function inPolys(polys, px, py) {
  let inside = false;
  for (const p of polys) {
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      const [xi, yi] = p[i];
      const [xj, yj] = p[j];
      if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

function inRoundRect(r, px, py, inset = 0) {
  const x0 = r.x + inset;
  const y0 = r.y + inset;
  const x1 = r.x + r.w - inset;
  const y1 = r.y + r.h - inset;
  const rad = Math.max(0, r.rx - inset);
  if (px < x0 || px > x1 || py < y0 || py > y1) return false;
  const cx = Math.min(Math.max(px, x0 + rad), x1 - rad);
  const cy = Math.min(Math.max(py, y0 + rad), y1 - rad);
  return (px - cx) ** 2 + (py - cy) ** 2 <= rad * rad;
}

// Shapes in paint order, each a hit test in SVG units plus a color and an
// opacity; rects with a stroke become a ring between two rounded rects.
function loadIcon() {
  const svg = fs.readFileSync(svgPath, "utf8");
  const shapes = [];
  for (const [tag] of svg.matchAll(/<rect\b[^>]*>/g)) {
    const r = {
      x: +attr(tag, "x"),
      y: +attr(tag, "y"),
      w: +attr(tag, "width"),
      h: +attr(tag, "height"),
      rx: +(attr(tag, "rx") ?? 0),
    };
    const fill = attr(tag, "fill");
    if (fill && fill !== "none") {
      shapes.push({ hit: (px, py) => inRoundRect(r, px, py), rgb: hex(fill), a: 1 });
    }
    const stroke = attr(tag, "stroke");
    if (stroke) {
      const half = +attr(tag, "stroke-width") / 2;
      const a = +(attr(tag, "stroke-opacity") ?? 1);
      shapes.push({
        hit: (px, py) => inRoundRect(r, px, py, -half) && !inRoundRect(r, px, py, half),
        rgb: hex(stroke),
        a,
      });
    }
  }
  const group = svg.match(/<g\b[^>]*fill="([^"]+)"[^>]*>([\s\S]*?)<\/g>/);
  if (!group) throw new Error("installer-images: no filled <g> with the mark in icon.svg");
  for (const [tag] of group[2].matchAll(/<path\b[^>]*>/g)) {
    const polys = parsePath(attr(tag, "d"));
    shapes.push({ hit: (px, py) => inPolys(polys, px, py), rgb: hex(group[1]), a: 1 });
  }
  const viewBox = attr(svg.match(/<svg\b[^>]*>/)[0], "viewBox").split(/\s+/).map(Number);
  return { shapes, size: viewBox[2] };
}

// Draws the icon as a size x size square at (left, top) onto an RGB canvas.
function render(width, height, bg, icon, left, top, size) {
  const px = new Float64Array(width * height * 3);
  const base = hex(bg);
  const scale = icon.size / size;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const acc = [0, 0, 0];
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (x - left + (sx + 0.5) / SS) * scale;
          const v = (y - top + (sy + 0.5) / SS) * scale;
          const c = [...base];
          for (const s of icon.shapes) {
            if (!s.hit(u, v)) continue;
            for (let k = 0; k < 3; k++) c[k] = c[k] * (1 - s.a) + s.rgb[k] * s.a;
          }
          for (let k = 0; k < 3; k++) acc[k] += c[k];
        }
      }
      for (let k = 0; k < 3; k++) px[(y * width + x) * 3 + k] = acc[k] / (SS * SS);
    }
  }
  return px;
}

function writeBmp(file, width, height, px) {
  const stride = Math.ceil((width * 3) / 4) * 4;
  const buf = Buffer.alloc(54 + stride * height);
  buf.write("BM", 0, "ascii");
  buf.writeUInt32LE(buf.length, 2);
  buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(height, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(24, 28);
  buf.writeUInt32LE(stride * height, 34);
  buf.writeInt32LE(2835, 38);
  buf.writeInt32LE(2835, 42);
  // bottom-up rows, BGR
  for (let y = 0; y < height; y++) {
    const row = 54 + (height - 1 - y) * stride;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      for (let k = 0; k < 3; k++) buf[row + x * 3 + k] = Math.round(px[i + 2 - k]);
    }
  }
  fs.writeFileSync(file, buf);
  console.log(`installer-images: wrote ${path.relative(root, file)} (${width}x${height})`);
}

const icon = loadIcon();
fs.mkdirSync(outDir, { recursive: true });
// MUI draws the header bitmap at the left of the header, before the title
writeBmp(path.join(outDir, "header.bmp"), 150, 57, render(150, 57, HEADER_BG, icon, 54, 5, 47));
writeBmp(path.join(outDir, "sidebar.bmp"), 164, 314, render(164, 314, SIDEBAR_BG, icon, 26, 64, 112));
