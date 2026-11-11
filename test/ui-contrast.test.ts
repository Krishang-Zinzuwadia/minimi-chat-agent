import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const css = readFileSync(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);
function palette(selector: string) {
  const start = css.indexOf(selector);
  assert.notEqual(start, -1);
  const block = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
  return Object.fromEntries(
    [...block.matchAll(/--([\w-]+):\s*(#[a-f\d]{3,6})\s*;/gi)].map((match) => [
      match[1],
      match[2],
    ]),
  );
}
function luminance(hex: string) {
  assert.ok(hex, "Color token must exist");
  const normalized =
    hex.length === 4
      ? hex
          .slice(1)
          .split("")
          .map((c) => c + c)
          .join("")
      : hex.slice(1);
  const rgb = [0, 2, 4]
    .map((index) => parseInt(normalized.slice(index, index + 2), 16) / 255)
    .map((value) =>
      value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
    );
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}
function contrast(a: string, b: string) {
  const l1 = luminance(a),
    l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
for (const [name, selector] of [
  ["light", ":root {"],
  ["dark", ':root[data-theme="dark"] {'],
  ["system dark", ':root[data-theme="system"] {'],
]) {
  test(`${name} small text meets WCAG AA against all assigned surfaces`, () => {
    const colors = palette(selector);
    for (const foreground of ["ink", "secondary", "muted"])
      for (const background of ["canvas", "panel", "raised"]) {
        const ratio = contrast(colors[foreground], colors[background]);
        assert.ok(
          ratio >= 4.5,
          `${foreground} on ${background}: ${ratio.toFixed(2)}:1`,
        );
      }
    for (const [foreground, background] of [
      ["error", "error-bg"],
      ["historical", "historical-bg"],
      ["accent", "soft"],
      ["on-accent", "accent"],
    ]) {
      const ratio = contrast(colors[foreground], colors[background]);
      assert.ok(
        ratio >= 4.5,
        `${foreground} on ${background}: ${ratio.toFixed(2)}:1`,
      );
    }
  });
  test(`${name} focus indicator remains visible against interface surfaces`, () => {
    const colors = palette(selector);
    for (const background of ["canvas", "panel", "raised"])
      assert.ok(
        contrast(colors.accent, colors[background]) >= 3,
        `Focus on ${background}`,
      );
  });
}
