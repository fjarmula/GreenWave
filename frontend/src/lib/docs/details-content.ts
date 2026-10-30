import type { Language } from "@/lib/localization";
import type { DocsBlock, DocsSection, FlowStep } from "./content";
import { etlSettingRows, simulationSettingRows } from "./details-settings";

/** Implementation details. Equations and identifiers are shared; every explanation is localized. */
function detailsSection(language: Language): DocsSection {
  const t = (pl: string, en: string) => (language === "pl" ? pl : en);
  const p = (pl: string, en: string): DocsBlock => ({ kind: "paragraph", text: t(pl, en) });
  const h = (pl: string, en: string): DocsBlock => ({ kind: "heading", text: t(pl, en) });
  const f = (pl: string, en: string, expression: string): DocsBlock => ({
    kind: "formula",
    label: t(pl, en),
    expression,
  });
  const step = (
    label: string,
    pl?: string,
    en?: string,
    branches: FlowStep["branches"] = undefined,
  ): FlowStep => ({ label, detail: pl && en ? t(pl, en) : undefined, branches });
  const branch = (label: string, pl: string, en: string) => ({ label, detail: t(pl, en) });
  const flow = (
    pl: string,
    en: string,
    steps: FlowStep[],
    cycle?: [string, string],
  ): DocsBlock => ({
    kind: "flow",
    label: t(pl, en),
    steps,
    cycle: cycle && t(...cycle),
  });
  const table = (pl: string[], en: string[], rows: string[][]): DocsBlock => ({
    kind: "table",
    columns: language === "pl" ? pl : en,
    rows,
  });

  return {
    id: "details",
    label: t("Szczegóły", "Details"),
    title: t("Szczegóły działania symulacji", "Simulation details"),
    blocks: [
      {
        kind: "note",
        text: t(
          "Wszystkie światła, odpowiedzi ITS i statusy dostępności są symulowane. To model do analizy, bez połączenia z rzeczywistymi sterownikami i bez potwierdzenia dokładności fizycznej. Parametry opóźnień i prędkości wymagają kalibracji.",
          "Every light, ITS answer and availability status here is simulated. This analytical model has no connection to physical controllers and has not been validated for physical accuracy. Delay and speed assumptions need calibration.",
        ),
      },
      h("Ustawienia: źródła i nadpisywanie", "Configuration sources and overrides"),
      p(
        "SimulationSettings powstaje przy starcie serwera i jest niezmienne. Argument konstruktora ma pierwszeństwo przed zmienną środowiskową GREENWAVE_SIM_<NAZWA_POLA>, a ta przed wartością domyślną. Klasy aplikacji nie konfigurują odczytu pliku .env, katalogu sekretów ani przeładowania w czasie działania. Launcher może przekazać zmienne do procesu. Żądanie API nie nadpisuje dowolnych parametrów silnika.",
        "SimulationSettings is created at server startup and frozen. Constructor arguments take precedence over GREENWAVE_SIM_<FIELD_NAME> environment variables, then field defaults. The app classes configure no dotenv reader, secrets directory or runtime reload. A launcher may supply process variables. API requests cannot override arbitrary engine parameters.",
      ),
      table(
        ["Zmienna / opcja", "Domyślnie", "Reguła"],
        ["Variable / option", "Default", "Rule"],
        [
          [
            "GREENWAVE_PROCESSED_DIR",
            "backend/data/processed",
            t(
              "Ścieżka względem pakietu; artefakty muszą przejść walidację.",
              "Package-relative path; artifacts must pass startup validation.",
            ),
          ],
          [
            "GREENWAVE_RAW_MANIFEST_PATH",
            "backend/data/raw/MANIFEST.json",
            t(
              "Manifest musi zgadzać się z przetworzonym zbiorem.",
              "Manifest must match the processed dataset.",
            ),
          ],
          [
            "GREENWAVE_CORS_ORIGINS",
            "http://localhost:3000",
            t(
              "Lista po przecinku, usunięte spacje/puste wpisy; brak walidatora URL. GET/POST, bez credentials.",
              "Comma-separated, trimmed, empty entries removed; no URL validator. GET/POST, no credentials.",
            ),
          ],
          [
            "NEXT_PUBLIC_SIMULATION_TRANSPORT",
            "mock",
            t(
              "Tylko mock/backend; błędna wartość daje ostrzeżenie i mock.",
              "Only mock/backend; invalid values warn and select mock.",
            ),
          ],
          [
            "NEXT_PUBLIC_API_BASE_URL",
            "http://127.0.0.1:8000",
            t(
              "Tylko HTTP(S); pozostaje origin i prefiks ścieżki, bez query/hash/końcowego /. Błąd przywraca domyślny adres.",
              "HTTP(S) only; keep origin/path prefix, strip query/hash/trailing slash. Invalid input uses the default.",
            ),
          ],
          [
            "stale / lost / start timeout / reconnects",
            "3 s / 15 s / 10000 ms / 5",
            t(
              "Stałe klienta, bez zmiennych środowiskowych.",
              "Client constants with no environment override.",
            ),
          ],
        ],
      ),
      p(
        "Jawne ścieżki create_app wygrywają ze środowiskiem. Wstrzyknięty dataset pomija odczyt dysku, ale nie można go łączyć z argumentami ścieżek. NEXT_PUBLIC_* jest utrwalane podczas budowania i buforowane raz na środowisko JS. Zmiana środowiska serwera nie zmienia gotowego frontendu. Walidacja żądań nie jest strict, a dodatkowe pola są domyślnie ignorowane.",
        "Explicit create_app paths override dataset environment paths. Injecting a dataset bypasses disk loading but cannot be combined with path arguments. NEXT_PUBLIC_* values are compiled into the frontend and cached once per JS runtime. Changing server environment does not update an existing bundle. Request validation is not strict and extra fields are ignored by default.",
      ),
      h("Parametry żądania i wartości interfejsu", "Request parameters and UI defaults"),
      table(
        ["Pole", "Domyślnie / zakres"],
        ["Field", "Default / range"],
        [
          [
            "simulation_id",
            t(
              "Wymagane; 1–64 znaki A–Z, a–z, 0–9, _ lub -. Aktywny duplikat: HTTP 409.",
              "Required; 1–64 characters A–Z, a–z, 0–9, _ or -. Active collision: HTTP 409.",
            ),
          ],
          [
            "origin / destination",
            t(
              "Wymagane; lat [−90,90], lng [−180,180]. W UI: baza → zdarzenie.",
              "Required; lat [−90,90], lng [−180,180]. UI sends base → incident.",
            ),
          ],
          [
            "traffic_density_multiplier",
            t(
              "Start: wymagane [1,3]; ranking: domyślnie 1; UI: 1.5.",
              "Start: required [1,3]; ranking default 1; UI default 1.5.",
            ),
          ],
          [
            "enable_cascade_mode / playback_speed",
            t(
              "Kaskada wymagana, UI true. Prędkość odtwarzania: liczba całkowita [1,10], domyślnie 1.",
              "Cascade required, UI true. Playback: integer [1,10], default 1.",
            ),
          ],
          [
            "vehicle_type / green_wave_mode",
            "AMBULANCE | FIRE_TRUCK | POLICE_CAR; ENABLED | DISABLED",
          ],
          ["its_scenario / its_outcome_seed", "NOMINAL; 0 ≤ seed ≤ 4294967295"],
          [
            "time_mode / resource_aware",
            t(
              "Ranking: ENABLED / false; świadomy zasobów tylko dla AMBULANCE.",
              "Ranking: ENABLED / false; resource-aware policy applies only to AMBULANCE.",
            ),
          ],
          [
            "scenario_time / availability",
            t(
              "Domyślnie czas Warszawy do minuty i pusty słownik; do 200 kodów zespołów z free/busy. Czas ze strefą przeliczany na Europe/Warsaw.",
              "Default Warsaw time to the minute and empty map; up to 200 team codes with free/busy. Zoned inputs convert to Europe/Warsaw.",
            ),
          ],
          [
            "geocode q / limit",
            t(
              "q: 2–100 znaków; limit: [1,10], domyślnie 8.",
              "q: 2–100 characters; limit: [1,10], default 8.",
            ),
          ],
        ],
      ),
      p(
        "Domyślny pojazd API to AMBULANCE, tryb ENABLED. Wszystkie typy korzystają z tego samego modelu prędkości; typ zmienia bazy i prezentację. UI obcina ziarno do liczby całkowitej i zakresu uint32; brak lub wartość niefinitywna daje 0. Porównanie wymaga dwóch różnych identyfikatorów, bez pola globalnego trybu.",
        "The API defaults to AMBULANCE and ENABLED. All vehicle types share the same speed model; type changes candidate bases and presentation. The UI truncates/clamps seeds into uint32, with absent/non-finite values becoming zero. Comparison requires two distinct IDs and has no overall run-mode field.",
      ),
      h("Pełny katalog parametrów silnika", "Complete engine parameter reference"),
      p(
        "Dla każdej nazwy użyj prefiksu GREENWAVE_SIM_ i wielkich liter. Jednostki znajdują się w nazwach: sekundy, metry, km/h lub m/s; czynniki i liczności są bezwymiarowe. finite oznacza jawny zakaz NaN i nieskończoności. Nie należy dopisywać takiej gwarancji pozostałym polom. Walidacja wymaga też ack_delay ≤ delayed_ack < ack_timeout, priority_green_tti ≤ clearing_tti oraz ambulance_min_speed ≤ ambulance_max_speed.",
        "Prefix each uppercase field name with GREENWAVE_SIM_. Names specify seconds, metres, km/h or m/s; factors and counts are dimensionless. finite means NaN/infinity are explicitly forbidden. Do not infer that guarantee for other fields. Validation also requires ack_delay ≤ delayed_ack < ack_timeout, priority_green_tti ≤ clearing_tti and ambulance_min_speed ≤ ambulance_max_speed.",
      ),
      table(
        ["Parametr", "Domyślnie", "Ograniczenia"],
        ["Parameter", "Default", "Bounds"],
        simulationSettingRows,
      ),
      h("Wybór trasy, dojazd pieszy i zasoby", "Routing, on-foot access and resources"),
      p(
        "Punkty końcowe są dopasowywane do najbliższych węzłów największej silnie spójnej składowej grafu. Limit dopasowania wynosi 150 m. Trasa minimalizuje sumę czasów krawędzi pojazdu uprzywilejowanego, włącznie z progami, ale bez kar skrzyżowań, gęstości i odpowiedzi ITS. Spośród równoległych krawędzi wygrywa najkrótszy czas, potem identyfikator. Oba tryby wybierają tę samą trasę.",
        "Endpoints snap to the nearest nodes in the graph’s largest strongly connected component, within 150 m. Routing minimizes emergency-vehicle edge time including calming, but excludes junction penalties, density and ITS outcomes. Parallel edges are chosen by minimum time, then ID. Both modes select the same route.",
      ),
      p(
        "Dojście piesze ma długość 1.3 r, gdzie r jest odległością prostą w metrach, tempo 1.4 m/s i limit 800 m. Węzeł dojazdu minimalizuje sumę czasu jazdy i marszu. Początek poza siecią jest błędem; tylko cel poza limitem snap uruchamia dojście piesze. Wybór dojazdu wyklucza węzeł początku, remisy rozstrzyga klucz węzła. Brak węzła w zasięgu daje DESTINATION_OFF_NETWORK, a brak osiągalnego dojazdu NO_ROUTE. Marsz omija model barier i jest raportowany osobno; KPI kończy się na dojeździe pojazdu.",
        "Walking access covers 1.3 r at 1.4 m/s, up to 800 m, where r is projected straight-line metres. The access node minimizes drive plus walk time. An off-network origin is an error; only a destination beyond the snap limit triggers walking access. Driven access excludes the origin node and breaks ties by node key. No node within walking reach gives DESTINATION_OFF_NETWORK; no reachable access gives NO_ROUTE. Walking ignores barriers and is reported separately; vehicle KPIs stop at vehicle arrival.",
      ),
      p(
        "Ranking baz używa odwróconej Dijkstry i domyślnie dokładniej ocenia pięć najlepszych baz, zwracając do trzech. Liczy czas wybranego trybu plus marsz. Baza na węźle zdarzenia może obsłużyć je na miejscu bez uruchamiania trasy; poza siecią marsz z bazy musi być szybszy niż przejazd, bo remis wygrywa jazda. Limit pięciu może pominąć bazę lepszą po uwzględnieniu sygnalizacji.",
        "Base ranking uses reversed Dijkstra, fully estimates the best five by default and returns up to three. It orders by the selected mode’s drive time plus walking. A base at the incident node can answer on site without a simulated route; off network, walking from the base must beat driving because driving wins ties. The five-base cut may omit a base that wins after signal timing is included.",
      ),
      p(
        "Ranking zasobów karetek ocenia wszystkie uprawnione bazy. Zespół musi być w sezonie i dniu tygodnia oraz w przedziale minut [od, do). OFF_SHIFT ma pierwszeństwo przed free; busy wyklucza zespół na dyżurze; brak nadpisania oznacza assumed_free. W bazie wybierany jest najpierw zespół z rejonu, potem według kodu. Typ zespołu nie jest współczynnikiem czasu.",
        "Resource-aware ambulance ranking evaluates every eligible base. A team must match season, weekday and the [from, to) minute window. OFF_SHIFT overrides free; busy excludes an on-shift team; no override means assumed_free. Within a base, in-area teams come first, then team code. Team type is not a time coefficient.",
      ),
      p(
        "Zespół z rejonu wygrywa, jeśli jest najwyżej 60 s wolniejszy od najszybszego. Rekomendacja jest pierwsza, reszta według czasu i identyfikatora bazy. Brak zespołów daje NO_ELIGIBLE_RESOURCE; istniejące zespoły bez osiągalnej bazy: NO_STATION_REACHABLE. Nieznany rejon oznacza wybór najbliższego czasowo. Rejon wynika z najbliższego adresu EMUiA w promieniu 250 m, a nie z testu zawierania punktu w wielokącie.",
        "An in-area team wins when it is at most 60 seconds slower than the fastest. The recommendation is first; remaining candidates sort by time then base ID. No eligible teams gives NO_ELIGIBLE_RESOURCE; eligible teams without a reachable base give NO_STATION_REACHABLE. Unknown area means nearest-by-time selection. Area comes from the nearest EMUiA address within 250 m, rather than polygon containment.",
      ),
      h("Trzy różne czasy przejazdu", "Three different journey times"),
      p(
        "Lₑ: metry krawędzi; Vₑ: zwykła prędkość w km/h; nₑ: liczba elementów uspokojenia ruchu; μ: gęstość [1,3]; Dᵢ: zapisane opóźnienie skrzyżowania; N: liczba unikalnych skrzyżowań. Buspas i torowisko dają największą z premii, nigdy ich iloczyn.",
        "Lₑ is edge metres, Vₑ ordinary km/h, nₑ calming-feature count, μ density in [1,3], Dᵢ stored junction delay and N unique junction count. Bus and tram advantages use the largest applicable boost, never their product.",
      ),
      f(
        "Prędkość krawędzi (km/h) i jej czas (s)",
        "Edge speed (km/h) and time (s)",
        "b_e = max(1, b_bus, b_tram)\nV_{a,e} = min(max(1.3 V_e b_e, 30), 90)\nt_{a,e} = L_e / (V_{a,e} / 3.6) + 2 n_e\nt_{n,e} = L_e μ ℓ_e s_e / (V_e / 3.6) + 3 n_e",
      ),
      p(
        "b_bus i b_tram wynoszą 1.05 na buspasie lub torowisku, inaczej 1. ℓₑ = 1.15 tylko dla jednego pasa w danym kierunku; inaczej 1. sₑ = 1.3 tylko dla rozpoznanej nawierzchni nieutwardzonej; inaczej 1. Nieznane cechy są neutralne. Powyższe liczby to wartości domyślne z katalogu parametrów.",
        "b_bus and b_tram are 1.05 on a bus lane or tram track, otherwise 1. ℓₑ is 1.15 for exactly one lane per direction, otherwise 1. sₑ is 1.3 for a recognized unpaved surface, otherwise 1. Unknown attributes are neutral. Numbers in these equations are the defaults from the parameter reference.",
      ),
      f(
        "Estymacje nominalne (domyślnie D_min = 3 s, Dᵢ = 35 s)",
        "Nominal estimates (defaults D_min = 3 s, Dᵢ = 35 s)",
        "T̂_normal = ∑_e t_{n,e} + ∑_i D_i\nT̂_greenwave = ∑_e t_{a,e} + N D_min",
      ),
      table(
        ["Pole", "Znaczenie"],
        ["Field", "Meaning"],
        [
          [
            "estimated_normal_time_sec",
            t(
              "Wzór dla zwykłego samochodu; nie jest czasem karetki w DISABLED. Kara raz na unikalne skrzyżowanie.",
              "Ordinary-car formula, not the DISABLED ambulance time. One delay per unique intersection.",
            ),
          ],
          [
            "estimated_greenwave_time_sec",
            t(
              "Nominalny model bez nieprzewidzianego oczekiwania na potwierdzenie, odmów i fallbacku.",
              "Nominal model without unconfirmed-green holds, rejection or fallback.",
            ),
          ],
          [
            "estimated_standard_time_sec",
            t(
              "Próbny przebieg tego samego integratora ruchu w DISABLED od t = 0, z ułamkowym czasem przyjazdu.",
              "Dry run of the same movement integrator in DISABLED from t = 0, including fractional arrival.",
            ),
          ],
        ],
      ),
      h(
        "Ruch, okna priorytetu i przekraczanie linii",
        "Movement, priority windows and stop-line crossings",
      ),
      p(
        "Na otwartej drodze prędkość efektywna to uₑ = Lₑ / tₐ,ₑ; koszt progów rozkłada się po krawędzi. Jedna iteracja ma budżet 1 s i dzieli go na końcach krawędzi, początku spowolnienia, liniach i celu. Ruch niesie pozostały czas na kolejną krawędź. Przyjazd zapisuje się z dokładnością do ułamka sekundy, a prędkość telemetryczna to faktyczne metry tej sekundy × 3.6.",
        "Open-road effective speed is uₑ = Lₑ / tₐ,ₑ, spreading calming cost across the edge. One iteration has a one-second budget split at edge ends, slowdown starts, stop lines and destination. Remaining time carries onto the next edge. Arrival retains subsecond precision; telemetry speed is metres actually moved that second × 3.6.",
      ),
      p(
        "Na skrzyżowaniu z priorytetem pojazd zwalnia płynnie do co najwyżej 15 km/h, tak aby przejazd trwał dodatkowo D_min. Spowolnienie zaczyna się najwyżej 60 m przed pierwszą linią, ale nie przed pierwszą linią poprzedniego skrzyżowania. R i E to pozostały dystans i dodatkowy czas; nakładające się okna mogą się łączyć. Brak miejsca daje postój D_min. Kolejne wewnętrzne linie priorytetowego skrzyżowania nie tworzą następnego spowolnienia. Dojazd do pierwszej linii wymaga następnie pokazanego zielonego z poprzedniego raportu; samo ACCEPTED nie wystarcza.",
        "At a priority junction the vehicle rolls down towards 15 km/h so the crossing costs D_min extra. Slowdown starts at most 60 m before the first line, but never before the previous junction’s first line. R and E are remaining distance and extra time; overlapping windows may merge. No room means a D_min dwell. Later internal priority lines do not add another slowdown. Departure from the first line then requires green shown in the previous report; ACCEPTED alone does not suffice.",
      ),
      p(
        "W DISABLED oraz na skrzyżowaniach fallback decyzja zapada przy każdej linii, w dokładnym czasie jej osiągnięcia. Zielone wszystkich właścicieli pozwala jechać dalej. Czerwone, żółte lub nieznane rozpoczyna ostrożny przejazd. u jest wtedy minimum efektywnej prędkości i zwykłego limitu drogi. Dla kilku właścicieli stosowany jest najdłuższy czas do zielonego; brak wiedzy zastępuje go Dᵢ.",
        "DISABLED and fallback decide at every stop line at its exact arrival time. Green for every owner drives on; red, yellow or unknown starts a cautious crossing. Here u is the minimum of effective ambulance speed and ordinary road limit. Multiple owners use the longest wait for green; an unknown movement substitutes Dᵢ.",
      ),
      p(
        "Ostrożny przejazd dolicza standard_clearance_factor × μ × czas do zielonego, najwyżej 15 s, rozłożone na co najmniej 30 m przy prędkości nie mniejszej niż 10 km/h. Długość jest sprawdzana względem najwolniejszych krawędzi, które obejmuje. Późniejsza krawędź o prędkości poniżej progu kończy okno na swoim początku i ogranicza koszt. Następna linia zastępuje aktywny standardowy przejazd; zielone może usunąć resztę kosztu. Fallback zastępuje własne spowolnienie, ale zachowuje resztę poprzedniego priorytetowego skrzyżowania. Cel ucina niewydany koszt. Limit 15 s dotyczy decyzji na linii, nie całego skrzyżowania o wielu liniach.",
        "A cautious crossing adds standard_clearance_factor × μ × wait for green, at most 15 s, spread over at least 30 m at no less than 10 km/h. Length is sized against the slowest covered edges. A later edge at/below the floor ends the window at its start and caps the extra cost. The next line replaces an active Standard crossing; green can clear its remainder. Fallback replaces its own slowdown but preserves an earlier priority junction’s remainder. Arrival truncates unspent cost. The 15-second cap is per stop-line decision, not per multi-line junction.",
      ),
      h("TTI, kaskada i długość żądania", "TTI, cascade and request hold"),
      f(
        "Wygładzona prędkość i czas do skrzyżowania",
        "Smoothed speed and time to intersection",
        "v̄_t = max(5, 0.25 Δx_t + 0.75 v̄_{t−1})\nTTI_i = max(0, s_i − x) / v̄_t",
      ),
      p(
        "sᵢ to pozycja pierwszej linii celu, a v̄₀ to efektywna prędkość pierwszej krawędzi (nie mniej niż próg). Ponieważ krok wynosi 1 s, Δx ma numerycznie wartość m/s. Przejechany cel ma TTI null. Dla nieżądanych i nieprzejechanych celów TTI ≤40 s kwalifikuje do żądania. Kaskada dodaje tylko cele w przód oddalone pierwsza-linia → pierwsza-linia o ≤250 m według wczytanego progu. Nie rozwija się rekurencyjnie. Tabela sąsiadów ETL służy do diagnostyki; nie blokuje dopasowania w modelu trasy.",
        "sᵢ is the target’s first stop line and v̄₀ the first edge’s effective speed, never below the floor. Because a step is one second, Δx numerically equals m/s. Passed targets report null TTI. Unrequested, unpassed targets become eligible at TTI ≤40 s. Cascade adds only forward first-line-to-first-line targets within the loaded threshold, default 250 m, without recursive expansion. ETL neighbour candidates are diagnostic evidence rather than a runtime membership gate.",
      ),
      f(
        "Czas zwolnienia i utrzymania priorytetu",
        "Release and hold duration",
        "R_i = T_open(x, last_i) + D_min J_i + E_rem\nH = max(40, ⌈max_i R_i⌉ + 5)",
      ),
      p(
        "Tₒₚₑₙ to czas jazdy bez kar do ostatniej linii celu, a E_rem pozostały dodatkowy czas. Przewidywany przyjazd UTC to teraz + min TTIᵢ / playback_speed. Jᵢ liczy nieprzejechane skrzyżowania do pierwszej linii celu lub z pierwszą linią wewnątrz jego ostatniej linii. Trwające spowolnienie bywa policzone konserwatywnie dwa razy. Domyślnie minimum H to 40 s, bufor 5 s. Kontrakt zawsze wymaga H ≥40 s. Zegar wygaśnięcia biegnie od wysłania, nie od akceptacji. Nie przewiduje przyszłych postojów ani fallbacku. Jeden pakiet na krok, cel żądany najwyżej raz.",
        "T_open is penalty-free driving time to the target’s last line and E_rem the remaining extra time. Expected UTC arrival is now + min TTIᵢ / playback_speed. Jᵢ counts unpassed junctions up to the target’s first line or whose first line lies inside its last line. An ongoing slowdown can be conservatively counted twice. H defaults to at least 40 seconds with a five-second buffer; the payload always requires H ≥40. Expiry runs from submission, not acceptance. Release estimates do not predict future holds or fallback. One grouped dispatch per step; each target is requested at most once.",
      ),
      h("Odpowiedzi ITS i deterministyczne wyniki", "ITS presets and deterministic outcomes"),
      table(
        ["Scenariusz", "Wynik", "Czas od wysłania"],
        ["Preset", "Outcome", "Time from submission"],
        [
          ["NOMINAL", "ACCEPTED", "1 s"],
          ["DELAYED", "ACCEPTED", "5 s"],
          ["REJECTED", "REJECTED / CONTROLLER_REJECTED", "1 s"],
          ["NO_FEEDBACK", "TIMED_OUT / ACK_TIMEOUT", "8 s"],
          [
            "MIXED",
            t(
              "Jeden z czterech powyższych wyników, wspólny dla grupy.",
              "One of the four outcomes above, shared by the target group.",
            ),
            t("Zależny od wyniku", "Outcome-specific"),
          ],
        ],
      ),
      p(
        "MIXED hashuje UTF-8 tekstu „ziarno:posortowane_ID” i wybiera wynik z dwóch najwyższych bitów: ACCEPT, ACCEPT_DELAYED, REJECT lub NO_RESPONSE. To FNV-1a z finalizatorem MurmurHash3 fmix32, a nie nowe losowanie w każdym kroku. Ziarno i uporządkowane identyfikatory celów wystarczają do odtworzenia. Czas i identyfikator przejazdu nie wpływają na hash; grupowanie kaskady może zmienić wynik. Każdy koszyk ma ¼ przestrzeni wyników, co nie gwarantuje 25% obserwacji w skończonej próbce. Stałe scenariusze ignorują ziarno.",
        "MIXED hashes the UTF-8 text “seed:sorted_IDs” and picks the outcome from the top two bits: ACCEPT, ACCEPT_DELAYED, REJECT or NO_RESPONSE. This is FNV-1a finalized with MurmurHash3 fmix32, not a fresh random draw every tick. Seed and sorted target IDs determine replay. Time and simulation ID are excluded; cascade grouping can change the outcome. Each bucket occupies one quarter of the output space, without guaranteeing 25% frequency in a finite sample. Fixed presets ignore the seed.",
      ),
      flow("Cykl życia żądania", "Request lifecycle", [
        step("REQUESTED", "wysłane przy TTI ≤ 40 s", "sent at TTI ≤ 40 s", [
          branch("REJECTED", "odmowa sterownika", "controller refuses"),
          branch("TIMED_OUT", "brak odpowiedzi w 8 s", "no answer within 8 s"),
        ]),
        step("ACCEPTED", "priorytet aktywny", "priority active", [
          branch("EXPIRED", "minął czas hold od wysłania", "hold elapsed since submission"),
        ]),
        step("RELEASED", "przejechano wszystkie cele", "every target passed"),
      ]),
      p(
        "Nieprzejechane cele żądań REJECTED, TIMED_OUT lub EXPIRED przechodzą na STANDARD_FALLBACK. REQUESTED przechodzi od razu w RELEASED, gdy pojazd minie wszystkie cele przed odpowiedzią. Najpierw sprawdzane jest przejechanie wszystkich celów, następnie termin odpowiedzi, a potem wygaśnięcie zaakceptowanego żądania. Spóźniona akceptacja po końcu hold daje od razu ACCEPTED i EXPIRED bez aktywacji. Timeout wycofuje żądanie i rezerwuje numer sekwencji. Ledger ignoruje złą symulację, nieznane żądanie, niezgodną kolejność celów, stary numer, cofnięty czas lub niedozwolone przejście. Identyczne ponowne wysłanie jest idempotentne, sprzeczne jest błędem.",
        "Unpassed targets of REJECTED, TIMED_OUT or EXPIRED requests cross as STANDARD_FALLBACK. REQUESTED goes straight to RELEASED when the vehicle passes every target before an answer. All-targets-passed release is checked first, then due acknowledgement, then accepted hold expiry. Acceptance after the hold deadline immediately produces ACCEPTED and EXPIRED without activating targets. Timeout withdraws the request and reserves a sequence number. The ledger ignores wrong simulations, unknown requests, mismatched ordered targets, stale sequence numbers, backward time and illegal transitions. Identical duplicate submission is idempotent; conflicting duplicates are errors.",
      ),
      h("Maszyna stanów skrzyżowania", "Intersection state machine"),
      flow(
        "Przejścia potwierdzonego stanu",
        "Reported state transitions",
        [
          step("NORMAL", "zwykły program", "ordinary programme"),
          step("CLEARING", "przyjęto, brak pokazanego zielonego", "accepted, green not yet shown", [
            branch(
              "NORMAL",
              "akceptacja kończy się przed przejazdem",
              "acceptance ends before passage",
            ),
          ]),
          step(
            "PRIORITY_GREEN",
            "TTI ≤ 25 s i wszystkie światła trasy GREEN",
            "TTI ≤ 25 s and every route head shows GREEN",
            [
              branch(
                "CLEARING",
                "TTI > 25 s lub brak potwierdzenia",
                "TTI > 25 s or green unconfirmed",
              ),
            ],
          ),
          step("RECOVERY", "ostatnia linia przejechana", "last line passed"),
        ],
        ["RECOVERY → NORMAL po 15 s", "RECOVERY → NORMAL after 15 s"],
      ),
      table(
        ["Stan", "Reguła"],
        ["State", "Rule"],
        [
          [
            "NORMAL",
            t(
              "Brak zaakceptowanego priorytetu lub zakończona regeneracja. Samo REQUESTED nie zmienia świateł.",
              "No accepted priority or recovery complete. REQUESTED alone changes no lights.",
            ),
          ],
          [
            "CLEARING",
            t(
              "Akceptacja bez kwalifikacji lub potwierdzonego zielonego. Konfliktowe pojazdy i piesi mają cel czerwony, trasa zachowuje zwykły program.",
              "Accepted without eligibility or confirmed green. Conflicting vehicles and pedestrians target red; route vehicles retain the ordinary programme.",
            ),
          ],
          [
            "PRIORITY_GREEN",
            t(
              "Akceptacja, TTI ≤25 s i wszystkie obsługiwane światła pojazdu na trasie pokazują zielone. Brak takich świateł nie potwierdza priorytetu.",
              "Accepted, TTI ≤25 s and all supported route vehicle heads shown green. Missing route heads cannot confirm priority.",
            ),
          ],
          [
            "RECOVERY",
            t(
              "Przejechano ostatnią linię po aktywnym priorytecie. Zwykły cykl wraca od razu; 15 s to stan odzyskiwania, a nie dodatkowa faza all-red.",
              "Last line passed after active priority. Ordinary cycle resumes immediately; 15 seconds is runtime recovery, not an extra all-red phase.",
            ),
          ],
        ],
      ),
      p(
        "Sterownik najpierw tworzy cele świateł, a dopiero potem obniża niepotwierdzone PRIORITY_GREEN do raportowanego CLEARING. Może też wejść z NORMAL od razu w PRIORITY_GREEN, a przejazd bez aktywnego priorytetu zostawia NORMAL. TTI jest oceniane ponownie, bez zatrzaskiwania progu. is_active_corridor oznacza dokładnie CLEARING lub PRIORITY_GREEN; is_cascade jest osobną flagą, nie stanem.",
        "The controller creates light targets before downgrading unconfirmed PRIORITY_GREEN to reported CLEARING, and can enter PRIORITY_GREEN directly from NORMAL; passage without active priority stays NORMAL. TTI eligibility is re-evaluated rather than latched. is_active_corridor means exactly CLEARING or PRIORITY_GREEN; is_cascade is separate metadata, not a state.",
      ),
      p(
        "Ostatnia linia pozostaje chroniona przez krok, który przenosi przez nią pojazd, oraz podczas postoju na wspólnej linii. Przyjazd na linię końcową utrzymuje ochronę dla przedziału przyjazdu, a odzyskiwanie zaczyna się później. Nieaktywowany lub nieudany priorytet nie wymaga RECOVERY. Anulowanie zamyka sterownik bez dodatkowego strumienia 15 s. Gdy brak znanych świateł na trasie, kontrola wyjazdu dopuszcza ruch mimo braku potwierdzonego zielonego.",
        "The last line remains protected through the movement interval carrying the vehicle across it and while waiting at a shared line. A destination on that line retains protection for the arrival interval before recovery begins. Priority never activated or already failed requires no RECOVERY. Cancellation closes the controller without another 15-second stream. With no known route vehicle heads, the departure check permits motion without confirming green.",
      ),
      h(
        "Program zwykły, priorytet i czasy przejść świateł",
        "Ordinary programme, priority and clearance timers",
      ),
      p(
        "Grupą ruchu jest uporządkowana tożsamość kontrolowanych krawędzi. Grupy trasy są łączone w jedną, potem posortowane grupy dostają numer modulo 2. Nie jest to graf konfliktów pasów. Sygnalizator bez znanej grupy nie ma wskaźnika. Węzły sygnalizacji obsługują pojazdy i pieszych, a przejścia piesze tylko pieszych. Dla wielu świateł trasy wybierany jest najbardziej restrykcyjny kolor: RED, YELLOW, GREEN.",
        "Movement identity comes from sorted controlled edges. Route groups merge into one; sorted groups then receive slots modulo two. This is not a lane-conflict graph. Signals without a known group have no indicator. Traffic-signal nodes support vehicles and pedestrians; crossing nodes pedestrians only. Multiple route lights use the most restrictive programme color: RED, YELLOW, GREEN.",
      ),
      p(
        "Każda grupa ma slot S = 30 s zielonego + 3 s żółtego + 2 s all-red = 35 s, więc cykl trwa 70 s i liczy się od absolutnego czasu symulacji. Czas oczekiwania trasy to 0 w jej zielonym, a inaczej czas do początku następnego zielonego slotu trasy. r w tabeli to czas od początku slotu.",
        "Each group has a slot S = 30 s green + 3 s yellow + 2 s all-red = 35 s, so the cycle lasts 70 s from absolute simulation time. The route’s wait is zero during its green, otherwise the time until its next green slot starts. In the table, r is time since the slot began.",
      ),
      table(
        ["Część slotu", "Aktywne pojazdy", "Inne pojazdy", "Piesi innej grupy"],
        ["Slot interval", "Active vehicles", "Other vehicles", "Other-group pedestrians"],
        [
          [
            "0 ≤ r < 30 s",
            "GREEN",
            "RED",
            t(
              "GREEN, jeśli pokazane pojazdy tej grupy są czerwone",
              "GREEN if shown vehicles on their arm are red",
            ),
          ],
          ["30 ≤ r < 33 s", "YELLOW", "RED", "RED"],
          ["33 ≤ r < 35 s", "RED", "RED", "RED"],
        ],
      ),
      p(
        "Piesi aktywnej grupy mają czerwone. NORMAL i RECOVERY korzystają z absolutnego czasu cyklu bez resetu. W CLEARING konfliktowe pojazdy i wszyscy piesi dostają cel czerwony; trasa pozostaje w zwykłym cyklu. PRIORITY_GREEN kieruje trasę na zielone, resztę na czerwone. Zmiana nie przeskakuje pokazanego żółtego.",
        "Pedestrians on the active arm stay red. NORMAL and RECOVERY follow absolute cycle time without reset. CLEARING targets conflicting vehicles and every pedestrian red while route vehicles keep cycling. PRIORITY_GREEN targets route vehicles green and everything else red. Switching does not skip displayed yellow.",
      ),
      flow(
        "Pokazane światła pojazdów",
        "Shown vehicle heads",
        [
          step("GREEN", "cel zielony", "target green"),
          step("YELLOW", "cel już nie jest zielony", "target no longer green"),
          step("RED", "po signal_yellow_seconds", "after signal_yellow_seconds"),
        ],
        [
          "RED → GREEN, gdy cel jest zielony, a każde inne światło bez zielonego celu było już RED",
          "RED → GREEN once the target is green and every other head not targeting green was already RED",
        ],
      ),
      p(
        "Nowe światło bez historii przyjmuje cel od razu. Żółte musi się skończyć nawet po powrocie zielonego celu; warunek używa poprzednich świateł, więc możliwy jest dodatkowy krok. Nie ma osobnego wymuszenia 2 s all-red przy dowolnym przełączeniu priorytetu — 2 s należą do zwykłego cyklu. Piesi nie mają żółtego i są blokowani przez zielone/żółte pojazdy na swoim ramieniu. Standard i fallback próbkują program w chwili dotarcia; priorytet sprawdza dodatkowo poprzednio pokazane światła.",
        "New heads initialize directly to target. Yellow must finish even if a green target returns; the check uses previous heads and can add another tick. An arbitrary priority switch has no independent two-second all-red hold: those two seconds belong to the ordinary cycle. Pedestrians have no yellow and are blocked by green/yellow vehicles on their arm. Standard and fallback sample the programme at arrival; priority additionally checks previously shown heads.",
      ),
      h("Oszczędność czasu i zaokrąglenia", "Time savings and rounding"),
      f(
        "Oszczędność względem przebiegu Standard",
        "Saving against the Standard baseline",
        "Δt_saved = round(T_S(x)) − round(t_elapsed)",
      ),
      p(
        "Tₛ(x) to czas próbnego przejazdu DISABLED na tej samej pozycji x, a t_elapsed to czas przyjazdu lub bieżący czas symulacji. W DISABLED oszczędność wynosi 0, a porównanie podaje różnicę przyjazdów DISABLED − ENABLED. Próbny przejazd zapisuje pozycję co sekundę i dokładny końcowy przyjazd. Tₛ interpoluje liniowo czas na tej samej pozycji, także gdy próbka przecina zmianę prędkości. KPI odejmuje osobno zaokrąglone czasy, nie zaokrągla różnicy, i dopuszcza wynik ujemny. Python używa zaokrąglenia połówek do parzystej. Odzyskiwanie świateł nie zwiększa elapsed. Porównanie czeka na dwa pomyślne zakończenia; pozycje w wyścigu są równe przy różnicy mniejszej niż 10 m.",
        "Tₛ(x) is the DISABLED dry run’s time at the same position x, and t_elapsed is arrival or current simulated time. DISABLED reports zero saving; comparison reports DISABLED − ENABLED arrival. The dry run samples positions each second and retains exact final arrival. Tₛ linearly interpolates time at the same position, including samples spanning speed changes. KPIs subtract separately rounded times rather than rounding a difference, and permit negative savings. Python uses ties-to-even. Recovery does not increase elapsed. Comparison requires both successful completion events; the live race calls gaps under 10 metres level.",
      ),
      h("Zegar, zastępowanie operacji i SSE", "Clock, replacement and SSE"),
      p(
        "Żądanie wysłane w danym kroku nie zmienia ruchu ani raportu tego kroku. Fallback działa od następnego ruchu. Każdy krok dodaje dokładnie 1 s i tick. Odtwarzanie p przy interwale I śpi max(0, I/p − czas_obliczeń); przekroczenie terminu jest logowane, bez serii nadrabiającej. ETA UTC dzieli przez p, ale nie uwzględnia niestandardowego I.",
        "A request submitted in a step cannot change that step’s movement or report. Fallback affects the next movement. Every step advances exactly one second and tick. Playback p with interval I sleeps max(0, I/p − processing_time); overruns are logged without catch-up bursts. UTC ETA divides by p but does not account for a nondefault I.",
      ),
      p(
        "Nowa operacja zastępuje poprzednią dopiero po udanym planowaniu; oba plany porównania muszą się udać. Stop jednego członka zatrzymuje parę. Awaria pętli kończy niezakończonych członków SERVER_ERROR, a jeden terminal na przejazd jest gwarantowany. Przyjazd i koniec operacji nie są tym samym. Historyczne ITS_REJECTED, ITS_TIMEOUT i ITS_HOLD_EXPIRED pozostają poprawnymi kodami kontraktu, ale silnik już ich nie emituje.",
        "Replacement supersedes the previous operation only after planning succeeds; both comparison plans must succeed. Stopping either member stops the pair. Loop failure ends unfinished members with SERVER_ERROR; publication permits only one terminal per run. Arrival and operation completion differ. Legacy ITS_REJECTED, ITS_TIMEOUT and ITS_HOLD_EXPIRED remain contract-valid but are no longer emitted by the engine.",
      ),
      p(
        "SSE zaczyna się retry: 2000; ramki mają event, id=tick i JSON data. Wiele zdarzeń może mieć ten sam tick. Reconnect dostaje ostatni stan i zdarzenia bieżące, nie odtwarza Last-Event-ID. Kolejka klienta ma domyślnie 32 zdarzenia i usuwa najstarsze, także feedback. Terminal wypiera zwykłe zdarzenie. Limit pamięci czterech sesji dotyczy sesji, nie operacji; aktywna para pozostaje. Rozłączenie nie zatrzymuje symulacji, a stan jest lokalny dla procesu serwera.",
        "SSE begins with retry: 2000; frames contain event, id=tick and JSON data. Several events can share a tick. Reconnect gets the latest snapshot and live events, not Last-Event-ID replay. A subscriber queue holds 32 events by default and drops the oldest, including feedback; terminal delivery displaces a nonterminal. Retention of four counts sessions rather than operations; an active pair is preserved. Disconnect does not stop simulation, and state is server-process-local.",
      ),
      h("Mock a backend", "Mock versus backend"),
      p(
        "Mock liczy odległość L po łuku koła wielkiego (haversine, R = 6371 km). Dla q = L / 5400 m zwykła estymacja wynosi 780 q μ / 1.5 s, a GreenWave 380 q s. Opóźnienie skrzyżowania to min(3 s, czas GreenWave / 2N).",
        "Mock measures L along a great circle (haversine, R = 6371 km). With q = L / 5400 m the ordinary estimate is 780 q μ / 1.5 s and GreenWave 380 q s. Junction delay is min(3 s, GreenWave time / 2N).",
      ),
      p(
        "Mock rysuje prostą zamiast trasy drogowej, bez snap. INT-9001 i INT-9002 leżą na ułamkach 1480/5400 i 1632/5400 długości. Zwykły limit wynosi 50 km/h, a czerwone używa stałego oczekiwania 35 s zamiast rzeczywistego czasu do zielonego. TTI jest czasem pozostałym na osi syntetycznej, nie EMA. Grupy S1/S2 są stałe; hold = max(40, ceil(max TTI)+5). Parametry backendu nie nadpisują stałych mock.",
        "Mock draws a straight line rather than a road route, with no snapping. INT-9001 and INT-9002 sit at fractions 1480/5400 and 1632/5400 of its length. Ordinary limit is 50 km/h; red uses a fixed 35-second wait instead of actual next-green time. TTI is remaining synthetic timeline time, not EMA. S1/S2 groups are fixed; hold = max(40, ceil(max TTI)+5). Backend settings do not override mock constants.",
      ),
      p(
        "Mock korzysta z tego samego hasha i domyślnych czasów 1/5/8 s. Po fallback przebudowuje tylko niezakończoną część osi czasu, zachowując przeszłość. JavaScript Math.round różni się od Python round przy połówkach. To zgodność demonstracyjna kontraktu, nie identyczność wyników numerycznych ani fallback serwera po błędzie.",
        "Mock shares the hash and default 1/5/8-second response timing. Fallback rebuilds only the undriven timeline, preserving its past. JavaScript Math.round differs from Python round at half values. This is a contract-level demonstration, not numerical parity or automatic server-error fallback.",
      ),
      h("Wnioski audytu i granice modelu", "Audit findings and model limits"),
      table(
        ["Obszar", "Ograniczenie implementacji"],
        ["Area", "Implementation limitation"],
        [
          [
            t("Estymacje", "Estimates"),
            t(
              "Nominalny GreenWave nie uwzględnia postojów sterownika i fallbacku. Rzeczywistą oszczędność daje Standard na tej samej pozycji lub dwa zakończone przejazdy.",
              "Nominal GreenWave excludes controller holds and fallback. Measured simulation savings use Standard at the same position or two completed runs.",
            ),
          ],
          [
            t("Dzielenie przez zero", "Division by zero"),
            t(
              "speed_floor_meters_per_second=0 i speed_ema_alpha=1 są dozwolone. Pełna sekunda postoju zeruje EMA, po czym TTI dzieli przez zero.",
              "speed_floor_meters_per_second=0 and speed_ema_alpha=1 are permitted. A full held second makes EMA zero and the next TTI divides by zero.",
            ),
          ],
          [
            t("Walidacja hold", "Hold validation"),
            t(
              "Ustawienie minimum hold poniżej 40 s i mały bufor mogą zbudować pakiet sprzeczny z kontraktem H ≥40, kończąc pętlę SERVER_ERROR.",
              "A hold minimum below 40 seconds plus a small buffer can produce a payload violating H ≥40, ending the loop with SERVER_ERROR.",
            ),
          ],
          [
            t("Dolna prędkość", "Rolling floor"),
            t(
              "Łączenie okien, zmiany krawędzi i ucięcie celu mogą obniżyć prędkość poniżej zamierzonego progu. Część floatów nie ma jawnego zakazu nieskończoności.",
              "Merged windows, edge changes and destination truncation can defeat the intended rolling floor. Several floats have no explicit infinity rejection.",
            ),
          ],
          [
            t("Sygnały", "Signals"),
            t(
              "Dwie grupy modulo 2 nie modelują pełnych konfliktów. Brak sygnałów nie potwierdza zielonego, ale pozwala na opuszczenie linii. Standard celowo przejeżdża czerwone ostrożnie.",
              "Two modulo slots do not model full conflicts. Missing heads cannot confirm green but permit line departure. Standard deliberately rolls red with caution.",
            ),
          ],
          [
            t("Optymalizacja", "Optimization"),
            t(
              "Najkrótsza suma krawędzi nie musi być najkrótszym czasem całej symulacji. Zwykły ranking ma limit pięciu baz; świadomy zasobów ocenia wszystkie uprawnione.",
              "Minimum edge cost need not minimize simulated trip time. Ordinary ranking cuts at five bases; resource-aware ranking evaluates all eligible bases.",
            ),
          ],
          [
            t("Zegar i połączenie", "Clock and connection"),
            t(
              "ETA UTC pomija niestandardowy interwał. EventSource nie udostępnia HTTP status: CORS/proxy może wyglądać jak brak sesji. Stop po timeout startu jest best-effort.",
              "UTC ETA omits nondefault interval. EventSource hides HTTP status, so CORS/proxy failures can look like missing sessions. Cleanup after start timeout is best-effort.",
            ),
          ],
          [
            t("Pamięć i odtwarzanie", "State and replay"),
            t(
              "Wyłączność jest na proces serwera, kolejki są stratne, brak trwałego replay. Więcej workerów nie współdzieli jednej operacji.",
              "Exclusivity is per server process, queues are lossy and there is no durable replay. Multiple workers do not share one operation.",
            ),
          ],
        ],
      ),
      p(
        "Brak modelu zakazów skrętu, dynamicznych kolejek, wielu oddziałujących pojazdów uprzywilejowanych, barier pieszych i rzeczywistej dostępności. μ nie spowalnia otwartej drogi karetki. Wyniki hashy nie są empiryczną niezawodnością ITS. Historyczne opisy 1 Hz czasu rzeczywistego i kończenia przejazdu po odmowie są zastąpione przez krok 1 s symulacji i fallback per skrzyżowanie.",
        "There is no model of turn restrictions, dynamic queues, interacting emergency vehicles, walking barriers or live availability. μ does not slow open-road ambulance movement. Hash outcomes are not empirical ITS reliability. Historical descriptions of 1 Hz wall-clock ticks and cancellation on rejection are superseded by one-second simulated steps and per-junction fallback.",
      ),
      h("Konfiguracja przygotowania danych", "Offline data-preparation configuration"),
      p(
        "Poniżej znajdują się wszystkie stałe etl/config.py, łącznie z progami raportów. To stałe Pythona, bez nadpisywania przez żądania. Zmiana danych pochodnych wymaga ponowienia odpowiednich etapów ETL. AREA_LOOKUP_RADIUS_M i ADDRESS_MATCH_CLEAN_M są także używane podczas działania serwera. Oznaczenia count_in_delay, exclude_and_reject i manual_review dotyczą traktowania sygnalizatorów.",
        "Every etl/config.py constant is listed below, including report-only thresholds. These are Python constants with no request override. Changing derived inputs requires rebuilding the affected ETL stages. AREA_LOOKUP_RADIUS_M and ADDRESS_MATCH_CLEAN_M also have runtime server consumers. count_in_delay, exclude_and_reject and manual_review describe signal handling.",
      ),
      table(["Stała", "Wartość"], ["Constant", "Value"], etlSettingRows),
      p(
        "Dodatnie całkowite maxspeed z opcjonalnym km/h wygrywa z prędkością klasy; np. mph, listy lub PL:urban trafiają do domyślnej z oznaczeniem źródła. Jawny oneway wygrywa, nawet no na rondzie; bez niego rondo/circular i motorway/link są jednokierunkowe. Wartości nieznane są zgłaszane. Cechy kierunkowe pasów wygrywają z sumą; sumy dwukierunkowe dzielone są na pół z minimum jednego pasa.",
        "Positive integer maxspeed with optional km/h wins over class speed; mph, lists and PL:urban use a source-marked default. Explicit oneway wins, even no on a roundabout; without it, roundabout/circular and motorway/link imply one-way. Unknown directions are reported. Directional lane tags override totals; two-way totals are halved with a minimum of one lane.",
      ),
      h("Źródła i zakres sprawdzenia", "Sources and verification scope"),
      p(
        "Opis sprawdzono z routing/edge_times, simulation/motion, controller, phases, priority_requests, session i telemetry, a następnie z niezależnym mock frontendu. Testy badają zgodność kodu i kontraktu, nie fizyczną poprawność parametrów. Wersja repozytoryjna zawiera odnośniki do konkretnych modułów i testów; treść matematyczna i katalog parametrów są dostępne powyżej bez opuszczania tej strony.",
        "The audit traced routing/edge_times, simulation/motion, controller, phases, priority_requests, session and telemetry, then checked the independent frontend mock. Tests verify implementation and contract behavior, not physical parameter accuracy. The repository reference links individual modules and tests; the equations and parameter catalog are available above without leaving this page.",
      ),
      {
        kind: "links",
        items: [
          {
            label: t("Audyt ze źródłami i testami", "Audit with source and test references"),
            href: "https://github.com/fjarmula/GreenWave/blob/main/docs/architecture/system-logic.md",
          },
          {
            label: t("Parametry silnika w kodzie", "Engine settings source"),
            href: "https://github.com/fjarmula/GreenWave/blob/main/backend/src/greenwave/simulation_settings.py",
          },
          {
            label: t("Kanoniczne schematy API", "Canonical API schemas"),
            href: "https://github.com/fjarmula/GreenWave/tree/main/backend/src/greenwave/schemas",
          },
        ],
      },
    ],
  };
}

export const detailsSections: Record<Language, DocsSection> = {
  pl: detailsSection("pl"),
  en: detailsSection("en"),
};
