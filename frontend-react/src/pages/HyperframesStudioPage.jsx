import { DirectorPanel } from '../components/hyperframes-studio/DirectorPanel.jsx';
import { ProjectPanel } from '../components/hyperframes-studio/ProjectPanel.jsx';
import { RenderPreview } from '../components/hyperframes-studio/RenderPreview.jsx';
import { StudioSidebar } from '../components/hyperframes-studio/StudioSidebar.jsx';
import { StudioStatus } from '../components/hyperframes-studio/StudioStatus.jsx';
import { useHyperframesStudio } from '../hooks/useHyperframesStudio.js';

export function HyperframesStudioPage({ awemeId = '', runId = '' }) {
  const studio = useHyperframesStudio({ initialAwemeId: awemeId, initialRunId: runId });
  const freeform = studio.activeRun?.hyperframes_freeform;

  return (
    <main className="container">
      <div className="workspaceIntro">
        <div>
          <h2>高级成片</h2>
          <p>在同一个工作台完成导演策划、工程编辑、渲染和抽帧质检。</p>
        </div>
        <div className="settingsSummary">
          <strong>{studio.awemeId || '未选择'}</strong>
          <span>{studio.runId ? `运行 ${studio.runId}` : '等待选择素材'}</span>
        </div>
      </div>

      <StudioStatus status={studio.status} />

      <div className="agentWorkbench">
        <StudioSidebar
          awemeId={studio.awemeId}
          setAwemeId={studio.setAwemeId}
          runId={studio.runId}
          setRunId={studio.setRunId}
          runs={studio.runs}
          busyAction={studio.busyAction}
          canUseWorkflow={studio.canUseRun}
          refreshRuns={studio.refreshRuns}
          createFreeformRun={studio.createFreeformRun}
          generateBrief={studio.generateBrief}
          generateProject={studio.generateProject}
          checkProject={studio.checkProject}
          renderVideo={studio.renderVideo}
          inspectVideo={studio.inspectVideo}
          selectRun={studio.selectRun}
        />
        <DirectorPanel freeform={freeform} />
        <ProjectPanel
          freeform={freeform}
          selectedFile={studio.selectedFile}
          setSelectedFile={studio.setSelectedFile}
          fileContent={studio.fileContent}
          setFileContent={studio.setFileContent}
          busyAction={studio.busyAction}
          canUseWorkflow={studio.canUseRun}
          loadFile={studio.loadFile}
          saveFile={studio.saveFile}
        />
        <RenderPreview freeform={freeform} />
      </div>
    </main>
  );
}
