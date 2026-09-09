"use client";
import SmartAgentPanel from "../smart/SmartAgentPanel";
export default function HomePage() {
  return <main className="container">
    <section className="hero"><h1>Geobot</h1>
      <p>Pregunta sobre tus documentos. Buscaré la información en todas las bibliotecas.</p>
    </section>
    <section className="smart-agent-section"><SmartAgentPanel /></section>
  </main>;
}
