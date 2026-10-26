import type { Metadata } from "next";
import { SimulationWorkspace } from "@/components/workspace/SimulationWorkspace";
export const metadata: Metadata = { title: "Standard traffic" };
export default function Page() {
  return <SimulationWorkspace mode="DISABLED" />;
}
