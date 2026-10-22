"use client";

import { LoaderCircle, MapPin, SearchX, TriangleAlert } from "lucide-react";
import { useEffect, useState, useSyncExternalStore, type KeyboardEvent } from "react";

import {
  createAddressSearch,
  enterSelection,
  searchFeedback,
  suggestionToIncident,
  type SearchFeedback as Feedback,
} from "@/lib/address-search";
import type { Incident } from "@/lib/useIncidentDispatch";
import type { GeocodeResult } from "@/types/telemetry";

type IncidentInputProps = {
  incident: Incident | null;
  geocodeEnabled: boolean;
  geocode: (query: string, signal?: AbortSignal) => Promise<GeocodeResult[]>;
  onIncidentChange: (incident: Incident) => void;
};

const LISTBOX_ID = "incident-suggestions";

/**
 * Address combobox. The parent remounts it (key) when the incident changes, so a
 * map click shows "Pinned lat, lng" in the box.
 */
export function IncidentInput({
  incident,
  geocodeEnabled,
  geocode,
  onIncidentChange,
}: IncidentInputProps) {
  const [query, setQuery] = useState(incident?.label ?? "");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [search] = useState(() => createAddressSearch(geocode));
  const searchState = useSyncExternalStore(search.subscribe, search.getState, search.getState);
  const { results, status } = searchState;
  useEffect(() => () => search.dispose(), [search]);
  const expanded = open && results.length > 0;

  function choose(result: GeocodeResult) {
    setQuery(result.label);
    setOpen(false);
    search.setQuery("");
    onIncidentChange(suggestionToIncident(result));
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!expanded) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((index) => (index + step + results.length) % results.length);
    } else if (event.key === "Enter") {
      const selection = enterSelection(results, active);
      if (!selection) return;
      event.preventDefault();
      choose(selection);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div>
      <label htmlFor="incident" className="dashboard-label">
        Incident location
      </label>
      <div className="relative mt-2">
        <input
          id="incident"
          type="text"
          role="combobox"
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={LISTBOX_ID}
          aria-activedescendant={expanded && active >= 0 ? `${LISTBOX_ID}-${active}` : undefined}
          disabled={!geocodeEnabled}
          placeholder={geocodeEnabled ? "Street and number, e.g. Floriańska 1" : "Click the map"}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            setActive(-1);
            search.setQuery(event.target.value);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          className="hud-input"
        />
        {status === "loading" ? (
          <LoaderCircle
            className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-beacon"
            aria-hidden
          />
        ) : (
          <MapPin
            className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-beacon"
            aria-hidden
          />
        )}
        {expanded && (
          <ul
            id={LISTBOX_ID}
            role="listbox"
            className="absolute z-30 mt-1.5 max-h-64 w-full overflow-y-auto rounded-xl border border-border bg-popover p-1 shadow-float"
          >
            {results.map((result, index) => (
              <li
                key={result.label}
                id={`${LISTBOX_ID}-${index}`}
                role="option"
                aria-selected={index === active}
                // mousedown, not click: the input's blur would close the list first.
                onMouseDown={(event) => {
                  event.preventDefault();
                  choose(result);
                }}
                className="cursor-pointer rounded-lg px-3 py-2 text-sm hover:bg-muted aria-selected:bg-accent"
              >
                {result.label}
              </li>
            ))}
          </ul>
        )}
      </div>
      <SearchFeedback feedback={geocodeEnabled ? searchFeedback(searchState, query) : null} />
      <p className="mt-1.5 text-[11px] text-muted-foreground">or click the map</p>
      {!geocodeEnabled && (
        <p className="mt-1 text-[11px] text-muted-foreground">Address search needs the backend</p>
      )}
    </div>
  );
}

/** Inline outcome of the last address search: a failure is an alert, no match is a status. */
export function SearchFeedback({ feedback }: { feedback: Feedback }) {
  if (feedback === "error") {
    return (
      <p
        role="alert"
        className="mt-1.5 flex items-center gap-1.5 text-[11px] font-medium text-emergency"
      >
        <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
        Address search unavailable — click the map instead
      </p>
    );
  }
  if (feedback === "no-match") {
    return (
      <p
        role="status"
        className="mt-1.5 flex items-center gap-1.5 text-[11px] font-medium text-caution"
      >
        <SearchX className="size-3.5 shrink-0" aria-hidden />
        No matching address
      </p>
    );
  }
  return null;
}
