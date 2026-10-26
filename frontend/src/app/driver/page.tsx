import type { Metadata } from "next";
import { DriverWorkspace } from "@/components/driver/DriverWorkspace";
export const metadata: Metadata = { title: "Driver" };
export default function Page() {
  return <DriverWorkspace />;
}
