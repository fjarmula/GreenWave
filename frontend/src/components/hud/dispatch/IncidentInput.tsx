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
          className="w-full rounded-lg border border-border bg-background px-3 py-3 pr-10 text-sm outline-none transition placeholder:text-muted-foreground/70 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-70"
        />
        {status === "loading" ? (
          <LoaderCircle
            className="pointer-events-none absolute top-3 right-3 size-4 animate-spin text-cyan-600 dark:text-cyan-300"
            aria-hidden
          />
        ) : (
          <MapPin
            className="pointer-events-none absolute top-3 right-3 size-4 text-cyan-600 dark:text-cyan-300"
            aria-hidden
          />
        )}
        {expanded && (
          <ul
            id={LISTBOX_ID}
            role="listbox"
            className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-border bg-card py-1 shadow-xl"
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
                className="cursor-pointer px-3 py-2 text-sm hover:bg-muted aria-selected:bg-cyan-500/15"
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
        className="mt-1.5 flex items-center gap-1.5 text-[11px] font-medium text-red-700 dark:text-red-300"
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
        className="mt-1.5 flex items-center gap-1.5 text-[11px] font-medium text-amber-700 dark:text-amber-300"
      >
        <SearchX className="size-3.5 shrink-0" aria-hidden />
        No matching address
      </p>
    );
  }
  return null;
}
