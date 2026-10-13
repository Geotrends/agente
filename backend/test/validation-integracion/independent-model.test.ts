import test from 'node:test';import assert from 'node:assert/strict';
import { Deadline } from '../../src/chat/deadline.js';import { handleChat, type ChatDeps } from '../../src/chat/handleChat.js';
import { callWithRouting } from '../../src/chat/modelRouting.js';import { resetCircuits } from '../../src/services/circuitBreaker.js';import { ModelError } from '../../src/bedrock/askBedrock.js';
import { independentPolicy } from '../../scripts/lib/validation/modelPolicy.js';import { observeBedrock } from '../../scripts/lib/validation/invocations.js';
import { startInApp } from './harness.js';
import { productionDeps } from '../../src/chat/runtime.js';
const small='openai.gpt-oss-20b-1:0',large='openai.gpt-oss-120b-1:0';
const req={system:'No copiar prompt al reporte',pregunta:'¿Cómo registro una mascota?',historial:[]};
test('independiente una tentativa sin respaldo; routing normal conserva sus dos tentativas',async()=>{
 resetCircuits();const calls:string[]=[];const adapter={call:async(id:string)=>{calls.push(id);throw new ModelError('network',true,'red');}};const deadline=new Deadline();
 try{await assert.rejects(independentPolicy(adapter,large,[small,large])(req,deadline));assert.deepEqual(calls,[large]);calls.length=0;await assert.rejects(callWithRouting(adapter,req,deadline));assert.deepEqual(calls,[small,large]);}finally{deadline.dispose();resetCircuits();}
});
test('independiente cancelable incluso si el sender ignora señal; modelo fuera de lista rechazado',async()=>{
 const deadline=new Deadline(4000);try{const adapter={call:async()=>new Promise<never>(()=>{})};assert.throws(()=>independentPolicy(adapter,'unknown',[small,large]));const p=independentPolicy(adapter,small,[small,large])(req,deadline);deadline.context.abort(new Error("cancelled"));await assert.rejects(p);}finally{deadline.dispose();}
});
test('captura SDK solo identidad/uso/ID: no conserva cuerpo/prompt/razonamiento',async()=>{
 const attempts:import('../../scripts/lib/validation/invocations.js').Attempt[]=[];
 const adapter=observeBedrock({send:async()=>({output:{message:{content:[{text:'Respuesta [D1].\n<!--FUENTES: D1-->'},{reasoningContent:'secreto'}]}},usage:{inputTokens:10,outputTokens:5},stopReason:'end_turn',$metadata:{requestId:'request-1'}})},attempts);
 const deadline=new Deadline();try{await independentPolicy(adapter,large,[small,large])(req,deadline);assert.equal(attempts.length,1);assert.equal(attempts[0].effectiveModel,large);assert.equal(attempts[0].requestId,'request-1');assert.ok(!JSON.stringify(attempts).includes(req.system));assert.ok(!JSON.stringify(attempts).includes('secreto'));}finally{deadline.dispose();}
});
test('handleChat local cero intentos y puerto independiente usa contactos/registro reales del harness',async()=>{
 const c=await startInApp();const deadline=new Deadline();let calls=0;
 try{const deps:ChatDeps={...productionDeps(),retrieve:async()=>({hits:[]}),modelCall:async()=>{calls++;throw new Error('should not call');}};
 const r=await handleChat({pregunta:'¿Qué requisitos tiene la poda?',historial:[]},'fixture',deps,deadline);assert.equal(r.status,200);assert.equal(calls,0);assert.equal(c.counters.modelCalls,0);assert.equal((await c.db.migrator.query('SELECT count(*)::int n FROM chat.anonymous_usage')).rows[0].n,1);
 }finally{deadline.dispose();await c.close();}
});
test('handleChat generado atraviesa el puerto privado una vez, sin usar adapter de routing',async()=>{
 const c=await startInApp();const deadline=new Deadline();let sent=0,routed=0;const attempts:import('../../scripts/lib/validation/invocations.js').Attempt[]=[];
 try{const adapter=observeBedrock({send:async()=>{sent++;const e=new Error('fallo sintético');e.name='ThrottlingException';throw e;}},attempts);
 const deps:ChatDeps={...productionDeps(),retrieve:async()=>({hits:c.retrieval.hits}),adapter:{call:async()=>{routed++;throw new Error('routing should not run');}},modelCall:independentPolicy(adapter,large,[small,large])};
 const result=await handleChat({pregunta:'¿Cómo registro mi mascota en el RUM?',historial:[]},'fixture',deps,deadline);assert.equal(result.status,503);assert.equal(sent,1);assert.equal(routed,0);assert.equal(attempts.length,1);assert.equal(attempts[0].sentModel,large);assert.equal(attempts[0].effectiveModel,null);assert.equal(attempts[0].errorCode,'throttle');
 }finally{deadline.dispose();await c.close();}
});
