import type { CreationPresenceMember } from "../types/content_generator";

export interface CreationPresenceState {
  members: CreationPresenceMember[];
  loading: boolean;
  error: string | null;
}

interface PresenceOptions {
  heartbeat: (clientId: string, signal: AbortSignal) => Promise<CreationPresenceMember[]>;
  leave: (clientId: string) => Promise<void>;
  onUpdate: (state: CreationPresenceState) => void;
  onLeaveError: (error: unknown) => void;
  createClientId?: () => string;
}

interface Visit {
  id: string;
  controller: AbortController;
  inFlight: boolean;
  timer?: ReturnType<typeof setTimeout>;
}

export function createCreationPresence({
  heartbeat, leave, onUpdate, onLeaveError,
  createClientId = () => crypto.randomUUID(),
}: PresenceOptions) {
  let active: Visit | null = null;

  const pulse = async (visit: Visit) => {
    visit.inFlight = true;
    try {
      const members = await heartbeat(visit.id, visit.controller.signal);
      if (active === visit) onUpdate({ members, loading: false, error: null });
    } catch (error) {
      if (active !== visit || visit.controller.signal.aborted) return;
      onUpdate({
        members: [], loading: false,
        error: error instanceof Error ? error.message : "Could not update creation presence",
      });
    } finally {
      visit.inFlight = false;
      if (active === visit) visit.timer = setTimeout(() => void pulse(visit), 10_000);
    }
  };

  return {
    start() {
      if (active) return;
      const visit: Visit = { id: createClientId(), controller: new AbortController(), inFlight: false };
      active = visit;
      onUpdate({ members: [], loading: true, error: null });
      void pulse(visit);
    },
    refresh() {
      if (!active || active.inFlight) return;
      clearTimeout(active.timer);
      void pulse(active);
    },
    stop() {
      const visit = active;
      if (!visit) return;
      active = null;
      clearTimeout(visit.timer);
      visit.controller.abort();
      void leave(visit.id).catch(onLeaveError);
    },
  };
}
