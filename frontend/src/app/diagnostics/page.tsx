import type { Metadata } from "next";
import { DiagnosticsWorkspace } from "@/components/diagnostics/DiagnosticsWorkspace";
export const metadata: Metadata = { title: "Diagnostics" };
export default function Page() {
  return <DiagnosticsWorkspace />;
}
