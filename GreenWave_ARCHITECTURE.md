# ER-GreenWave: Emergency Response GreenWave System

**Project developed for the "Open Data App" Hackathon (Kraków)**

ER-GreenWave is a proof-of-concept (PoC) platform demonstrating dynamic
routing and preemptive traffic-light clearing for emergency vehicles.
Using open spatial data from the City of Kraków, the system creates
temporary "green corridors" (life corridors) to reduce emergency
response times without compromising civilian traffic safety.

**Contact:** Filip Jarmuła (<jarmulafilip@gmail.com>), Piotr Lorek (<piotrlorek06@gmail.com>)

---

## 1. Glossary and Acronyms

- **TTI (Time to Intersection):** The dynamically calculated time
  remaining before the emergency vehicle reaches a specific
  intersection.
- **ITS (Intelligent Transportation System):** Centralized city
  systems that manage traffic lights. In Kraków, this refers to the
  STeR system.
- **MSIP (Miejski System Informacji Przestrzennej):** Kraków's
  official municipal spatial information system and a source of road
  geometry and traffic-light coordinates.
- **ZDMK (Zarząd Dróg Miasta Krakowa):** Kraków's municipal road
  authority and a source of speed limits and road classifications.
- **Datex II / NTCIP 1211:** Standards associated with communication
  and priority control in intelligent transportation systems.
- **SSE (Server-Sent Events) / WebSockets:** Technologies for
  streaming real-time data from the backend to the frontend,
  respectively unidirectionally or bidirectionally.
- **PoC (Proof of Concept):** A scaled-down implementation built to
  validate core logic and technical feasibility.

---

## 2. Architecture and Technology Stack

The project uses a decoupled architecture with a JSON-based
publish/subscribe contract. This supports rapid iteration, clear
separation of concerns, and straightforward integration with AI coding
assistants.

### Technology Stack

- **Backend:** Python and **FastAPI** (asynchronous event loop), with
  dependencies managed by **`uv`**.
- **Data processing engine:** **GeoPandas**, **Polars**, and
  **NetworkX** for graph-based pathfinding and spatial joins.
- **Frontend:** **Next.js** (React), **Tailwind CSS**, and
  **shadcn/ui** for dashboard development; run locally for the demo.
- **Mapping engine:** **MapLibre GL JS** (free, token-free fork of Mapbox GL; OSM-based tiles) for GPU-accelerated WebGL
  rendering of vehicle routes and intersection states.

### Architectural Decisions: Why?

1.  **Mocking the ITS controller:** The PoC does not interface directly
    with physical traffic lights because physical overrides are
    safety-critical. Instead, the system acts as an analytical layer
    that sends standardized priority requests to a mocked central ITS.
2.  **JSON contracts over WebSockets/SSE:** The frontend is passive and
    stateless. It consumes a data stream at 1 Hz and renders the
    interface, keeping UI complexity low.
3.  **Precomputed graph (ETL):** Raw GeoJSON/WFS data from MSIP is
    processed by an offline ETL step (output cached in
    `backend/data/processed/`) into an optimized directed NetworkX graph that the server loads at startup.
    Performing real-time pathfinding directly on raw GIS data would be
    too slow.
4.  **Corridor batching (cascade mode):** Clearing a single intersection
    on a dense street (such as Aleje Trzech Wieszczów) is ineffective if
    traffic is blocked at another intersection 150 m ahead. The engine
    groups nearby intersections (distance **d \< 250 m**) and triggers
    them together.

---

## 3. Mathematical Models and Core Logic

### Time to Intersection (TTI)

TTI is recalculated every second to drive the intersection state
machine:

$$\mathrm{TTI}_i = \frac{d_i}{v_{\mathrm{avg}}}$$

Where:

- $d_i$ is the remaining distance along the route polyline to
  intersection $i$.
- $v_{\mathrm{avg}}$ is the smoothed velocity of the
  ambulance.

### Travel-Time Estimation Algorithm

The system compares normal routing with ER-GreenWave routing to estimate
the potential time savings.

#### 1. Normal travel time (without priority)

$$T_{\mathrm{normal}} = \sum_{e \in \mathrm{Edges}} \frac{L_e}{V_e \cdot \mu_{\mathrm{traffic}}} + \sum_{v \in \mathrm{Signals}} D_v$$

This model includes standard speed limits ($V_e$), a traffic-density multiplier ($\mu_{\mathrm{traffic}}$), and a static delay penalty of approximately $D_v \approx 35\text{ s}$ at red lights.

#### 2. ER-GreenWave travel time (with priority)

$$T_{\mathrm{greenwave}} = \sum_{e \in \mathrm{Edges}} \frac{L_e}{V_{\mathrm{ambulance}}} + \sum_{v \in \mathrm{Signals}} D_{\min}$$

This model assumes a cleared lane, allowing a higher sustained speed and a minimal delay of approximately $D_{\min} \approx 3\text{ s}$ for safe crossing.

---

## 4. Data Flow and JSON Protocols

The system uses explicit JSON schemas as the API contract between the
engine and the dispatcher dashboard.

### Phase 1: Route Initialization (Frontend → Backend)

**Endpoint:** `POST /api/v1/simulation/start`

Called when the user selects the origin and destination.

**Request:**

```json
{
  "simulation_id": "SIM-20261025-01",
  "origin": {
    "lat": 50.0612,
    "lng": 19.9571
  },
  "destination": {
    "lat": 50.0134,
    "lng": 19.9982
  },
  "traffic_density_multiplier": 1.5,
  "enable_cascade_mode": true
}
```

**Response:** Returns static graph and route data.

```json
{
  "status": "INITIALIZED",
  "route_geometry": {
    "type": "LineString",
    "coordinates": [
      [19.9571, 50.0612],
      [19.9234, 50.0645],
      [19.9248, 50.0621]
    ]
  },
  "total_distance_m": 5400,
  "estimated_normal_time_sec": 780,
  "estimated_greenwave_time_sec": 380,
  "intersections_on_route": ["INT-302", "INT-303"]
}
```

### Phase 2: Real-Time Telemetry Stream (Backend → Frontend)

**Transport:** WebSocket or SSE, with a **1 Hz tick**.

The frontend consumes this stream to animate the MapLibre vehicle marker
and update dashboard KPIs. In this example, the second intersection
transitions to `CLEARING_CASCADE` based on the TTI threshold.

```json
{
  "event_type": "SIMULATION_TICK",
  "tick": 42,
  "timestamp": "2026-10-25T14:32:10Z",
  "ambulance": {
    "id": "AMB-KRA-01",
    "position": {
      "lat": 50.0661,
      "lng": 19.9221
    },
    "speed_kmh": 62.4,
    "status": "APPROACHING_INTERSECTION"
  },
  "kpi_metrics": {
    "current_time_saved_sec": 145,
    "total_time_elapsed_sec": 42
  },
  "intersections": [
    {
      "id": "INT-302",
      "name": "Aleje / Czarnowiejska",
      "state": "CLEARING",
      "tti_seconds": 28,
      "is_active_corridor": true
    },
    {
      "id": "INT-303",
      "name": "Aleje / Reymonta",
      "state": "CLEARING_CASCADE",
      "tti_seconds": 38,
      "is_active_corridor": true
    }
  ]
}
```

### Phase 3: Simulated ITS Dispatch (Backend → Mock External API)

**Endpoint:** `POST /api/v1/its/priority-request`

Triggered internally by the backend when **TTI ≤ 40 s**. This payload
represents an example request sent to the municipal traffic-control
center.

```json
{
  "message_id": "MSG-ITS-88392",
  "system_source": "ER_GREENWAVE_ENGINE",
  "target_system": "STeR_KRAKOW_ITS",
  "payload": {
    "priority_level": 1,
    "vehicle_type": "AMBULANCE",
    "intersections_group": ["MSIP-SIG-089", "MSIP-SIG-090"],
    "action": "FORCE_GREEN_PHASE",
    "hold_duration_sec": 35,
    "expected_arrival_utc": "2026-10-25T14:32:38Z"
  }
}
```

---

## 5. Proof-of-Concept Scope and Safety Note

ER-GreenWave is a proof of concept. Its ITS integration is mocked and
the JSON payloads illustrate the proposed interface; they do not
establish compatibility with Kraków's production traffic-control
infrastructure. Any real-world deployment would require validation with
the relevant authorities, controller-specific integration, and rigorous
operational and safety testing.

---

## 6. Open Questions

Unresolved points in this document. Agents must not invent answers (see
`.agents/INSTRUCTIONS.md`); resolve them here first, then implement.

1. **State machine:** the documented sequence is `NORMAL → CLEARING → PRIORITY_GREEN → RECOVERY`,
   but the telemetry example uses `CLEARING_CASCADE`. Proposal: treat cascade as a boolean flag,
   not a state. Transition conditions (TTI thresholds for CLEARING → PRIORITY_GREEN, start of
   RECOVERY) and the relation of `hold_duration_sec` to them are undefined.
2. **Identifiers:** telemetry uses `INT-302`, the ITS request uses `MSIP-SIG-089`; no mapping defined.
3. **Contract gaps:** `simulation_id` is client-supplied but not echoed in the response or
   telemetry; no stream subscription or stop/cancel endpoint; no policy for concurrent or
   duplicate simulations; no `schema_version`; no field marking values as simulated; ambulance
   `status` enum undefined; valid range of `traffic_density_multiplier` undefined (it divides
   speed, so it must be > 0).
4. **ITS dispatch (Phase 3):** model as an internal `ItsGateway` interface with a mock
   implementation rather than an HTTP call from the backend to itself.
5. **Model inputs:** `V_ambulance`, the ambulance speed model, and the smoothing method for
   $v_{\mathrm{avg}}$ are unspecified. The CRS and units of the MSIP/ZDMK layers must be verified
   before writing distance code.
6. **Data sources:** concrete datasets and URLs from the Kraków Open Data portal are not yet
   chosen or verified (the contest requires at least one Kraków open-data source).
7. **Terminology:** verify the name "STeR" for Kraków's ITS; "Datex II / NTCIP 1211" is in the
   glossary but not used.
