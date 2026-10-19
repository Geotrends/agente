/**
 * Contrato ejecutable de la política IAM del servicio (RNF-C3-IN-07/08).
 *
 * La identidad de la aplicación (usuario IAM) puede ejecutar UNA acción —`bedrock:InvokeModel`— sobre DOS recursos: los
 * ARN `foundation-model` exactos de gpt-oss-20b y gpt-oss-120b en la región configurada. Sin
 * comodines, sin streaming (`InvokeModelWithResponseStream`), sin perfiles de inferencia ni
 * regionales, sin `NotAction`/`NotResource`. `evaluate` reproduce la evaluación de AWS sobre las
 * políticas de identidad: denegación por omisión, `Deny` explícito prevalece.
 */
export type PolicyStatement = {
  Sid?: string;
  Effect: "Allow" | "Deny";
  Action?: string | string[];
  NotAction?: string | string[];
  Resource?: string | string[];
  NotResource?: string | string[];
  Condition?: unknown;
};
export type PolicyDocument = { Version?: string; Statement: PolicyStatement | PolicyStatement[] };

const list = (v: string | string[] | undefined): string[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

const globToRegExp = (glob: string): RegExp =>
  new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`, "i");

export const statements = (doc: PolicyDocument): PolicyStatement[] => (Array.isArray(doc.Statement) ? doc.Statement : [doc.Statement]);

/** Evaluación de una acción sobre un recurso con una o varias políticas (unión de identidad). */
export function evaluate(docs: PolicyDocument[], action: string, resource: string): "allow" | "deny" | "implicit_deny" {
  let allowed = false;
  for (const doc of docs) {
    for (const s of statements(doc)) {
      const actionMatch = s.NotAction !== undefined
        ? !list(s.NotAction).some(a => globToRegExp(a).test(action))
        : list(s.Action).some(a => globToRegExp(a).test(action));
      const resourceMatch = s.NotResource !== undefined
        ? !list(s.NotResource).some(r => globToRegExp(r).test(resource))
        : list(s.Resource).some(r => globToRegExp(r).test(resource));
      if (!actionMatch || !resourceMatch) continue;
      if (s.Effect === "Deny") return "deny";
      if (s.Effect === "Allow" && s.Condition === undefined) allowed = true;
    }
  }
  return allowed ? "allow" : "implicit_deny";
}

export const requiredArns = (region: string, models: readonly string[]): string[] =>
  models.map(m => `arn:aws:bedrock:${region}::foundation-model/${m}`);

/** Problemas de una política frente al contrato (vacío = cumple). Solo nombres y rutas, nunca valores sensibles. */
export function checkContract(doc: PolicyDocument, region: string, models: readonly string[]): string[] {
  const problems: string[] = [];
  const expected = requiredArns(region, models);
  const allows = statements(doc).filter(s => s.Effect === "Allow");
  if (allows.length !== 1) problems.push(`debe haber exactamente un Allow (hay ${allows.length})`);
  for (const s of statements(doc)) {
    if (s.NotAction !== undefined || s.NotResource !== undefined) problems.push("NotAction/NotResource no se admiten");
    if (s.Condition !== undefined) problems.push("Condition no se admite en el contrato base");
  }
  const s = allows[0];
  if (s) {
    const actions = list(s.Action);
    if (actions.length !== 1 || actions[0] !== "bedrock:InvokeModel") problems.push("la única acción debe ser bedrock:InvokeModel");
    const resources = list(s.Resource);
    if (resources.some(r => r.includes("*"))) problems.push("los recursos no admiten comodines");
    if (resources.some(r => !r.startsWith("arn:aws:bedrock:") || !r.includes("::foundation-model/"))) {
      problems.push("solo ARN foundation-model (sin perfiles de inferencia ni regionales)");
    }
    const sorted = [...resources].sort();
    if (JSON.stringify(sorted) !== JSON.stringify([...expected].sort())) problems.push(`los recursos deben ser exactamente los ${expected.length} ARN de los modelos en ${region}`);
  }
  return problems;
}
