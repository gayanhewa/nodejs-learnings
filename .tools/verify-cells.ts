// Verifies each Zed cell-script runs under Deno by executing every
// CODE cell independently in its own subprocess. Running cells in
// isolation is stricter than Zed (which shares scope across cells),
// so it also confirms each cell is self-contained — you can run any
// cell in any order while studying without "x is not defined".
//
// Run: deno run -A .tools/verify-cells.ts

let failures = 0;

for (
  const file of [
    "1-promises.ts",
    "2-event-emitters.ts",
    "3-concurrency.ts",
    "4-streams.ts",
  ]
) {
  const text = await Deno.readTextFile(
    new URL(`../notebooks/${file}`, import.meta.url),
  );

  // Split on `// %%` markers; a cell is "code" if, after stripping
  // its comment/blank lines, anything executable remains.
  const cells = text.split(/^\/\/ %%[ \t]*$/m).map((c) => c.trim()).filter(
    Boolean,
  );

  let idx = 0;
  for (const cell of cells) {
    const executable = cell
      .split("\n")
      .filter((l) => l.trim() && !l.trim().startsWith("//"))
      .join("\n");
    if (!executable.trim()) continue; // pure prose/comment cell

    const tmp = await Deno.makeTempFile({ suffix: ".ts" });
    await Deno.writeTextFile(tmp, cell); // run the WHOLE cell (comments are harmless)
    const { code, stderr } = await new Deno.Command(Deno.execPath(), {
      args: ["run", "-A", "--quiet", tmp],
      stderr: "piped",
    }).output();
    await Deno.remove(tmp);

    if (code === 0) {
      console.log(`✓ ${file} cell ${idx}`);
    } else {
      failures++;
      console.log(
        `✗ ${file} cell ${idx} FAILED:\n` + new TextDecoder().decode(stderr),
      );
    }
    idx++;
  }
}

console.log(
  failures === 0 ? "\nALL CELLS PASS" : `\n${failures} CELL(S) FAILED`,
);
if (failures > 0) Deno.exit(1);
