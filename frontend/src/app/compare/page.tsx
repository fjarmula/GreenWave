import { pageMetadata } from "@/lib/localized-metadata";
import { ComparisonWorkspace } from "@/components/comparison/ComparisonWorkspace";
export async function generateMetadata() {
  return pageMetadata("Comparison");
}
export default function Page() {
  return <ComparisonWorkspace />;
}
