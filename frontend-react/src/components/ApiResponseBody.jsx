import { useId, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { createJsonPreview, PREVIEW_CHARACTERS } from '@/lib/json-response-preview.mjs';

const VALUE_COLORS = {
  string: 'text-emerald-300', number: 'text-sky-300', boolean: 'text-violet-300', null: 'text-slate-400',
};
const PREVIEW_NOTICE = '当前仅预览部分正文，复制按钮会复制这条记录中保存的全部正文。';

function JsonNode({ node, index, path, depth, treeId, expansion, onToggle, comma = false }) {
  const isContainer = Boolean(node.children);
  const canCollapse = isContainer && (node.children.length > 0 || node.truncated);
  const open = expansion.nodes[path] ?? expansion.all ?? depth < 2;
  const opening = node.type === 'array' ? '[' : '{';
  const closing = node.type === 'array' ? ']' : '}';
  const label = node.key !== null ? `${node.key}: ` : index == null ? '' : `${index}: `;
  const accessibleLabel = node.key !== null ? `字段 ${node.key.slice(1, -1)}` : index == null ? '根节点' : `数组项 ${index}`;
  const childrenId = `${treeId}-${path}`;

  if (!canCollapse) return <li className="min-w-0 pl-6">
    <span className="text-slate-300">{label}</span>
    <span className={VALUE_COLORS[node.type] || 'text-slate-100'}>{isContainer ? `${opening}${closing}` : node.text}</span>
    {node.truncated ? <span className="text-amber-300">…</span> : null}
    {comma ? ',' : ''}
  </li>;

  return <li className="min-w-0">
    <Button variant="ghost" size="sm" className="h-auto min-h-6 max-w-full justify-start gap-1 rounded px-1 py-0 text-left font-mono text-xs font-normal text-slate-100 whitespace-pre-wrap hover:bg-slate-800 hover:text-slate-100"
      aria-label={`${open ? '折叠' : '展开'}${accessibleLabel}`} aria-expanded={open} aria-controls={childrenId}
      onClick={() => onToggle(path, !open)}>
      {open ? <ChevronDown className="size-4" aria-hidden="true" /> : <ChevronRight className="size-4" aria-hidden="true" />}
      <span><span className="text-slate-300">{label}</span>{opening}{open ? '' : ` … ${closing}${comma ? ',' : ''}`}</span>
      {!open ? <span className="shrink-0 text-slate-500">{node.children.length}{node.truncated ? '+' : ''} 项</span> : null}
    </Button>
    {open ? <>
      <ul id={childrenId} className="m-0 ml-3 list-none border-l border-slate-800 py-0 pl-3">
        {node.children.map((child, childIndex) => <JsonNode key={childIndex} node={child}
          index={node.type === 'array' ? childIndex : null} path={`${path}-${childIndex}`} depth={depth + 1}
          treeId={treeId} expansion={expansion} onToggle={onToggle} comma={childIndex < node.children.length - 1} />)}
        {node.truncated ? <li className="pl-6 text-amber-300">… 后续内容未预览</li> : null}
      </ul>
      <div className="pl-6">{closing}{comma ? ',' : ''}</div>
    </> : null}
  </li>;
}

function JsonTree({ preview }) {
  const treeId = useId();
  const [expansion, setExpansion] = useState({ all: null, nodes: {} });
  const onToggle = (path, open) => setExpansion(previous => ({ ...previous, nodes: { ...previous.nodes, [path]: open } }));

  return <>
    {preview.root.children?.length ? <div className="flex flex-wrap items-center gap-2">
      <span className="mr-auto text-xs text-fg-3">JSON · 点击箭头展开或折叠对象、数组</span>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <Button variant="outline" size="xs" onClick={() => setExpansion({ all: true, nodes: {} })}>全部展开</Button>
        <Button variant="outline" size="xs" onClick={() => setExpansion({ all: false, nodes: {} })}>全部折叠</Button>
      </div>
    </div> : null}
    {preview.truncated ? <p className="m-0 text-xs text-fg-3">{PREVIEW_NOTICE}</p> : null}
    <div tabIndex={0} className="max-h-[42vh] min-w-0 overflow-auto rounded-lg bg-slate-950 p-4 font-mono text-xs leading-6 text-slate-100 whitespace-pre-wrap [overflow-wrap:anywhere]" aria-label="API 返回正文">
      <ul className="m-0 list-none p-0"><JsonNode node={preview.root} path="root" depth={0}
        treeId={treeId} expansion={expansion} onToggle={onToggle} /></ul>
    </div>
  </>;
}

export function ApiResponseBody({ bodyText, encoding, emptyMessage }) {
  const preview = useMemo(() => encoding === 'base64' ? null : createJsonPreview(bodyText), [bodyText, encoding]);
  if (preview) return <JsonTree preview={preview} />;

  return <>
    {bodyText.length > PREVIEW_CHARACTERS ? <p className="m-0 text-xs text-fg-3">{PREVIEW_NOTICE}</p> : null}
    <pre tabIndex={0} className="m-0 max-h-[42vh] overflow-auto whitespace-pre-wrap rounded-lg bg-slate-950 p-4 font-mono text-xs leading-6 text-slate-100 [overflow-wrap:anywhere]" aria-label="API 返回正文">{bodyText.slice(0, PREVIEW_CHARACTERS) || emptyMessage}</pre>
  </>;
}
