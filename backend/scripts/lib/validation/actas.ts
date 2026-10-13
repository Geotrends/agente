import { object, ref, sha, text, list, enumeration, person, instant, fail, type ArtifactRef, type PersonRef } from './types.js';
import { readArtifact } from './artifacts.js';
import { contentHash } from './hash.js';
export type ActaReceipt = {
    signedFileRef: ArtifactRef;
    reportHash: string;
    matrixVersion: string;
    validatedModels?: string[];
    chatbotVersion?: string;
    signatories: {
        party: 'supervisión' | 'Geotrends';
        person: PersonRef;
        signedAt: string;
    }[];
    verifiedBy: PersonRef;
    verifiedAt: string;
    signatureEvidenceRef: ArtifactRef;
};
export function validateActa(value: unknown, context: {
    milestone: 'H5-C3' | 'H4-C4';
    ready: boolean;
    reportHash: string;
    matrixVersion: string;
    models: string[];
    chatbotVersion: string;
    lastFinishedAt: string;
}): ActaReceipt {
    const o = object(value, ['signedFileRef', 'reportHash', 'matrixVersion', 'validatedModels', 'chatbotVersion', 'signatories', 'verifiedBy', 'verifiedAt', 'signatureEvidenceRef'], ['signedFileRef', 'reportHash', 'matrixVersion', 'signatories', 'verifiedBy', 'verifiedAt', 'signatureEvidenceRef']);
    ref(o.signedFileRef);
    sha(o.reportHash);
    text(o.matrixVersion);
    person(o.verifiedBy);
    instant(o.verifiedAt);
    ref(o.signatureEvidenceRef);
    if (!context.ready || o.reportHash !== context.reportHash || o.matrixVersion !== context.matrixVersion)
        fail('acta_package');
    const signatures = list(o.signatories, 2).map(v => { const s = object(v, ['party', 'person', 'signedAt']); enumeration(s.party, ['supervisión', 'Geotrends']); person(s.person); instant(s.signedAt); if (Date.parse(String(s.signedAt)) <= Date.parse(context.lastFinishedAt) || Date.parse(String(s.signedAt)) > Date.parse(String(o.verifiedAt)))
        fail('signature_time'); return s; });
    if (signatures.length !== 2 || new Set(signatures.map(s => s.party)).size !== 2 || Date.parse(String(o.verifiedAt)) > Date.now())
        fail('signature_parties_or_verification');
    if (context.milestone === 'H5-C3') {
        if (o.chatbotVersion !== undefined || contentHash(list(o.validatedModels).map(text).sort()) !== contentHash([...context.models].sort()))
            fail('acta_models');
    }
    else if (o.validatedModels !== undefined || text(o.chatbotVersion) !== context.chatbotVersion)
        fail('acta_chatbot_version');
    return o as unknown as ActaReceipt;
}
export async function verifyActa(root: string, value: unknown, context: Parameters<typeof validateActa>[1]): Promise<ActaReceipt> { const receipt = validateActa(value, context); await readArtifact(root, receipt.signedFileRef); await readArtifact(root, receipt.signatureEvidenceRef); return receipt; }
export function draftActa(milestone: string, matrixVersion: string, reportRef: ArtifactRef): string { return `# Borrador de acta ${milestone}\n\nPendiente de revisión y firmas humanas de supervisión y Geotrends.\n\nMatriz: ${matrixVersion}. Informe: ${reportRef.path}; SHA256 ${reportRef.sha256}.\n\nLa declaración de recepción conforme solo procede tras verificar las puertas y los originales firmados.\n`; }
