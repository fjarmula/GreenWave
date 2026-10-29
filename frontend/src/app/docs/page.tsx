import { pageMetadata } from "@/lib/localized-metadata";
import { DocsWorkspace } from "@/components/docs/DocsWorkspace";
export async function generateMetadata() {
  return pageMetadata("Documentation");
}
export default function Page() {
  return <DocsWorkspace />;
}
