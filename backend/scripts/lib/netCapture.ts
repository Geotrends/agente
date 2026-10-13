/**
 * Captura de destinos de red para la prueba de tráfico (RNF-C3-DI-02). Se instala sobre
 * `net.Socket.connect`, así que ve HTTP, HTTPS (TLS) y PostgreSQL por igual. Solo guarda
 * host:puerto y un contador; jamás el contenido, las cabeceras ni las credenciales.
 */
import net from "node:net";

export type Destination = { host: string; port: number; count: number };

const INFRA_DEFAULT = ["localhost", "127.0.0.1", "::1"];
/** Credenciales temporales del rol: metadatos de la instancia y STS/SSO de AWS. */
const CREDENTIAL_HOSTS = [/^169\.254\.169\.254$/, /^sts(\.[a-z0-9-]+)?\.amazonaws\.com$/, /^sso(\.[a-z0-9-]+)?\.amazonaws\.com$/, /^portal\.sso\.[a-z0-9-]+\.amazonaws\.com$/];

export function bedrockHost(region: string): string { return `bedrock-runtime.${region}.amazonaws.com`; }

export type Classification = "bedrock" | "credenciales" | "infraestructura" | "NO_AUTORIZADO";

export function classify(host: string, region: string, infraHosts: string[] = []): Classification {
  if (host === bedrockHost(region)) return "bedrock";
  if (CREDENTIAL_HOSTS.some(re => re.test(host))) return "credenciales";
  if ([...INFRA_DEFAULT, ...infraHosts].includes(host)) return "infraestructura";
  return "NO_AUTORIZADO";
}

export class NetCapture {
  private readonly seen = new Map<string, Destination>();
  private original: typeof net.Socket.prototype.connect | undefined;

  start(): void {
    if (this.original) return;
    const proto = net.Socket.prototype;
    this.original = proto.connect;
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    proto.connect = function patched(this: net.Socket, ...args: unknown[]) {
      // net.connect() entrega los argumentos ya normalizados como [opciones, callback].
      const first = Array.isArray(args[0]) ? (args[0] as unknown[])[0] : args[0];
      let host = "desconocido"; let port = 0;
      if (first && typeof first === "object") { const o = first as { host?: string; port?: number; path?: string }; host = o.host ?? (o.path ? `unix:${o.path}` : "localhost"); port = Number(o.port ?? 0); }
      else if (typeof first === "number") { port = first; host = typeof args[1] === "string" ? (args[1] as string) : "localhost"; }
      const key = `${host}:${port}`;
      const e = self.seen.get(key) ?? { host, port, count: 0 };
      e.count++;
      self.seen.set(key, e);
      return (self.original as (...a: unknown[]) => net.Socket).apply(this, args);
    } as typeof proto.connect;
  }

  stop(): void {
    if (this.original) net.Socket.prototype.connect = this.original;
    this.original = undefined;
  }

  destinations(region: string, infraHosts: string[] = []): Array<Destination & { clase: Classification }> {
    return [...this.seen.values()].map(d => ({ ...d, clase: classify(d.host, region, infraHosts) })).sort((a, b) => b.count - a.count);
  }
}
