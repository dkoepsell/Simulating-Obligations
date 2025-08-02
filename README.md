
# Agent‑Relational Simulation Testbed

This repository contains a modular, browser-based simulation testbed for exploring the dynamics of ethical obligation, trust, and social order. Inspired by *The Geometry of the Good*, this simulation models agents who emit and receive directed obligations, adjust trust, reproduce, die, and form emergent alliances and normative regimes.

By tweaking parameters or defining your own normative rules, you can investigate how various ethical structures and repair mechanisms influence the stability or collapse of moral communities.

---

## 🚀 Quick Start

1. **No install required** — everything runs in the browser via [p5.js](https://p5js.org/). No Node dependencies are needed to run the simulation.
2. **Serve the project locally** (due to browser restrictions on ES modules):
   ```bash
   python -m http.server 8000
   ```
   Then open: [http://localhost:8000/index.html](http://localhost:8000/index.html)

3. **Explore the interface.**  
   - The canvas appears on the left.  
   - The GUI panel appears below.  
   - Tooltips are available on hover.

---

## 🗂 File Structure

```
.
├─ index.html                # Entry point; loads p5.js and sketch.js
├─ README.md                 # This guide
└─ sim/
   ├─ config.js              # Simulation constants and toggles
   ├─ scenarios.js           # Predefined scenarios (pluralist, authoritarian, etc.)
   ├─ norms.js               # Norm definitions and enforcement logic
   ├─ agent.js               # Agent & ObligationVector classes
   ├─ exporter.js            # Logging, summaries, and CSV/JSON export
   ├─ gui.js                 # Control panel and advanced sliders
   ├─ sketch.js              # Main p5.js loop and orchestration
   └─ examples/
      ├─ sample_config.json  # Sample config file
      └─ README.md           # Instructions for using config files
```

---

## 🧩 Module Overview

### `index.html`
Loads p5.js from a CDN and imports `sketch.js` as an ES module. The `<div id="sketch-holder">` hosts the canvas, and the GUI is injected below.

---

### `sim/config.js`

Defines all global parameters:

- **`SIM_CONFIG.forceParams`** — controls motion via cohesion, separation, alignment, and trust attraction.
- **`SIM_CONFIG.obligation`** — defines obligation proximity, count, and frequency.
- **`SIM_CONFIG.enforcementRules`** — expiration timing and randomization.
- **`SIM_CONFIG.trustGrowth`** — how trust is increased or decreased.
- **`SIM_CONFIG.reproduction` / `SIM_CONFIG.death`** — birth/death rates, mutation intensity, inheritance.
- **`TOGGLES`** — enables features like moral repair, directed emergence, trails, validation mode, etc.

Runtime parameter changes via the GUI override defaults in this file.

---

### `sim/scenarios.js`

Defines bulk norm configurations. Predefined scenarios include:

- `pluralist`: random norm acknowledgment
- `authoritarian`: legal only
- `utopian`: all norms acknowledged
- `collapsed`: no norm acknowledgment
- `anomic`: low, fragmented acknowledgment

Additional scenarios include:
- `allCare`, `allLegal`, `noApriori`, `asymmetryOnly`, `genocideShock`, etc.

New scenarios can be added here and will automatically appear in the GUI.

---

### `sim/norms.js`

The norm registry assigns:
- A **color**
- An **`enforceFn()`** to handle fulfillment, denial, expiration
- An **`acknowledgeFn()`** to set how norms are recognized

New norms (e.g. “empathy”) can be added via GUI or dynamically using:

```js
registerNorm(name, { color, enforceFn, acknowledgeFn });
```

---

### `sim/agent.js`

Implements:

- **Agent**: Position, velocity, trust, memory, cultural traits, conflict and debt tracking, reproduction, norm acknowledgment, affiliation shifts.
- **ObligationVector**: Represents a directed norm-based obligation from source to target, enforcing behavioral constraints.

Agents evolve affiliations and contribute to scenario evolution. Trust and contradiction debt are updated based on denied or expired obligations.

---

### `sim/exporter.js`

Handles:

- Per-generation metric computation
- CSV/JSON logging
- Interpretive summary construction

CSV downloads use the [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API) when available to allow custom file save destinations; otherwise, standard downloads are used.

---

### `sim/gui.js`

Constructs the interactive interface:

- Scenario selectors
- Feature toggles (repair, emergence, heatmaps, trails)
- Simulation controls (Pause, Stop, Reset, About, Batch Mode)
- Advanced Settings panel for fine-tuned parameter adjustment
- Custom norm creation fields
- Live tooltips on all controls

---

### `sim/sketch.js`

Main orchestration file using `setup()` and `draw()` from p5.js:

- Agent updates and rendering
- Obligation creation and enforcement
- Affiliation/simulation regime evolution
- Interpretive summaries and condition logging
- Batch mode for headless scenario runs
- Validation mode (no rendering, only data updates)

---

### `sim/examples/`

Includes:

- `sample_config.json`: Demonstrates saved settings
- Instructions for loading these into the GUI or batch mode

---

## 🧪 Extending the Simulation

- Add **new norms** via `norms.js` or GUI
- Create **new scenarios** in `scenarios.js`
- Define **custom sliders** in `gui.js` linked to new config params
- Adjust **conflict/debt** logic in `agent.js` to test alternate ethics
- Enable **stress test toggles** (e.g., `nonReciprocalTargeting`, `directedEmergence`) via `config.js` or batch mode

---

## 📖 References

This simulation is based on:

**David Koepsell**, *The Geometry of the Good*  
A philosophical work proposing that moral obligation arises not from abstract rules, but from the directedness of relational structures.

A companion study explores simulation-based testing of these ideas, including moral repair, norm collapse, and emergent social regimes.

---

## 🤝 Contributing

Pull requests and issues are welcome. Please feel free to:

- Fork and modify the code
- Suggest new scenarios or parameters
- Report bugs or performance concerns
- Share findings and experiment results

