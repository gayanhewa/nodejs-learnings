// ============================================================
// PDF builder — run: deno run -A .tools/build-pdf.ts
//
// Converts the four Zed cell-scripts in notebooks/ into ONE Markdown
// document (prose comments become text, code cells become fenced ts
// blocks), then runs the full pipeline: pandoc turns it into a
// syntax-highlighted standalone HTML, and headless Chrome prints that
// to dist/nodejs-async-lessons.pdf. Requires pandoc and Google Chrome.
//
// Why notebooks/*.ts and not the lessons.ts source: the notebooks are
// the verified, runnable artifact, so the PDF matches exactly what
// runs in the editor.
// ============================================================

const LESSONS = [
  "1-promises.ts",
  "2-event-emitters.ts",
  "3-concurrency.ts",
  "4-streams.ts",
];

// A cell is the text between `// %%` markers. Within a cell, the
// LEADING run of `//`-prefixed lines is prose (markdown); everything
// after the first non-comment line is code.
function cellToMarkdown(cell: string): string {
  const lines = cell.split("\n");
  const prose: string[] = [];
  let i = 0;

  // Collect the leading comment block as prose.
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") {
      // Blank line: part of prose only if more prose follows.
      if (
        prose.length &&
        lines.slice(i + 1).some((l) => l.trim().startsWith("//"))
      ) {
        prose.push("");
        continue;
      }
      i++; // consume the separating blank line before code
      break;
    }
    if (line.trim().startsWith("//")) {
      prose.push(line.replace(/^\s*\/\/ ?/, ""));
    } else {
      break; // first code line
    }
  }

  const code = lines.slice(i).join("\n").trim();

  // Drop editor-only tips that make no sense in a static PDF.
  const cleanedProse = prose
    .filter((line) => !/ctrl-shift-enter/.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  let out = "";
  if (cleanedProse) out += cleanedProse + "\n\n";
  if (code) out += "```ts\n" + code + "\n```\n";
  return out;
}

function lessonToMarkdown(text: string): string {
  // Split into cells on lines that are EXACTLY `// %%`. The first
  // chunk is the file header block (Zed instructions), which we drop.
  const chunks = text.split(/^\/\/ %%[ \t]*$/m);
  const cells = chunks.slice(1).map((c) => c.trim()).filter(Boolean);

  return cells.map(cellToMarkdown).filter(Boolean).join("\n");
}

let doc = `---
title: "Node.js Async"
subtitle: "Promises, Event Emitters, Concurrency & Streams"
date: "Lessons with runnable examples"
---

`;

for (let l = 0; l < LESSONS.length; l++) {
  const file = LESSONS[l];
  const text = await Deno.readTextFile(
    new URL(`../notebooks/${file}`, import.meta.url),
  );
  if (l > 0) doc += '\n\n<div class="page-break"></div>\n\n';
  doc += lessonToMarkdown(text);
}

const outDir = new URL("../dist/", import.meta.url);
await Deno.mkdir(outDir, { recursive: true });
const root = new URL("../", import.meta.url).pathname;
const mdPath = `${root}dist/nodejs-async-lessons.md`;
const htmlPath = `${root}dist/nodejs-async-lessons.html`;
const pdfPath = `${root}dist/nodejs-async-lessons.pdf`;
await Deno.writeTextFile(mdPath, doc);
console.log(
  `wrote dist/nodejs-async-lessons.md (${
    doc.split("\n").length
  } lines, ${LESSONS.length} lessons)`,
);

// --- markdown -> standalone HTML (pandoc, with syntax highlighting) ---
const pandoc = await new Deno.Command("pandoc", {
  args: [
    mdPath,
    "-f",
    "markdown",
    "-t",
    "html5",
    "--standalone",
    "--syntax-highlighting=tango",
    `--css=${root}.tools/pdf.css`,
    "--embed-resources",
    "-o",
    htmlPath,
  ],
  stderr: "piped",
}).output();
if (pandoc.code !== 0) {
  console.error("pandoc failed:\n" + new TextDecoder().decode(pandoc.stderr));
  Deno.exit(1);
}
console.log("wrote dist/nodejs-async-lessons.html");

// --- HTML -> PDF (headless Chrome) ---
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const chrome = await new Deno.Command(CHROME, {
  args: [
    "--headless",
    "--disable-gpu",
    "--no-pdf-header-footer",
    `--print-to-pdf=${pdfPath}`,
    `file://${htmlPath}`,
  ],
  stderr: "piped",
}).output();
if (chrome.code !== 0) {
  console.error("chrome failed:\n" + new TextDecoder().decode(chrome.stderr));
  Deno.exit(1);
}
console.log("wrote dist/nodejs-async-lessons.pdf");
