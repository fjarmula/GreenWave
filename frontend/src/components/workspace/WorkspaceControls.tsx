"use client";
import type { ReactNode } from "react";
import { useFollowControl } from "@/components/map/follow-context";
import { CameraViewButton } from "@/components/map/CameraViewButton";

/** One aligned row for the workspace camera and the active run's settings. */
export function WorkspaceControls({ children }: { children?: ReactNode }) {
  const follow = useFollowControl();
  if (!follow.hasRoute && !children) return null;
  return (
    <div className="workspace-run-controls" data-map-occluder>
      {follow.hasRoute && (
        <CameraViewButton
          following={follow.following}
          canFollow={follow.available}
          onFollow={() => follow.setFollowing(true)}
          onShowRoute={() => follow.setFollowing(false)}
        />
      )}
      {children}
    </div>
  );
}
