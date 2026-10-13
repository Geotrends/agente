"use client";
import "../chat/panel.css";
import SmartAgentPanel from "../smart/SmartAgentPanel";
export default function HomePage() {
  return <main className="container">
    <section className="hero"><h1>Geobot</h1>
      <p>Orientación sobre trámites, requisitos y canales de atención de Ecosistemas, Bienestar Animal y Gestión Ambiental.</p>
    </section>
    <section className="smart-agent-section"><SmartAgentPanel /></section>
  </main>;
}
