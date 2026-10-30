import { ArrowRight, CornerDownRight, RotateCcw } from "lucide-react";
import type { FlowStep } from "@/lib/docs/content";

/** Steps read left to right (top to bottom when narrow); branches hang under the step they leave. */
export function FlowDiagram({
  label,
  steps,
  cycle,
}: {
  label: string;
  steps: FlowStep[];
  cycle?: string;
}) {
  return (
    <figure className="docs-flow">
      <figcaption>{label}</figcaption>
      <ol className="docs-flow-steps">
        {steps.map((step, index) => (
          <li className="docs-flow-step" key={step.label}>
            {index > 0 && <ArrowRight aria-hidden className="docs-flow-arrow" />}
            <div className="docs-flow-column">
              <div className="docs-flow-node">
                <strong>{step.label}</strong>
                {step.detail && <span>{step.detail}</span>}
              </div>
              {step.branches && (
                <ul className="docs-flow-branches">
                  {step.branches.map((branch) => (
                    <li key={branch.label}>
                      <CornerDownRight aria-hidden className="docs-flow-branch-arrow" />
                      <div className="docs-flow-node docs-flow-node-branch">
                        <strong>{branch.label}</strong>
                        {branch.detail && <span>{branch.detail}</span>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        ))}
      </ol>
      {cycle && (
        <p className="docs-flow-cycle">
          <RotateCcw aria-hidden className="size-4 shrink-0" />
          <span>{cycle}</span>
        </p>
      )}
    </figure>
  );
}
