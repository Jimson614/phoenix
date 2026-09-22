"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import AoYuCompanion from "@/components/aoyu/aoyu-companion";
import type { AoyuPresentationEvent } from "@/lib/aoyu/contract";

type Props = {
  scopeKey: string;
  progress?: number;
  sourceEvent: AoyuPresentationEvent;
  retry?: boolean;
  action: (data: FormData) => Promise<void | { redirectTo: string }>;
  children: ReactNode;
};

/** UI events describe only the existing form. All academic decisions remain server-owned. */
export default function CompanionTaskForm({ scopeKey, progress, sourceEvent, retry = false, action, children }: Props) {
  const router = useRouter();
  const serial = useRef(0);
  const refreshWhenOnline = useRef(false);
  const [localEvent, setLocalEvent] = useState<AoyuPresentationEvent | null>(null);
  const [pending, setPending] = useState(false);
  const event = localEvent ?? sourceEvent;
  useEffect(() => { setLocalEvent(null); }, [sourceEvent.eventId]);
  useEffect(() => {
    const sync = () => {
      if (refreshWhenOnline.current) {
        refreshWhenOnline.current = false;
        router.refresh();
      }
    };
    window.addEventListener("online", sync);
    return () => window.removeEventListener("online", sync);
  }, [router]);
  const emit = (state: AoyuPresentationEvent["state"]) => {
    serial.current += 1;
    setLocalEvent({ state, eventId: `${sourceEvent.eventId}:input:${state}:${Date.now()}:${serial.current}` });
  };

  async function submit(data: FormData) {
    if (pending) return;
    setPending(true);
    emit(retry ? "ENCOURAGE" : "FOCUS");
    try {
      const result = await action(data);
      setLocalEvent(null);
      if (result?.redirectTo) router.push(result.redirectTo);
    } catch {
      // Network/server failure is an actual failed submission, never a timed simulation.
      emit("SAFE_ERROR");
      // A lost response can follow a successful write. Re-read the authoritative
      // snapshot; never automatically repeat the write or assume rollback.
      if (navigator.onLine) router.refresh();
      else refreshWhenOnline.current = true;
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <AoYuCompanion progress={progress} aoyuState={event.state} eventKey={event.eventId}
        completionKey={event.completionKey} scopeKey={scopeKey} soundEnabled={false} />
      <form action={submit} aria-busy={pending}
        onFocusCapture={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null) &&
            (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement)) {
            emit("FOCUS");
          }
        }}
        onBlurCapture={(e) => {
          if (!pending && !e.currentTarget.contains(e.relatedTarget as Node | null)) emit("WAITING");
        }}>
        <fieldset disabled={pending} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
          {children}
        </fieldset>
      </form>
    </>
  );
}
