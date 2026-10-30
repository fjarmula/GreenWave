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
          "Wskazania świateł, odpowiedzi ITS i dostępność zespołów są symulowane. Model służy analizie i nie jest połączony z rzeczywistymi sterownikami. Nie zweryfikowano jego zgodności z rzeczywistym ruchem; parametry opóźnień i prędkości wymagają kalibracji.",
          "All signal indications, ITS responses and availability statuses are simulated. The model is not connected to physical controllers, and its physical accuracy has not been validated. Delay and speed assumptions require calibration.",
        ),
      },
      h("Ustawienia: źródła i nadpisywanie", "Configuration sources and overrides"),
      p(
        "Obiekt SimulationSettings jest tworzony przy uruchomieniu serwera i nie zmienia się w trakcie jego działania. Argument konstruktora ma pierwszeństwo przed zmienną środowiskową GREENWAVE_SIM_<FIELD_NAME>, a zmienna przed wartością domyślną. Aplikacja nie wczytuje samodzielnie pliku .env ani katalogu sekretów i nie przeładowuje ustawień podczas pracy. Zmienne środowiskowe może przekazać program uruchamiający serwer. Żądanie API nie pozwala zmieniać dowolnych parametrów silnika.",
        "SimulationSettings is created at server startup and remains unchanged. Constructor arguments override GREENWAVE_SIM_<FIELD_NAME> environment variables, which override defaults. The app does not load .env files or secret directories itself, or reload settings at runtime. The server launcher can supply environment variables. API requests cannot change arbitrary engine settings.",
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
              "Lista rozdzielona przecinkami, bez zbędnych spacji i pustych wpisów. Adresy URL nie są walidowane. GET/POST, bez przesyłania danych uwierzytelniających.",
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
              "Dozwolone jest HTTP(S). Zachowywany jest adres serwera i prefiks ścieżki; parametry zapytania, fragment i końcowe / są usuwane. Błędna wartość przywraca adres domyślny.",
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
        "Ścieżki przekazane do create_app mają pierwszeństwo przed ustawieniami środowiska. Przekazanie gotowego obiektu dataset pomija odczyt z dysku i wyklucza jednoczesne podanie ścieżek. Wartości NEXT_PUBLIC_* są zapisywane podczas budowania aplikacji i odczytywane raz w danym środowisku JS. Zmiana środowiska serwera nie aktualizuje gotowego panelu. Walidacja żądań dopuszcza konwersję typów, a dodatkowe pola są domyślnie ignorowane.",
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
              "Pole kaskady jest wymagane; domyślnie w interfejsie true. Prędkość odtwarzania: liczba całkowita [1,10], domyślnie 1.",
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
              "Wybór jednostki: ENABLED / false; uwzględnianie dostępności zespołów dotyczy tylko AMBULANCE.",
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
        "Domyślne wartości API to pojazd AMBULANCE i tryb ENABLED. Wszystkie rodzaje pojazdów korzystają z tego samego modelu prędkości; wybór pojazdu zmienia dostępne bazy i sposób prezentacji. Interfejs obcina część ułamkową ziarna i ogranicza wartość do zakresu uint32. Brak wartości, NaN lub nieskończoność daje 0. Porównanie wymaga dwóch różnych identyfikatorów; każdy przejazd ma własny tryb.",
        "The API defaults to AMBULANCE and ENABLED. All vehicle types use the same speed model; vehicle type determines available bases and presentation. The UI truncates the seed to an integer and clamps it to uint32. An absent value, NaN or infinity becomes 0. Comparison requires two distinct identifiers, with a separate mode for each run.",
      ),
      h("Pełny katalog parametrów silnika", "Complete engine parameter reference"),
      p(
        "Nazwę zmiennej środowiskowej tworzy prefiks GREENWAVE_SIM_ i nazwa pola zapisana wielkimi literami. Nazwy określają jednostki: sekundy, metry, km/h lub m/s. Współczynniki i liczności są bezwymiarowe. Oznaczenie finite wyklucza NaN i nieskończoność; nie dotyczy automatycznie pozostałych pól. Walidacja wymaga też ack_delay ≤ delayed_ack < ack_timeout, priority_green_tti ≤ clearing_tti oraz ambulance_min_speed ≤ ambulance_max_speed.",
        "Prefix each uppercase field name with GREENWAVE_SIM_. Names specify seconds, metres, km/h or m/s; factors and counts are dimensionless. finite means NaN/infinity are explicitly forbidden. Do not infer that guarantee for other fields. Validation also requires ack_delay ≤ delayed_ack < ack_timeout, priority_green_tti ≤ clearing_tti and ambulance_min_speed ≤ ambulance_max_speed.",
      ),
      table(
        ["Parametr", "Domyślnie", "Ograniczenia"],
        ["Parameter", "Default", "Bounds"],
        simulationSettingRows,
      ),
      h("Wybór trasy, dojazd pieszy i zasoby", "Routing, on-foot access and resources"),
      p(
        "Punkty początkowy i końcowy są dopasowywane do najbliższych węzłów największej silnie spójnej składowej grafu, w granicach 150 m. Wybrana trasa minimalizuje sumę czasów przejazdu krawędzi pojazdem uprzywilejowanym. Uwzględnia progi zwalniające, ale nie opóźnienia na skrzyżowaniach, gęstość ruchu ani odpowiedzi ITS. Spośród równoległych krawędzi wybierana jest ta o najkrótszym czasie; remisy rozstrzyga identyfikator. Oba tryby korzystają z tej samej trasy.",
        "Endpoints snap to the nearest nodes in the graph’s largest strongly connected component, within 150 m. Routing minimizes emergency-vehicle edge time including calming, but excludes junction penalties, density and ITS outcomes. Parallel edges are chosen by minimum time, then ID. Both modes select the same route.",
      ),
      p(
        "Model dojścia pieszego przyjmuje dystans 1.3 r, prędkość 1.4 m/s i limit 800 m; r oznacza odległość w linii prostej w układzie metrycznym. Węzeł kończący dojazd pojazdu minimalizuje łączny czas jazdy i marszu. Początek poza siecią oznacza błąd. Tylko cel poza limitem dopasowania do sieci uruchamia wariant z dojściem pieszym. Węzeł początkowy jest wykluczony z wyboru punktu dojazdu, a remisy rozstrzyga klucz węzła. Brak węzła w zasięgu daje DESTINATION_OFF_NETWORK, a brak osiągalnej trasy NO_ROUTE. Model marszu nie uwzględnia barier terenowych. Czas dojścia jest podawany osobno; KPI obejmują tylko dojazd pojazdu.",
        "Walking access covers 1.3 r at 1.4 m/s, up to 800 m, where r is projected straight-line metres. The access node minimizes drive plus walk time. An off-network origin is an error; only a destination beyond the snap limit triggers walking access. Driven access excludes the origin node and breaks ties by node key. No node within walking reach gives DESTINATION_OFF_NETWORK; no reachable access gives NO_ROUTE. Walking ignores barriers and is reported separately; vehicle KPIs stop at vehicle arrival.",
      ),
      p(
        "Wybór bazy rozpoczyna się od algorytmu Dijkstry na grafie o odwróconych krawędziach. Domyślnie pięć najlepszych baz przechodzi pełne obliczenia czasu, a wynik zawiera do trzech propozycji. Kolejność zależy od czasu jazdy w wybranym trybie i czasu marszu. Jeśli baza leży na węźle zdarzenia, zespół może dotrzeć pieszo bez uruchamiania przejazdu. Poza siecią marsz bezpośrednio z bazy jest wybierany tylko wtedy, gdy trwa krócej niż jazda; przy remisie wybierana jest jazda. Wstępny limit pięciu baz może pominąć bazę, która byłaby lepsza po uwzględnieniu sygnalizacji.",
        "Base selection starts with Dijkstra’s algorithm on the reversed graph. By default, the five fastest candidates receive full journey-time estimates and up to three are returned. Selection uses driving time in the chosen mode plus walking time. A team based at the incident’s node can respond on foot without a simulated drive. For off-network incidents, walking directly from a base is selected only if it is faster than driving; driving wins ties. The initial five-base limit may exclude a base that would be faster once signal timing is included.",
      ),
      p(
        "Wybór karetki z uwzględnieniem dostępności obejmuje wszystkie bazy z zespołami spełniającymi warunki. Sprawdzane są sezon, dzień tygodnia i przedział minut [od, do). Stan OFF_SHIFT wyklucza zespół niezależnie od wartości free. Wartość busy wyklucza zespół będący na dyżurze; brak nadpisania oznacza assumed_free. W danej bazie pierwszeństwo ma zespół z rejonu zdarzenia, a następnie decyduje kod zespołu. Typ zespołu nie wpływa na obliczany czas.",
        "Resource-aware ambulance ranking evaluates every eligible base. A team must match season, weekday and the [from, to) minute window. OFF_SHIFT overrides free; busy excludes an on-shift team; no override means assumed_free. Within a base, in-area teams come first, then team code. Team type is not a time coefficient.",
      ),
      p(
        "Zespół z rejonu jest zalecany, jeśli dojedzie najwyżej 60 s później niż najszybszy zespół. Zalecana jednostka jest pierwsza na liście, a pozostałe są uporządkowane według czasu i identyfikatora bazy. Brak dostępnych zespołów daje NO_ELIGIBLE_RESOURCE; brak osiągalnej bazy mimo dostępnych zespołów daje NO_STATION_REACHABLE. Przy nieznanym rejonie decyduje najkrótszy czas dojazdu. Rejon ustala się na podstawie najbliższego adresu EMUiA w promieniu 250 m, bez sprawdzania, czy punkt leży wewnątrz granic rejonu.",
        "An in-area team is recommended if it arrives no more than 60 seconds after the fastest team. The recommendation appears first; others are ordered by time and base ID. No eligible teams yields NO_ELIGIBLE_RESOURCE. Eligible teams without a reachable base yield NO_STATION_REACHABLE. If the incident area is unknown, estimated arrival time alone decides. The area comes from the nearest EMUiA address within 250 m, without testing whether the incident lies inside an area boundary.",
      ),
      h("Trzy różne czasy przejazdu", "Three different journey times"),
      p(
        "Lₑ oznacza długość krawędzi w metrach, Vₑ zwykły limit prędkości w km/h, nₑ liczbę elementów uspokojenia ruchu, μ mnożnik gęstości [1,3], Dᵢ zapisane opóźnienie skrzyżowania, a N liczbę unikalnych skrzyżowań. Dla buspasa i torowiska stosuje się większy z odpowiednich współczynników, a nie ich iloczyn.",
        "Lₑ is edge length in metres, Vₑ the ordinary speed limit in km/h, nₑ the number of traffic-calming features, μ the density multiplier [1,3], Dᵢ the stored intersection delay and N the number of unique intersections. Bus-lane and tram-track adjustments use the larger applicable boost, not their product.",
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
        "Szacowane czasy nominalne (domyślnie D_min = 3 s, Dᵢ = 35 s)",
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
              "Czas zwykłego samochodu, a nie karetki w trybie DISABLED. Opóźnienie jest doliczane raz na unikalne skrzyżowanie.",
              "Ordinary-car formula, not the DISABLED ambulance time. One delay per unique intersection.",
            ),
          ],
          [
            "estimated_greenwave_time_sec",
            t(
              "Szacunek nominalny, bez dodatkowego oczekiwania na potwierdzenie, odmów ani przejazdu na zwykłej sygnalizacji po nieudanym żądaniu.",
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
        "Na odcinku drogi poza skrzyżowaniem prędkość efektywna wynosi uₑ = Lₑ / tₐ,ₑ; opóźnienie od progów jest rozłożone na całej krawędzi. Jeden krok ma budżet 1 s, dzielony na końcach krawędzi, początku spowolnienia, liniach zatrzymania i punkcie docelowym. Pozostały czas można wykorzystać na kolejnej krawędzi. Czas przyjazdu jest zapisywany z częścią ułamkową. Prędkość w telemetrii odpowiada liczbie metrów rzeczywiście przejechanych w tej sekundzie × 3.6.",
        "Open-road effective speed is uₑ = Lₑ / tₐ,ₑ, spreading calming cost across the edge. One iteration has a one-second budget split at edge ends, slowdown starts, stop lines and destination. Remaining time carries onto the next edge. Arrival retains subsecond precision; telemetry speed is metres actually moved that second × 3.6.",
      ),
      p(
        "Przed skrzyżowaniem z priorytetem pojazd płynnie zwalnia, rozkładając dodatkowy czas D_min na odcinku dojazdu. Okno jest dobierane z założeniem dolnej prędkości 15 km/h, z ograniczeniami opisanymi we wnioskach audytu. Spowolnienie zaczyna się najwyżej 60 m przed pierwszą linią zatrzymania, ale nie przed pierwszą linią poprzedniego skrzyżowania. R i E oznaczają pozostały dystans i dodatkowy czas; nakładające się okna mogą się łączyć. Gdy brakuje miejsca, pojazd zatrzymuje się na D_min. Kolejne linie tego samego skrzyżowania nie rozpoczynają następnego spowolnienia. Opuszczenie pierwszej linii wymaga zielonego światła potwierdzonego w poprzednim raporcie; samo ACCEPTED nie wystarcza.",
        "Before a priority intersection, the vehicle slows smoothly to spread the additional D_min time across its approach. The window is sized for a 15 km/h lower speed bound, subject to the limitations listed in the audit findings. Slowdown begins at most 60 m before the first stop line, but not before the previous intersection’s first line. R and E are remaining distance and extra time; overlapping windows can merge. If there is no room, the vehicle waits for D_min. Later lines in the same priority intersection do not start another slowdown. Departure from the first line requires route green confirmed in the previous report; ACCEPTED alone is insufficient.",
      ),
      p(
        "W trybie DISABLED oraz po przejściu skrzyżowania na zwykłą sygnalizację decyzja zapada przy każdej linii zatrzymania, dokładnie w chwili jej osiągnięcia. Jeśli wszystkie kierunki przypisane do tej linii mają zielone, pojazd jedzie dalej. Czerwone, żółte lub nieznany stan rozpoczyna ostrożny przejazd. Prędkość u jest wtedy mniejszą z prędkości efektywnej i zwykłego limitu drogi. Jeśli linię kontroluje kilka skrzyżowań, przyjmowany jest najdłuższy czas do zielonego; gdy nie jest znany, zastępuje go Dᵢ.",
        "DISABLED and fallback decide at every stop line at its exact arrival time. Green for every owner drives on; red, yellow or unknown starts a cautious crossing. Here u is the minimum of effective ambulance speed and ordinary road limit. Multiple owners use the longest wait for green; an unknown movement substitutes Dᵢ.",
      ),
      p(
        "Ostrożny przejazd dolicza standard_clearance_factor × μ × czas do zielonego, najwyżej 15 s, rozłożone na co najmniej 30 m przy prędkości nie mniejszej niż 10 km/h. Długość jest sprawdzana względem najwolniejszych krawędzi, które obejmuje. Późniejsza krawędź o prędkości poniżej progu kończy okno na swoim początku i ogranicza koszt. Następna linia zastępuje aktywny standardowy przejazd; zielone może usunąć resztę kosztu. Fallback zastępuje własne spowolnienie, ale zachowuje resztę poprzedniego priorytetowego skrzyżowania. Cel ucina niewydany koszt. Limit 15 s dotyczy decyzji na linii, nie całego skrzyżowania o wielu liniach.",
        "A cautious crossing adds standard_clearance_factor × μ × wait for green, at most 15 s, spread over at least 30 m at no less than 10 km/h. Length is sized against the slowest covered edges. A later edge at/below the floor ends the window at its start and caps the extra cost. The next line replaces an active Standard crossing; green can clear its remainder. Fallback replaces its own slowdown but preserves an earlier priority junction’s remainder. Arrival truncates unspent cost. The 15-second cap is per stop-line decision, not per multi-line junction.",
      ),
      h("TTI, grupowanie skrzyżowań i czas priorytetu", "TTI, cascade and request hold"),
      f(
        "Wygładzona prędkość i czas do skrzyżowania",
        "Smoothed speed and time to intersection",
        "v̄_t = max(5, 0.25 Δx_t + 0.75 v̄_{t−1})\nTTI_i = max(0, s_i − x) / v̄_t",
      ),
      p(
        "sᵢ oznacza pozycję pierwszej linii zatrzymania danego skrzyżowania, a v̄₀ prędkość efektywną pierwszej krawędzi, nie mniejszą od ustawionego progu. Ponieważ krok trwa 1 s, przejechany dystans Δx jest liczbowo równy prędkości w m/s. Dla miniętego skrzyżowania TTI wynosi null. Skrzyżowanie bez wcześniejszego żądania kwalifikuje się do priorytetu przy TTI ≤40 s. Kaskada dołącza kolejne skrzyżowania w odległości ≤250 m między pierwszymi liniami zatrzymania, zgodnie z wczytanym progiem. Nie jest rozwijana rekurencyjnie. Tabela sąsiadów ETL służy diagnostyce i nie ogranicza wyboru celów w modelu trasy.",
        "sᵢ is the position of the intersection’s first stop line. Initial speed v̄₀ is the first edge’s effective speed, bounded below by the configured floor. Over a one-second step, distance Δx is numerically equal to speed in m/s. Passed intersections report null TTI. An unrequested intersection becomes eligible at TTI ≤40 s. Cascade adds forward intersections whose first stop lines are within the loaded threshold, default 250 m, without recursive expansion. The ETL neighbour table supports diagnostics and does not restrict route-model target selection.",
      ),
      f(
        "Czas zwolnienia i utrzymania priorytetu",
        "Release and hold duration",
        "R_i = T_open(x, last_i) + D_min J_i + E_rem\nH = max(40, ⌈max_i R_i⌉ + 5)",
      ),
      p(
        "Tₒₚₑₙ oznacza czas jazdy bez opóźnień skrzyżowań do ostatniej linii zatrzymania danego celu, a E_rem pozostały dodatkowy czas. Przewidywany przyjazd UTC to teraz + min TTIᵢ / playback_speed. Jᵢ to liczba nieprzejechanych skrzyżowań, których pierwsza linia leży nie dalej niż pierwsza linia celu lub przed jego ostatnią linią. Dla zachowania zapasu trwające spowolnienie może zostać uwzględnione dwukrotnie. Domyślnie minimum H to 40 s, bufor 5 s. Kontrakt zawsze wymaga H ≥40 s. Czas do wygaśnięcia jest liczony od wysłania, a nie od przyjęcia żądania. Szacunek nie uwzględnia przyszłych postojów ani przejścia na zwykłą sygnalizację. W jednym kroku wysyłany jest najwyżej jeden pakiet, a każdy cel otrzymuje żądanie najwyżej raz.",
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
        "Scenariusz MIXED oblicza hash tekstu „seed:sorted_IDs” zakodowanego w UTF-8. Dwa najwyższe bity wybierają wynik: ACCEPT, ACCEPT_DELAYED, REJECT lub NO_RESPONSE. Używany jest FNV-1a z finalizatorem MurmurHash3 fmix32; wynik nie jest losowany ponownie w każdym kroku. Do odtworzenia wystarczą ziarno i posortowane identyfikatory celów. Czas i identyfikator symulacji nie wpływają na wynik, ale zmiana grupy skrzyżowań może go zmienić. Każda z czterech kategorii zajmuje ¼ przestrzeni wyników hasha, co nie gwarantuje udziału 25% w skończonej próbie. Pozostałe scenariusze ignorują ziarno.",
        "MIXED hashes the UTF-8 text “seed:sorted_IDs”. Its two highest bits select ACCEPT, ACCEPT_DELAYED, REJECT or NO_RESPONSE. The algorithm is FNV-1a with the MurmurHash3 fmix32 finalizer; it does not draw a new outcome each step. The seed and sorted target IDs determine the result. Time and simulation ID do not affect it, but changing the intersection group can change the outcome. Each bucket occupies ¼ of the hash output space, without guaranteeing a 25% share in a finite sample. Fixed presets ignore the seed.",
      ),
      flow("Cykl życia żądania", "Request lifecycle", [
        step("REQUESTED", "wysłane przy TTI ≤ 40 s", "sent at TTI ≤ 40 s", [
          branch("REJECTED", "odmowa sterownika", "controller refuses"),
          branch("TIMED_OUT", "brak odpowiedzi w 8 s", "no answer within 8 s"),
        ]),
        step("ACCEPTED", "priorytet aktywny", "priority active", [
          branch(
            "EXPIRED",
            "upłynął czas utrzymania priorytetu liczony od wysłania",
            "hold elapsed since submission",
          ),
        ]),
        step("RELEASED", "przejechano wszystkie cele", "every target passed"),
      ]),
      p(
        "Nieprzejechane cele żądań REJECTED, TIMED_OUT lub EXPIRED przechodzą na STANDARD_FALLBACK. REQUESTED przechodzi od razu w RELEASED, gdy pojazd minie wszystkie cele przed odpowiedzią. Najpierw sprawdzane jest przejechanie wszystkich celów, następnie termin odpowiedzi, a potem wygaśnięcie zaakceptowanego żądania. Spóźniona akceptacja po upływie czasu utrzymania priorytetu daje od razu ACCEPTED i EXPIRED bez aktywacji. Przekroczenie limitu czasu wycofuje żądanie i rezerwuje numer sekwencji. Rejestr żądań pomija odpowiedzi dotyczące innej symulacji, nieznane żądanie, niezgodną kolejność celów, stary numer, czas wcześniejszy od ostatniej aktualizacji lub niedozwolone przejście. Identyczne ponowne wysłanie jest idempotentne, sprzeczne jest błędem.",
        "Unpassed targets of REJECTED, TIMED_OUT or EXPIRED requests cross as STANDARD_FALLBACK. REQUESTED goes straight to RELEASED when the vehicle passes every target before an answer. All-targets-passed release is checked first, then due acknowledgement, then accepted hold expiry. Acceptance after the hold deadline immediately produces ACCEPTED and EXPIRED without activating targets. Timeout withdraws the request and reserves a sequence number. The ledger ignores wrong simulations, unknown requests, mismatched ordered targets, stale sequence numbers, backward time and illegal transitions. Identical duplicate submission is idempotent; conflicting duplicates are errors.",
      ),
      h("Maszyna stanów skrzyżowania", "Intersection state machine"),
      flow(
        "Przejścia potwierdzonego stanu",
        "Reported state transitions",
        [
          step("NORMAL", "zwykły program", "ordinary programme"),
          step(
            "CLEARING",
            "przyjęto, brak pokazanego zielonego",
            "accepted, route green not yet confirmed",
            [
              branch(
                "NORMAL",
                "akceptacja kończy się przed przejazdem",
                "acceptance ends before passage",
              ),
            ],
          ),
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
              "Brak zaakceptowanego priorytetu lub zakończony powrót do zwykłego programu. Samo REQUESTED nie zmienia świateł.",
              "No accepted priority or recovery complete. REQUESTED alone changes no lights.",
            ),
          ],
          [
            "CLEARING",
            t(
              "Żądanie jest przyjęte, ale próg TTI nie został osiągnięty lub zielone nie jest potwierdzone. Dla kolidujących kierunków i pieszych docelowym kolorem jest czerwony; trasa zachowuje zwykły program.",
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
              "Pojazd minął ostatnią linię po przejeździe z aktywnym priorytetem. Zwykły cykl wraca od razu; przez 15 s trwa stan powrotu do zwykłego programu, a nie dodatkowa faza all-red.",
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
        "Ostatnia linia pozostaje chroniona przez krok, który przenosi przez nią pojazd, oraz podczas postoju na wspólnej linii. Przyjazd na linię końcową utrzymuje ochronę dla przedziału przyjazdu, a powrót do zwykłego programu zaczyna się później. Nieaktywowany lub nieudany priorytet nie wymaga RECOVERY. Anulowanie zamyka sterownik bez dodatkowego strumienia 15 s. Gdy brak znanych świateł na trasie, kontrola wyjazdu dopuszcza ruch mimo braku potwierdzonego zielonego.",
        "The last line remains protected through the movement interval carrying the vehicle across it and while waiting at a shared line. A destination on that line retains protection for the arrival interval before recovery begins. Priority never activated or already failed requires no RECOVERY. Cancellation closes the controller without another 15-second stream. With no known route vehicle heads, the departure check permits motion without confirming green.",
      ),
      h(
        "Program zwykły, priorytet i czasy przejść świateł",
        "Ordinary programme, priority and clearance timers",
      ),
      p(
        "Grupę ruchu wyznacza uporządkowany zestaw identyfikatorów kontrolowanych krawędzi. Grupy leżące na trasie są łączone w jedną; następnie posortowanym grupom przypisuje się jeden z dwóch przedziałów cyklu, według numeru modulo 2. Nie jest to pełny model kolizji kierunków ruchu na pasach. Sygnalizator bez znanej grupy nie otrzymuje wskaźnika. Węzły sygnalizacji obejmują pojazdy i pieszych, a węzły przejść wyłącznie pieszych. Dla kilku świateł na trasie obowiązuje najbardziej restrykcyjny kolor: RED, YELLOW, GREEN.",
        "A movement group is identified by its sorted controlled-edge IDs. Groups on the route merge into one; the sorted groups then receive one of two cycle slots by ordinal modulo 2. This is not a complete lane-conflict model. Signals without a known group have no indicator. Traffic-signal nodes support vehicles and pedestrians; crossing nodes support pedestrians only. Multiple route lights use the most restrictive color: RED, YELLOW, GREEN.",
      ),
      p(
        "Każda grupa ma przedział S = 30 s zielonego + 3 s żółtego + 2 s czerwonego dla wszystkich kierunków (all-red) = 35 s. Cykl trwa więc 70 s i jest wyznaczany na podstawie bezwzględnego czasu symulacji. W czasie zielonego oczekiwanie wynosi 0; poza nim jest to czas do następnego zielonego dla kierunku przejazdu. W tabeli r oznacza czas od początku przedziału.",
        "Each group has a slot S = 30 s green + 3 s yellow + 2 s all-red = 35 s, so the cycle lasts 70 s from absolute simulation time. The route’s wait is zero during its green, otherwise the time until its next green slot starts. In the table, r is time since the slot began.",
      ),
      table(
        [
          "Przedział czasu",
          "Pojazdy aktywnej grupy",
          "Pojazdy pozostałych grup",
          "Piesi innej grupy",
        ],
        ["Slot interval", "Active vehicles", "Other vehicles", "Other-group pedestrians"],
        [
          [
            "0 ≤ r < 30 s",
            "GREEN",
            "RED",
            t(
              "GREEN, jeśli sygnalizatory pojazdów tej grupy pokazują czerwone",
              "GREEN if vehicle signals on their arm show red",
            ),
          ],
          ["30 ≤ r < 33 s", "YELLOW", "RED", "RED"],
          ["33 ≤ r < 35 s", "RED", "RED", "RED"],
        ],
      ),
      p(
        "Piesi na ramieniu obsługiwanym przez aktywną grupę mają czerwone. W stanach NORMAL i RECOVERY cykl jest kontynuowany bez zerowania czasu. CLEARING ustawia docelowo czerwone dla kolidujących kierunków i wszystkich pieszych; kierunek przejazdu pozostaje w zwykłym cyklu. PRIORITY_GREEN ustawia docelowo zielone dla trasy, a czerwone dla pozostałych kierunków. Zmiana wskazania nie pomija żółtego światła.",
        "Pedestrians on the active arm stay red. NORMAL and RECOVERY follow absolute cycle time without reset. CLEARING targets conflicting vehicles and every pedestrian red while route vehicles keep cycling. PRIORITY_GREEN targets route vehicles green and everything else red. Switching does not skip displayed yellow.",
      ),
      flow(
        "Pokazane światła pojazdów",
        "Shown vehicle heads",
        [
          step("GREEN", "docelowy kolor zielony", "target green"),
          step("YELLOW", "docelowy kolor inny niż zielony", "target no longer green"),
          step("RED", "po signal_yellow_seconds", "after signal_yellow_seconds"),
        ],
        [
          "RED → GREEN, gdy cel jest zielony, a każde inne światło bez docelowego zielonego było już RED",
          "RED → GREEN once the target is green and every other head not targeting green was already RED",
        ],
      ),
      p(
        "Nowy wskaźnik, bez poprzedniego stanu, od razu przyjmuje docelowy kolor. Rozpoczęte żółte musi dobiec końca, nawet jeśli ponownie zażądano zielonego. Warunek korzysta z poprzednich wskazań, dlatego przełączenie może wymagać dodatkowego kroku. Przy zmianie priorytetu nie ma osobnego wymogu 2 s all-red — ten czas należy do zwykłego cyklu. Wskazania dla pieszych nie mają fazy żółtej; zielone lub żółte pojazdów na tym samym ramieniu blokuje zielone dla pieszych. Przejazd bez priorytetu korzysta z programu w chwili osiągnięcia linii, a priorytet dodatkowo sprawdza wskazania pokazane w poprzednim raporcie.",
        "A new signal head with no previous state immediately takes its target color. Once yellow starts, it must finish even if green is requested again. The check uses previous indications, so a change may take an extra step. Priority switching has no separate two-second all-red requirement; that interval belongs to the ordinary cycle. Pedestrian signals have no yellow phase. Green or yellow vehicle indications on their arm prevent pedestrian green. Standard and fallback crossings sample the programme at arrival; priority also checks previously shown indications.",
      ),
      h("Oszczędność czasu i zaokrąglenia", "Time savings and rounding"),
      f(
        "Oszczędność względem przebiegu Standard",
        "Saving against the Standard baseline",
        "Δt_saved = round(T_S(x)) − round(t_elapsed)",
      ),
      p(
        "Tₛ(x) to czas próbnego przejazdu DISABLED na tej samej pozycji x, a t_elapsed to czas przyjazdu lub bieżący czas symulacji. W DISABLED oszczędność wynosi 0, a porównanie podaje różnicę przyjazdów DISABLED − ENABLED. Próbny przejazd zapisuje pozycję co sekundę i dokładny końcowy przyjazd. Tₛ interpoluje liniowo czas na tej samej pozycji, także gdy próbka przecina zmianę prędkości. KPI oblicza różnicę osobno zaokrąglonych czasów, nie zaokrągla różnicy, i dopuszcza wynik ujemny. Python używa zaokrąglenia połówek do parzystej. Powrót do zwykłej sygnalizacji nie zwiększa elapsed. Porównanie czeka na dwa pomyślne zakończenia; pojazdy są uznawane za jadące równo, gdy różnica odległości jest mniejsza niż 10 m.",
        "Tₛ(x) is the DISABLED dry run’s time at the same position x, and t_elapsed is arrival or current simulated time. DISABLED reports zero saving; comparison reports DISABLED − ENABLED arrival. The dry run samples positions each second and retains exact final arrival. Tₛ linearly interpolates time at the same position, including samples spanning speed changes. KPIs subtract separately rounded times rather than rounding a difference, and permit negative savings. Python uses ties-to-even. Recovery does not increase elapsed. Comparison requires both successful completion events; the live race calls gaps under 10 metres level.",
      ),
      h("Zegar, zastępowanie operacji i SSE", "Clock, replacement and SSE"),
      p(
        "Żądanie wysłane w danym kroku nie zmienia ruchu ani raportu z tego kroku. Zwykłe zasady po nieudanym żądaniu obowiązują od następnego kroku ruchu. Każdy krok zwiększa czas symulacji o 1 s i numer tick o 1. Przy tempie p i interwale I pętla czeka max(0, I/p − czas_obliczeń). Przekroczenie terminu jest zapisywane w logach, bez serii kroków nadrabiających opóźnienie. Przewidywany czas przyjazdu UTC dzieli TTI przez p, ale nie uwzględnia niestandardowego I.",
        "A request submitted in a step cannot change that step’s movement or report. Fallback affects the next movement. Every step advances exactly one second and tick. Playback p with interval I sleeps max(0, I/p − processing_time); overruns are logged without catch-up bursts. UTC ETA divides by p but does not account for a nondefault I.",
      ),
      p(
        "Nowa operacja zastępuje poprzednią dopiero po udanym planowaniu. W porównaniu muszą zostać wyznaczone obie trasy. Zatrzymanie jednego przejazdu zatrzymuje całą parę. Awaria pętli kończy niezakończone przejazdy zdarzeniem SERVER_ERROR; każdy przejazd otrzymuje najwyżej jedno zdarzenie końcowe. Przyjazd pojazdu nie oznacza jeszcze końca operacji. Historyczne kody ITS_REJECTED, ITS_TIMEOUT i ITS_HOLD_EXPIRED pozostają dozwolone w kontrakcie, ale silnik już ich nie wysyła.",
        "A new operation replaces the previous one only after planning succeeds. Both routes must be planned for a comparison. Stopping either run stops the pair. A loop failure ends unfinished runs with SERVER_ERROR; each run receives at most one terminal event. Vehicle arrival does not mean the operation has finished. Legacy ITS_REJECTED, ITS_TIMEOUT and ITS_HOLD_EXPIRED codes remain valid in the contract but are no longer emitted by the engine.",
      ),
      p(
        "Strumień SSE zaczyna się od retry: 2000. Ramki zawierają pola event, id=tick oraz dane JSON w polu data. Kilka zdarzeń może mieć ten sam numer tick. Ponowne połączenie przekazuje ostatni stan i bieżące zdarzenia, bez odtwarzania od Last-Event-ID. Kolejka subskrybenta mieści domyślnie 32 zdarzenia; po zapełnieniu usuwa najstarsze, także odpowiedzi ITS. Zdarzenie końcowe wypiera zdarzenie zwykłe. Limit czterech sesji dotyczy sesji, nie operacji; aktywna para pozostaje w pamięci. Rozłączenie nie zatrzymuje symulacji. Stan sesji jest przechowywany osobno w każdym procesie serwera.",
        "SSE begins with retry: 2000; frames contain event, id=tick and JSON data. Several events can share a tick. Reconnect gets the latest snapshot and live events, not Last-Event-ID replay. A subscriber queue holds 32 events by default and drops the oldest, including feedback; terminal delivery displaces a nonterminal. Retention of four counts sessions rather than operations; an active pair is preserved. Disconnect does not stop simulation, and state is server-process-local.",
      ),
      h("Wariant testowy a serwer symulacji", "Mock versus backend"),
      p(
        "Mock liczy odległość L po łuku koła wielkiego (haversine, R = 6371 km). Dla q = L / 5400 m zwykła estymacja wynosi 780 q μ / 1.5 s, a GreenWave 380 q s. Opóźnienie skrzyżowania to min(3 s, czas GreenWave / 2N).",
        "Mock measures L along a great circle (haversine, R = 6371 km). With q = L / 5400 m the ordinary estimate is 780 q μ / 1.5 s and GreenWave 380 q s. Junction delay is min(3 s, GreenWave time / 2N).",
      ),
      p(
        "Wariant mock rysuje linię prostą zamiast trasy drogowej i nie dopasowuje punktów do sieci. Skrzyżowania INT-9001 i INT-9002 leżą odpowiednio na 1480/5400 i 1632/5400 długości odcinka. Zwykły limit wynosi 50 km/h. Dla czerwonego przyjmowane jest stałe oczekiwanie 35 s zamiast rzeczywistego czasu do zielonego. TTI oznacza czas pozostały na syntetycznej osi przejazdu, a nie wynik EMA. Grupy S1/S2 są stałe; hold = max(40, ceil(max TTI)+5). Ustawienia serwera nie nadpisują stałych wariantu mock.",
        "Mock draws a straight line rather than a road route, with no snapping. INT-9001 and INT-9002 sit at fractions 1480/5400 and 1632/5400 of its length. Ordinary limit is 50 km/h; red uses a fixed 35-second wait instead of actual next-green time. TTI is remaining synthetic timeline time, not EMA. S1/S2 groups are fixed; hold = max(40, ceil(max TTI)+5). Backend settings do not override mock constants.",
      ),
      p(
        "Wariant mock używa tego samego hasha i domyślnych czasów 1/5/8 s. Po nieudanym żądaniu przebudowuje tylko pozostałą część przejazdu, zachowując już przebyty odcinek. JavaScript Math.round i Python round inaczej zaokrąglają wartości połówkowe. Wariant mock ilustruje kontrakt, ale nie gwarantuje zgodności wyników numerycznych z serwerem i nie jest uruchamiany automatycznie po jego błędzie.",
        "Mock uses the same hash and default 1/5/8-second response times. After a failed request, it rebuilds only the remaining journey and preserves the path already travelled. JavaScript Math.round and Python round handle half values differently. Mock illustrates the contract; it does not guarantee numerical parity with the server or activate automatically after a server error.",
      ),
      h("Wnioski audytu i granice modelu", "Audit findings and model limits"),
      table(
        ["Obszar", "Ograniczenie implementacji"],
        ["Area", "Implementation limitation"],
        [
          [
            t("Szacowane czasy", "Estimates"),
            t(
              "Nominalny czas GreenWave pomija oczekiwanie na sterownik i nieudane żądania. Oszczędność w symulacji jest obliczana względem przejazdu bez priorytetu na tej samej pozycji lub na podstawie dwóch zakończonych przejazdów.",
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
            t("Walidacja czasu utrzymania priorytetu", "Hold validation"),
            t(
              "Minimum czasu utrzymania priorytetu poniżej 40 s w połączeniu z małym buforem może dać pakiet niezgodny z kontraktem H ≥40 i zakończyć pętlę błędem SERVER_ERROR.",
              "A hold minimum below 40 seconds plus a small buffer can produce a payload violating H ≥40, ending the loop with SERVER_ERROR.",
            ),
          ],
          [
            t("Minimalna prędkość przejazdu", "Rolling floor"),
            t(
              "Łączenie okien, zmiany krawędzi i skrócenie okna na końcu trasy mogą obniżyć prędkość poniżej założonego progu. Dla części pól zmiennoprzecinkowych nieskończoność nie jest jawnie zabroniona.",
              "Merged windows, edge changes and destination truncation can defeat the intended rolling floor. Several floats have no explicit infinity rejection.",
            ),
          ],
          [
            t("Sygnały", "Signals"),
            t(
              "Podział modulo 2 na dwie grupy nie opisuje wszystkich kolizji kierunków ruchu. Brak danych sygnałów nie potwierdza zielonego, ale dopuszcza opuszczenie linii. Model przejazdu bez priorytetu zakłada ostrożny przejazd na czerwonym.",
              "Two modulo slots do not model full conflicts. Missing heads cannot confirm green but permit line departure. Standard deliberately rolls red with caution.",
            ),
          ],
          [
            t("Optymalizacja", "Optimization"),
            t(
              "Najmniejsza suma czasów krawędzi nie musi oznaczać najkrótszego przejazdu w symulacji. Zwykły wybór jednostki obejmuje pięć baz; wariant uwzględniający dostępność ocenia wszystkie bazy spełniające warunki.",
              "Minimum edge cost need not minimize simulated trip time. Ordinary ranking cuts at five bases; resource-aware ranking evaluates all eligible bases.",
            ),
          ],
          [
            t("Zegar i połączenie", "Clock and connection"),
            t(
              "Przewidywany czas przyjazdu UTC pomija niestandardowy interwał. EventSource nie udostępnia statusu HTTP, więc błąd CORS lub serwera proxy może zostać rozpoznany jako brak sesji. Próba zatrzymania po przekroczeniu czasu uruchamiania nie gwarantuje zatrzymania sesji.",
              "UTC ETA omits nondefault interval. EventSource hides HTTP status, so CORS/proxy failures can look like missing sessions. Cleanup after start timeout is best-effort.",
            ),
          ],
          [
            t("Pamięć i odtwarzanie", "State and replay"),
            t(
              "Ograniczenie do jednej operacji obowiązuje osobno w każdym procesie serwera. Kolejki mogą pomijać zdarzenia i nie ma trwałego dziennika do ich odtworzenia. Procesy robocze nie współdzielą jednej operacji.",
              "Exclusivity is per server process, queues are lossy and there is no durable replay. Multiple workers do not share one operation.",
            ),
          ],
        ],
      ),
      p(
        "Model nie uwzględnia zakazów skrętu, dynamicznych kolejek, oddziaływania wielu pojazdów uprzywilejowanych, barier na trasach pieszych ani rzeczywistej dostępności zespołów. μ nie zmniejsza prędkości karetki na drodze poza skrzyżowaniami. Wyniki funkcji hashującej nie opisują zmierzonej niezawodności ITS. Dawne opisy kroku 1 Hz w czasie rzeczywistym i kończenia przejazdu po odmowie zostały zastąpione krokiem jednej sekundy symulacji i obsługą nieudanego priorytetu osobno dla każdego skrzyżowania.",
        "There is no model of turn restrictions, dynamic queues, interacting emergency vehicles, walking barriers or live availability. μ does not slow open-road ambulance movement. Hash outcomes are not empirical ITS reliability. Historical descriptions of 1 Hz wall-clock ticks and cancellation on rejection are superseded by one-second simulated steps and per-junction fallback.",
      ),
      h("Konfiguracja przygotowania danych", "Offline data-preparation configuration"),
      p(
        "Poniżej znajdują się wszystkie stałe etl/config.py, łącznie z progami raportów. To stałe Pythona, bez nadpisywania przez żądania. Zmiana danych pochodnych wymaga ponowienia odpowiednich etapów ETL. AREA_LOOKUP_RADIUS_M i ADDRESS_MATCH_CLEAN_M są także używane podczas działania serwera. Oznaczenia count_in_delay, exclude_and_reject i manual_review dotyczą traktowania sygnalizatorów.",
        "Every etl/config.py constant is listed below, including report-only thresholds. These are Python constants with no request override. Changing derived inputs requires rebuilding the affected ETL stages. AREA_LOOKUP_RADIUS_M and ADDRESS_MATCH_CLEAN_M also have runtime server consumers. count_in_delay, exclude_and_reject and manual_review describe signal handling.",
      ),
      table(["Stała", "Wartość"], ["Constant", "Value"], etlSettingRows),
      p(
        "Dodatnia liczba całkowita maxspeed, opcjonalnie z km/h, ma pierwszeństwo przed domyślną prędkością danej klasy drogi. Wartości takie jak mph, listy lub PL:urban powodują użycie wartości domyślnej z oznaczeniem źródła. Jawny oneway ma pierwszeństwo, także no na rondzie. Bez niego roundabout/circular i motorway/link oznaczają ruch jednokierunkowy. Nierozpoznane kierunki są zgłaszane. Kierunkowe oznaczenia liczby pasów mają pierwszeństwo przed liczbą łączną. Dla drogi dwukierunkowej połowa liczby pasów, zaokrąglona w dół, wynosi co najmniej jeden pas na kierunek.",
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
