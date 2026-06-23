import { useMemo } from 'react';
import { STATUS_TEXT, getStepState, normalizeWorkflowStages } from './creativeDisplay.js';

export function CreativeWorkflowStepper({ workflow }) {
  const stages = useMemo(() => normalizeWorkflowStages(workflow), [workflow]);

  return (
    <div className="creativeWorkflowStepper" aria-label="生成进度">
      {stages.map((stage, index) => {
        const stepState = getStepState(stage, index, stages);
        return (
          <div className={`creativeWorkflowStep ${stepState}`} key={stage.id || stage.label}>
            {index > 0 ? <span className="creativeWorkflowStepConnector" aria-hidden="true" /> : null}
            <span className="creativeWorkflowStepDot">{index + 1}</span>
            <span className="creativeWorkflowStepLabel">{stage.label}</span>
            <small>{STATUS_TEXT[stage.status] || stage.status || '等待中'}</small>
          </div>
        );
      })}
    </div>
  );
}
