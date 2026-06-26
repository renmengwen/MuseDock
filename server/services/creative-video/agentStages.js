const AGENTS = {
  research: 'ResearchAgent',
  templateSelector: 'TemplateSelectorAgent',
  templateInput: 'TemplateInputAgent',
  contentGraph: 'ContentGraphAgent',
  frameHtml: 'FrameHtmlAgent',
};

const STAGES = {
  research: 'research',
  templateSelection: 'template_selection',
  templateInputs: 'template_inputs',
  contentGraph: 'content_graph',
  frameHtml: 'frame_html',
};

module.exports = { AGENTS, STAGES };
