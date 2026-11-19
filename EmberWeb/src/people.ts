import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { Profile } from "./types";

/**
 * Caches user profiles so the UI can show names instead of ids. Call
 * `ensure(ids)` with every id you are about to render; missing ones are
 * fetched once and the component re-renders when they arrive.
 */
export function usePeople(seed: Profile[]) {
  const [people, setPeople] = useState<Record<string, Profile>>(() =>
    Object.fromEntries(seed.map((p) => [p.id, p]))
  );
  const inFlight = useRef(new Set<string>());

  const remember = useCallback((profiles: Profile[]) => {
    setPeople((prev) => {
      const next = { ...prev };
      for (const p of profiles) next[p.id] = p;
      return next;
    });
  }, []);

  const ensure = useCallback(
    (ids: string[]) => {
      const missing = ids.filter((id) => !people[id] && !inFlight.current.has(id));
      for (const id of missing) {
        inFlight.current.add(id);
        api
          .user(id)
          .then((p) => remember([p]))
          .catch(() => remember([{ id, displayName: "Unknown user" }]))
          .finally(() => inFlight.current.delete(id));
      }
    },
    [people, remember]
  );

  const nameOf = useCallback((id: string) => people[id]?.displayName ?? "…", [people]);

  return { people, ensure, remember, nameOf };
}

export type People = ReturnType<typeof usePeople>;

/** Calls `ensure` whenever the list of ids changes. */
export function useEnsurePeople(people: People, ids: string[]) {
  const key = [...new Set(ids)].sort().join(",");
  useEffect(() => {
    if (key) people.ensure(key.split(","));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, people.ensure]);
}
