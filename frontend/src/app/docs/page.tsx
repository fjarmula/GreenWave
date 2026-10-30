import { STIX_Two_Text } from "next/font/google";
import { pageMetadata } from "@/lib/localized-metadata";
import { DocsWorkspace } from "@/components/docs/DocsWorkspace";

/** Formula typeface, loaded only for the documentation route. */
const mathFont = STIX_Two_Text({
  variable: "--font-math",
  subsets: ["latin", "greek"],
  style: ["normal", "italic"],
  preload: false,
});

export async function generateMetadata() {
  return pageMetadata("Documentation");
}
export default function Page() {
  return <DocsWorkspace className={mathFont.variable} />;
}
