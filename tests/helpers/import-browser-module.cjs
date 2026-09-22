// 为纯前端领域模块保留真实相对导入关系；支持无构建的 Node 合同测试。
const fs=require('node:fs/promises');
const path=require('node:path');
async function moduleUrl(file) {
  let source=await fs.readFile(file,'utf8');
  const imports=[...source.matchAll(/import\s+([A-Za-z_$][\w$]*)\s+from\s+['"]([^'"]+\.json)['"];?/g)];
  for(const match of imports) {
    const value=JSON.parse(await fs.readFile(path.resolve(path.dirname(file),match[2]),'utf8'));
    source=source.replace(match[0],'const '+match[1]+' = '+JSON.stringify(value)+';');
  }
  const relatives=[...source.matchAll(/from\s+['"](\.[^'"]+)['"]/g)];
  for(const match of relatives) source=source.replace(match[0],'from '+JSON.stringify(await moduleUrl(path.resolve(path.dirname(file),match[1]))));
  return 'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
}
async function importBrowserModule(file){return import(await moduleUrl(path.resolve(file)));}
module.exports={importBrowserModule};
