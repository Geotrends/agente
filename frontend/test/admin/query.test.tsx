import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAdminQuery } from "../../admin/useAdminQuery";
import AdminTable from "../../admin/AdminTable";
import Contactos from "../../app/admin/contacts/page";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
function List({ path }: { path: string }) {
  const { data, busy, cargar } = useAdminQuery<{ items: { id: string; name: string }[]; total: number; nextCursor: string | null }>(path);
  return <><p>{data?.items.map(i => i.name).join(",")}</p><button disabled={busy} onClick={() => { void cargar("next"); }}>Más</button></>;
}
afterEach(() => vi.restoreAllMocks());
describe("consultas administrativas", () => {
  it("una respuesta antigua no sustituye el filtro actual aunque fetch ignore el aborto", async () => {
    const pending = new Map<string, (r: Response) => void>();
    vi.spyOn(globalThis, "fetch").mockImplementation(url => new Promise(resolve => pending.set(String(url), resolve)));
    const { rerender } = render(<List path="/old" />);
    rerender(<List path="/new" />);
    await act(async () => pending.get("/api/admin/new")!(json({ items: [{ id: "2", name: "Actual" }], total: 1, nextCursor: null })));
    expect(screen.getByText("Actual")).toBeInTheDocument();
    await act(async () => pending.get("/api/admin/old")!(json({ items: [{ id: "1", name: "Obsoleto" }], total: 1, nextCursor: null })));
    expect(screen.queryByText("Obsoleto")).toBeNull();
  });
  it("bloquea páginas simultáneas y no añade dos veces un identificador", async () => {
    let finish: (r: Response) => void = () => {};
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async url => String(url).includes("cursor=") ? new Promise(resolve => { finish = resolve; }) : json({ items: [{ id: "1", name: "Uno" }], total: 2, nextCursor: "next" }));
    render(<List path="/items" />);
    await screen.findByText("Uno");
    fireEvent.click(screen.getByText("Más")); fireEvent.click(screen.getByText("Más"));
    await act(async () => finish(json({ items: [{ id: "1", name: "Uno" }, { id: "2", name: "Dos" }], total: 2, nextCursor: null })));
    expect(await screen.findByText("Uno,Dos")).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("un error inicial en contactos termina la carga y permite reintentar", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ error: { codigo: "CAIDA", mensaje: "Error" } }, 503));
    render(<Contactos />);
    expect(await screen.findByRole("alert")).toHaveTextContent("no está disponible");
    expect(screen.queryByText("Cargando…")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  });
});
it("conserva el título vacío y ordena números por valor, anunciando el orden", () => {
  const columns = [{ clave: "n", titulo: "Cantidad", numerica: true, ordenar: (x: number) => x, render: (x: number) => x }];
  const { rerender } = render(<AdminTable titulo="Cantidades" filas={[]} clave={String} columnas={columns} />);
  expect(screen.getByRole("table", { name: "Cantidades" })).toBeInTheDocument();
  rerender(<AdminTable titulo="Cantidades" filas={[10, 2]} clave={String} columnas={columns} />);
  fireEvent.click(screen.getByRole("button", { name: /Cantidad: ordenar ascendente/ }));
  expect(screen.getByRole("columnheader")).toHaveAttribute("aria-sort", "ascending");
  expect(screen.getAllByRole("cell").map(x => x.textContent)).toEqual(["2", "10"]);
});
