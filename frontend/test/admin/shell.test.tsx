import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";

let ruta = "/admin/documents";
vi.mock("next/navigation", () => ({ usePathname: () => ruta }));

import AdminShell from "../../admin/AdminShell";
import { navegacion } from "../../admin/adminClient";
import { createActivityTracker, POLL_IDLE_MS, SESSION_IDLE_MS } from "../../admin/sessionActivity";

type Resp = { status: number; json?: unknown };
function mockFetch(handler: (url: string) => Resp) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
    const r = handler(String(input));
    return new Response(r.json === undefined ? "" : JSON.stringify(r.json), {
      status: r.status, headers: { "content-type": "application/json" },
    });
  });
}
const sesion = (perfil: string, mustChangePassword = false) => ({
  cuenta: { id: "1", nombre: "Ana", perfil }, mustChangePassword, csrfToken: "csrf",
});

describe("AdminShell", () => {
  let ir: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { ruta = "/admin/documents"; ir = vi.spyOn(navegacion, "ir").mockImplementation(() => {}); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it("no muestra contenido protegido antes de conocer la sesión y luego lo muestra con la navegación del perfil", async () => {
    mockFetch(url => url.endsWith("/session") ? { status: 200, json: sesion("Gestor documental") } : { status: 200, json: { notifications: 2 } });
    render(<AdminShell><p>secreto-del-panel</p></AdminShell>);
    expect(screen.queryByText("secreto-del-panel")).toBeNull();
    expect(await screen.findByText("secreto-del-panel")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Documentos/ })).toBeInTheDocument();
    // El Gestor no ve enlaces técnicos.
    expect(screen.queryByRole("link", { name: "Cuentas" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Auditoría" })).toBeNull();
    await waitFor(() => expect(screen.getByRole("link", { name: /Avisos/ })).toHaveTextContent("(2)"));
  });

  it("sin sesión redirige al login sin renderizar contenido", async () => {
    mockFetch(() => ({ status: 401, json: { error: { codigo: "NO_AUTENTICADO", mensaje: "x" } } }));
    render(<AdminShell><p>secreto</p></AdminShell>);
    await waitFor(() => expect(ir).toHaveBeenCalledWith("/admin/login"));
    expect(screen.queryByText("secreto")).toBeNull();
  });

  it("contraseña temporal: solo la pantalla de cambio; el resto redirige", async () => {
    mockFetch(url => url.endsWith("/session") ? { status: 200, json: sesion("administrador técnico", true) } : { status: 403, json: { error: { codigo: "CAMBIO_CONTRASENA_REQUERIDO", mensaje: "x" } } });
    render(<AdminShell><p>datos</p></AdminShell>);
    await waitFor(() => expect(ir).toHaveBeenCalledWith("/admin/password"));
    expect(screen.queryByText("datos")).toBeNull();
  });

  it("base caída (503): mensaje de indisponibilidad, sin contenido ni navegación en caché", async () => {
    mockFetch(() => ({ status: 503, json: { error: { codigo: "SERVICIO_NO_DISPONIBLE", mensaje: "x" } } }));
    render(<AdminShell><p>datos</p></AdminShell>);
    expect(await screen.findByRole("alert")).toHaveTextContent(/no está disponible/);
    expect(screen.queryByText("datos")).toBeNull();
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(ir).not.toHaveBeenCalled();
  });

  it("el login no exige sesión", () => {
    ruta = "/admin/login";
    const f = mockFetch(() => ({ status: 401 }));
    render(<AdminShell><p>formulario</p></AdminShell>);
    expect(screen.getByText("formulario")).toBeInTheDocument();
    expect(f).not.toHaveBeenCalled();
  });

  it("el sondeo de contadores se suspende tras 60 s sin interacción humana y se reanuda al interactuar", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const f = mockFetch(url => url.endsWith("/session") ? { status: 200, json: sesion("administrador técnico") } : { status: 200, json: { notifications: 0, pending: 0, openImprovements: 0 } });
    render(<AdminShell><p>ok</p></AdminShell>);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const contar = () => f.mock.calls.filter(c => String(c[0]).endsWith("/counters")).length;
    expect(contar()).toBe(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(contar()).toBe(2); // aún dentro de los 60 s
    await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60_000); });
    const trasInactividad = contar();
    expect(trasInactividad).toBeLessThanOrEqual(3); // solo cabía un sondeo antes de los 60 s
    await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60_000); });
    expect(contar()).toBe(trasInactividad); // sigue suspendido
    await act(async () => { document.dispatchEvent(new Event("pointerdown")); await vi.advanceTimersByTimeAsync(30_000); });
    expect(contar()).toBe(trasInactividad + 1);
  });

  it("cierra y revoca la sesión tras 30 minutos sin interacción humana", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const f = mockFetch(url => url.endsWith("/session") ? { status: 200, json: sesion("administrador técnico") } : { status: 200, json: { notifications: 0 } });
    render(<AdminShell><p>ok</p></AdminShell>);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    await act(async () => { await vi.advanceTimersByTimeAsync(SESSION_IDLE_MS + 30_000); });
    expect(f.mock.calls.some(c => (c[1] as RequestInit | undefined)?.method === "DELETE")).toBe(true);
    expect(ir).toHaveBeenCalledWith("/admin/login?expirada=1");
  });
});

describe("ActivityTracker", () => {
  it("define las ventanas de 60 s de sondeo y 30 min de sesión", () => {
    let t = 0;
    const tr = createActivityTracker({ now: () => t });
    expect(tr.pollingAllowed()).toBe(true);
    t = POLL_IDLE_MS - 1; expect(tr.pollingAllowed()).toBe(true);
    t = POLL_IDLE_MS; expect(tr.pollingAllowed()).toBe(false);
    t = SESSION_IDLE_MS - 1; expect(tr.expired()).toBe(false);
    t = SESSION_IDLE_MS; expect(tr.expired()).toBe(true);
    tr.touch(); expect(tr.expired()).toBe(false);
    tr.dispose();
  });
});
