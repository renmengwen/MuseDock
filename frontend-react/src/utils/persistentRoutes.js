const DEFAULT_STATE = {
  crawlPlatform: 'douyin',
  recordsPlatform: 'douyin',
  mediaPlatform: '',
  mediaId: '',
  aiSearch: '',
  studioAwemeId: '',
  studioRunId: '',
  activePage: 'creative',
};

function splitPath(pathname = '') {
  return String(pathname || '')
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .filter(Boolean);
}

function normalizePlatform(value) {
  return value === 'xhs' ? 'xhs' : 'douyin';
}

export function getPersistentRouteState(previous = DEFAULT_STATE, pathname = '/', search = '') {
  const state = { ...DEFAULT_STATE, ...(previous || {}) };
  const parts = splitPath(pathname);
  const section = parts[0] || 'creative';

  if (section === 'creative') {
    return {
      ...state,
      activePage: 'creative',
    };
  }

  if (section === 'records') {
    return {
      ...state,
      recordsPlatform: normalizePlatform(parts[1]),
      activePage: 'records',
    };
  }

  if (section === 'media') {
    return {
      ...state,
      mediaPlatform: parts[1] || state.mediaPlatform,
      mediaId: parts[2] || state.mediaId,
      activePage: 'media',
    };
  }

  if (section === 'ai') {
    return {
      ...state,
      aiSearch: search || state.aiSearch,
      activePage: 'ai',
    };
  }

  if (section === 'settings') {
    return {
      ...state,
      activePage: 'settings',
    };
  }

  if (section === 'hyperframes-freeform') {
    return {
      ...state,
      studioAwemeId: parts[1] || state.studioAwemeId,
      studioRunId: parts[2] || state.studioRunId,
      activePage: 'hyperframes-freeform',
    };
  }

  return {
    ...state,
    crawlPlatform: normalizePlatform(parts[1]),
    activePage: 'crawl',
  };
}
