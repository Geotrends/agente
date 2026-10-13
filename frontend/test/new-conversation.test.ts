/** T053 (RF-C4-UI-05, RF-C4-IN-01/02/03): reinicio confirmado, cancelación y resultados obsoletos. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { render } from "@testing-library/react";
import ChatPanel from "../chat/ChatPanel";
import { clearSessionToken } from "../shared/session";
import { ask, CONFIG, input, installFetch, json, okAnswer, UUID } from "./helpers/panel";

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

const click = async (name: string | RegExp) => { await act(async () => { fireEvent.click(screen.getByRole("button", { name })); }); };

async function openAs(mode: "Autorizo" | "No autorizo") {
  clearSessionToken();
  render(createElement(ChatPanel));
  await screen.findByText(/Soy Geobot/);
  await click(mode);
  await screen.findByRole("button", { name: "No estoy seguro" });
  await click("No estoy seguro");
}

describe("diálogo", () => {
  it("texto literal, opciones y foco inicial en Cancelar", async () => {
    installFetch(n => okAnswer(n));
    await openAs("No autorizo");
    await click("Nueva conversación");
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("¿Desea iniciar una conversación nueva? La conversación actual dejará de mostrarse.");
    expect(screen.getByRole("button", { name: "Iniciar nueva" })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancelar" }));
  });

  it("Escape cancela, conserva la conversación y devuelve el foco a «Nueva conversación»", async () => {
    installFetch(n => okAnswer(n));
    await openAs("No autorizo");
    await ask("primera");
    await screen.findByText("Respuesta 1");
    await click("Nueva conversación");
    await act(async () => { fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" }); });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("log").textContent).toContain("Respuesta 1");
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Nueva conversación" })));
  });

  it("Tab queda contenido entre Cancelar e Iniciar nueva", async () => {
    installFetch(n => okAnswer(n));
    await openAs("No autorizo");
    await click("Nueva conversación");
    const iniciar = screen.getByRole("button", { name: "Iniciar nueva" });
    iniciar.focus();
    await act(async () => { fireEvent.keyDown(iniciar, { key: "Tab" }); });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancelar" }));
  });
});

describe("cancelar y confirmar", () => {
  it("cancelar no toca autorización, categoría, ID ni la solicitud en curso, y la respuesta llega a la conversación actual", async () => {
    let resolve!: (r: Response) => void;
    installFetch(() => new Promise<Response>(r => { resolve = r; }));
    await openAs("Autorizo");
    await ask("pendiente");
    await click("Nueva conversación");
    await click("Cancelar");
    expect(input().disabled).toBe(true); // el intento sigue en curso
    await act(async () => { resolve(json({ modo: "conversación", conversationId: UUID, responseId: "r1", tipo: "respondida", respuesta: "Llegó durante el diálogo", fuentes: [] })); });
    expect(await screen.findByText("Llegó durante el diálogo")).toBeTruthy();
    expect(input().disabled).toBe(false);
  });

  it("confirmar con consulta pendiente: la respuesta tardía no aparece en la conversación nueva", async () => {
    let resolve!: (r: Response) => void;
    const api = installFetch(() => new Promise<Response>(r => { resolve = r; }));
    await openAs("Autorizo");
    await ask("vieja");
    await click("Nueva conversación");
    await click("Iniciar nueva");
    await screen.findByText(/Soy Geobot/);
    await act(async () => { resolve(okAnswer(9)); });
    expect(screen.queryByText("Respuesta 9")).toBeNull();
    expect(screen.queryByText("vieja")).toBeNull();
    // Vuelve a pedirse la decisión; no hay ID ni categoría.
    expect(screen.getByRole("button", { name: "Autorizo" })).toBeTruthy();
    expect(input().disabled).toBe(true);
    expect(api.chats()).toHaveLength(1);
  });

  it("autorizado: tras reiniciar se pide un ID nuevo y la primera consulta no lleva historial", async () => {
    const api = installFetch(n => json({ modo: "conversación", conversationId: UUID, responseId: `r${n}`, tipo: "respondida", respuesta: `Respuesta ${n}`, fuentes: [] }));
    await openAs("Autorizo");
    await ask("a"); await screen.findByText("Respuesta 1");
    await ask("b"); await screen.findByText("Respuesta 2");
    expect((api.chats()[1].body as { historial?: unknown[] }).historial).toHaveLength(1);
    await click("Nueva conversación");
    await click("Iniciar nueva");
    await screen.findByRole("button", { name: "Autorizo" });
    await click("Autorizo");
    await screen.findByRole("button", { name: "No estoy seguro" });
    await click("No estoy seguro");
    await ask("c");
    await screen.findByText("Respuesta 3");
    expect(api.calls.filter(c => c.url.endsWith("/conversations"))).toHaveLength(2);
    expect(api.chats()[2].body).not.toHaveProperty("historial");
    expect(screen.getByRole("log").textContent).not.toContain("Respuesta 1");
  });

  it("anónimo: reinicio sin solicitar conversación y sin historial", async () => {
    const api = installFetch(n => okAnswer(n));
    await openAs("No autorizo");
    await ask("a"); await screen.findByText("Respuesta 1");
    await click("Nueva conversación"); await click("Iniciar nueva");
    await screen.findByRole("button", { name: "No autorizo" });
    await click("No autorizo");
    await click("Ecosistemas");
    await ask("b"); await screen.findByText("Respuesta 2");
    expect(api.calls.some(c => c.url.endsWith("/conversations"))).toBe(false);
    expect(api.chats()[1].body).toEqual({ pregunta: "b", categoria: "Ecosistemas" });
  });

  it("política nueva: tras el reinicio se vuelve a leer la configuración y se autoriza con la versión vigente", async () => {
    let version = "2026-10";
    const api = installFetch(n => okAnswer(n), {
      config: () => json({ ...CONFIG, politica: { version, url: CONFIG.politica.url } }),
    });
    await openAs("Autorizo");
    await click("Nueva conversación");
    version = "2026-11";
    await click("Iniciar nueva");
    await waitFor(() => expect(api.configs()).toHaveLength(2));
    await waitFor(() => expect((screen.getByRole("button", { name: "Autorizo" }) as HTMLButtonElement).disabled).toBe(false));
    await click("Autorizo");
    const conv = api.calls.filter(c => c.url.endsWith("/conversations")).at(-1)!;
    expect(conv.body).toEqual({ autorizacion: true, policyVersion: "2026-11" });
  });
});
