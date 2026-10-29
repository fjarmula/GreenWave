import type { Language } from "@/lib/localization";
import type { DocsSectionId } from "./tabs";

export type ArchitectureNodeId =
  "sources" | "etl" | "dataset" | "api" | "its" | "stream" | "dashboard";

export type DocsBlock =
  | { kind: "paragraph"; text: string }
  | { kind: "heading"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "table"; columns: string[]; rows: string[][] }
  | { kind: "code"; label: string; code: string }
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
  blocks: DocsBlock[];
}

const DEMO_URL = "https://green-wave.duckdns.org/";

/** Commands are shared by both languages and must match README.md (content-facts test). */
const COMMANDS = {
  install: "cd backend && uv sync --dev --locked && cd ..\ncd frontend && npm ci && cd ..",
  dataset: [
    "cd backend",
    "uv run python scripts/build_manifest.py --check",
    "uv run python scripts/run_etl.py profile",
    "uv run python scripts/run_etl.py signals",
    "uv run python scripts/run_etl.py graph",
    "uv run python scripts/run_etl.py override-map",
    "uv run python scripts/run_etl.py intersections",
    "uv run python scripts/run_etl.py neighbours",
    "uv run python scripts/run_etl.py places",
    "uv run python scripts/run_etl.py quality",
  ].join("\n"),
  compose: "docker compose up --build",
  backend: "cd backend\nuv run uvicorn greenwave.main:app --reload",
  frontend: "cd frontend\nnpm run dev",
  frontendWithBackend:
    "NEXT_PUBLIC_SIMULATION_TRANSPORT=backend NEXT_PUBLIC_API_BASE_URL=http://localhost:8000 npm run dev",
};

const SOURCE_LINKS = [
  "https://www.openstreetmap.org/copyright",
  "https://msip.krakow.pl/dataset/1379",
  "https://msip.krakow.pl/dataset/1492",
  "https://extract.bbbike.org",
];

/** Contest documentation (§5.2 of the Open Data App rules), already localized: not passed through t(). */
export const docsContent: Record<Language, DocsSection[]> = {
  pl: [
    {
      id: "about",
      label: "O projekcie",
      title: "ER-GreenWave: zielony korytarz dla pojazdów uprzywilejowanych",
      blocks: [
        {
          kind: "paragraph",
          text: "Karetka, wóz strażacki czy radiowóz w drodze do zdarzenia traci cenne sekundy na skrzyżowaniach z sygnalizacją. Nawet na sygnale kierowca musi zwolnić przed czerwonym światłem i ostrożnie przecisnąć się przez ruch poprzeczny. W mieście takim jak Kraków, z gęstą siecią sygnalizacji, te straty sumują się na każdym przejeździe.",
        },
        {
          kind: "paragraph",
          text: "ER-GreenWave pokazuje, jak mógłby działać zielony korytarz. System wybiera jednostkę, która dotrze najszybciej, wyznacza trasę po rzeczywistej sieci drogowej Krakowa i z wyprzedzeniem prosi sygnalizację na trasie o zielone światło. Ten sam przejazd można odtworzyć przy zwykłej pracy sygnalizacji i porównać czasy dojazdu.",
        },
        { kind: "heading", text: "Co można zrobić w aplikacji" },
        {
          kind: "list",
          items: [
            "GreenWave: przejazd z priorytetem, w którym kolejne sygnalizacje przełączają się na zielone przed pojazdem.",
            "Ruch standardowy: ta sama trasa, ale sygnalizacja działa według zwykłego programu, a czerwone światło kosztuje czas.",
            "Porównanie: oba tryby startują jednocześnie na wspólnym zegarze, obok siebie na dwóch mapach, a karta wyników pokazuje różnicę.",
            "Kierowca: widok na telefon z mapą i najbliższą sygnalizacją przed pojazdem.",
            "Diagnostyka: podgląd każdego zapytania i zdarzenia oraz raport jakości danych.",
          ],
        },
        { kind: "heading", text: "Komu to służy" },
        {
          kind: "list",
          items: [
            "Mieszkańcom: szybsza pomoc medyczna, a w przyszłości także szybsze interwencje straży pożarnej i policji.",
            "Dyspozytorom: wybór jednostki według realnego czasu dojazdu, a nie odległości w linii prostej.",
            "Miastu i zarządcy dróg: narzędzie do oceny, na których ciągach priorytet daje największy zysk, zanim zapadnie decyzja o inwestycji.",
          ],
        },
        {
          kind: "note",
          text: "Wyłącznie symulacja. Aplikacja nie łączy się z prawdziwą sygnalizacją świetlną i niczym nie steruje. Stany świateł, odpowiedzi sterownika i czasy przejazdu są wynikiem modelu.",
        },
        { kind: "heading", text: "Zespół" },
        { kind: "paragraph", text: "Filip Jarmuła, Piotr Lorek." },
      ],
    },
    {
      id: "run",
      label: "Uruchomienie",
      title: "Jak uruchomić",
      blocks: [
        {
          kind: "paragraph",
          text: "Najprościej obejrzeć działającą wersję demonstracyjną w przeglądarce. Nie wymaga instalacji i działa na komputerze oraz telefonie.",
        },
        { kind: "links", items: [{ label: "Wersja demonstracyjna ER-GreenWave", href: DEMO_URL }] },
        { kind: "heading", text: "Wymagania do uruchomienia lokalnego" },
        {
          kind: "list",
          items: [
            "Git oraz Python 3.12 z menedżerem uv.",
            "Node.js 22 z npm.",
            "Opcjonalnie Docker z Docker Compose.",
            "Paczka surowych danych GIS przekazywana przez zespół. Nie jest częścią repozytorium.",
          ],
        },
        { kind: "code", label: "Instalacja zależności", code: COMMANDS.install },
        {
          kind: "paragraph",
          text: "Po skopiowaniu paczki danych do backend/data/raw/ zbiór symulacji przygotowuje się jednorazowo poniższymi krokami.",
        },
        { kind: "code", label: "Przygotowanie zbioru danych", code: COMMANDS.dataset },
        { kind: "code", label: "Całość w Docker Compose", code: COMMANDS.compose },
        {
          kind: "paragraph",
          text: "Panel otwiera się pod adresem http://localhost:3000, a dokumentacja API pod http://localhost:8000/docs.",
        },
        { kind: "code", label: "Serwer symulacji (lokalnie)", code: COMMANDS.backend },
        { kind: "code", label: "Panel (lokalnie, tryb demonstracyjny)", code: COMMANDS.frontend },
        {
          kind: "paragraph",
          text: "Sam panel uruchomiony w ten sposób korzysta z wbudowanej symulacji demonstracyjnej i nie potrzebuje ani serwera, ani danych GIS. Aby połączyć go z serwerem symulacji, w katalogu frontend użyj polecenia poniżej.",
        },
        { kind: "code", label: "Panel z serwerem symulacji", code: COMMANDS.frontendWithBackend },
      ],
    },
    {
      id: "tech",
      label: "Technologie",
      title: "Technologie",
      blocks: [
        {
          kind: "paragraph",
          text: "Wybraliśmy dojrzałe, otwarte narzędzia, które nie wymagają płatnych licencji ani kluczy dostępowych. Każdy element da się zastąpić bez przebudowy całości.",
        },
        {
          kind: "table",
          columns: ["Warstwa", "Technologia", "Dlaczego"],
          rows: [
            [
              "Interfejs",
              "Next.js 16, React 19, Tailwind CSS 4",
              "Jeden kod dla komputera i telefonu, motyw jasny i ciemny, wersja polska i angielska.",
            ],
            [
              "Mapa",
              "MapLibre GL JS, podkład CARTO na danych OSM",
              "Płynne renderowanie WebGL bez tokenów i opłat za mapę.",
            ],
            [
              "Serwer i symulacja",
              "Python 3.12, FastAPI, Pydantic",
              "Asynchroniczne strumieniowanie oraz typowane kontrakty, z których generujemy specyfikację OpenAPI i typy panelu.",
            ],
            [
              "Przetwarzanie danych",
              "GeoPandas, Shapely, Polars, NetworkX",
              "Operacje przestrzenne w metrycznym układzie PL-2000 (EPSG:2178), szybkie tabele i wyznaczanie tras na grafie.",
            ],
            [
              "Transmisja na żywo",
              "Server-Sent Events (SSE)",
              "Jednokierunkowy strumień po zwykłym HTTP: jedna wiadomość na każdą sekundę symulacji.",
            ],
            [
              "Wdrożenie",
              "Docker Compose, Caddy, Oracle Cloud Always Free",
              "Automatyczny HTTPS, zerowy koszt utrzymania i wdrożenie po każdej zmianie w gałęzi main.",
            ],
            [
              "Jakość",
              "pytest, Vitest, Ruff, mypy, ESLint, Playwright",
              "Testy i analiza statyczna przy każdej zmianie oraz testy w prawdziwej przeglądarce.",
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
          text: "Projekt łączy otwarte dane Miasta Krakowa z OpenStreetMap i wojewódzkim planem ratownictwa medycznego. Każdy plik źródłowy ma w repozytorium zapisane pochodzenie i sumę kontrolną. Przetworzony zbiór jest powiązany z tym spisem, a serwer nie wystartuje na zbiorze zbudowanym z innych danych.",
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
              "Wyszukiwanie adresu zdarzenia. Miejskie współrzędne są rozstrzygające.",
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
        { kind: "heading", text: "Jak łączymy źródła" },
        {
          kind: "list",
          items: [
            "Graf drogowy z OpenStreetMap otrzymuje sygnalizację przypisaną do konkretnych wlotów skrzyżowań. To na tym grafie liczona jest trasa i czas przejazdu.",
            "Nazwy z miejskiego rejestru Ulice sprawdzają nazwy i długości ulic w OpenStreetMap. Rozbieżności trafiają do raportu jakości danych widocznego w Diagnostyce.",
            "Rejestr buspasów porównywany jest z buspasami z OpenStreetMap po nazwie ulicy. Służy wyłącznie do kontroli.",
            "Punkty adresowe EMUiA są parowane z adresami z OpenStreetMap. Przy rozbieżności panel pokazuje obie lokalizacje i ich odległość.",
            "Bazy zespołów z planu PRM są lokalizowane według adresów EMUiA (lub udokumentowanej współrzędnej) i przypinane do sieci drogowej. Tak powstaje lista miejsc, z których wyjeżdżają karetki.",
          ],
        },
        {
          kind: "links",
          items: [
            { label: "Prawa autorskie OpenStreetMap", href: SOURCE_LINKS[0] },
            { label: "MSIP: Ulice", href: SOURCE_LINKS[1] },
            { label: "MSIP: Punkty adresowe (EMUiA)", href: SOURCE_LINKS[2] },
            { label: "BBBike: wycinki OpenStreetMap", href: SOURCE_LINKS[3] },
          ],
        },
      ],
    },
    {
      id: "architecture",
      label: "Architektura",
      title: "Architektura rozwiązania",
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
            "Dane źródłowe są przetwarzane raz, offline. Serwer symulacji wysyła stan przejazdu do panelu co sekundę symulacji. Zielona linia to ścieżka danych na żywo.",
        },
        { kind: "heading", text: "Przygotowanie danych" },
        {
          kind: "paragraph",
          text: "Etap ETL zamienia surowe pliki w skierowany graf drogowy z tabelami skrzyżowań, wlotów i adresów. Serwer wczytuje go raz przy starcie, więc wyznaczanie trasy nie sięga już do surowych plików GIS.",
        },
        { kind: "heading", text: "Wybór jednostki i trasa" },
        {
          kind: "paragraph",
          text: "Po wskazaniu miejsca zdarzenia serwer szacuje czas dojazdu z każdej pasującej bazy i wybiera najszybszą. Prędkość pojazdu uprzywilejowanego wynika z ograniczenia prędkości na odcinku. Buspas lub torowisko pozwalają jechać szybciej, a każdy próg zwalniający kosztuje kilka sekund.",
        },
        { kind: "heading", text: "Zielony korytarz" },
        {
          kind: "paragraph",
          text: "Co sekundę symulacji silnik liczy dla każdej sygnalizacji przed pojazdem czas dotarcia (TTI): pozostały dystans podzielony przez wygładzoną prędkość. Gdy pojazd się zbliża, silnik wysyła prośbę o priorytet do symulowanego sterownika ITS. Sygnalizacje leżące w odległości do 250 m wzdłuż trasy są obsługiwane razem, żeby korek przy następnym skrzyżowaniu nie zablokował przejazdu.",
        },
        {
          kind: "paragraph",
          text: "Symulowany sterownik może odpowiedzieć normalnie (po 1 s), z opóźnieniem (po 5 s), odmówić albo nie odpowiedzieć wcale (limit 8 s). Odmowa lub brak odpowiedzi kończy przejazd w widoczny sposób, bo właśnie takie przypadki musiałby obsłużyć prawdziwy system.",
        },
        { kind: "heading", text: "Ruch standardowy" },
        {
          kind: "paragraph",
          text: "Bez priorytetu pojazd jedzie tą samą trasą, a sygnalizacja pracuje według zwykłego programu. Na czerwonym pojazd przejeżdża ostrożnie i traci czas zależny od tego, jak długo czekałby na zielone, maksymalnie 15 s na skrzyżowanie. Różnica między oboma przejazdami to zysk z zielonego korytarza.",
        },
        {
          kind: "note",
          text: "Wyłącznie symulacja. Komunikaty do sterownika ITS ilustrują proponowany interfejs. Wdrożenie wymagałoby integracji z konkretnymi sterownikami oraz walidacji bezpieczeństwa z zarządcą drogi.",
        },
      ],
    },
    {
      id: "roadmap",
      label: "Rozwój",
      title: "Możliwości rozwoju",
      blocks: [
        {
          kind: "paragraph",
          text: "Aplikacja jest prototypem, ale jej podział na dane, silnik i panel pozwala rozwijać ją krok po kroku w stronę wdrożenia.",
        },
        { kind: "heading", text: "Droga do wdrożenia" },
        {
          kind: "list",
          items: [
            "Pilotaż z Zarządem Dróg Miasta Krakowa na jednym ciągu, na przykład na Alejach Trzech Wieszczów, z połączeniem do centrum sterowania ruchem przez standardowy interfejs priorytetu.",
            "Rzeczywiste pozycje pojazdów z systemu dyspozytorskiego zamiast ruchu symulowanego.",
            "Kalibracja parametrów modelu na zmierzonych danych o ruchu w Krakowie.",
            "Objęcie korytarzem straży pożarnej, policji i priorytetu dla komunikacji miejskiej tym samym mechanizmem.",
            "Kolejne miasta: proces przetwarzania przyjmuje dowolny wycinek OpenStreetMap i lokalny rejestr adresów.",
          ],
        },
        { kind: "heading", text: "Wartość dla sektora publicznego i prywatnego" },
        {
          kind: "list",
          items: [
            "Miasto i zarządca dróg mogą porównać ciągi ulic i zdecydować, gdzie priorytet dla pojazdów uprzywilejowanych da największy zysk czasu.",
            "Służby ratunkowe dostają dowód, ile sekund można zyskać, i narzędzie do planowania rozmieszczenia baz.",
            "Dostawcy sterowników i integratorzy systemów ITS otrzymują referencyjny interfejs priorytetu oraz środowisko testowe.",
            "Prywatni przewoźnicy medyczni i operatorzy flot mogą wykorzystać szacunki czasu przejazdu do planowania.",
          ],
        },
      ],
    },
  ],
  en: [
    {
      id: "about",
      label: "About",
      title: "ER-GreenWave: a green corridor for emergency vehicles",
      blocks: [
        {
          kind: "paragraph",
          text: "An ambulance, fire engine or police car on its way to an incident loses valuable seconds at signalised junctions. Even with sirens on, the driver has to slow down for a red light and edge carefully through cross traffic. In a city like Kraków, with a dense signal network, these losses add up on every trip.",
        },
        {
          kind: "paragraph",
          text: "ER-GreenWave shows how a green corridor could work. It picks the unit that will arrive first, routes it over Kraków's real road network and asks each signal on the way for a green light ahead of time. The same trip can be replayed under ordinary signal timing to compare arrival times.",
        },
        { kind: "heading", text: "What the app does" },
        {
          kind: "list",
          items: [
            "Green Wave: a priority run in which the signals ahead turn green before the vehicle reaches them.",
            "Standard traffic: the same route under the ordinary signal programme, where a red light costs time.",
            "Comparison: both modes start together on one clock, side by side on two maps, with a result card showing the difference.",
            "Driver: a phone view with the map and the next signal ahead of the vehicle.",
            "Diagnostics: every request and event as it happens, plus the data-quality report.",
          ],
        },
        { kind: "heading", text: "Who it helps" },
        {
          kind: "list",
          items: [
            "Residents: faster medical help and, in future, faster fire and police response.",
            "Dispatchers: a unit chosen by real driving time, not straight-line distance.",
            "The city and the road authority: a way to judge which corridors gain most from priority before committing to an investment.",
          ],
        },
        {
          kind: "note",
          text: "Simulation only. The app never connects to real traffic signals and controls nothing. Light states, controller answers and travel times all come from the model.",
        },
        { kind: "heading", text: "Team" },
        { kind: "paragraph", text: "Filip Jarmuła, Piotr Lorek." },
      ],
    },
    {
      id: "run",
      label: "Running it",
      title: "How to run it",
      blocks: [
        {
          kind: "paragraph",
          text: "The quickest way in is the live demo in a browser. It needs no installation and works on a computer and on a phone.",
        },
        { kind: "links", items: [{ label: "ER-GreenWave live demo", href: DEMO_URL }] },
        { kind: "heading", text: "Requirements for a local run" },
        {
          kind: "list",
          items: [
            "Git and Python 3.12 with the uv package manager.",
            "Node.js 22 with npm.",
            "Optionally Docker with Docker Compose.",
            "The raw GIS data bundle supplied by the team. It is not part of the repository.",
          ],
        },
        { kind: "code", label: "Install dependencies", code: COMMANDS.install },
        {
          kind: "paragraph",
          text: "With the data bundle copied into backend/data/raw/, these one-off steps build the simulation dataset.",
        },
        { kind: "code", label: "Build the dataset", code: COMMANDS.dataset },
        { kind: "code", label: "Everything with Docker Compose", code: COMMANDS.compose },
        {
          kind: "paragraph",
          text: "The dashboard opens at http://localhost:3000 and the API reference at http://localhost:8000/docs.",
        },
        { kind: "code", label: "Simulation server (local)", code: COMMANDS.backend },
        { kind: "code", label: "Dashboard (local, demo mode)", code: COMMANDS.frontend },
        {
          kind: "paragraph",
          text: "Started this way, the dashboard runs its built-in demo simulation and needs neither the server nor the GIS data. To connect it to the simulation server, run the command below in the frontend folder.",
        },
        {
          kind: "code",
          label: "Dashboard with the simulation server",
          code: COMMANDS.frontendWithBackend,
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
          text: "We chose mature open tools that need no paid licences or access keys. Any single piece can be swapped without rebuilding the rest.",
        },
        {
          kind: "table",
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
              "Smooth WebGL rendering with no map tokens or fees.",
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
              "A one-way stream over plain HTTP: one message for every simulated second.",
            ],
            [
              "Deployment",
              "Docker Compose, Caddy, Oracle Cloud Always Free",
              "Automatic HTTPS, zero running cost and a fresh deploy after every change on main.",
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
            { label: "OpenStreetMap copyright", href: SOURCE_LINKS[0] },
            { label: "MSIP: Ulice", href: SOURCE_LINKS[1] },
            { label: "MSIP: Punkty adresowe (EMUiA)", href: SOURCE_LINKS[2] },
            { label: "BBBike: OpenStreetMap extracts", href: SOURCE_LINKS[3] },
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
            "Source data is processed once, offline. The simulation server sends the run state to the dashboard every simulated second. The green line is the live data path.",
        },
        { kind: "heading", text: "Data preparation" },
        {
          kind: "paragraph",
          text: "The ETL stage turns the raw files into a directed road graph with tables of junctions, approaches and addresses. The server loads it once at startup, so routing never has to touch the raw GIS files.",
        },
        { kind: "heading", text: "Choosing the unit and the route" },
        {
          kind: "paragraph",
          text: "Once the incident is placed, the server estimates the driving time from every suitable base and picks the fastest. The emergency vehicle's speed follows the limit on each road. A bus lane or tram track lets it go faster, and each speed bump costs a few seconds.",
        },
        { kind: "heading", text: "The green corridor" },
        {
          kind: "paragraph",
          text: "Every simulated second, the engine computes the time to intersection (TTI) for each signal ahead: remaining distance divided by smoothed speed. As the vehicle approaches, it sends a priority request to the simulated ITS controller. Signals within 250 m of each other along the route are handled together, so a queue at the next junction cannot block the run.",
        },
        {
          kind: "paragraph",
          text: "The simulated controller can answer normally (after 1 s), late (after 5 s), refuse, or not answer at all (8 s limit). A refusal or a missing answer ends the run visibly, because a real system would have to handle exactly these cases.",
        },
        { kind: "heading", text: "Standard traffic" },
        {
          kind: "paragraph",
          text: "Without priority, the vehicle takes the same route while the signals run their ordinary programme. At a red light it crosses with care and loses time that depends on how long it would have waited for green, at most 15 s per junction. The difference between the two runs is what the green corridor saves.",
        },
        {
          kind: "note",
          text: "Simulation only. Messages to the ITS controller illustrate a proposed interface. A deployment would need integration with specific controllers and safety validation with the road authority.",
        },
      ],
    },
    {
      id: "roadmap",
      label: "Future development",
      title: "Future development",
      blocks: [
        {
          kind: "paragraph",
          text: "The app is a prototype, but its split into data, engine and dashboard lets it grow step by step towards deployment.",
        },
        { kind: "heading", text: "Path to deployment" },
        {
          kind: "list",
          items: [
            "A pilot with the Kraków road authority (ZDMK) on one corridor, such as Aleje Trzech Wieszczów, linked to the traffic control centre through a standard priority interface.",
            "Real vehicle positions from the dispatch system instead of simulated motion.",
            "Model parameters calibrated on measured Kraków traffic data.",
            "Fire brigade, police and public transport priority served by the same mechanism.",
            "Other cities: the processing pipeline accepts any OpenStreetMap extract and a local address register.",
          ],
        },
        { kind: "heading", text: "Value for the public and private sectors" },
        {
          kind: "list",
          items: [
            "The city and the road authority can compare corridors and decide where emergency priority saves the most time.",
            "Emergency services get evidence of how many seconds can be saved, and a tool for planning where bases go.",
            "ITS controller vendors and system integrators get a reference priority interface and a test bench.",
            "Private medical transport and fleet operators can use the travel-time estimates for planning.",
          ],
        },
      ],
    },
  ],
};
