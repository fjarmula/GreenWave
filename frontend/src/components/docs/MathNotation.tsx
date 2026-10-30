import type { ReactNode } from "react";

type MathNode =
  string | { kind: "var"; text: string } | { kind: "sub" | "sup"; children: MathNode[] };

const WORD = /[A-Za-z]{2,}/y;
const LETTER = /\p{L}\p{M}*/uy;
const NUMBER = /\d+(?:\.\d+)?/y;
const UPRIGHT_GREEK = /^[Α-Ω]/;

function push(nodes: MathNode[], node: MathNode) {
  const last = nodes.at(-1);
  if (typeof node === "string" && typeof last === "string") nodes[nodes.length - 1] = last + node;
  else nodes.push(node);
}

/** One operand: a function name or label word, a single variable letter, a number or a symbol. */
function atom(source: string, index: number): [MathNode, number] {
  for (const pattern of [WORD, LETTER, NUMBER]) {
    pattern.lastIndex = index;
    const match = pattern.exec(source);
    if (!match) continue;
    const text = match[0];
    // TeX convention: single Latin and lowercase Greek letters are italic variables.
    const node =
      pattern === LETTER && !UPRIGHT_GREEK.test(text) ? { kind: "var" as const, text } : text;
    return [node, pattern.lastIndex];
  }
  return [source[index], index + 1];
}

function parse(source: string, index = 0, group = false): [MathNode[], number] {
  const nodes: MathNode[] = [];
  while (index < source.length) {
    const char = source[index];
    if (group && char === "}") return [nodes, index + 1];
    if (char === "_" || char === "^") {
      let children: MathNode[];
      if (source[index + 1] === "{") [children, index] = parse(source, index + 2, true);
      else {
        const [node, next] = atom(source, index + 1);
        [children, index] = [[node], next];
      }
      nodes.push({ kind: char === "_" ? "sub" : "sup", children });
      continue;
    }
    const [node, next] = atom(source, index);
    push(nodes, node);
    index = next;
  }
  return [nodes, index];
}

function render(nodes: MathNode[]): ReactNode[] {
  return nodes.map((node, index) => {
    if (typeof node === "string") return node;
    if (node.kind === "var") return <var key={index}>{node.text}</var>;
    const Tag = node.kind;
    return <Tag key={index}>{render(node.children)}</Tag>;
  });
}

/** Typeset lines of compact notation (`x_i`, `t_{a,e}`, `x^2`) as italic variables with scripts. */
export function MathNotation({ expression }: { expression: string }) {
  return (
    <div
      className="docs-math"
      tabIndex={0}
      role="math"
      aria-label={expression.replace(/[{}]/g, "").replace(/[_^]/g, " ")}
    >
      {expression.split("\n").map((line, index) => (
        <span key={index} className="docs-math-line">
          {render(parse(line)[0])}
        </span>
      ))}
    </div>
  );
}
