/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // La imagen Docker fija NEXT_OUTPUT=export para generar estáticos en out/ y
  // servirlos con nginx. En local `next dev` y `next start` siguen igual.
  ...(process.env.NEXT_OUTPUT === "export" ? { output: "export" } : {}),
  // Las pruebas E2E del panel exportan a otro directorio para no pisar `out/` (SPEC004/Docker).
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {})
};

export default nextConfig;
