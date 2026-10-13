/** T041 (RF-C4-UI-07/08, RF-C4-IN-02/03): estado del intento, plazo de 45 s y reintentos con reloj controlado. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { advance, after, answerFor, ask, input, installFetch, json, mountPanel, okAnswer } from "./helpers/panel";

/** RTL espera con temporizadores reales: el reloj simulado se activa DESPUÉS de montar y elegir categoría. */
const clock = () => vi.useFakeTimers({ shouldAdvanceTime: false });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("una sola solicitud activa", () => {
  it("doble envío síncrono (clic + Enter) produce una única solicitud y bloquea campo y botón", async () => {
    const api = installFetch(after(5000, () => okAnswer(1)));
    await mountPanel(); clock();
    await act(async () => { fireEvent.change(input(), { target: { value: "hola" } }); });
    await act(async () => {
      const form = input().closest("form")!;
      fireEvent.submit(form);
      fireEvent.submit(form);
      fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    });
    expect(api.chats()).toHaveLength(1);
    expect(input().disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Enviar" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("demora de 5 s: indicador literal visible durante la espera y campo habilitado al terminar", async () => {
    installFetch(after(5000, () => okAnswer(1)));
    await mountPanel(); clock();
    await ask("consulta");
    expect(screen.getByRole("status").textContent).toContain("Geobot está buscando en la información institucional…");
    await advance(4999);
    expect(input().disabled).toBe(true);
    await advance(1);
    expect(screen.getByText("Respuesta 1")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("");
    expect(input().disabled).toBe(false);
  });
});

describe("plazo de 45 s", () => {
  it("respuesta a los 40 s se muestra", async () => {
    installFetch(after(40_000, () => okAnswer(1)));
    await mountPanel(); clock();
    await ask("consulta");
    await advance(40_000);
    expect(screen.getByText("Respuesta 1")).toBeTruthy();
  });

  it("respuesta a los 50 s: fallo entre 45 y 46 s y la tardía se descarta", async () => {
    installFetch((n, _b, signal) => new Promise<Response>((resolve, reject) => {
      // El servidor "responde" a los 50 s aunque el cliente ya abortó: no debe aparecer.
      const t = setTimeout(() => resolve(okAnswer(n)), 50_000);
      signal?.addEventListener("abort", () => { clearTimeout(t); reject(new DOMException("abort", "AbortError")); });
    }));
    await mountPanel(); clock();
    await ask("consulta");
    await advance(44_999);
    expect(screen.queryByText(/En este momento no puedo responder/)).toBeNull();
    await advance(1_001);
    expect(screen.getByText(/En este momento no puedo responder/)).toBeTruthy();
    await advance(10_000);
    expect(screen.queryByText("Respuesta 1")).toBeNull();
    expect(input().disabled).toBe(false);
  });

  it("cada reintento tiene su propio plazo y el fallo no entra en la conversación", async () => {
    let n = 0;
    const api = installFetch((_n, _b, signal) => {
      n++;
      if (n === 1) return new Promise<Response>((_, reject) => signal?.addEventListener("abort", () => reject(new DOMException("a", "AbortError"))));
      return after(40_000, () => okAnswer(2))(n, {}, signal);
    });
    await mountPanel(); clock();
    await ask("consulta");
    await advance(45_000);
    expect(screen.getByRole("alert").textContent).toContain("En este momento no puedo responder");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Reintentar/ })); });
    expect(api.chats()).toHaveLength(2);
    expect(api.chats()[1].body).toEqual(api.chats()[0].body);
    await advance(40_000); // 40 s desde el reintento, no desde el envío inicial
    expect(screen.getByText("Respuesta 2")).toBeTruthy();
    // Una sola pregunta visible, y el fallo no creó mensajes.
    expect(screen.getAllByText("consulta")).toHaveLength(1);
  });

  it("tras un fallo la siguiente consulta no arrastra el intento fallido como par", async () => {
    let n = 0;
    const api = installFetch((_n, b) => {
      n++;
      return n === 1 ? json({ error: { codigo: "ERROR_INTERNO" } }, 500) : answerFor(n, b);
    });
    await mountPanel({ anonymous: false });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Autorizo" })); });
    await screen.findByRole("button", { name: "No estoy seguro" });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "No estoy seguro" })); });
    clock();
    await ask("primera");
    await advance(0);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Reintentar/ })); });
    await advance(0);
    expect(screen.getByText("Respuesta 2")).toBeTruthy();
    await ask("segunda");
    await advance(0);
    const last = api.chats().at(-1)!.body as { historial?: Array<{ pregunta: string }> };
    expect(last.historial).toEqual([{ pregunta: "primera", respuesta: "Respuesta 2" }]);
  });
});
