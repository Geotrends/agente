// Synthetic API responses: no real accounts, documents or mutations.
const date='2026-10-19T15:30:00Z';
const long='https://ejemplo.gov.co/tramites/solicitud-de-aprovechamiento-forestal-y-autorizaciones/expediente-2026-000001';
export const docs=Array.from({length:35},(_,i)=>({id:String(i),revision:'1',codigo:'GT-P-'+String(i).padStart(3,'0'),nombre:'Procedimiento de aprovechamiento forestal y autorización ambiental '+i,tipo:'Procedimiento',direccion:'Gestión Ambiental',enlace:long,estado:'Publicado',version:'1.0',fechaActualizacion:date,formatoOriginal:'PDF',usoOcr:'No',fechaCarga:date,procedimientoOrigen:'GT-P-004',origen:'scraper',autor:null,validoHasta:'2027-10-19',sinActualizacionAutomatica:false,candidata:null}));
export const account={id:'1',nombre:'Persona de prueba',email:'persona.muy.larga.de.prueba@ejemplo.gov.co',perfil:'administrador técnico',activa:true,cambioObligatorio:false,revision:'1'};
export const notice={id:'1',origen:'kb',type:'verificacion_fallida',description:'No fue posible verificar el documento '+long,state:'no_revisada',firstAt:date,lastAt:date,repetitions:123,reviewedBy:null,reviewedAt:null,scope:'sistema',revision:'1'};
const model={modelo:'openai.gpt-oss-120b-1:0',consultas:10000,autorizadas:9900,anonimas:100,tokensEntrada:10000000,tokensSalida:3000000,costoTotal:'25.3600',consultasSinCosto:0,costoParcial:false};
const list=(items: any[])=>({items,total:items.length,nextCursor:null});
const mode: string='normal';
export function apiFixture(url: URL): any{const p=url.pathname.replace('/api/admin','');const rango={from:'2026-09-20',to:'2026-10-19'};
 if(p==='/session')return {cuenta:account,mustChangePassword:false,csrfToken:'synthetic'};
 if(p==='/counters')return {notifications:2,pending:35,openImprovements:3};
 if(p==='/documents') { const matching = url.searchParams.get('id') ? docs.filter(d => d.id === url.searchParams.get('id')) : url.searchParams.get('search') ? docs.filter(d => d.nombre.toLowerCase().includes(url.searchParams.get('search')!.toLowerCase())) : docs; const page = Number(url.searchParams.get('page') ?? 1), size = Number(url.searchParams.get('limit') ?? 15); return { items: matching.slice((page - 1) * size, page * size), total: matching.length, nextCursor: null }; }
 if(p==='/accounts')return list([account,{...account,id:'2',email:'segunda.persona@ejemplo.gov.co'}]);
 if(p==='/status')return {componentes:['gpt-oss-20b','gpt-oss-120b','reranker','registro','scraper'].map(component=>({component,status:'normal',lastSuccessAt:date,lastFailureAt:null,safeReason:'Operación normal'})),reindexacion:null};
 if(p==='/notifications')return {...list([notice,{...notice,id:'2'}]),noRevisadas:2};
 if(p==='/pending')return list([{tipo:'documento',id:'1',nombre:docs[0].nombre,origen:'Manual',fecha:date,dias:15}]);
 if(p==='/scraper-links')return {items:[{id:'1',url:long,fuente:'Portal ambiental',direccion:'Gestión Ambiental',justificacion:'Fuente oficial con procedimientos ambientales.',revision:'1',cambiadoPor:'Persona de prueba',cambiadoEn:date}],listRevision:'1'};
 if(p==='/link-proposals')return list([{id:'1',tipo:'add',url:long,direccion:'Gestión Ambiental',justificacion:'Incorporar el procedimiento publicado.',estado:'Pendiente de validación',creadaEn:date,propietario:{id:'1',nombre:'Persona de prueba'},decididaPor:null,decididaEn:null,motivoRechazo:null,revision:'1'}]);
 if(p==='/audit')return list([{id:'1',actor:{id:'1',nombre:'Persona de prueba',rol:'administrador técnico'},accion:'documento.editar_metadata',objeto:'documento',objetoId:'123',resultado:'ok',fecha:date}]);
 if(p==='/interactions')return list([{fechaHora:date,categoria:'Gestión Ambiental',pregunta:'¿Cómo solicito un permiso de aprovechamiento forestal?',respuesta:'Para solicitar el permiso debe presentar una solicitud y aportar los documentos requeridos. '.repeat(15),tipo:'respondida',documentosCitados:[{nombre:docs[0].nombre,enlace:long,fecha:date}],modelo:model.modelo,valoracion:'Útil',motivo:null,disponibilidad:'disponible'}]);
 if(p==='/improvements')return {...list([{id:'1',fecha:date,categoria:'Gestión Ambiental',origenes:['sin información'],tipoFallo:null,estado:'Registrada',antiguedadDias:1,revision:'1',hallazgoRef:null}]),abiertos:1};
 if(p==='/tariffs')return {items:[{modelo:model.modelo,region:'us-east-1',moneda:'USD',version:'1',inputPerMillion:'0.1500',outputPerMillion:'0.6000',vigenteDesde:date,fuente:long}],faltantes:[]};
 if(p==='/contacts')return {revision:1,recepcion:{pqrsd:long,whatsapp:'3001234567',email:'ejemplo@ejemplo.gov.co'},general:{phone:'6041234567',email:'ejemplo@ejemplo.gov.co',url:long},inmediatos:[{id:'1',name:'Atención ambiental',description:'Atención de incidentes',type:'teléfono',value:'6041234567',position:1}]};
 if(p==='/metrics/usage')return {rango,total:100,autorizadas:90,anonimas:10,porDia:[{dia:'2026-10-19',consultas:100}],porCategoria:[{categoria:'Gestión Ambiental',consultas:90}],porTipo:[{tipo:'respondida',consultas:90}],nota:'Datos sintéticos para revisión UX.'};
 if(p==='/metrics/documents')return {rango,respuestasConCitas:90,ranking:[{posicion:1,nombre:docs[0].nombre,direccion:'Gestión Ambiental',citas:90}],anonymousCoverage:'No disponible',nota:'Datos sintéticos.'};
 if(p==='/metrics/ratings')return {rango,total:100,util:90,noUtil:10,porcentajeUtil:90,porcentajeNoUtil:10,motivos:[{motivo:'Información incompleta',cantidad:10}],nota:'Datos sintéticos.'};
 if(p==='/metrics/consumption')return {rango,modelos:[model],rutaLocal:{...model,consultas:10},total:model,nota:'Datos sintéticos.'};
 return {};
}
