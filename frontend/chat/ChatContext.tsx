"use client";
/**
 * Contexto único del panel (SPEC003 + SPEC004): apertura → consentimiento → categoría → lista,
 * emergencia en paralelo, un intento activo, reloj de 45 s, reintentos manuales y reinicio.
 * Todo el estado es volátil. `epochRef` invalida en el acto cualquier resultado de una
 * conversación anterior (RF-C4-IN-03): los callbacks comparan el epoch con el que nacieron.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from "react";
import { createConversation, fetchConfig, type ConversationOutcome } from "../shared/chatClient";
import { AttemptRunner } from "./queryAttempt";
import { submitRating } from "../shared/feedbackClient";
import type { Motivo, Valoracion } from "../shared/feedbackContracts";
import type { Categoria, ConfigChat } from "../shared/chatContracts";
import { clearSessionToken } from "../shared/session";
import { contactReducer, initialContactState, type ContactState } from "./contactState";
import { buildPayload, canQuery, initialSession, sessionReducer } from "./sessionReducer";
import type { PanelSession } from "./types";
import { useState } from "react";

export type PanelConfig = Pick<ConfigChat, "apertura" | "politica" | "opciones">;

export type ChatApi = {
  session: PanelSession;
  config: PanelConfig | undefined;
  contacts: ContactState;
  conversationNotice: "politica" | "sesion" | "servicio" | "red" | undefined;
  creating: boolean;
  decide: (autoriza: boolean) => void;
  chooseCategory: (c: Categoria | null) => void;
  openEmergency: () => void;
  closeEmergency: () => void;
  submit: (question: string) => boolean;
  retry: () => void;
  reset: () => void;
  /** Elige «No útil» (abre la selección de motivo) sin enviar todavía. */
  startRating: (responseId: string) => void;
  /** Envía la valoración; «Útil» sin motivo, «No útil» con uno de los cinco. */
  rate: (responseId: string, valoracion: Valoracion, motivo?: Motivo) => void;
  /** Reintenta obtener la configuración/contactos (solo si faltan). Agrupa solicitudes en vuelo. */
  ensureContacts: () => void;
};

const Ctx = createContext<ChatApi | undefined>(undefined);

export function useChat(): ChatApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useChat requiere <ChatProvider>");
  return v;
}

export function ChatProvider({ children }: { children: ReactNode }) {
  const [session, dispatch] = useReducer(sessionReducer, undefined, () => initialSession());
  const [contacts, dispatchContacts] = useReducer(contactReducer, undefined, () => initialContactState());
  const [config, setConfig] = useState<PanelConfig | undefined>();
  const [notice, setNotice] = useState<ChatApi["conversationNotice"]>();
  const [creating, setCreating] = useState(false);

  const sessionRef = useRef(session);
  sessionRef.current = session;
  const contactsRef = useRef(contacts);
  contactsRef.current = contacts;
  const epochRef = useRef(session.epoch);
  const runner = useRef<AttemptRunner | undefined>(undefined);
  runner.current ??= new AttemptRunner(() => epochRef.current);
  const configAbort = useRef<AbortController | undefined>(undefined);
  const creatingAbort = useRef<AbortController | undefined>(undefined);
  const ratingAbort = useRef<AbortController | undefined>(undefined);
  /** Bloqueo síncrono por respuesta: un doble clic no produce dos solicitudes aunque el estado aún no se haya pintado. */
  const ratingInFlight = useRef<Set<string>>(new Set());
  const configInFlight = useRef<Promise<void> | undefined>(undefined);
  /** Bloqueo síncrono: una sola creación de conversación por decisión «Autorizo». */
  const creatingInFlight = useRef(false);

  const loadConfig = useCallback((): Promise<void> => {
    if (configInFlight.current) return configInFlight.current;
    const epoch = epochRef.current;
    dispatchContacts({ type: "solicitar", epoch });
    const ctl = new AbortController();
    configAbort.current = ctl;
    const p = (async () => {
      const r = await fetchConfig(ctl.signal);
      if (epoch !== epochRef.current) return; // llegó de una conversación anterior
      if (r.kind === "ok") {
        setConfig({ apertura: r.config.apertura, politica: r.config.politica, opciones: r.config.opciones });
        dispatchContacts({ type: "listo", epoch, snapshot: r.config.contactos });
        dispatch({ type: "configListo", contacts: r.config.contactos });
      } else {
        dispatchContacts({ type: "fallo", epoch });
        dispatch({ type: "configFallida" });
      }
    })().finally(() => { configInFlight.current = undefined; });
    configInFlight.current = p;
    return p;
  }, []);

  // Primer montaje del iframe: bloque de configuración/contactos (nunca antes del primer clic).
  useEffect(() => {
    void loadConfig();
    return () => { configAbort.current?.abort(); runner.current?.abort(); creatingAbort.current?.abort(); };
  }, [loadConfig]);

  const ensureContacts = useCallback(() => {
    if (contactsRef.current.snapshot || contactsRef.current.status === "loading") return;
    void loadConfig();
  }, [loadConfig]);

  const decide = useCallback((autoriza: boolean) => {
    const s = sessionRef.current;
    if (s.startup !== "consentimiento") return;
    setNotice(undefined);
    if (!autoriza) { dispatch({ type: "noAutorizo" }); return; }
    if (!config || creatingInFlight.current) return;
    creatingInFlight.current = true;
    const epoch = epochRef.current;
    dispatch({ type: "solicitarConversacion" });
    setCreating(true);
    const ctl = new AbortController();
    creatingAbort.current = ctl;
    void (async () => {
      let out: ConversationOutcome;
      try { out = await createConversation(config.politica.version, ctl.signal); }
      catch { out = { kind: "fallo", causa: "red" }; }
      creatingInFlight.current = false;
      if (epoch !== epochRef.current) return;
      setCreating(false);
      if (out.kind === "ok") dispatch({ type: "conversacionCreada", conversationId: out.conversationId, policyVersion: config.politica.version });
      else { setNotice(out.causa); dispatch({ type: "conversacionFallida" }); }
    })();
  }, [config]);

  const run = useCallback((attempt: { epoch: number; sequence: number; frozenPayload: Record<string, unknown> }) => {
    return runner.current!.start(attempt, {
      onResult: (sequence, out) => {
        if (out.kind === "ok") dispatch({ type: "respondida", sequence, respuesta: out.respuesta });
        else {
          dispatch({ type: "fallida", sequence, mensaje: out.causa, retryable: out.retryable, retryAfterSeconds: out.retryAfterSeconds });
          // IN-06: sin contactos, se piden de nuevo al mostrar el fallo (sin LLM).
          if (out.causa !== "validacion") ensureContactsRef.current();
        }
      },
    });
  }, []);

  const ensureContactsRef = useRef(ensureContacts);
  ensureContactsRef.current = ensureContacts;

  const submit = useCallback((raw: string): boolean => {
    const question = raw.trim();
    const s = sessionRef.current;
    if (!question || runner.current!.busy || !canQuery(s)) return false;
    const payload = buildPayload(s, question);
    // `start` bloquea de forma síncrona: un segundo clic/tecla en el mismo instante no crea otro intento.
    if (!run({ epoch: epochRef.current, sequence: s.nextSequence, frozenPayload: payload })) return false;
    dispatch({ type: "enviar", question, frozenPayload: payload, now: Date.now() });
    return true;
  }, [run]);

  const retry = useCallback(() => {
    const s = sessionRef.current;
    const at = s.activeAttempt;
    if (!at || runner.current!.busy || at.phase !== "fallido" || !at.failure?.retryable) return;
    if (!run({ epoch: epochRef.current, sequence: at.sequence, frozenPayload: at.frozenPayload })) return;
    dispatch({ type: "reintentar", sequence: at.sequence, now: Date.now() });
  }, [run]);

  const startRating = useCallback((responseId: string) => dispatch({ type: "valoracionElegir", responseId }), []);

  const rate = useCallback((responseId: string, valoracion: Valoracion, motivo?: Motivo) => {
    const s = sessionRef.current;
    const cur = s.feedbackByResponse[responseId];
    // Una solicitud por respuesta; confirmada o enviando no admite otra.
    if (cur?.phase === "sending" || cur?.phase === "confirmed" || ratingInFlight.current.has(responseId)) return;
    ratingInFlight.current.add(responseId);
    const epoch = epochRef.current;
    dispatch({ type: "valoracionEnviando", responseId, selected: valoracion, ...(motivo ? { reason: motivo } : {}) });
    const ctl = (ratingAbort.current ??= new AbortController());
    void submitRating(responseId, valoracion, motivo, ctl.signal).then(out => {
      ratingInFlight.current.delete(responseId);
      if (epoch !== epochRef.current) return; // la conversación cambió: el resultado se descarta
      // «Gracias» solo con 201 confirmado; un rechazo (p. ej. duplicado) NO es éxito.
      dispatch({ type: out.kind === "registrada" ? "valoracionConfirmada" : "valoracionFallida", responseId });
    });
  }, []);

  const reset = useCallback(() => {
    // El epoch avanza ANTES de abortar: ninguna promesa en vuelo puede repoblar la sesión nueva.
    epochRef.current += 1;
    runner.current!.abort();
    configAbort.current?.abort();
    creatingAbort.current?.abort();
    creatingInFlight.current = false;
    ratingAbort.current?.abort();
    ratingAbort.current = undefined;
    ratingInFlight.current.clear();
    configInFlight.current = undefined;
    clearSessionToken();
    setNotice(undefined);
    setCreating(false);
    dispatch({ type: "reiniciar" });
    dispatchContacts({ type: "solicitar", epoch: epochRef.current });
    void loadConfig();
  }, [loadConfig]);

  const api = useMemo<ChatApi>(() => ({
    session, config, contacts, conversationNotice: notice, creating,
    decide,
    chooseCategory: c => dispatch({ type: "elegirCategoria", categoria: c }),
    openEmergency: () => { dispatch({ type: "abrirEmergencia" }); ensureContacts(); },
    closeEmergency: () => dispatch({ type: "cerrarEmergencia" }),
    submit, retry, reset, ensureContacts, startRating, rate,
  }), [session, config, contacts, notice, creating, decide, submit, retry, reset, ensureContacts, startRating, rate]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
