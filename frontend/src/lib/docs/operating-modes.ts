import type { Language } from "@/lib/localization";
import type { DocsBlock } from "./content";

/** State identifiers remain verbatim; descriptions distinguish design intent from the PoC. */
export function operatingModeBlocks(language: Language): DocsBlock[] {
  const t = (pl: string, en: string) => (language === "pl" ? pl : en);
  return [
    { kind: "heading", text: t("Tryby pracy sygnalizacji", "Traffic Signal Operating Modes") },
    {
      kind: "paragraph",
      text: t(
        "Cztery fazy opisują pracę pojedynczego skrzyżowania, niezależnie od trybu przejazdu ENABLED lub DISABLED. Celem zarządzania korytarzem jest zarówno skrócenie dojazdu służb, jak i ograniczenie blokowania kolejnych skrzyżowań przez ruch ogólny. Poniżej oddzielono rolę docelowego systemu od działania obecnej symulacji.",
        "These four phases describe one intersection, separately from the ENABLED or DISABLED run mode. Corridor management aims to shorten emergency response and reduce downstream junction blocking by general traffic. Each phase below separates its intended traffic-management role from the current simulation behavior.",
      ),
    },
    {
      kind: "table",
      cards: true,
      columns: [
        t("Stan", "State"),
        t("Faza", "Phase"),
        t("Rola w zarządzaniu ruchem", "Traffic-management role"),
        t("Obecna implementacja", "Current implementation"),
      ],
      rows: [
        [
          "NORMAL",
          t("Tryb normalny / bazowy", "Normal / Baseline Mode"),
          t(
            "Zwykłe plany sygnalizacji obsługują ruch, gdy skrzyżowanie nie ma aktywnego priorytetu korytarza ratunkowego.",
            "Regular signal timing plans serve baseline traffic when no emergency corridor priority is active at the intersection.",
          ),
          t(
            "Symulowany program dwóch grup: 30 s zielonego, 3 s żółtego i 2 s all-red na grupę. Oczekujące żądanie samo nie zmienia stanu.",
            "A simulated two-group programme: 30 s green, 3 s yellow and 2 s all-red per group. A pending request alone changes no reported state.",
          ),
        ],
        [
          "CLEARING",
          t("Oczyszczanie przed przyjazdem", "Clearing Mode — Pre-arrival Queue Flushing"),
          t(
            "Docelowo wcześniejsze otwieranie faz na kolejnych skrzyżowaniach ma odprowadzać kolejki, aby pojazd uprzywilejowany napotkał ruchomy, drożny pas zamiast zatrzymanego ruchu. Koordynacja w przód ogranicza ryzyko przenoszenia zatoru na następne skrzyżowanie.",
            "In the intended system, opening coordinated phases ahead of arrival flushes queued vehicles so the emergency vehicle reaches an open, moving lane. Preparing downstream junctions is intended to prevent displaced traffic from blocking the next intersection.",
          ),
          t(
            "Żądania kwalifikują się przy TTI ≤40 s; po akceptacji CLEARING kieruje ruch konfliktowy i pieszych na czerwone, a trasie pozostawia zwykły program. Kaskada obejmuje cele w przód do 250 m. PoC nie symuluje kolejek ani ich opróżniania i nie wymusza tu zielonego trasy.",
            "Requests become eligible at TTI ≤40 s. After acceptance, CLEARING targets conflicting movements and pedestrians red while the route retains its ordinary programme. Cascade includes forward targets within 250 m. The PoC neither simulates queues and their discharge nor forces route green in this phase.",
          ),
        ],
        [
          "PRIORITY_GREEN",
          t(
            "Zielona fala / przejęcie priorytetu",
            "Green Wave / Priority Mode — Corridor Preemption",
          ),
          t(
            "Utrzymanie zielonego dla zbliżającego się pojazdu ma umożliwić ciągły przejazd przez kluczowe skrzyżowania przygotowanego korytarza.",
            "Holding route signals green for the approaching emergency vehicle aims to provide continuous passage through the prepared corridor’s critical intersections.",
          ),
          t(
            "Wymaga zaakceptowanego żądania, TTI ≤25 s i potwierdzenia pokazanych zielonych świateł trasy. Opóźnienia sterownika mogą zatrzymać pojazd, a nieudane żądanie daje STANDARD_FALLBACK tylko swoim celom. Nie jest to gwarancja nieprzerwanego przejazdu.",
            "Requires an accepted request, TTI ≤25 s and confirmation that route heads are shown green. Controller delay may hold the vehicle; failed requests put only their targets into STANDARD_FALLBACK. Uninterrupted passage is not guaranteed.",
          ),
        ],
        [
          "RECOVERY",
          t("Stabilizacja po przejeździe", "Recovery Mode — Post-passage Stabilization"),
          t(
            "Docelowe stopniowe przywracanie długości cykli i przesunięć fazowych ma ograniczać fale hamowania, wtórne przewężenia i wzajemne blokowanie skrzyżowań po przejeździe służb.",
            "A deployment would gradually restore normal cycle lengths and offsets to limit traffic shockwaves, secondary bottlenecks and gridlock after emergency passage.",
          ),
          t(
            "Po przejechaniu ostatniej linii skrzyżowania objętego aktywnym priorytetem wraca od razu zwykły program; stan RECOVERY trwa domyślnie 15 s. Żółte i blokady pokazanych świateł nadal obowiązują. PoC nie interpoluje długości cykli ani offsetów i nie modeluje fal zatorowych.",
            "After the last line of an actively prioritised intersection is passed, the ordinary programme resumes immediately; RECOVERY lasts 15 s by default. Shown-head yellow transitions and interlocks still apply. The PoC does not interpolate cycle lengths/offsets or model traffic shockwaves.",
          ),
        ],
      ],
    },
  ];
}
