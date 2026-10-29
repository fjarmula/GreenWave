import type { Corridor } from "@/lib/home-corridor";

/** Short cross streets through each signal, square to the route there: the backdrop's street grid. */
export function crossStreets({ route, signals }: Corridor): string {
  const points = route.path
    .slice(1)
    .split("L")
    .map((pair) => pair.split(",").map(Number));
  return signals
    .map(({ x, y }, index) => {
      let nearest = 0;
      points.forEach(([px, py], i) => {
        const [nx, ny] = points[nearest];
        if ((px - x) ** 2 + (py - y) ** 2 < (nx - x) ** 2 + (ny - y) ** 2) nearest = i;
      });
      const [ax, ay] = points[Math.max(0, nearest - 1)];
      const [bx, by] = points[Math.min(points.length - 1, nearest + 1)];
      const length = Math.hypot(bx - ax, by - ay) || 1;
      const [ux, uy] = [-(by - ay) / length, (bx - ax) / length];
      const reach = 70 + (index % 3) * 40;
      const end = (scale: number) =>
        `${(x + ux * scale).toFixed(1)},${(y + uy * scale).toFixed(1)}`;
      return `M${end(-reach)}L${end(reach * 1.2)}`;
    })
    .join("");
}
