/** One operation across live simulation and sequential capture. A claim cannot be re-entered. */
export function createOperationSlot() {
  let owner: "live" | "comparison" | null = null;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    acquire(next: "live" | "comparison") {
      if (owner) return false;
      owner = next;
      notify();
      return true;
    },
    release(current: "live" | "comparison") {
      if (owner === current) {
        owner = null;
        notify();
      }
    },
    getOwner: () => owner,
  };
}
export const simulationOperationSlot = createOperationSlot();
