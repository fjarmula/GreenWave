import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DispatchSettingsChip, FollowSwitch } from "./DispatchSettingsChip";
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

describe("FollowSwitch", () => {
  it("shows the following state as a labelled switch", () => {
    const html = renderToStaticMarkup(<FollowSwitch available following onChange={() => {}} />);
    expect(html).toContain("Follow vehicle");
    expect(html).toMatch(/<button[^>]*role="switch"[^>]*aria-checked="true"/);
    expect(html).not.toContain('disabled=""');
  });

  it("is disabled while no live map can follow", () => {
    const html = renderToStaticMarkup(
      <FollowSwitch available={false} following={false} onChange={() => {}} />,
    );
    expect(html).toMatch(/<button[^>]*role="switch"[^>]*disabled=""/);
  });
});

describe("DispatchSettingsChip", () => {
  it("puts the follow switch in the settings popover", () => {
    const html = renderToStaticMarkup(<DispatchSettingsChip request={request} />);
    const popover = html.slice(html.indexOf("<section"));
    expect(popover).toContain("Follow vehicle");
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
