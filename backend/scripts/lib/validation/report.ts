import {assessPackage,type MilestonePackage} from './packages.js';
import {writeImmutable,writeTextImmutable} from './artifacts.js';
import {draftActa} from './actas.js';
export function renderReport(assessment:Awaited<ReturnType<typeof assessPackage>>):string {
 const {input,gates}=assessment;
 const esc=(v:string)=>v.replaceAll('|','\\|').replaceAll('\n',' ');
 const reference=(r:{path:string;sha256:string})=>`${esc(r.path)} (${r.sha256})`;
 return `# Informe ${input.milestone}\n\nEstado: ${assessment.ready?'ready-for-signature':'draft'}. No acredita firmas.\n\n`+
 `Release: ${reference(input.releaseRef)}.\nMatriz: ${reference(input.matrixRef)}.\nHallazgos: ${reference(input.findingsRef)}.\nAjustes: ${reference(input.adjustmentsRef)}.\n\n`+
 '| Requisito/puerta | Veredicto | Motivo | Evidencia |\n|---|---|---|---|\n'+
 gates.map(g=>`| ${esc(g.requirementId)} | ${g.verdict} | ${esc(g.reason)} | ${g.evidenceRefs.map(reference).join('; ')} |`).join('\n')+
 '\n\n| Corrida | Modo/modelo | Adaptador | N | Aprobados/fallos/pendientes | Mínimo | Protegidos 100% | Bruto/retiro |\n|---|---|---|---|---|---|---|---|\n'+
 assessment.runSummaries.map(r=>`| ${esc(r.runId)} | ${esc(r.mode+' / '+(r.targetModel??'integrado/funcional'))} | ${r.adapter} | ${r.summary.total} | ${r.summary.passed}/${r.summary.failed}/${r.summary.pending} | ${r.summary.required} | ${r.summary.protectedPassed} | ${reference(r.ref)}; ${r.cleanupRefs.map(reference).join('; ')} |`).join('\n')+
 '\n\nVerificaciones compartidas: '+input.sharedVerificationRefs.map(reference).join('; ')+'\n';
}
export async function generateReport(root:string,value:unknown,output:string){
 const assessment=await assessPackage(root,value),{input,gates}=assessment;
 const reportRef=await writeTextImmutable(root,output+'/informe.md',renderReport(assessment));
 const pkg:MilestonePackage={schemaVersion:1,id:input.id,milestone:input.milestone,releaseRef:input.releaseRef,matrixRef:input.matrixRef,latestRunRefs:assessment.latestRunRefs,findingsRef:input.findingsRef,adjustmentsRef:input.adjustmentsRef,sharedVerificationRefs:input.sharedVerificationRefs,reportRef,gateVerdicts:gates,status:assessment.ready?'ready-for-signature':'draft'};
 const packageRef=await writeImmutable(root,output+'/expediente.json',pkg);
 const inputRef=await writeImmutable(root,output+'/insumos.json',input);
 await writeTextImmutable(root,output+'/acta-borrador.md',draftActa(input.milestone,assessment.matrixVersion,reportRef));
 return {assessment,pkg,packageRef,inputRef};
}
