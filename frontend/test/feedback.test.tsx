/** T063 (RF-C4-UI-06, RF-C4-IN-05): controles, estados y garantías de la valoración (componentes). */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import ChatPanel from "../chat/ChatPanel";
import { clearSessionToken } from "../shared/session";
import { MOTIVOS } from "../shared/feedbackContracts";
import { ask, CONFIG, installFetch, json, UUID } from "./helpers/panel";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

type Rating = { responseId: string; valoracion: string; motivo?: string };

function setup(opts: { ratings?: (n: number, body: Rating) => Response | Promise<Response>; withIds?: boolean } = {}) {
  const ratings: Rating[] = [];
  let chats = 0;
  const base = installFetch((_n, body) => {
    chats++;
    // Anónimo: la API no devuelve identificadores (contrato coherente con la solicitud).
    if (typeof body.conversationId !== "string") return json({ modo: "anónima", tipo: "respondida", respuesta: `Respuesta ${chats}`, fuentes: [] });
    return json({
      modo: "conversación", conversationId: UUID,
      ...(opts.withIds === false ? {} : { responseId: `00000000-0000-4000-8000-00000000000${chats}` }),
      tipo: "respondida", respuesta: `Respuesta ${chats}`, fuentes: [],
    });
  });
  const inner = globalThis.fetch as unknown as (u: string, i?: RequestInit) => Promise<Response>;
  vi.stubGlobal("fetch", vi.fn(async (u: string, i?: RequestInit) => {
    if (String(u).endsWith("/ratings")) {
      const b = JSON.parse(String(i?.body)) as Rating;
      ratings.push(b);
      const n = ratings.length;
      return opts.ratings ? opts.ratings(n, b) : json({ responseId: b.responseId, registrada: true }, 201);
    }
    return inner(u, i);
  }));
  return { ratings, base };
}

async function open(mode: "Autorizo" | "No autorizo") {
  clearSessionToken();
  render(createElement(ChatPanel));
  await screen.findByText(/Soy Geobot/);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: mode })); });
  await screen.findByRole("button", { name: "No estoy seguro" });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "No estoy seguro" })); });
}
const click = async (name: string | RegExp) => { await act(async () => { fireEvent.click(screen.getByRole("button", { name })); }); };

describe("elegibilidad", () => {
  it("autorizado con responseId: controles Útil / No útil", async () => {
    setup();
    await open("Autorizo");
    await ask("consulta"); await screen.findByText("Respuesta 1");
    expect(screen.getByRole("button", { name: "Útil" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "No útil" })).toBeTruthy();
  });
  it("tres respuestas anónimas: ningún control ni elemento oculto enfocable", async () => {
    setup();
    await open("No autorizo");
    for (let i = 1; i <= 3; i++) { await ask(`c${i}`); await screen.findByText(`Respuesta ${i}`); }
    expect(screen.queryByRole("group", { name: /Valorar/ })).toBeNull();
    expect(document.querySelectorAll(".feedback, [aria-label*='Valorar']")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /Útil/ })).toBeNull();
  });
  it("autorizada pero sin responseId (fallo de registro): contenido normal y cero controles", async () => {
    setup({ withIds: false });
    await open("Autorizo");
    await ask("consulta"); await screen.findByText("Respuesta 1");
    expect(screen.queryByRole("button", { name: /Útil/ })).toBeNull();
  });
  it("seis variantes IN-05: 2 identificadas valoradas, 2 sin ID, 2 anónimas (las 4 últimas sin controles)", async () => {
    const s = setup();
    await open("Autorizo");
    for (let i = 1; i <= 2; i++) {
      await ask(`id${i}`); await screen.findByText(`Respuesta ${i}`);
    }
    const utiles = screen.getAllByRole("button", { name: "Útil" });
    expect(utiles).toHaveLength(2);
    await act(async () => { fireEvent.click(utiles[0]); });
    await waitFor(() => expect(s.ratings).toHaveLength(1));
    cleanup();
    const sinId = setup({ withIds: false });
    await open("Autorizo");
    for (let i = 1; i <= 2; i++) { await ask(`s${i}`); await screen.findByText(`Respuesta ${i}`); }
    expect(screen.queryByRole("button", { name: /Útil/ })).toBeNull();
    expect(sinId.ratings).toHaveLength(0);
    cleanup();
    const anon = setup();
    await open("No autorizo");
    for (let i = 1; i <= 2; i++) { await ask(`a${i}`); await screen.findByText(`Respuesta ${i}`); }
    expect(screen.queryByRole("button", { name: /Útil/ })).toBeNull();
    expect(anon.ratings).toHaveLength(0);
  });
});

describe("envío", () => {
  it("«Útil»: cuerpo sin motivo; «Gracias» solo tras 201 y los controles desaparecen", async () => {
    const s = setup();
    await open("Autorizo");
    await ask("c"); await screen.findByText("Respuesta 1");
    await click("Útil");
    await screen.findByText("Gracias por su valoración");
    expect(s.ratings).toEqual([{ responseId: "00000000-0000-4000-8000-000000000001", valoracion: "Útil" }]);
    expect(screen.queryByRole("button", { name: "Útil" })).toBeNull();
  });

  it.each([...MOTIVOS])("«No útil» exige un único motivo: %s", async motivo => {
    const s = setup();
    await open("Autorizo");
    await ask("c"); await screen.findByText("Respuesta 1");
    await click("No útil");
    // Sin motivo, no se puede enviar.
    expect((screen.getByRole("button", { name: "Enviar valoración" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getAllByRole("radio")).toHaveLength(5);
    await act(async () => { fireEvent.click(screen.getByRole("radio", { name: motivo })); });
    await click("Enviar valoración");
    await screen.findByText("Gracias por su valoración");
    expect(s.ratings[0]).toMatchObject({ valoracion: "No útil", motivo });
    expect(Object.keys(s.ratings[0]).sort()).toEqual(["motivo", "responseId", "valoracion"]);
  });

  it("doble clic: una sola solicitud", async () => {
    let release!: (r: Response) => void;
    const s = setup({ ratings: () => new Promise<Response>(r => { release = r; }) });
    await open("Autorizo");
    await ask("c"); await screen.findByText("Respuesta 1");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Útil" }));
      fireEvent.click(screen.getByRole("button", { name: "Útil" }));
    });
    expect(s.ratings).toHaveLength(1);
    expect((screen.getByRole("button", { name: "Útil" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { release(json({ responseId: "00000000-0000-4000-8000-000000000001", registrada: true }, 201)); });
    await screen.findByText("Gracias por su valoración");
  });

  it("pérdida de acuse: el rechazo por duplicado NO es éxito; la respuesta sigue y no se puede cambiar la selección", async () => {
    const s = setup({ ratings: () => json({ error: { codigo: "VALIDACION", mensaje: "No se pudo registrar la valoración." } }, 400) });
    await open("Autorizo");
    await ask("c"); await screen.findByText("Respuesta 1");
    await click("Útil");
    await screen.findByRole("alert", { name: "" }).catch(() => undefined);
    await waitFor(() => expect(screen.getByText(/No se pudo registrar su valoración/)).toBeTruthy());
    expect(screen.queryByText("Gracias por su valoración")).toBeNull();
    expect(screen.getByRole("log").textContent).toContain("Respuesta 1");
    // Solo se puede reintentar lo mismo; «No útil» queda bloqueado.
    expect((screen.getByRole("button", { name: "No útil" }) as HTMLButtonElement).disabled).toBe(true);
    await click("Reintentar valoración");
    await waitFor(() => expect(s.ratings).toHaveLength(2));
    expect(s.ratings[1]).toEqual(s.ratings[0]);
    expect(screen.queryByText("Gracias por su valoración")).toBeNull();
    // La consulta no se reenvió.
    expect(s.base.chats()).toHaveLength(1);
  });

  it("el resultado de una valoración tras reiniciar la conversación se descarta", async () => {
    let release!: (r: Response) => void;
    setup({ ratings: () => new Promise<Response>(r => { release = r; }) });
    await open("Autorizo");
    await ask("c"); await screen.findByText("Respuesta 1");
    await click("Útil");
    await click("Nueva conversación"); await click("Iniciar nueva");
    await screen.findByRole("button", { name: "Autorizo" });
    await act(async () => { release(json({ responseId: "00000000-0000-4000-8000-000000000001", registrada: true }, 201)); });
    expect(screen.queryByText("Gracias por su valoración")).toBeNull();
    expect(screen.queryByText("Respuesta 1")).toBeNull();
  });
});

describe("accesibilidad básica", () => {
  it("grupo con nombre, fieldset con leyenda y botones alcanzables por teclado", async () => {
    setup();
    await open("Autorizo");
    await ask("c"); await screen.findByText("Respuesta 1");
    expect(screen.getByRole("group", { name: "Valorar esta respuesta" })).toBeTruthy();
    await click("No útil");
    expect(screen.getByRole("group", { name: /Por qué no fue útil/ })).toBeTruthy();
    for (const el of [...screen.getAllByRole("radio"), screen.getByRole("button", { name: "Enviar valoración" })]) {
      expect(el.getAttribute("tabindex")).not.toBe("-1");
    }
  });
});
