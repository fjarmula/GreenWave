import { pageMetadata } from "@/lib/localized-metadata";
import { DriverWorkspace } from "@/components/driver/DriverWorkspace";
export async function generateMetadata() {
  return pageMetadata("Driver");
}
export default function Page() {
  return <DriverWorkspace />;
}
