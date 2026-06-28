const projectStore = require('./html-video/projectStore');
const editPatchService = require('./html-video/editPatchService');
const frameHtmlEditService = require('./html-video/frameHtmlEditService');
const iterateService = require('./html-video/htmlVideoIterateService');
const layoutQaService = require('./html-video/layoutQaService');
const editModeService = require('./html-video/htmlVideoEditModeService');
const projectOrchestrator = require('./html-video/projectOrchestrator');
const workflow = require('./html-video/htmlVideoWorkflow');
const diagnostics = require('./html-video/diagnostics');
const rawHtmlTextPatch = require('./html-video/rawHtmlTextPatch');
const frameIdentity = require('./html-video/frameIdentity');
const templateRegistry = require('./html-video/templateRegistry');

module.exports = {
  projectStore,
  editPatchService,
  frameHtmlEditService,
  iterateService,
  layoutQaService,
  editModeService,
  projectOrchestrator,
  workflow,
  createDiagnostic: diagnostics.createDiagnostic,
  normalizeDiagnostics: diagnostics.normalizeDiagnostics,
  syncRawHtmlFrameTextPatch: rawHtmlTextPatch.syncRawHtmlFrameTextPatch,
  findFrameByAnyId: frameIdentity.findFrameByAnyId,
  createTemplateRegistry: templateRegistry.createTemplateRegistry,
};
