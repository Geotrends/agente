/** T042 (RF-C4-UI-08, RF-C4-IN-04/06): errores sin datos técnicos y recuperación de contactos. */
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import fx from "./fixtures/fallos.json";
import { ask, CONFIG, installFetch, json, mountPanel } from "./helpers/panel";

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

const FALLO = "En este momento no puedo responder. Puede intentarlo de nuevo o comunicarse por los canales oficiales.";
const raw = (c: { status: number; content: string; body: string }) => new Response(c.body, { status: c.status, headers: { "content-type": c.content } });

describe("seis causas de error (IN-04)", () => {
  it.each(fx.causas)("$id: mensaje fijo, canales, sin datos técnicos y Reintentar solo si es recuperable", async c => {
    installFetch(() => raw(c));
    await mountPanel();
    await ask("consulta");
    const fallo = await screen.findByRole("alert", { name: /No fue posible responder/ });
    expect(fallo.textContent).toContain(FALLO);
    for (const t of fx.tecnicos) expect(fallo.textContent).not.toContain(t);
    // Canales de recepción del snapshot, valores exactos.
    expect(fallo.textContent).toContain(CONFIG.contactos.recepcion.whatsapp);
    expect(fallo.textContent).toContain(CONFIG.contactos.recepcion.email);
    expect(fallo.querySelector("a")?.getAttribute("href")).toBe(CONFIG.contactos.recepcion.pqrsd);
    expect(!!screen.queryByRole("button", { name: /Reintentar/ })).toBe(c.retry);
    // Sin valoración y fuera de la conversación.
    expect(screen.queryByRole("button", { name: /Útil/ })).toBeNull();
  });
});

describe("contactos (IN-06)", () => {
  it("1. snapshot cargado al abrir: el fallo NO hace una solicitud extra de configuración", async () => {
    const api = installFetch(() => json({ error: { codigo: "ERROR_INTERNO" } }, 500));
    await mountPanel();
    expect(api.configs()).toHaveLength(1);
    await ask("consulta");
    await screen.findByRole("alert", { name: /No fue posible responder/ });
    expect(api.configs()).toHaveLength(1);
  });

  it("2. sin snapshot al abrir: mensaje literal y enlace oficial, sin teléfonos de reserva", async () => {
    vi.stubEnv("NEXT_PUBLIC_OFFICIAL_CONTACT_URL", "https://www.envigado.gov.co/contacto");
    installFetch(() => json({}), { config: () => new Response("x", { status: 503 }) });
    const { render } = await import("@testing-library/react");
    const { default: ChatPanel } = await import("../chat/ChatPanel");
    render(createElement(ChatPanel));
    const alerta = await screen.findByRole("alert");
    expect(alerta.textContent).toContain("No pudimos cargar los canales de atención. Consulte los canales oficiales del Municipio de Envigado.");
    expect(alerta.textContent).not.toMatch(/\+?\d[\d\s()-]{6,}/);
    expect(alerta.textContent).not.toContain("@");
    vi.unstubAllEnvs();
  });

  it("3. sin snapshot: se repite al elegir emergencia y se recupera", async () => {
    let configCalls = 0;
    const api = installFetch(() => json({}), {
      config: () => (++configCalls === 1 ? new Response("x", { status: 503 }) : json(CONFIG)),
    });
    const { render } = await import("@testing-library/react");
    const { default: ChatPanel } = await import("../chat/ChatPanel");
    render(createElement(ChatPanel));
    await screen.findByText(/No pudimos cargar los canales de atención/);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Intentar de nuevo/ })); });
    await screen.findByText(/Soy Geobot/);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Emergencia o situación en curso" })); });
    expect(screen.getByRole("region", { name: "Canales de atención inmediata" }).textContent).toContain("123");
    expect(api.configs()).toHaveLength(2);
  });

  it("4. caída en ambos momentos (apertura y emergencia): mensaje literal y dos solicitudes agrupadas", async () => {
    // Configuración con apertura válida pero sin contactos íntegros no existe: el bloque llega completo o falla.
    const api = installFetch(() => json({}), { config: () => new Response("x", { status: 503 }) });
    const { render } = await import("@testing-library/react");
    const { default: ChatPanel } = await import("../chat/ChatPanel");
    render(createElement(ChatPanel));
    await screen.findByText(/No pudimos cargar los canales de atención/);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Intentar de nuevo/ })); });
    await waitFor(() => expect(api.configs().length).toBe(2));
    await screen.findByText(/No pudimos cargar los canales de atención/);
    // Doble clic rápido no genera solicitudes duplicadas mientras una está en vuelo.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Intentar de nuevo/ }));
      fireEvent.click(screen.getByRole("button", { name: /Intentar de nuevo/ }));
    });
    await waitFor(() => expect(api.configs().length).toBe(3));
  });

  it("la solicitud de configuración se corta a los 5 s", async () => {
    installFetch(() => json({}), { config: () => new Promise<Response>(() => {}) });
    vi.useFakeTimers();
    const { render } = await import("@testing-library/react");
    const { default: ChatPanel } = await import("../chat/ChatPanel");
    const stubAbort = vi.fn();
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener("abort", () => { stubAbort(); reject(new DOMException("abort", "AbortError")); });
    })));
    render(createElement(ChatPanel));
    await act(async () => { await vi.advanceTimersByTimeAsync(4_999); });
    expect(stubAbort).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(stubAbort).toHaveBeenCalled();
    expect(screen.getByText(/No pudimos cargar los canales de atención/)).toBeTruthy();
  });
});
