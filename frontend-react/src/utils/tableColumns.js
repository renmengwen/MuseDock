export function createIndexColumn() {
  return {
    id: 'index',
    label: '序号',
    alwaysVisible: true,
    className: 'w-[64px] min-w-[64px] text-center text-slate-500',
    render: (_item, index) => index + 1,
  };
}

export function getTitleText(item = {}) {
  return item.title || item.description || '-';
}
