// 仅供 OpenDesign 本地预览：只读设计目录，不暴露应用数据或工作流文件。
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../../opendesign');
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8',
  '.json':'application/json; charset=utf-8','.md':'text/plain; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.mp4':'video/mp4'};
const server=http.createServer((req,res)=>{
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
  let pathname;
  try{pathname=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);}catch{res.writeHead(400);res.end();return;}
  if(!pathname.startsWith('/opendesign/')){res.writeHead(404);res.end();return;}
  const relative=pathname.slice('/opendesign/'.length)||'index.html';
  const target=path.resolve(root,relative),boundary=path.relative(root,target);
  if(boundary.startsWith('..')||path.isAbsolute(boundary)||!types[path.extname(target)]){res.writeHead(404);res.end();return;}
  fs.realpath(target,(error,actual)=>{
    if(error||!actual.startsWith(root+path.sep)){res.writeHead(404);res.end();return;}
    fs.stat(actual,(error,stat)=>{
      if(error||!stat.isFile()){res.writeHead(404);res.end();return;}
      let start=0,end=stat.size-1,status=200;
      const range=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range||'');
      if(range){start=Number(range[1]);end=range[2]?Math.min(end,Number(range[2])):end;status=206;}
      if(start>end||start>=stat.size){res.writeHead(416);res.end();return;}
      const headers={'Content-Type':types[path.extname(target)],'Content-Length':end-start+1,'Accept-Ranges':'bytes','X-Content-Type-Options':'nosniff'};
      if(status===206)headers['Content-Range']='bytes '+start+'-'+end+'/'+stat.size;
      res.writeHead(status,headers);
      if(req.method==='HEAD'){res.end();return;}
      fs.createReadStream(actual,{start,end}).on('error',()=>res.destroy()).pipe(res);
    });
  });
});
server.on('error',error=>{console.error(error.code==='EADDRINUSE'?'8289 端口已被占用，未停止现有服务。':'设计预览启动失败。');process.exitCode=1;});
server.listen(8289,'127.0.0.1',()=>console.log('OpenDesign: http://127.0.0.1:8289/opendesign/mockups/illustrated-narration/index.html'));
