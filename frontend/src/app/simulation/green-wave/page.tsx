import type { Metadata } from "next";
import { SimulationWorkspace } from "@/components/workspace/SimulationWorkspace";
export const metadata: Metadata = { title: "Green Wave" };
export default function Page() {
  return <SimulationWorkspace mode="ENABLED" />;
}
