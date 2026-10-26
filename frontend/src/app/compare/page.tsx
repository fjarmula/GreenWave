import type { Metadata } from "next";
import { ComparisonWorkspace } from "@/components/comparison/ComparisonWorkspace";
export const metadata: Metadata = { title: "Comparison" };
export default function Page() {
  return <ComparisonWorkspace />;
}
