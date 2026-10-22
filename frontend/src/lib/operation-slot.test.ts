import { expect, it } from "vitest";
import { createOperationSlot } from "./operation-slot";
it("notifies views without allowing a competing operation to steal ownership", () => {
  const slot = createOperationSlot();
  const seen: unknown[] = [];
  slot.subscribe(() => seen.push(slot.getOwner()));
  expect(slot.acquire("comparison")).toBe(true);
  expect(slot.acquire("live")).toBe(false);
  slot.release("live");
  expect(slot.getOwner()).toBe("comparison");
  slot.release("comparison");
  expect(seen).toEqual(["comparison", null]);
});
