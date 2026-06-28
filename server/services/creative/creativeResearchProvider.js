const aiModelConfig = require('../ai/aiModelConfig');
const aiTextModel = require('../ai/aiTextModel');
const { AGENTS, STAGES } = require('../creative-video/agentStages');

// ponytail: 3 行纯函数，与 creativeWorkflows 各持一份，避免为它把 166 处调用迁去共享 util
function safeString(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).trim();
}

async function defaultResearchProvider({
  query,
  aiModelConfig: injectedAiModelConfig,
  aiTextModel: injectedAiTextModel,
  webSearchProvider,
} = {}) {
  return runResearchProvider({
    query,
    aiModelConfig: injectedAiModelConfig || aiModelConfig,
    aiTextModel: injectedAiTextModel || aiTextModel,
    webSearchProvider: webSearchProvider || defaultWebSearchProvider,
  });
}

function extractUrlsFromText(text) {
  const urlRegex = /https?:\/\/[^\s)）\]}>"'，。；;]+/g;
  return String(text || '').match(urlRegex) || [];
}

function stripHtml(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeDuckDuckGoRedirect(url) {
  try {
    const parsed = new URL(url, 'https://duckduckgo.com');
    const uddg = parsed.searchParams.get('uddg');
    return uddg ? decodeURIComponent(uddg) : parsed.href;
  } catch {
    return safeString(url);
  }
}

function parseDuckDuckGoLiteResults(html, limit) {
  const results = [];
  const pattern = /<a([^>]*class=['"]result-link['"][^>]*)>([\s\S]*?)<\/a>[\s\S]*?<td[^>]+class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/gi;
  let match;
  while ((match = pattern.exec(html)) && results.length < limit) {
    const hrefMatch = match[1].match(/\shref=['"]([^'"]+)['"]/i);
    if (!hrefMatch) continue;
    results.push({
      title: stripHtml(match[2]),
      url: decodeDuckDuckGoRedirect(hrefMatch[1]),
      summary: stripHtml(match[3]),
    });
  }
  return results;
}

function parseDuckDuckGoHtmlResults(html, limit) {
  const results = [];
  const pattern = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = pattern.exec(html)) && results.length < limit) {
    results.push({
      title: stripHtml(match[2]),
      url: decodeDuckDuckGoRedirect(match[1]),
      summary: stripHtml(match[3]),
    });
  }
  return results;
}

function parseBingResults(html, limit) {
  const results = [];
  const pattern = /<li[^>]+class="[^"]*b_algo[^"]*"[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/gi;
  let match;
  while ((match = pattern.exec(html)) && results.length < limit) {
    results.push({
      title: stripHtml(match[2]),
      url: safeString(match[1]),
      summary: stripHtml(match[3]),
    });
  }
  return results;
}

function normalizeSearchResults(value) {
  const rawResults = Array.isArray(value)
    ? value
    : (Array.isArray(value?.results) ? value.results : []);
  return rawResults
    .map(item => ({
      title: safeString(item?.title),
      url: safeString(item?.url || item?.link),
      summary: safeString(item?.summary || item?.snippet || item?.description),
    }))
    .filter(item => item.url)
    .slice(0, 5);
}

async function defaultWebSearchProvider({ query, limit = 5, fetchImpl = global.fetch } = {}) {
  const normalizedQuery = safeString(query);
  if (!normalizedQuery) return { results: [] };
  if (typeof fetchImpl !== 'function') {
    throw new Error('当前运行环境缺少 fetch 实现，无法执行联网搜索。');
  }

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml',
  };
  const endpoints = [
    {
      url: `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(normalizedQuery)}`,
      parse: parseDuckDuckGoLiteResults,
    },
    {
      url: `https://html.duckduckgo.com/html/?q=${encodeURIComponent(normalizedQuery)}`,
      parse: parseDuckDuckGoHtmlResults,
    },
    {
      url: `https://www.bing.com/search?q=${encodeURIComponent(normalizedQuery)}`,
      parse: parseBingResults,
    },
  ];
  const errors = [];
  for (const endpoint of endpoints) {
    try {
      const response = await fetchImpl(endpoint.url, {
        headers,
        signal: typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
          ? AbortSignal.timeout(20000)
          : undefined,
      });
      if (!response || !response.ok) {
        errors.push(`HTTP ${response?.status || 'unknown'}: ${endpoint.url}`);
        continue;
      }
      const html = await response.text();
      const results = endpoint.parse(html, limit);
      if (results.length > 0) return { results };
      errors.push(`搜索结果为空: ${endpoint.url}`);
    } catch (error) {
      errors.push(`${endpoint.url}: ${error.message || '请求失败'}`);
    }
  }
  return { results: [], diagnostics: errors };
}

function getFirstAssistantMessage(rawResponse = {}) {
  return rawResponse?.choices?.[0]?.message || null;
}

function getWebSearchToolCalls(rawResponse = {}) {
  const message = getFirstAssistantMessage(rawResponse);
  const toolCalls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
  return toolCalls.filter(toolCall => toolCall?.function?.name === 'web_search');
}

function parseToolCallArguments(toolCall) {
  try {
    return JSON.parse(toolCall?.function?.arguments || '{}');
  } catch {
    return {};
  }
}

async function runResearchProvider({
  query,
  aiModelConfig: modelConfigService,
  aiTextModel: textModelService,
  webSearchProvider,
} = {}) {
  const messages = [
    {
      role: 'system',
      content: '你是一个联网研究助手。请搜索最新资料，为用户提供准确、有帮助的信息。',
    },
    {
      role: 'user',
      content: `请搜索并研究以下主题：${query}`,
    },
  ];

  // 获取模型配置，判断是否为mimo模型
  const config = await modelConfigService.getRuntimeConfig('text');
  const modelId = config?.modelId || '';
  const isMimo = modelId.toLowerCase().startsWith('mimo');

  // 根据模型类型选择工具格式
  let tools;
  let toolChoice;

  if (isMimo) {
    // mimo-v2.5-pro 的 web_search 工具格式
    tools = [
      {
        type: 'web_search',
        max_keyword: 3,
        force_search: true,
        limit: 5,
      },
    ];
    toolChoice = 'auto';
  } else {
    // OpenAI 标准格式
    tools = [
      {
        type: 'function',
        function: {
          name: 'web_search',
          description: '搜索互联网获取最新信息',
          parameters: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: '搜索关键词',
              },
            },
            required: ['query'],
          },
        },
      },
    ];
    toolChoice = { type: 'function', function: { name: 'web_search' } };
  }

  try {
    const result = await textModelService.callTextModel({
      messages,
      tools,
      tool_choice: toolChoice,
      temperature: 0.3,
      stream: false,
      audit: {
        agent: AGENTS.research,
        stage: STAGES.research,
        sub_stage: 'web_search_request',
        attempt: 1,
      },
    });

    if (!result.success) {
      throw new Error(result.message || '文本模型调用失败');
    }

    // 从响应中提取搜索结果
    const text = result.text || '';
    const rawResponse = result.raw_response || {};
    const webSearchToolCalls = getWebSearchToolCalls(rawResponse);

    if (webSearchToolCalls.length > 0 && typeof webSearchProvider === 'function') {
      const assistantMessage = getFirstAssistantMessage(rawResponse);
      const toolMessages = [];
      let searchSources = [];
      for (const toolCall of webSearchToolCalls) {
        const args = parseToolCallArguments(toolCall);
        const searchQuery = safeString(args.query) || safeString(query);
        const searchResult = await webSearchProvider({ query: searchQuery, limit: 5 });
        const normalizedResults = normalizeSearchResults(searchResult);
        searchSources = searchSources.concat(normalizedResults);
        toolMessages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          name: 'web_search',
          content: JSON.stringify({ query: searchQuery, results: normalizedResults }),
        });
      }

      const finalResult = await textModelService.callTextModel({
        messages: [
          ...messages,
          {
            role: 'assistant',
            content: assistantMessage?.content || '',
            tool_calls: assistantMessage?.tool_calls || webSearchToolCalls,
          },
          ...toolMessages,
          {
            role: 'user',
            content: '请基于搜索结果输出中文研究摘要，并在正文中保留关键来源 URL。不要编造搜索结果之外的信息。',
          },
        ],
        temperature: 0.3,
        stream: false,
        audit: {
          agent: AGENTS.research,
          stage: STAGES.research,
          sub_stage: 'web_search_summary',
          attempt: 1,
        },
      });
      if (!finalResult.success) {
        throw new Error(finalResult.message || '文本模型整理搜索结果失败');
      }
      return {
        summary: finalResult.text || '',
        sources: normalizeSearchResults(searchSources),
      };
    }

    // 尝试从raw_response中提取搜索结果
    let sources = [];
    if (rawResponse.choices && rawResponse.choices[0] && rawResponse.choices[0].message) {
      const message = rawResponse.choices[0].message;
      // mimo的搜索结果可能在message的某个字段中
      if (message.tool_calls) {
        // 解析tool_calls中的搜索结果
        for (const toolCall of message.tool_calls) {
          if (toolCall.function && toolCall.function.name === 'web_search') {
            try {
              const searchResult = JSON.parse(toolCall.function.arguments);
              if (searchResult.results) {
                sources = searchResult.results.map(item => ({
                  title: item.title || '',
                  url: item.url || item.link || '',
                  summary: item.snippet || item.description || '',
                }));
              }
            } catch {
              // 解析失败，继续
            }
          }
        }
      }
    }

    // 如果没有从tool_calls中提取到，尝试从文本中提取
    if (sources.length === 0) {
      // 尝试从文本中提取URL和标题
      const urls = extractUrlsFromText(text);
      sources = urls.slice(0, 5).map(url => ({
        title: '',
        url: url,
        summary: '',
      }));
    }

    return {
      summary: text,
      sources: sources,
    };
  } catch (error) {
    throw new Error(`联网研究失败：${error.message}`);
  }
}

module.exports = {
  defaultResearchProvider,
  defaultWebSearchProvider,
  runResearchProvider,
  extractUrlsFromText,
  stripHtml,
  decodeDuckDuckGoRedirect,
  parseDuckDuckGoLiteResults,
  parseDuckDuckGoHtmlResults,
  parseBingResults,
  normalizeSearchResults,
  getFirstAssistantMessage,
  getWebSearchToolCalls,
  parseToolCallArguments,
};
