"use client";

/**
 * Speak instead of type: transcribes in the browser (Web Speech API) and hands back text.
 *
 * Importers/callers: src/components/ReportSheet.tsx (description field).
 * No audio is ever recorded or uploaded by CleanLoop — only the transcript text is kept, and only
 * if the reporter submits it. Kannada (kn-IN) or English (en-IN) follows the app language.
 * Hidden entirely where the browser has no speech recognition (e.g. Firefox), so it never
 * shows a button that can't work.
 */
import { useRef, useState, useSyncExternalStore } from "react";

type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};
type RecognitionCtor = new () => Recognition;

const ctor = (): RecognitionCtor | null =>
  typeof window === "undefined"
    ? null
    : ((window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor }).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: RecognitionCtor }).webkitSpeechRecognition ??
      null);
const noop = () => () => {};

export default function DictateButton({ lang, onText }: { lang: "en" | "kn"; onText: (text: string) => void }) {
  // Server render and first paint: unsupported (no button). Client: the real answer.
  const supported = useSyncExternalStore(noop, () => ctor() !== null, () => false);
  const [listening, setListening] = useState(false);
  const [status, setStatus] = useState("");
  const rec = useRef<Recognition | null>(null);

  if (!supported) return null;

  function toggle() {
    if (listening) return rec.current?.stop();
    const Ctor = ctor();
    if (!Ctor) return;
    const r = new Ctor();
    r.lang = lang === "kn" ? "kn-IN" : "en-IN";
    r.interimResults = false;
    r.continuous = false;
    r.onresult = (e) => {
      const text = Array.from(e.results).map((res) => res[0].transcript).join(" ").trim();
      if (text) onText(text);
    };
    r.onerror = (e) =>
      setStatus(
        {
          "not-allowed": "Microphone permission was denied.",
          "service-not-allowed": "This browser blocks voice typing. Try Chrome or Safari.",
          network: "Voice typing needs Chrome or Safari online. This browser can't reach the speech service.",
          "audio-capture": "No microphone found.",
          "no-speech": "Didn't hear anything. Tap Speak and talk right away.",
          "language-not-supported": "This browser can't transcribe this language.",
        }[e.error] ?? `Didn't catch that (${e.error}). Try again.`,
      );
    r.onend = () => setListening(false);
    rec.current = r;
    setStatus("");
    setListening(true);
    r.start();
  }

  return (
    <>
      <button
        type="button"
        onClick={toggle}
        aria-pressed={listening}
        className={`flex h-11 shrink-0 items-center gap-1.5 rounded-xl border px-3 text-xs ${
          listening ? "border-[#ff6b5e] bg-[#ff6b5e]/15 text-[#ffb0a5]" : "border-white/15 text-white/80"
        }`}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
          <rect x="9" y="3" width="6" height="11" rx="3" stroke="currentColor" strokeWidth="2" />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        {listening ? "Listening… tap to stop" : lang === "kn" ? "ಮಾತನಾಡಿ" : "Speak"}
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {listening ? "Listening" : status}
      </span>
      {status && <p className="text-[11px] text-[#ffb0a5]">{status}</p>}
    </>
  );
}
