const {randomUUID}=require('crypto');
const path=require('path');
const fs=require('fs/promises');
const store=require('./storage');
const state=require('./state');
const {ErrorType}=require('./contracts');
const jobs=require('./jobs');

class Cancelled extends Error {}
async function run(workflowId,options={}) {
  let record=await store.readWorkflow(workflowId,options.rootDir);
  store.assertContract(record);
  if(record.illustrated.operation?.status!=='queued') return {success:record.success!==false,...state.view(record)};
  const operationId=record.illustrated.operation.id;
  const update=async callback=>(await store.mutate(workflowId,options,async latest=>{
    if(latest.illustrated.operation?.id!==operationId) throw new ErrorType('STALE_OPERATION','操作版本已变化，旧结果不会覆盖当前任务。',409);
    return callback(latest);
  })).record;
  record=await update(latest=>{
    const op=latest.illustrated.operation;
    if(op.status!=='queued') throw new ErrorType('OPERATION_RUNNING','此操作正在执行，请等待。',409);
    op.status='running';op.startedAt=new Date().toISOString();state.refresh(latest);
  });
  const directory=path.join(store.mediaRoot(workflowId,options.rootDir),'work',operationId);
  const context={
    options,directory,workflowId,update,
    read:()=>store.readWorkflow(workflowId,options.rootDir),
    check:async()=>{
      const current=await store.readWorkflow(workflowId,options.rootDir);
      if(current.illustrated.operation?.id!==operationId || current.illustrated.operation.cancelRequested) throw new Cancelled();
      return current;
    },
    progress:async(message,counts)=>{
      const latest=await update(current=>{
        current.message=message;current.current_stage_message=message;
        if(counts) current.illustrated.operation.progress={...current.illustrated.operation.progress,...counts};
      });
      await options.taskContext?.emit?.({type:'stage_progress',stage:latest.current_stage,progress:latest.current_progress,message,
        data:{operation:latest.illustrated.operation.type,counts:latest.illustrated.operation.progress}});
    },
    external:async(type,inputIdentity,sceneId,invoke,receive,requestInput={})=>{
      await context.check();
      let attempt;
      const before=await update(current=>{
        if(state.pendingUnknown(current.illustrated).length) throw new ErrorType('UNKNOWN_EXTERNAL_OUTCOME','仍有外部结果待核实，不能发送新的普通重试。',409);
        attempt={id:randomUUID(),type,stage:current.illustrated.operation.stage,inputIdentity,sceneId:sceneId||'',
          status:'prepared',createdAt:new Date().toISOString(),operationId,
          settings:structuredClone(current.illustrated.operation.settings),
          requestInput:structuredClone(requestInput),
          model:structuredClone(current.illustrated.models[type==='text'?'text':type==='image'?'image':type==='tts'?'tts':'asr']),
          planIdentity:current.illustrated.plan?.identity||'',
          input:type==='text'?structuredClone(current.input):structuredClone(current.illustrated.plan?.scenes.find(scene=>scene.id===sceneId)||{})};
        current.illustrated.attempts.push(attempt);
      });
      await context.check();
      await update(current=>{
        if (current.illustrated.operation.cancelRequested) throw new Cancelled();
        Object.assign(current.illustrated.attempts.find(item=>item.id===attempt.id),{status:'requesting',startedAt:new Date().toISOString()});
      });
      let received=false;
      try {
        const response=await invoke(before,attempt);
        received=true;
        await update(async current=>{
          await receive?.(current,response);
          const item=current.illustrated.attempts.find(item=>item.id===attempt.id);
          Object.assign(item,{status:response?.error?(response.error.code==='UNKNOWN_EXTERNAL_OUTCOME'?'unknown_external_outcome':'failed'):'done',
            finishedAt:new Date().toISOString(),message:response?.error?.message||'已接收并保存结果。'});
        });
        if(response?.error) throw response.error;
        return response;
      } catch(error) {
        if (received && (!(error instanceof ErrorType) || error.code==='ARTIFACT_INVALID') && await store.workflowFileExists(workflowId,options.rootDir)) {
          error=new ErrorType('UNKNOWN_EXTERNAL_OUTCOME','外部请求已返回，但本地保存未完成。请先恢复或核实已有结果，不能普通重试重复发送。',409);
        }
        await update(current=>{
          const item=current.illustrated.attempts.find(entry=>entry.id===attempt.id);
          if(item.status==='requesting') Object.assign(item,{status:error.code==='UNKNOWN_EXTERNAL_OUTCOME'?'unknown_external_outcome':'failed',
            message:store.safeError(error).message,finishedAt:new Date().toISOString()});
        });
        throw error;
      }
    },
  };
  const heartbeat=setInterval(()=>{
    update(current=>{
      if(current.illustrated.operation?.status==='running') current.updated_at=new Date().toISOString();
    }).catch(()=>{});
  },5000);
  heartbeat.unref();
  try {
    await fs.mkdir(directory,{recursive:true});
    await options.taskContext?.emit?.({type:'stage_started',stage:record.current_stage,progress:record.current_progress,message:record.message});
    await jobs[record.illustrated.operation.type](context);
    record=await update(current=>{
      current.illustrated.operation.status=current.illustrated.operation.cancelRequested?'cancelled':'done';
      current.illustrated.operation.finishedAt=new Date().toISOString();
      current.illustrated.lastError=null;
      store.revision(current,'operation_finished');
      state.refresh(current,current.illustrated.operation.cancelRequested?'操作已停止，已收到的结果和成功片段均已保留。':undefined);
    });
  } catch(error) {
    if (!await store.workflowFileExists(workflowId, options.rootDir)) {
      const directory = store.mediaRoot(workflowId, options.rootDir);
      if (store.isPathInside(directory, path.resolve(options.rootDir || store.DEFAULT_ROOT, '.illustrated-media'))) {
        await fs.rm(directory, { recursive:true, force:true, maxRetries:5, retryDelay:200 }).catch(()=>{});
      }
      return { success:false, workflow_id:workflowId, status:'deleted', message:'任务已删除，晚到结果不会重建任务。' };
    }
    const cancelled=error instanceof Cancelled || error.code==='CANCELLED';
    record=await update(current=>{
      const op=current.illustrated.operation;op.status=cancelled?'cancelled':'failed';op.finishedAt=new Date().toISOString();
      if(cancelled) {
        current.illustrated.attempts.filter(item=>item.status==='prepared').forEach(item=>{item.status='cancelled';});
        op.progress.cancelled+=op.progress.queued;op.progress.queued=0;op.progress.running=0;
        current.illustrated.lastError=null;
      } else {
        op.progress.running=0;op.progress.cancelled+=op.progress.queued;op.progress.queued=0;
        if(!state.pendingUnknown(current.illustrated).length)op.progress.failed=Math.max(1,op.progress.failed);
        current.illustrated.lastError={...store.safeError(error),stage:op.stage};
      }
      store.revision(current,cancelled?'operation_cancelled':'operation_failed');
      state.refresh(current,cancelled?'操作已停止，成功媒体已保留。':undefined);
    });
  } finally {clearInterval(heartbeat);}
  return {...state.view(record),success:record.success!==false,workflow_id:workflowId};
}

module.exports={run};
