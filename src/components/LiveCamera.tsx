"use client";

/**
 * Take a photo with the live camera, inside the page. No file picker, so a saved or generated
 * image has no way in: the after photo of a cleanup must be shot at the spot, right now.
 *
 * Importers/callers: src/components/ResolveSheet.tsx (after photo).
 * Hands back a JPEG File, already at upload size (longest edge 1600px), via onCapture.
 * Staying in the page also means the phone never leaves for its camera app, which is what
 * unloaded the report form mid-photo (see ReportSheet's draft).
 * ponytail: a virtual-camera driver on a laptop still gets past; the server's AI-label check
 * and the reporter's confirmation are the backstops.
 */
import { useEffect, useRef, useState } from "react";

const MAX_EDGE = 1600;

export default function LiveCamera({ label, onCapture }: { label: string; onCapture: (f: File) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [live, setLive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stop = () => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setLive(false);
  };
  useEffect(() => () => stream.current?.getTracks().forEach((t) => t.stop()), []);

  // The <video> mounts once live flips on; attach the stream then.
  useEffect(() => {
    if (live && video.current && stream.current) {
      video.current.srcObject = stream.current;
      video.current.play().catch(() => {});
    }
  }, [live]);

  async function open() {
    setError(null);
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      setLive(true);
    } catch (e) {
      const name = (e as DOMException).name;
      setError(
        name === "NotAllowedError"
          ? "Camera permission was denied. Allow it to take the after photo."
          : name === "NotFoundError"
            ? "No camera found. The after photo has to be taken live at the spot."
            : "Couldn't open the camera. Try Chrome or Safari.",
      );
    }
  }

  function shoot() {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const scale = Math.min(1, MAX_EDGE / Math.max(v.videoWidth, v.videoHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(v.videoWidth * scale);
    c.height = Math.round(v.videoHeight * scale);
    c.getContext("2d")?.drawImage(v, 0, 0, c.width, c.height);
    c.toBlob(
      (b) => {
        if (!b) return;
        onCapture(new File([b], `after-${Date.now()}.jpg`, { type: "image/jpeg" }));
        stop();
      },
      "image/jpeg",
      0.85,
    );
  }

  if (live) {
    return (
      <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-black">
        <video ref={video} playsInline muted className="h-56 w-full object-cover" />
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-3 bg-gradient-to-t from-black/80 to-transparent p-3">
          <button type="button" onClick={stop} className="h-11 rounded-full border border-white/25 px-4 text-xs text-white/80">
            Cancel
          </button>
          <button
            type="button"
            onClick={shoot}
            aria-label="Take photo"
            className="h-14 w-14 rounded-full border-4 border-white/70 bg-white"
          />
        </div>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={open}
        className="flex h-28 w-full flex-col items-center justify-center gap-1.5 rounded-2xl border border-dashed border-white/15 bg-white/[0.03]"
      >
        <span className="text-lg">📷</span>
        <span className="text-sm text-white/70">{label}</span>
      </button>
      {error && <p className="text-[11px] text-[#ffb0a5]">{error}</p>}
    </>
  );
}
