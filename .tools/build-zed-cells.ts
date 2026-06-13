// ============================================================
// Zed cell-script generator — run: deno run -A .tools/build-zed-cells.ts
//
// Zed's REPL runs TypeScript files split into cells by `// %%`
// markers (cursor in a cell, ctrl-shift-enter to run; output shows
// inline below it). Zed has no separate markdown cells, so prose
// is emitted as a comment block introducing the next code cell.
//
// Source of truth is lessons.ts. Edit there, then re-run this.
// ============================================================
import type { Cell } from "./cells.ts";
import { notebooks } from "./lessons.ts";

// Render a markdown string as a `//` comment block so it reads
// well above its code cell in Zed. Blank lines stay as bare `//`.
function mdToComment(src: string): string {
  return src
    .split("\n")
    .map((line) => (line.length ? "// " + line : "//"))
    .join("\n");
}

function toZedScript(title: string, cells: Cell[]): string {
  const header = [
    "// ============================================================",
    `// ${title}`,
    "// ============================================================",
    "// Zed REPL: put the cursor in a cell and press ctrl-shift-enter",
    "// to run it. Cells are separated by `// %%`. Output appears",
    "// inline below the cell; the Deno kernel auto-displays each",
    "// cell's final expression.",
    "//",
    "// One-time setup: `deno jupyter --install` (kernel already",
    "// installed on this machine), then set Deno as the TS kernel —",
    "// see .zed/settings.json in this repo.",
    "// ============================================================",
  ].join("\n");

  // Merge each markdown block into the TOP of the following code
  // cell, so every `// %%` cell is "explanation + runnable code"
  // together (no prose-only cells to skip past in Zed). Trailing
  // markdown with no following code becomes its own closing cell.
  const blocks: string[] = [header];
  let pendingMd: string[] = [];

  for (const cell of cells) {
    if (cell.kind === "md") {
      pendingMd.push(mdToComment(cell.src));
    } else {
      const prose = pendingMd.length ? pendingMd.join("\n//\n") + "\n\n" : "";
      blocks.push("// %%\n" + prose + cell.src);
      pendingMd = [];
    }
  }
  if (pendingMd.length) blocks.push("// %%\n" + pendingMd.join("\n//\n"));

  return blocks.join("\n\n") + "\n";
}

for (const { file, title, cells } of notebooks) {
  const path = new URL(`../notebooks/${file}`, import.meta.url);
  await Deno.writeTextFile(path, toZedScript(title, cells));
  const codeCount = cells.filter((c) => c.kind === "code").length;
  console.log(`wrote notebooks/${file} (${codeCount} code cells)`);
}
