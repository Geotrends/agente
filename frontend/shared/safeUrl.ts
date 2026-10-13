/** Validación de URL externas: solo https absolutas, sin credenciales (RNF-C4-UI-03). */
export function safeHttpsUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!/^https:\/\//i.test(trimmed)) return undefined;
  try {
    const u = new URL(trimmed);
    if (u.protocol !== "https:" || u.username || u.password || !u.hostname) return undefined;
    return u.toString();
  } catch {
    return undefined;
  }
}
