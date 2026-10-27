"use client";
import { LocateFixed, Route } from "lucide-react";

/** The action names the next view, rather than repeating the current camera state. */
export function CameraViewButton({
  following,
  canFollow,
  onFollow,
  onShowRoute,
}: {
  following: boolean;
  canFollow: boolean;
  onFollow: () => void;
  onShowRoute: () => void;
}) {
  const route = following || !canFollow;
  const Icon = route ? Route : LocateFixed;
  return (
    <button
      type="button"
      className="workspace-button workspace-float"
      onClick={route ? onShowRoute : onFollow}
    >
      <Icon aria-hidden />
      {route ? "Show route" : "Follow vehicle"}
    </button>
  );
}
