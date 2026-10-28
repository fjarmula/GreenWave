import { pageMetadata } from "@/lib/localized-metadata";
import { DiagnosticsWorkspace } from "@/components/diagnostics/DiagnosticsWorkspace";
export async function generateMetadata() {
  return pageMetadata("Diagnostics");
}
export default function Page() {
  return <DiagnosticsWorkspace />;
}
