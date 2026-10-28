import { pageMetadata } from "@/lib/localized-metadata";
import { SimulationWorkspace } from "@/components/workspace/SimulationWorkspace";
export async function generateMetadata() {
  return pageMetadata("Green Wave");
}
export default function Page() {
  return <SimulationWorkspace mode="ENABLED" />;
}
