/**
 * Episodios de falla del registro (RF-C3-IN-08).
 *
 * Un episodio abre con la PRIMERA escritura fallida tras un éxito (o el arranque) y cierra con el
 * primer éxito siguiente. Avisa una sola vez (fecha, hora y modo, jamás texto) y un segundo
 * episodio es una identidad operativa nueva aunque el aviso anterior siga sin revisar. El
 * identificador es aleatorio y no se relaciona con ninguna consulta, conversación, IP ni token.
 *
 * Todo vive en memoria: una caída del proceso pierde el buffer y no se promete recuperarlo ni
 * entregarlo exactamente una vez a través de reinicios.
 */
import { randomUUID } from "node:crypto";

export type RegistryMode = "conversación" | "anónima";

export type RegistryEpisode = {
  /** Identidad operativa aleatoria; agrupa el aviso del panel, no a un ciudadano. */
  episodeId: string;
  firstFailureAt: Date;
  mode: RegistryMode;
  state: "abierto" | "cerrado";
  aviso: "pendiente" | "persistido";
  recoveredAt?: Date;
};

export type SuccessInfo = {
  /** Episodio que este éxito acaba de cerrar, si lo había. */
  recovered?: RegistryEpisode;
  /** true en el primer éxito del proceso o al cerrar un episodio: el estado pasa a «normal». */
  becameNormal: boolean;
};

export class EpisodeTracker {
  private episode: RegistryEpisode | undefined;
  private seenSuccess = false;

  /** Registra una falla. Devuelve true solo si abre un episodio nuevo (el único que avisa). */
  failure(mode: RegistryMode = "conversación", at: Date = new Date()): boolean {
    if (this.episode?.state === "abierto") return false;
    this.episode = { episodeId: randomUUID(), firstFailureAt: at, mode, state: "abierto", aviso: "pendiente" };
    return true;
  }

  /** Registra un éxito: cierra el episodio abierto y reporta si el estado vuelve a normal. */
  success(at: Date = new Date()): SuccessInfo {
    const open = this.episode?.state === "abierto" ? this.episode : undefined;
    if (open) { open.state = "cerrado"; open.recoveredAt = at; }
    const becameNormal = !!open || !this.seenSuccess;
    this.seenSuccess = true;
    return { recovered: open, becameNormal };
  }

  /** Solo pruebas: vuelve al estado inicial del proceso. */
  reset(): void { this.episode = undefined; this.seenSuccess = false; }

  /** Episodio en curso (abierto), si lo hay. */
  get current(): RegistryEpisode | undefined {
    return this.episode?.state === "abierto" ? this.episode : undefined;
  }

  get inEpisode(): boolean { return this.episode?.state === "abierto"; }

  markPersisted(episodeId: string): void {
    if (this.episode?.episodeId === episodeId) this.episode.aviso = "persistido";
  }
}

export const writeEpisodes = new EpisodeTracker();

/** `AAAA-MM-DD HH:MM:SS` en hora de Colombia (UTC−5, sin horario de verano). */
export function colombiaTime(d: Date): string {
  const t = new Date(d.getTime() - 5 * 3_600_000);
  return `${t.toISOString().slice(0, 10)} ${t.toISOString().slice(11, 19)}`;
}

/** Descripción segura del aviso: fecha, hora y modo; nunca texto de consulta. */
export function describeEpisode(e: Pick<RegistryEpisode, "firstFailureAt" | "mode">): string {
  return `No se pudo escribir el registro de consultas (modo ${e.mode}) el ${colombiaTime(e.firstFailureAt)} hora de Colombia. `
    + "Las respuestas siguen entregándose; el registro se retoma al primer éxito.";
}
