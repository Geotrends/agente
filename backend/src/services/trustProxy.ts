/**
 * Interpretación segura de TRUST_PROXY (RNF-C3-IN-05).
 *
 * Express da semánticas distintas a un número y a una cadena: `app.set("trust proxy", "1")` NO es
 * «confiar en un salto» sino una lista con la dirección «1», y la IP de todos los clientes pasa a
 * ser la del proxy. Aquí el valor se analiza una vez y se entrega ya tipado:
 *
 *  - vacío              → sin proxy de confianza (`req.ip` es la del socket);
 *  - entero 1..10       → número de saltos confiables (el último proxy lee la IP real, los
 *                         encabezados que añada el cliente a la izquierda se ignoran);
 *  - lista de IP/CIDR   → exactamente esos proxies (también `loopback`, `linklocal`, `uniquelocal`).
 *
 * Se rechaza «confiar en todos» (`true`, `*`, `0.0.0.0/0`, `::/0`): permitiría suplantar la IP y
 * evadir el límite de 60 consultas por minuto con solo cambiar una cabecera.
 */
export type TrustProxy = false | number | string[];

export type TrustProxyResult = { value: TrustProxy; problems: string[] };

const KEYWORDS = new Set(["loopback", "linklocal", "uniquelocal"]);
const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}(?:\/(?:\d|[12]\d|3[0-2]))?$/;
const IPV6 = /^[0-9a-f:]+(?:\/(?:\d{1,2}|1[01]\d|12[0-8]))?$/i;
const ALL = new Set(["true", "*", "0.0.0.0/0", "::/0", "0.0.0.0", "::"]);

function validIpv4(entry: string): boolean {
  const [addr] = entry.split("/");
  return addr.split(".").every(o => Number(o) >= 0 && Number(o) <= 255);
}

export function parseTrustProxy(raw: string | undefined): TrustProxyResult {
  const text = raw?.trim() ?? "";
  if (!text) return { value: false, problems: [] };
  if (/^\d+$/.test(text)) {
    const hops = Number(text);
    if (hops < 1 || hops > 10) return { value: false, problems: ["TRUST_PROXY debe ser un número de saltos entre 1 y 10"] };
    return { value: hops, problems: [] };
  }
  const entries = text.split(",").map(e => e.trim()).filter(Boolean);
  const problems: string[] = [];
  const accepted: string[] = [];
  for (const entry of entries) {
    const lower = entry.toLowerCase();
    if (ALL.has(lower)) { problems.push("TRUST_PROXY no puede confiar en todos los proxies"); continue; }
    if (KEYWORDS.has(lower)) { accepted.push(lower); continue; }
    if ((IPV4.test(entry) && validIpv4(entry)) || (entry.includes(":") && IPV6.test(entry))) { accepted.push(entry); continue; }
    problems.push("TRUST_PROXY contiene una entrada que no es un número de saltos, una IP/CIDR ni una palabra clave de Express");
  }
  return { value: problems.length ? false : accepted, problems: [...new Set(problems)] };
}
