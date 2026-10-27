import { expect, it } from "vitest";
import { captureRunLabels, settingsForMode } from "@/lib/scenario-state";
import { DEFAULT_DISPATCH_SETTINGS } from "@/lib/start-request";

it("captures endpoints independently of later draft edits", () => {
  const station = { label: "Station A", position: { lat: 50, lng: 19 } };
  const incident = { label: "Incident A", position: { lat: 51, lng: 20 } };
  const labels = captureRunLabels(station, incident);
  station.label = "Station B";
  incident.position.lat = 52;
  expect(labels.origin).toEqual({ label: "Station A", position: { lat: 50, lng: 19 } });
  expect(labels.destination).toEqual({ label: "Incident A", position: { lat: 51, lng: 20 } });
});

it("route mode overrides only mode and leaves shared settings unchanged", () => {
  const settings = { ...DEFAULT_DISPATCH_SETTINGS, trafficDensity: 2, cascadeEnabled: false };
  expect(settingsForMode(settings, "DISABLED")).toEqual({ ...settings, greenWaveMode: "DISABLED" });
  expect(settings.greenWaveMode).toBe("ENABLED");
});

it("keeps the OSM position of an address disagreement with the incident", () => {
  const station = { label: "Station A", position: { lat: 50, lng: 19 } };
  const osmPosition = { lat: 51.001, lng: 20.002 };
  const incident = { label: "Zabłocie 18", position: { lat: 51, lng: 20 }, osmPosition };
  const labels = captureRunLabels(station, incident);
  osmPosition.lat = 0;
  expect(labels.destination.osmPosition).toEqual({ lat: 51.001, lng: 20.002 });
  expect(captureRunLabels(station, { ...incident, osmPosition: null }).destination).toEqual({
    label: "Zabłocie 18",
    position: { lat: 51, lng: 20 },
  });
});
