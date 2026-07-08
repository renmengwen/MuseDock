import { firstText } from './creativeDisplay.js';

function listTextValues(...values) {
  return values
    .flatMap(value => (Array.isArray(value) ? value : []))
    .map(value => firstText(value))
    .filter(Boolean);
}

function getWorkflowSceneSpec(workflow) {
  return workflow?.result?.hyperframes_freeform?.project?.scene_spec
    || workflow?.result?.hyperframes_freeform?.scene_spec
    || workflow?.result?.scene_spec
    || workflow?.scene_spec
    || null;
}

function getWorkflowTitleInfo(workflow) {
  const sceneSpec = getWorkflowSceneSpec(workflow);
  const mainTitle = firstText(
    sceneSpec?.title,
    workflow?.result?.hyperframes_freeform?.project?.title,
    workflow?.result?.hyperframes_freeform?.title,
  );
  const candidates = Array.from(new Set(listTextValues(
    sceneSpec?.title_candidates,
    sceneSpec?.titleCandidates,
    sceneSpec?.alternative_titles,
    sceneSpec?.alternate_titles,
    workflow?.result?.hyperframes_freeform?.project?.title_candidates,
  ))).filter(title => title !== mainTitle).slice(0, 4);
  return { mainTitle, candidates };
}

export function CreativeTitlePanel({ workflow }) {
  const { mainTitle, candidates } = getWorkflowTitleInfo(workflow);
  if (!mainTitle && !candidates.length) return null;
  const visibleCandidates = mainTitle ? candidates : candidates.slice(1);

  return (
    <div className="grid min-w-0 gap-2 border-t border-[#edf0f4] pt-3">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="text-xs font-bold text-[#8a93a2]">视频标题</span>
        <strong className="min-w-0 break-words text-[15px] leading-snug text-[#111827]">{mainTitle || candidates[0]}</strong>
      </div>
      {visibleCandidates.length ? (
        <div className="flex min-w-0 flex-wrap gap-2" aria-label="备选标题">
          {visibleCandidates.map(title => (
            <span key={title} className="min-w-0 max-w-full break-words rounded-full bg-[#f8fafc] px-3 py-1 text-xs font-semibold text-[#4b5563] ring-1 ring-[#e7e9ee]">
              {title}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
