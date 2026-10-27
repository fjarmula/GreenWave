import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DispatchSettingsChip } from "./DispatchSettingsChip";
import { WorkspaceShell } from "@/components/workspace/WorkspaceShell";
import type { SimulationStartRequest } from "@/types/telemetry";

const request = {
  vehicle_type: "AMBULANCE",
  traffic_density_multiplier: 1.5,
  enable_cascade_mode: true,
  green_wave_mode: "ENABLED",
  its_scenario: "NOMINAL",
  playback_speed: 1,
} as SimulationStartRequest;

describe("DispatchSettingsChip", () => {
  it("keeps settings separate from the single camera action", () => {
    const html = renderToStaticMarkup(<DispatchSettingsChip request={request} />);
    const popover = html.slice(html.indexOf("<section"));
    expect(popover).not.toContain("Follow vehicle");
    expect(popover).not.toContain('role="switch"');
    expect(popover).toContain("Playback speed");
  });
});

describe("WorkspaceShell status slot", () => {
  it("aligns the status overlay on request", () => {
    const html = renderToStaticMarkup(
      <WorkspaceShell map={<div />} header={<h1>Run</h1>} status={<p>chip</p>} statusAlign="end" />,
    );
    expect(html).toMatch(/class="workspace-status"[^>]*data-align="end"/);
  });
});
