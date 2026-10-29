import { expect, it } from "vitest";
import { copyText } from "./copy";

it("reports false when the clipboard is missing", async () => {
  expect(await copyText("x", undefined)).toBe(false);
});

it("reports false when the clipboard rejects", async () => {
  expect(await copyText("x", { writeText: () => Promise.reject(new Error("denied")) })).toBe(false);
});

it("writes the text and reports true", async () => {
  const written: string[] = [];
  const clipboard = { writeText: async (text: string) => void written.push(text) };
  expect(await copyText("x", clipboard)).toBe(true);
  expect(written).toEqual(["x"]);
});
