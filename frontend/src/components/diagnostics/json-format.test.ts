import { expect, it } from "vitest";
import { formatJsonBody } from "./JsonDetails";
it("formats JSON without changing numeric tokens, strings or escape sequences", () => {
  const raw = '{"id":9007199254740993,"exponent":1e+42,"text":"a,\\\"{}","nested":[true,null]}';
  const formatted = formatJsonBody(raw);
  expect(formatted).toContain("9007199254740993");
  expect(formatted).toContain("1e+42");
  expect(formatted).toContain('"a,\\\"{}"');
  expect(JSON.parse(formatted)).toEqual(JSON.parse(raw));
  expect(formatJsonBody("<html>error</html>")).toBe("<html>error</html>");
});
it("keeps deeply nested JSON intact without expanding it excessively", () => {
  const raw = "[".repeat(100) + "0" + "]".repeat(100);
  expect(formatJsonBody(raw)).toBe(raw);
});
