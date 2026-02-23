const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

test("init banner shows VIBEUSAGE logo", () => {
  const src = read("src/commands/init.js");
  const startToken = "const ASCII_LOGO = [";
  const endToken = "].join('\\n');";
  const startIndex = src.indexOf(startToken);
  assert.ok(startIndex !== -1, "expected ASCII_LOGO definition");
  const endIndex = src.indexOf(endToken, startIndex);
  assert.ok(endIndex !== -1, "expected ASCII_LOGO end");
  const rawBlock = src.slice(startIndex + startToken.length, endIndex);
  const lines = [];
  const lineRegex = /'([^']*)'/g;
  let lineMatch;
  while ((lineMatch = lineRegex.exec(rawBlock)) !== null) {
    lines.push(lineMatch[1]);
  }
  const expected = [
    "██╗   ██╗██╗██████╗ ███████╗██╗   ██╗███████╗ █████╗  ██████╗ ███████╗",
    "██║   ██║██║██╔══██╗██╔════╝██║   ██║██╔════╝██╔══██╗██╔════╝ ██╔════╝",
    "██║   ██║██║██████╔╝█████╗  ██║   ██║███████╗███████║██║  ███╗█████╗",
    "╚██╗ ██╔╝██║██╔══██╗██╔══╝  ██║   ██║╚════██║██╔══██║██║   ██║██╔══╝",
    " ╚████╔╝ ██║██████╔╝███████╗╚██████╔╝███████║██║  ██║╚██████╔╝███████╗",
    "  ╚═══╝  ╚═╝╚═════╝ ╚══════╝ ╚═════╝ ╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚══════╝",
  ];

  assert.deepEqual(lines, expected, "expected ASCII_LOGO to match VIBEUSAGE banner");
});
