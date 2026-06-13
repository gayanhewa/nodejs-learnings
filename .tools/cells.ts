// Cell authoring helpers — kept separate to avoid a circular
// import between build-zed-cells.ts and lessons.ts.

export type Cell = { kind: "md" | "code"; src: string };

export const md = (s: TemplateStringsArray, ...x: unknown[]): Cell => ({
  kind: "md",
  src: raw(s, x),
});

export const code = (s: TemplateStringsArray, ...x: unknown[]): Cell => ({
  kind: "code",
  src: raw(s, x),
});

function raw(s: TemplateStringsArray, x: unknown[]): string {
  return s
    .reduce(
      (acc, part, i) => acc + part + (i < x.length ? String(x[i]) : ""),
      "",
    )
    .replace(/^\n/, "")
    .replace(/\n$/, "");
}
