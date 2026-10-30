import { logicSections } from "./logic-content";
import type { Language } from "@/lib/localization";
import type { DocsSectionId } from "./tabs";

export type ArchitectureNodeId =
  "sources" | "etl" | "dataset" | "api" | "its" | "stream" | "dashboard";

export type DocsBlock =
  | { kind: "paragraph"; text: string }
  | { kind: "heading"; text: string }
  | { kind: "list"; items: string[] }
  /** `cards`: one card per row, first column as its label (rows that read as items, not data). */
  | { kind: "table"; columns: string[]; rows: string[][]; cards?: true }
  | { kind: "code"; label: string; code: string }
  | { kind: "formula" | "state"; label: string; expression: string }
  | { kind: "links"; items: { label: string; href: string }[] }
  | {
      kind: "diagram";
      diagram: "architecture";
      nodes: Record<ArchitectureNodeId, string>;
      caption: string;
    }
  /** A simulation-only callout. */
  | { kind: "note"; text: string };

export interface DocsSection {
  id: DocsSectionId;
  label: string;
  title: string;
  /** Its headings are steps to follow in order. */
  numbered?: true;
  blocks: DocsBlock[];
}

export const DEMO_URL = "https://green-wave.duckdns.org/";

const SOURCE_LINKS = [
  "https://www.openstreetmap.org/copyright",
  "https://msip.krakow.pl/dataset/1379",
  "https://msip.krakow.pl/dataset/1492",
  "https://extract.bbbike.org",
];

/** Bilingual documentation copy, rendered directly rather than passed through t(). */
export const docsContent: Record<Language, DocsSection[]> = {
  pl: [
    {
      id: "about",
      label: "O projekcie",
      title: "Symulacja przejazdów ratunkowych w Krakowie",
      blocks: [
        {
          kind: "paragraph",
          text: "ER-GreenWave porównuje czas dojazdu pojazdu uprzywilejowanego z priorytetem na skrzyżowaniach i bez niego. Symulacja korzysta z sieci drogowej Krakowa, lokalizacji jednostek ratunkowych i miejskich danych adresowych.",
        },
        {
          kind: "paragraph",
          text: "Użytkownik wskazuje miejsce zdarzenia i typ pojazdu. Aplikacja wybiera jednostkę na podstawie szacowanego czasu dojazdu, wyznacza trasę i pokazuje przejazd na mapie. Oba warianty można uruchomić jednocześnie, aby porównać ich wyniki.",
        },
        { kind: "heading", text: "Widoki aplikacji" },
        {
          kind: "list",
          items: [
            "GreenWave — symulowany przejazd z priorytetem na kolejnych skrzyżowaniach.",
            "Ruch standardowy — przejazd tą samą trasą bez priorytetu sygnalizacji.",
            "Porównanie — oba przejazdy na wspólnym zegarze symulacji, z osobnymi mapami i zestawieniem czasów.",
            "Kierowca — widok dostosowany do telefonu, z mapą i informacją o najbliższej sygnalizacji.",
            "Diagnostyka — podgląd żądań, zdarzeń symulacji i raportu jakości danych.",
          ],
        },
        { kind: "heading", text: "Zastosowanie" },
        {
          kind: "list",
          items: [
            "Analiza, o ile priorytet sygnalizacji może skrócić dojazd służb ratunkowych.",
            "Porównanie jednostek według szacowanego czasu przejazdu, a nie samej odległości.",
            "Ocena wybranych tras i scenariuszy przed ewentualnymi testami w terenie.",
          ],
        },
        {
          kind: "note",
          text: "Aplikacja służy wyłącznie do celów demonstracyjnych. Nie łączy się z rzeczywistymi sterownikami sygnalizacji. Stany świateł, odpowiedzi ITS i czasy przejazdu są obliczane przez model.",
        },
        { kind: "heading", text: "Autorzy" },
        {
          kind: "paragraph",
          text: "Filip Jarmuła, Piotr Lorek.",
        },
      ],
    },
    {
      id: "tech",
      label: "Technologie",
      title: "Technologie",
      blocks: [
        {
          kind: "paragraph",
          text: "Panel działa w przeglądarce, a serwer odpowiada za wybór jednostki, wyznaczanie trasy i przebieg symulacji. Dane przestrzenne są przygotowywane osobno, przed uruchomieniem serwera.",
        },
        {
          kind: "table",
          cards: true,
          columns: ["Obszar", "Narzędzia", "Zastosowanie"],
          rows: [
            [
              "Interfejs",
              "Next.js 16, React 19, Tailwind CSS 4",
              "Panel na komputer i telefon, z obsługą języka polskiego i angielskiego oraz jasnego i ciemnego motywu.",
            ],
            [
              "Mapa",
              "MapLibre GL JS, podkład CARTO na danych OSM",
              "Wyświetlanie mapy, tras, pojazdów i sygnalizacji z użyciem WebGL.",
            ],
            [
              "Serwer i symulacja",
              "Python 3.12, FastAPI, Pydantic",
              "Obsługa żądań i symulacji. Modele danych definiują kontrakt API oraz typy używane przez panel.",
            ],
            [
              "Przetwarzanie danych",
              "GeoPandas, Shapely, Polars, NetworkX",
              "Przetwarzanie danych przestrzennych, budowa grafu drogowego i wyznaczanie tras. Obliczenia odległości korzystają z układu PL-2000 (EPSG:2178).",
            ],
            [
              "Aktualizacja stanu",
              "Server-Sent Events (SSE)",
              "Jednokierunkowy strumień HTTP przekazujący kolejne stany symulacji do panelu.",
            ],
            [
              "Wdrożenie",
              "Docker Compose, Caddy, Oracle Cloud",
              "Uruchamianie usług w kontenerach, obsługa HTTPS i automatyczne wdrażanie zmian z gałęzi main.",
            ],
            [
              "Weryfikacja",
              "pytest, Vitest, Ruff, mypy, ESLint, Playwright",
              "Testy jednostkowe, analiza statyczna kodu i testy interfejsu w przeglądarce.",
            ],
          ],
        },
      ],
    },
    {
      id: "data",
      label: "Dane",
      title: "Wykorzystane dane",
      blocks: [
        {
          kind: "paragraph",
          text: "Symulacja łączy dane OpenStreetMap, miejskie zbiory MSIP i wojewódzki plan działania systemu Państwowe Ratownictwo Medyczne. Pochodzenie plików i ich sumy kontrolne są zapisane w repozytorium. Serwer sprawdza zgodność przygotowanego zbioru z tym wykazem.",
        },
        {
          kind: "table",
          columns: ["Zbiór", "Wydawca", "Licencja", "Stan danych", "Zastosowanie"],
          rows: [
            [
              "OpenStreetMap (wycinek BBBike)",
              "Społeczność OpenStreetMap",
              "ODbL 1.0",
              "13.10.2026",
              "Sieć drogowa, sygnalizacja, atrybuty dróg (pasy, nawierzchnia, progi, buspasy, torowiska).",
            ],
            [
              "Ulice (MSIP, zbiór 1379)",
              "Urząd Miasta Krakowa / MSIP",
              "Ustawa o otwartych danych (Dz.U. 2021 poz. 1641)",
              "13.10.2026",
              "Kontrola nazw i długości ulic oraz nazw ulic na skrzyżowaniach.",
            ],
            [
              "Buspasy (ZDMK / MSIP)",
              "Urząd Miasta Krakowa / ZDMK / MSIP",
              "Ustawa o otwartych danych (Dz.U. 2021 poz. 1641)",
              "13.10.2026",
              "Weryfikacja buspasów z OpenStreetMap. Nie zmienia czasów przejazdu.",
            ],
            [
              "Punkty adresowe EMUiA (MSIP, zbiór 1492)",
              "Urząd Miasta Krakowa, Wydział Geodezji / MSIP",
              "Ustawa o otwartych danych, warunki MSIP",
              "27.10.2026",
              "Wyszukiwanie adresów zdarzeń. Przy rozbieżności z OSM trasa prowadzi do współrzędnych z EMUiA.",
            ],
            [
              "Wojewódzki plan działania systemu PRM, aktualizacja nr 2",
              "Wojewoda Małopolski",
              "Dokument publiczny (BIP)",
              "24.06.2026",
              "Bazy zespołów ratownictwa medycznego, godziny gotowości i rejony działania.",
            ],
          ],
        },
        { kind: "heading", text: "Łączenie i weryfikacja danych" },
        {
          kind: "list",
          items: [
            "Na podstawie OpenStreetMap powstaje graf drogowy. Sygnalizatory są przypisywane do wlotów skrzyżowań, a graf służy do wyznaczania tras i czasu przejazdu.",
            "Miejski rejestr Ulice służy do weryfikacji nazw i długości ulic w OpenStreetMap. Rozbieżności są widoczne w raporcie jakości danych w Diagnostyce.",
            "Rejestr buspasów jest porównywany z OpenStreetMap według nazw ulic. Wynik tej kontroli nie zmienia czasów przejazdu.",
            "Adresy EMUiA są dopasowywane do adresów OpenStreetMap. Jeśli lokalizacje się różnią, panel pokazuje oba punkty i odległość między nimi.",
            "Lokalizacje baz zespołów PRM są ustalane na podstawie adresów EMUiA lub udokumentowanych współrzędnych, a następnie dopasowywane do sieci drogowej.",
          ],
        },
        {
          kind: "links",
          items: [
            {
              label: "Prawa autorskie OpenStreetMap",
              href: SOURCE_LINKS[0],
            },
            {
              label: "MSIP: Ulice",
              href: SOURCE_LINKS[1],
            },
            {
              label: "MSIP: Punkty adresowe (EMUiA)",
              href: SOURCE_LINKS[2],
            },
            {
              label: "BBBike: wycinki OpenStreetMap",
              href: SOURCE_LINKS[3],
            },
          ],
        },
      ],
    },
    {
      id: "architecture",
      label: "Architektura",
      title: "Jak działa symulacja",
      blocks: [
        {
          kind: "diagram",
          diagram: "architecture",
          nodes: {
            sources: "Otwarte dane",
            etl: "ETL (offline)",
            dataset: "Graf drogowy",
            api: "Silnik symulacji",
            its: "Symulowany ITS",
            stream: "Strumień SSE",
            dashboard: "Panel Next.js",
          },
          caption:
            "Szare linie ciągłe pokazują przygotowanie i wczytanie danych. Zielone strzałki oznaczają przesyłanie stanów symulacji do panelu przez SSE. Przerywana strzałka w obu kierunkach oznacza żądania priorytetu i odpowiedzi symulowanego sterownika ITS. Ta wymiana odbywa się wewnątrz procesu symulacji.",
        },
        { kind: "heading", text: "Przygotowanie danych" },
        {
          kind: "paragraph",
          text: "Proces ETL przekształca pliki źródłowe w skierowany graf drogowy oraz tabele skrzyżowań, wlotów i adresów. Serwer wczytuje gotowy zbiór przy uruchomieniu. Wyznaczanie tras nie wymaga ponownego odczytu surowych plików GIS.",
        },
        { kind: "heading", text: "Wybór jednostki i trasa" },
        {
          kind: "paragraph",
          text: "Po wskazaniu zdarzenia serwer szacuje czas dojazdu z baz obsługujących wybrany typ pojazdu. Model uwzględnia ograniczenia prędkości i cechy drogi, między innymi buspasy, torowiska oraz progi zwalniające.",
        },
        { kind: "heading", text: "Priorytet sygnalizacji" },
        {
          kind: "paragraph",
          text: "Co sekundę symulacji silnik oblicza przewidywany czas dotarcia do sygnalizacji (TTI) na podstawie pozostałej odległości i wygładzonej prędkości. Gdy pojazd się zbliża, wysyła żądanie priorytetu do symulowanego sterownika ITS. Sygnalizacje oddalone od siebie o maksymalnie 250 m wzdłuż trasy mogą być obsługiwane razem.",
        },
        {
          kind: "paragraph",
          text: "Sterownik może przyjąć żądanie po 1 s lub 5 s, odrzucić je albo nie odpowiedzieć. Po odmowie lub braku odpowiedzi przez 8 s pojazd przejeżdża tylko te skrzyżowania na zwykłej sygnalizacji i jedzie dalej, a kolejne skrzyżowania nadal mogą dać mu priorytet. Scenariusz mieszany losuje wynik każdego żądania z podanego ziarna.",
        },
        { kind: "heading", text: "Ruch standardowy" },
        {
          kind: "paragraph",
          text: "W wariancie bez priorytetu pojazd porusza się po tej samej trasie, a sygnalizacja działa według zwykłego programu. Przy czerwonym świetle model zakłada ostrożny przejazd i dolicza opóźnienie zależne od czasu do zmiany światła, nie większe niż 15 s na decyzję przy linii zatrzymania. Wynik porównania dotyczy tych założeń modelu.",
        },
        {
          kind: "note",
          text: "Sterownik ITS jest częścią symulacji. Połączenie z rzeczywistą sygnalizacją wymagałoby osobnej integracji i oceny bezpieczeństwa z zarządcą drogi.",
        },
      ],
    },
    logicSections.pl,
    {
      id: "roadmap",
      label: "Rozwój",
      title: "Możliwości rozwoju",
      blocks: [
        {
          kind: "paragraph",
          text: "Dalsze prace mogą objąć kalibrację modelu, wykorzystanie danych o pozycjach pojazdów i przygotowanie pilotażu. Każdy z tych etapów wymaga osobnej weryfikacji.",
        },
        { kind: "heading", text: "Kierunki prac" },
        {
          kind: "list",
          items: [
            "Przygotowanie pilotażu na wybranym ciągu ulic, na przykład na Alejach Trzech Wieszczów, we współpracy z zarządcą drogi i centrum sterowania ruchem.",
            "Zastąpienie ruchu symulowanego danymi o pozycjach pojazdów z systemu dyspozytorskiego.",
            "Kalibracja parametrów na podstawie pomiarów ruchu w Krakowie.",
            "Rozszerzenie testów priorytetu dla straży pożarnej i policji oraz analiza odrębnych zasad dla transportu publicznego.",
            "Dostosowanie procesu przygotowania danych do innych miast i ich lokalnych rejestrów.",
          ],
        },
        { kind: "heading", text: "Możliwe zastosowania" },
        {
          kind: "list",
          items: [
            "Zarządca dróg — porównanie tras i scenariuszy priorytetu przed wyborem miejsca pilotażu.",
            "Służby ratunkowe — analiza szacowanych czasów dojazdu i rozmieszczenia baz.",
            "Dostawcy systemów ITS — testowanie obsługi żądań priorytetu i odpowiedzi sterownika w środowisku symulacyjnym.",
            "Operatorzy transportu medycznego — analiza wariantów przejazdu z uwzględnieniem ograniczeń modelu.",
          ],
        },
      ],
    },
  ],
  en: [
    {
      id: "about",
      label: "About",
      title: "Emergency-response simulation in Kraków",
      blocks: [
        {
          kind: "paragraph",
          text: "ER-GreenWave compares emergency-vehicle travel times with and without signal priority. The simulation uses Kraków’s road network, emergency-service locations and municipal address data.",
        },
        {
          kind: "paragraph",
          text: "Choose an incident location and vehicle type. The application selects a unit using estimated travel time, plans a route and shows the simulated journey on the map. Both modes can run together to compare their results.",
        },
        { kind: "heading", text: "What the app does" },
        {
          kind: "list",
          items: [
            "GreenWave: a simulated journey with priority at successive junctions.",
            "Standard traffic: the same route under the ordinary signal programme, where a red light costs time.",
            "Comparison: both modes start together on one clock, side by side on two maps, with a result card showing the difference.",
            "Driver: a phone view with the map and the next signal ahead of the vehicle.",
            "Diagnostics: every request and event as it happens, plus the data-quality report.",
          ],
        },
        { kind: "heading", text: "Uses" },
        {
          kind: "list",
          items: [
            "Analyse how signal priority could shorten emergency response times.",
            "Compare units by estimated driving time rather than distance alone.",
            "Evaluate routes and scenarios before considering field trials.",
          ],
        },
        {
          kind: "note",
          text: "For demonstration purposes only. The app never connects to real traffic signals and controls nothing. Light states, controller answers and travel times all come from the model.",
        },
        { kind: "heading", text: "Authors" },
        {
          kind: "paragraph",
          text: "Filip Jarmuła, Piotr Lorek.",
        },
      ],
    },
    {
      id: "tech",
      label: "Technologies",
      title: "Technologies",
      blocks: [
        {
          kind: "paragraph",
          text: "The browser displays the dashboard. The server selects units, plans routes and runs the simulation. Spatial data is prepared separately before the server starts.",
        },
        {
          kind: "table",
          cards: true,
          columns: ["Layer", "Technology", "Why"],
          rows: [
            [
              "Interface",
              "Next.js 16, React 19, Tailwind CSS 4",
              "One codebase for desktop and phone, light and dark themes, Polish and English.",
            ],
            [
              "Map",
              "MapLibre GL JS, CARTO basemap on OSM data",
              "WebGL rendering for the map, routes, vehicles and signals.",
            ],
            [
              "Server and simulation",
              "Python 3.12, FastAPI, Pydantic",
              "Asynchronous streaming and typed contracts that generate the OpenAPI spec and the dashboard types.",
            ],
            [
              "Data processing",
              "GeoPandas, Shapely, Polars, NetworkX",
              "Spatial operations in the metric Polish PL-2000 grid (EPSG:2178), fast tables and graph routing.",
            ],
            [
              "Live updates",
              "Server-Sent Events (SSE)",
              "A one-way HTTP stream delivering successive simulation states to the dashboard.",
            ],
            [
              "Deployment",
              "Docker Compose, Caddy, Oracle Cloud",
              "Containerised services, HTTPS and automatic deployment of changes from main.",
            ],
            [
              "Quality",
              "pytest, Vitest, Ruff, mypy, ESLint, Playwright",
              "Tests and static analysis on every change, plus checks in a real browser.",
            ],
          ],
        },
      ],
    },
    {
      id: "data",
      label: "Data",
      title: "Data used",
      blocks: [
        {
          kind: "paragraph",
          text: "The project combines City of Kraków open data with OpenStreetMap and the regional emergency medical services plan. Every source file has its origin and checksum recorded in the repository. The processed dataset is tied to that record, and the server refuses to start on a dataset built from different data.",
        },
        {
          kind: "table",
          columns: ["Dataset", "Publisher", "Licence", "Data as of", "Use in the app"],
          rows: [
            [
              "OpenStreetMap (BBBike extract)",
              "OpenStreetMap contributors",
              "ODbL 1.0",
              "13 Oct 2026",
              "Road network, traffic signals, road attributes (lanes, surface, speed bumps, bus lanes, tram tracks).",
            ],
            [
              "Ulice (MSIP, dataset 1379)",
              "City of Kraków / MSIP",
              "Polish Open Data Act (Dz.U. 2021 poz. 1641)",
              "13 Oct 2026",
              "Checks street names and lengths, and the street names at junctions.",
            ],
            [
              "Buspasy (ZDMK / MSIP)",
              "City of Kraków / ZDMK / MSIP",
              "Polish Open Data Act (Dz.U. 2021 poz. 1641)",
              "13 Oct 2026",
              "Verifies OpenStreetMap bus lanes. Never changes travel times.",
            ],
            [
              "Punkty adresowe EMUiA (MSIP, dataset 1492)",
              "City of Kraków, Surveying Department / MSIP",
              "Polish Open Data Act, MSIP terms",
              "27 Oct 2026",
              "Incident address search. The municipal coordinate is authoritative.",
            ],
            [
              "Wojewódzki plan działania systemu PRM, update no. 2",
              "Voivode of Małopolska",
              "Public document (BIP)",
              "24 Jun 2026",
              "Ambulance team bases, readiness hours and operating areas.",
            ],
          ],
        },
        { kind: "heading", text: "How the sources work together" },
        {
          kind: "list",
          items: [
            "The OpenStreetMap road graph gets each signal attached to a specific junction approach. Routes and travel times are computed on this graph.",
            "Names from the municipal Ulice register check OpenStreetMap street names and lengths. Mismatches go into the data-quality report shown in Diagnostics.",
            "The bus-lane register is matched to OpenStreetMap bus lanes by street name. It serves as a check only.",
            "EMUiA address points are paired with OpenStreetMap addresses. When they disagree, the dashboard shows both locations and the distance between them.",
            "Team bases from the PRM plan are located by their EMUiA address (or a cited coordinate) and pinned to the road network. This gives the list of places ambulances set out from.",
          ],
        },
        {
          kind: "links",
          items: [
            {
              label: "OpenStreetMap copyright",
              href: SOURCE_LINKS[0],
            },
            {
              label: "MSIP: Ulice",
              href: SOURCE_LINKS[1],
            },
            {
              label: "MSIP: Punkty adresowe (EMUiA)",
              href: SOURCE_LINKS[2],
            },
            {
              label: "BBBike: OpenStreetMap extracts",
              href: SOURCE_LINKS[3],
            },
          ],
        },
      ],
    },
    {
      id: "architecture",
      label: "Architecture",
      title: "Solution architecture",
      blocks: [
        {
          kind: "diagram",
          diagram: "architecture",
          nodes: {
            sources: "Open data",
            etl: "ETL (offline)",
            dataset: "Road graph",
            api: "Simulation API",
            its: "Simulated ITS",
            stream: "SSE stream",
            dashboard: "Next.js dashboard",
          },
          caption:
            "Solid grey arrows show data preparation and loading. Green arrows carry simulation states to the dashboard over SSE. The dashed two-way arrow shows priority requests and responses exchanged with the simulated ITS controller, entirely within the simulation.",
        },
        { kind: "heading", text: "Data preparation" },
        {
          kind: "paragraph",
          text: "The ETL stage turns the raw files into a directed road graph with tables of junctions, approaches and addresses. The server loads it once at startup, so routing never has to touch the raw GIS files.",
        },
        { kind: "heading", text: "Choosing the unit and the route" },
        {
          kind: "paragraph",
          text: "Once the incident is placed, the server ranks suitable bases by estimated travel time; resource-aware ambulance selection can prefer a team within the incident’s operating area. The emergency vehicle's speed follows the limit on each road. A bus lane or tram track lets it go faster, and each speed bump costs a few seconds.",
        },
        { kind: "heading", text: "The green corridor" },
        {
          kind: "paragraph",
          text: "Every simulated second, the engine computes the time to intersection (TTI) for each signal ahead: remaining distance divided by smoothed speed. As the vehicle approaches, it sends a priority request to the simulated ITS controller. Signals within 250 m of each other along the route are handled together, as a one-hop cascade from independently eligible targets.",
        },
        {
          kind: "paragraph",
          text: "The simulated controller can answer normally (after 1 s), late (after 5 s), refuse, or not answer at all (8 s limit). After a refusal or a missing answer the vehicle crosses only those junctions on ordinary signals and drives on; later junctions can still give it priority. A mixed scenario draws each request's answer from a chosen seed.",
        },
        { kind: "heading", text: "Standard traffic" },
        {
          kind: "paragraph",
          text: "Without priority, the vehicle takes the same route while the signals run their ordinary programme. At a red light it crosses with care and loses time that depends on how long it would have waited for green, at most 15 s per stop-line decision. The difference between the two runs is what the green corridor saves.",
        },
        {
          kind: "note",
          text: "Simulation only. Messages to the ITS controller illustrate a proposed interface. A deployment would need integration with specific controllers and safety validation with the road authority.",
        },
      ],
    },
    logicSections.en,
    {
      id: "roadmap",
      label: "Future development",
      title: "Future development",
      blocks: [
        {
          kind: "paragraph",
          text: "Further work could cover model calibration, vehicle-position data and preparation for a pilot. Each stage needs separate validation.",
        },
        { kind: "heading", text: "Areas for further work" },
        {
          kind: "list",
          items: [
            "Prepare a pilot on a selected corridor, such as Aleje Trzech Wieszczów, with the road authority and traffic control centre.",
            "Replace simulated movement with vehicle positions from the dispatch system.",
            "Calibrate model parameters using traffic measurements from Kraków.",
            "Extend fire and police priority testing and examine separate rules for public transport.",
            "Adapt data preparation to other cities and their local registers.",
          ],
        },
        { kind: "heading", text: "Potential uses" },
        {
          kind: "list",
          items: [
            "Road authorities: compare routes and priority scenarios before selecting a pilot location.",
            "Emergency services: analyse estimated arrival times and base locations.",
            "ITS suppliers: test priority requests and controller responses in a simulated environment.",
            "Medical transport operators: analyse route alternatives within the model’s limits.",
          ],
        },
      ],
    },
  ],
};
