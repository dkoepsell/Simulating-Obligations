# Agent‑Relational Simulation Testbed

This repository contains a modular, configurable testbed for exploring the dynamics of ethical obligation, trust, and social order, inspired by the ontological approach laid out in *The Geometry of the Good*.  Agents in this simulation occupy a shared space, emit and receive directed obligations, adjust trust, reproduce and die, and form emergent alliances and regimes.  By tweaking parameters or writing your own norm modules, you can investigate how different normative structures and repair mechanisms influence the stability or collapse of moral communities.

## Quick start

1. **Install dependencies** (optional).  All code is pure JavaScript running in the browser via [p5.js](https://p5js.org/), so there are no Node dependencies required for runtime.  If you want to build or lint the code, run `npm install`.
2. **Serve the project over HTTP.**  Modern browsers block ES‑module imports from `file://` URLs.  Start a simple server in the project root:

   ```bash
   python -m http.server 8000
Then open http://localhost:8000/index.html
 in your browser.
3. Interact with the GUI. The simulation appears on the left; control and analysis tools appear below. From here you can select scenarios, toggle experimental features, adjust dozens of parameters, run headless batches, or download logs. Hover over any control for a tooltip.

├─ index.html                # Entry point loading p5.js and the modular simulation
├─ README.md                 # This guide
└─ sim/
   ├─ config.js              # Central configuration (canvas sizes, force constants, mortality, reproduction, etc.)
   ├─ scenarios.js           # Scenario definitions (pluralist, authoritarian, utopian, collapsed, anomic, etc.)
   ├─ norms.js               # Registry of norms and default enforcement/acknowledgment logic
   ├─ agent.js               # Agent and ObligationVector classes; motion, trust, conflict, debt, reproduction
   ├─ exporter.js            # Metrics computation and CSV/JSON export functions
   ├─ gui.js                 # Construction of the control panel and advanced settings
   ├─ sketch.js              # The p5.js setup/draw loop; orchestrates everything
   └─ examples/
      ├─ sample_config.json  # Example parameter file for batch runs
      └─ README.md           # Explains how to load sample configs



Loads p5.js from a CDN and imports ./sim/sketch.js as an ES module. The <div id="sketch-holder"> element hosts the canvas; the GUI is appended dynamically below this element. For development, you can adjust the <meta> tags or add a favicon here.

sim/config.js
Defines all global numerical parameters and toggle defaults. Key sections include:

SIM_CONFIG.forceParams – cohesion, separation, alignment and trust‑attraction coefficients. Changing these values alters how agents move in relation to each other.

SIM_CONFIG.obligation – proximity threshold, count multiplier and maximum number of obligations generated per generation.

SIM_CONFIG.enforcementRules – baseline expiration time and random jitter for obligations; adjust these to make obligations expire faster or slower.

SIM_CONFIG.trustGrowth – increment and decrement applied to trust when obligations are fulfilled or denied.

SIM_CONFIG.reproduction and SIM_CONFIG.death – control birth/death rates, mutation intensity and inheritance.

TOGGLES – default booleans for optional features (moral repair, directed emergence, trust heatmaps, trails, falsifiability flags, validation mode).

Modify this file or use the Advanced Settings panel to tune the simulation at runtime. Parameters supplied via the GUI override the defaults.

sim/scenarios.js
Defines named scenario functions that shape agents’ norm acknowledgments and preferences en masse. Scenarios include:

pluralist – each norm is acknowledged randomly (mixed norms).

authoritarian – only the legal norm is acknowledged.

utopian – all norms are acknowledged.

collapsed – no norms are acknowledged (ethical collapse).

anomic – norms are seldom acknowledged (high fragmentation).

Several others like allCare, allLegal, noApriori, asymmetryOnly and genocideShock for more exotic experiments.

Use these functions via the scenario buttons or batch runs. You can add your own scenarios by exporting additional functions from this module; they will appear automatically in the GUI.

sim/norms.js
A norm registry defines for each norm a colour, an enforceFn, and an acknowledgeFn. The default enforcement function, defaultEnforce(), handles fulfillment, denial and expiration. Researchers can register custom norms (e.g. an “empathy” norm) at runtime by calling registerNorm(name, {color, enforceFn, acknowledgeFn}). When you add a norm via the Advanced Settings panel, it appears in the legend and becomes available for obligations.

sim/agent.js
Implements two classes:

Agent – holds position, velocity and acceleration vectors; stores trust, conflict, debt and cultural momentum; updates motion via flocking and trust attraction; records biographies and assigns roles/traits; contains the updateConflictAndDebt() logic which now counts both expired and denied obligations as contributing to contradiction debt

localhost
.

ObligationVector – links a source and target agent, pushing the source towards the target until fulfilled, denied or expired. Enforcement logic is delegated to the norm registry.

sim/exporter.js
Contains functions to compute generation‑level metrics (logGeneration), assemble interpretive summaries, and export logs. CSV download functions now use the browser’s File System Access API when available, allowing you to choose a destination for your files. If the API isn’t supported, exports fall back to a standard download anchored in the default directory.

sim/gui.js
Builds the control panel. Key features include:

Scenario buttons to switch normative regimes on the fly.

Toggle switches for moral repair, directed norms, vulnerability targeting, trust heatmaps and trails.

Simulation controls (Pause/Resume, Stop, Reset, About, Start Batch). The About button opens a modal with a synopsis of the simulation’s theoretical foundations.

Advanced Settings – a collapsible panel exposing sliders and selectors for nearly every parameter in config.js: agent count, proximity threshold, trust growth, expiration rules, reproduction/death rates, force coefficients, memory base, moral stance distribution, validation mode, batch run counts, etc. Live values are displayed next to each slider.

Add custom norm – fields to register new norms at runtime by name and colour.

Download Settings – exports the current slider values as a JSON file for reproducibility.

All controls include tooltips explaining their purpose.

sim/sketch.js
This is the orchestrator. It uses p5.js’s setup() and draw() functions to manage agents, obligations, logging and rendering. Highlights:

Batch mode allows headless execution across combinations of scenarios and toggle settings, with automatic CSV exports after each run.

Dynamic affiliation and scenario evolution – agents form trust‑based alliances (affiliations) that can split and merge over time; they also re‑classify into high‑level scenarios (pluralist, authoritarian, utopian, etc.) based on their norm acknowledgments. Both affiliations and scenarios are colour‑coded, displayed in the metric panel, and logged per agent.

Interpretive summary – when you stop the simulation, a report summarises fulfillment rates, relational integrity, debt, conflict and trust patterns.

Validation mode – toggle a dry‑run mode that skips rendering and performs only updates and logging; useful for long batch experiments.

sim/examples/
A place for sample configurations or output. The provided sample_config.json demonstrates how to save and load parameter sets.

Extending the testbed
Define new norms in norms.js or register them via the GUI.

Write your own scenarios in scenarios.js to model different normative distributions.

Expose more parameters by adding sliders in gui.js and corresponding fields in advancedSettings in sketch.js.

Adjust debt/conflict logic in agent.js to test alternate ethical hypotheses.

References
The conceptual foundation of this simulation comes from David Koepsell’s The Geometry of the Good, which argues that obligations emerge from the geometry of relations rather than abstract rules

localhost
. A companion paper explores how directed obligations, trust networks and moral repair mechanisms affect the stability of social systems. This testbed seeks to render those ideas experimentally.

Please feel free to fork, modify and contribute. Issues and pull requests are welcome!
