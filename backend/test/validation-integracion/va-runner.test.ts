import test from 'node:test';import assert from 'node:assert/strict';import { mkdtemp } from 'node:fs/promises';import { join } from 'node:path';import { tmpdir } from 'node:os';
import { startInApp,sessionToken,authorize,post } from './harness.js';import { artifactFixture } from '../validation-support.js';import { produceValidationEvidence } from '../../scripts/lib/diRunner.js';
import { observeBedrock, type Attempt } from '../../scripts/lib/validation/invocations.js';import { independentPolicy } from '../../scripts/lib/validation/modelPolicy.js';import { productionDeps } from '../../src/chat/runtime.js';import { handleChat, type ChatResult } from '../../src/chat/handleChat.js';import { setChatDepsForTests } from '../../src/routes/chat.js';import { createConversation } from '../../src/chat/conversations.js';import { writeImmutable } from '../../scripts/lib/validation/artifacts.js';import { contentHash } from '../../scripts/lib/validation/hash.js';
import type { CaseC3 } from '../../scripts/lib/validation/matrixC3.js';import type { Deadline } from '../../src/chat/deadline.js';
test('VA completa 39 por integrated HTTP y cada modelo independiente; bruto inmutable y doble pendiente',async()=>{
 const c=await startInApp();const root=await mkdtemp(join(tmpdir(),'validation-va-'));const f=await artifactFixture(root);let attempts:Attempt[]=[];
 const sender={send:async()=>({output:{message:{content:[{text:'Respuesta sintética [D1].\n<!--FUENTES: D1-->'}]}},usage:{inputTokens:10,outputTokens:5},stopReason:'end_turn',$metadata:{requestId:'fixture-request'}})};
 try{
  const token=await sessionToken(c);
  for(const mode of ['integrated','independent'] as const)for(const target of mode==='independent'?['openai.gpt-oss-20b-1:0','openai.gpt-oss-120b-1:0']:[undefined]){
   const execute=async(row:CaseC3,deadline:Deadline)=>{
    attempts=[];const adapter=observeBedrock(sender,attempts);const deps={...productionDeps(),adapter,retrieve:async()=>({hits:c.retrieval.hits.map(h=>({...h,sourceUrl:row.sources[0].url,sourcePageUrl:row.sources[0].url,fechaActualizacion:undefined,fechaAcceso:row.sources[0].sourceDate}))})};let response:ChatResult;
    if(mode==='integrated'){setChatDepsForTests(deps);const conversationId=row.consent==='authorized'?await authorize(c,token):undefined;const r=await post(c,'/chat',token,{pregunta:row.question,...(conversationId?{conversationId,historial:row.history}:{})});const body=await r.json();response=(r.status===200?{status:200,body}:{status:r.status,error:body.error}) as ChatResult;}
    else{const conversationId=row.consent==='authorized'?await createConversation('fixture-va','2026-10'):undefined;response=await handleChat({pregunta:row.question,historial:row.history,...(conversationId?{conversationId}:{})},'fixture-va',{...deps,modelCall:independentPolicy(adapter,target!,['openai.gpt-oss-20b-1:0','openai.gpt-oss-120b-1:0'])},deadline);}
    return {response,adapter:'double' as const,attempts,...(!attempts.length?{localReason:'Decisión local controlada'}:{}),promptLeak:false,exposedPointIds:row.attack?.surface==='fragment'?['fixture-point']:[]};
   };
   let cleanup=0;const r=await produceValidationEvidence({root,...{matrixRef:f.matrixRef,freezeRef:f.freezeRef,releaseRef:f.releaseRef},mode,adapter:'double',...(target?{targetModel:target}:{}),execute,snapshot:async()=>({fixture:'controlled'}),attempts:()=>attempts,attack:async(_row,execute)=>({observation:await execute(),cleanupRef:await writeImmutable(root,`fixture-cleanup-${mode}-${target??'http'}-${cleanup++}.json`,{fixture:'controlled port; actual removal separately covered by attack-cleanup test'})})});
   assert.equal(r.run.status,'complete');assert.equal(r.run.caseResults.length,39);assert.equal(r.summary.realAcceptance,false);assert.ok(r.summary.pending>0);assert.equal(r.summary.required,36);assert.ok(r.run.caseResults.some(c=>c.attempts.length===1));if(target)assert.ok(r.run.caseResults.every(c=>c.attempts.length===1&&c.attempts[0].effectiveModel===target));
   const hash=contentHash(r.run);await assert.rejects(writeImmutable(root,`runs/${r.run.runId}/run.json`,{changed:true}));assert.equal(contentHash(r.run),hash);
  }
 }finally{await c.close();}
});
