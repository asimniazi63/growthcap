"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { parsePins, pinsKey, removePin } from "@/lib/overview/pinned-answers";
import { announceChange, browserStore, readRaw, STORE_EVENT, subscribeStore, writeRaw, type StoreChange } from "@/lib/shell/local-store";

// The markdown renderer is loaded only once there is something pinned to draw.
const PinnedCard = dynamic(() => import("./pinned-card").then((m) => m.PinnedCard), { loading: () => <div aria-hidden className="card skeleton h-40" /> });

// The answers this person pinned from the search window for this brand. They are kept in this browser, so the server never sees
// them and the first render is empty; the cards appear once the page is in the browser. If storage is blocked, nothing shows.
export function PinnedAnswers({ orgId, userId }: { orgId: string; userId: string }) {
  const key = pinsKey(orgId, userId);
  const read = useCallback(() => readRaw(browserStore(), key), [key]);
  const raw = useSyncExternalStore(subscribeStore, read, () => null);
  const pins = useMemo(() => parsePins(raw), [raw]);
  const [fresh, setFresh] = useState<string | null>(null); // the card that has just been pinned, which settles in
  const [note, setNote] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const uid = useId();

  useEffect(() => {
    const onChange = (e: Event) => {
      const change = (e as CustomEvent<StoreChange>).detail;
      if (change?.key === key && change.added) setFresh(change.added);
    };
    window.addEventListener(STORE_EVENT, onChange);
    return () => window.removeEventListener(STORE_EVENT, onChange);
  }, [key]);

  const unpin = (id: string) => {
    const rest = removePin(pins, id);
    if (!writeRaw(browserStore(), key, rest.length > 0 ? JSON.stringify(rest) : null)) {
      setNote("Couldn't unpin: this browser isn't letting the page save.");
      return;
    }
    announceChange({ key });
    setNote("Unpinned.");
    heading.current?.focus(); // the button that was pressed is gone with its card
  };

  return (
    <>
      {pins.length > 0 ? (
        <section aria-labelledby={`${uid}-title`}>
          <div className="mb-2.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <h2 id={`${uid}-title`} ref={heading} tabIndex={-1} className="section-title outline-none">
              Pinned answers
            </h2>
            <p className="faint text-xs">Saved in this browser. Each shows the figures as they were when it was asked.</p>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {pins.map((pin) => (
              <li key={pin.id} className="flex min-w-0">
                <PinnedCard pin={pin} fresh={pin.id === fresh} onUnpin={() => unpin(pin.id)} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <p role="status" className="sr-only">
        {note}
      </p>
    </>
  );
}
