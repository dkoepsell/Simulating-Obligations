// sketch.js
//
// The entry point for the modular agent–obligation simulation.  This file
// orchestrates the P5.js setup/draw lifecycle, composes the imported
// modules and maintains the simulation state.  It largely mirrors the
// structure of the original monolithic sketch but references
// configuration, class definitions, scenarios, exporters and GUI
// builders from dedicated modules.

import { SIM_CONFIG, TOGGLES, normTypes, COLORS } from './config.js';
import { registerNorm, defaultEnforce } from './norms.js';
import { Agent, ObligationVector, getNormColor } from './agent.js';
import { SCENARIO_FUNCTIONS, SCENARIO_NAMES } from './scenarios.js';
import { createGUI } from './gui.js';
import { logGeneration, generateInterpretiveSummary, downloadAgentLog, downloadObligationLog } from './exporter.js';

// Declare global state variables.  Using module‑level variables keeps
// the simulation state encapsulated within this file but still
// accessible from callback functions and the P5.js environment.
let agents = [];
let obligationVectors = [];
let agentLog = [];
let obligationLog = [];
let log = [];
let falsifyFlags = [];

let generation = 0;
let generationTimer = 0;
const generationInterval = SIM_CONFIG.generationInterval;

// The current scenario and toggle states.  Scenario defaults to
// 'pluralist' but can be changed via the GUI.  Toggles mirror the
// properties defined in TOGGLES but are copied locally to allow
// mutation.
let scenario = 'pluralist';
let enableMoralRepair = TOGGLES.enableMoralRepair;
let enableDirectedEmergence = TOGGLES.enableDirectedEmergence;
let enableNonReciprocalTargeting = TOGGLES.enableNonReciprocalTargeting;

// Visual toggle states copied from the configuration toggles.  These
// flags control optional render layers such as trust heatmap and
// agent motion trails.  They may be toggled via the GUI and remain
// scoped to this module so that modifications don't alter the
// imported constants.
let enableTrustHeatmap = TOGGLES.showTrustHeatmap;
let enableAgentTrails = TOGGLES.showAgentTrails;

// Additional visual layers for emerging affiliation groups and conflict intensity.
// These toggles control whether translucent heatmaps are drawn to
// illustrate group clustering and cross‑group friction.  They are
// initialised to false but can be enabled via the GUI.
let enableAffiliationHeatmap = false;
let enableConflictHeatmap = false;

// Validation mode controls whether the sketch renders the canvas.
// When true the simulation still updates but visual output is
// suppressed and only metrics are collected.  This flag is
// toggled via the advanced settings panel.
let validationMode = TOGGLES.enableValidationMode;

// Batch mode variables.  When batchMode is true the simulation runs
// repeatedly without drawing, logging results after a fixed number
// of generations.  Use window.startBatch(runs, generations) to
// initiate batch mode.
let batchMode = false;
let batchTotalRuns = 1;
let batchGenerations = 25;
let batchIndex = 0;

// Sequence of {scenario, combo} objects representing the order of
// scenario/toggle combinations to execute in batch mode.  Each
// element is consumed sequentially.  The array is built when
// startBatch() is called.
let batchRunsSequence = [];

// Accumulators for logs across batch runs.  When running in batch
// mode, we collect all agent and obligation log entries into these
// arrays.  At the end of the batch sequence the aggregated logs
// will be exported as single CSV files instead of one per run.
let batchAgentLog = [];
let batchObligationLog = [];

// Map of affiliation labels to colours used for rendering.  When a
// new group is created at runtime, a random colour is assigned and
// stored here.  This map is exposed on the window so that the
// Agent class can access groupColours during its update() call.
window.groupColors = {};

// Advanced settings allow users to modify core parameters at runtime
// without editing the code.  They are initialised from SIM_CONFIG
// defaults and updated via the GUI's advanced panel.
let advancedSettings = {
  numAgents: SIM_CONFIG.numAgents,
  proximityThreshold: SIM_CONFIG.enforcementRules.proximityThreshold,
  defaultNormDistribution: 'uniform',
  // Base memory length for new agents.  Values in [0.1,1.0].  Agents
  // sample around this base when initialised.
  memoryBase: 0.6,
  // Distribution for moral stance of new agents.  Can be
  // 'uniform', 'reactive-biased' or 'proactive-biased'.
  moralStanceDistribution: 'uniform'
};

// Unique id generator for agents.  Incremented whenever an agent is
// created.  Persisting across resets ensures that ids never repeat.
let globalAgentIndex = 0;

// Maintain a map of id → agent for efficient lookup.  This map is
// recreated every frame in draw() so that changes to the agents
// array are reflected automatically.
let agentMap = new Map();
// Set of hostile group pairs.  Each entry is a string "g1|g2" with
// lexicographically sorted group names.  If a pair is hostile, the
// obligation generator will avoid creating obligations between these
// groups.  Updated each generation by updateGroupDynamics().
let hostilePairs = new Set();

// Control flags
let running = true;
let isPaused = false;
let interpretiveSummary = '';
let summaryPopup;
let aboutPopup;

// Helper to classify an agent into a high-level scenario based on its
// current norm acknowledgments.  This function approximates the
// original scenario definitions: agents acknowledging all norms are
// classified as 'utopian'; agents acknowledging none as 'collapsed';
// agents acknowledging only the legal norm as 'authoritarian';
// agents acknowledging only the care norm as 'allCare'; otherwise
// agents fall into 'pluralist'.  Additional patterns can easily be
// added here.
function classifyScenario(agent) {
  const acknowledgments = {
    apriori: agent.aprioriAcknowledges,
    legal: agent.legalAcknowledges,
    care: agent.careAcknowledges,
    epistemic: agent.epistemicAcknowledges
  };
  const ackCount = Object.values(acknowledgments).filter(Boolean).length;
  if (ackCount === normTypes.length) return 'utopian';
  if (ackCount === 0) return 'collapsed';
  if (ackCount === 1) {
    if (acknowledgments.legal) return 'authoritarian';
    if (acknowledgments.care) return 'allCare';
    // If only one other norm is acknowledged, classify as pluralist by default
    return 'pluralist';
  }
  // Default catch-all for mixed acknowledgments
  return 'pluralist';
}

// Expose the agents and agentMap on the window so that imported
// classes can access them without circular dependencies.  See the
// applyCohesionForce() and applyAlignmentForce() implementations.
window.agents = agents;
window.agentMap = agentMap;
window.isPaused = isPaused;

// Provide a function on the window for initiating batch mode.  This
// allows the GUI module to call startBatch() without importing
// sketch.js directly.  When invoked it sets up the batch counters,
// enables headless rendering via validationMode and resets the
// simulation for the first run.
window.startBatch = function(runs, generations) {
  // Determine how many repetitions of each scenario/toggle combo to
  // execute.  A run represents one execution per parameter combo.
  const reps = parseInt(runs) || 1;
  batchGenerations = parseInt(generations) || 25;
  batchRunsSequence = [];
  // Clear batch log accumulators at the start of a new batch run
  batchAgentLog = [];
  batchObligationLog = [];
  // Define the toggle combinations for batch cycling.  These combos
  // cover different moral repair and norm emergence settings.  Heatmap
  // and trail toggles are disabled in batch mode to reduce overhead.
  const combos = [
    { enableMoralRepair: true, enableDirectedEmergence: false, enableNonReciprocalTargeting: false },
    { enableMoralRepair: false, enableDirectedEmergence: true, enableNonReciprocalTargeting: false },
    { enableMoralRepair: true, enableDirectedEmergence: true, enableNonReciprocalTargeting: true }
  ];
  // Build the batch run sequence by iterating over all scenarios and
  // toggle combos.  Each combination is repeated the specified
  // number of times.
  for (const s of SCENARIO_NAMES) {
    for (const combo of combos) {
      for (let i = 0; i < reps; i++) {
        batchRunsSequence.push({ scenario: s, combo });
      }
    }
  }
  batchTotalRuns = batchRunsSequence.length;
  batchIndex = 0;
  batchMode = true;
  validationMode = true;
  // Apply the configuration for the first run and reset the simulation
  if (batchRunsSequence.length > 0) {
    applyBatchConfig(batchRunsSequence[0]);
  }
  resetSimulation();
};

/**
 * Setup is called once by P5.js when the page loads.  It
 * initialises the canvas, builds the GUI, creates the initial agents
 * and obligations and seeds the log.  After setup the draw() loop
 * begins and runs at the desired frame rate.
 */
export function setup() {
  const canvas = createCanvas(windowWidth - 40, windowHeight - 100);
  canvas.parent('sketch-holder');
  // Improve graphics quality by increasing pixel density and enabling
  // smoothing.  This reduces jagged edges and produces clearer lines
  // and curves on high DPI displays.
  pixelDensity(2);
  smooth();

  // Create and style the summary popup used for interpretive summaries
  summaryPopup = createDiv('');
  summaryPopup.id('summary-popup');
  summaryPopup.html('');
  summaryPopup.style('position', 'absolute');
  summaryPopup.style('top', '50%');
  summaryPopup.style('left', '50%');
  summaryPopup.style('transform', 'translate(-50%, -50%)');
  summaryPopup.style('background', '#fffff0');
  summaryPopup.style('padding', '20px');
  summaryPopup.style('border', '1px solid #ccc');
  summaryPopup.style('border-radius', '8px');
  summaryPopup.style('font-family', 'Arial');
  summaryPopup.style('font-size', '14px');
  summaryPopup.style('display', 'none');
  summaryPopup.style('max-width', '600px');
  summaryPopup.style('z-index', '1000');
  document.body.appendChild(summaryPopup.elt);

  // About popup to display descriptive information about the simulation.
  // It mirrors the summary popup in style but contains static text.
  aboutPopup = createDiv('');
  aboutPopup.id('about-popup');
  aboutPopup.html('');
  aboutPopup.style('position', 'absolute');
  aboutPopup.style('top', '50%');
  aboutPopup.style('left', '50%');
  aboutPopup.style('transform', 'translate(-50%, -50%)');
  aboutPopup.style('background', '#fffff0');
  aboutPopup.style('padding', '20px');
  aboutPopup.style('border', '1px solid #ccc');
  aboutPopup.style('border-radius', '8px');
  aboutPopup.style('font-family', 'Arial');
  aboutPopup.style('font-size', '14px');
  aboutPopup.style('display', 'none');
  aboutPopup.style('max-width', '600px');
  aboutPopup.style('z-index', '1000');
  document.body.appendChild(aboutPopup.elt);

  // Build the GUI.  Callbacks are defined here to manipulate the
  // simulation state without leaking implementation details into the
  // GUI module.
    createGUI({
    scenarios: SCENARIO_NAMES,
    // Expose an array of toggle names.  Additional toggles for
    // visual layers (trust heatmap, affiliation heatmap, conflict heatmap
    // and motion trails) are included to provide more modifiability.
    // These labels are used in the onToggleChange handler below.
    toggles: ['Moral Repair', 'Directed Norms', 'Vulnerability Targeting', 'Trust Heatmap', 'Affiliation Heatmap', 'Conflict Heatmap', 'Trails'],
    onScenarioSelect: (type) => {
      scenario = type;
      resetSimulation();
    },
    onToggleChange: (name) => {
      switch (name) {
        case 'Moral Repair':
          enableMoralRepair = !enableMoralRepair;
          break;
        case 'Directed Norms':
          enableDirectedEmergence = !enableDirectedEmergence;
          break;
        case 'Vulnerability Targeting':
          enableNonReciprocalTargeting = !enableNonReciprocalTargeting;
          break;
        case 'Trust Heatmap':
          enableTrustHeatmap = !enableTrustHeatmap;
          break;
        case 'Affiliation Heatmap':
          enableAffiliationHeatmap = !enableAffiliationHeatmap;
          break;
        case 'Conflict Heatmap':
          enableConflictHeatmap = !enableConflictHeatmap;
          break;
        case 'Trails':
          enableAgentTrails = !enableAgentTrails;
          break;
      }
    },
    onPauseResume: () => {
      isPaused = !isPaused;
      running = !isPaused;
    },
    onStop: () => {
      running = false;
      interpretiveSummary = generateInterpretiveSummary(log, agents, scenario);
      showInterpretivePopup();
    },
    onReset: () => {
      resetSimulation();
    },
    onDownloadAgentLog: () => {
      downloadAgentLog(agentLog, scenario);
    },
    onDownloadObligationLog: () => {
      downloadObligationLog(obligationLog, scenario);
    },
    onAdvancedChange: (settings) => {
      // Update advanced settings from the GUI and propagate changes
      // into the global configuration.  Many of these updates take
      // effect immediately (e.g. force constants) while others only
      // affect new agents on the next reset (e.g. memory base).
      advancedSettings = { ...advancedSettings, ...settings };
      // Proximity and agent count
      if (settings.proximityThreshold !== undefined) {
        SIM_CONFIG.enforcementRules.proximityThreshold = parseFloat(settings.proximityThreshold);
        SIM_CONFIG.obligation.proximityThreshold = parseFloat(settings.proximityThreshold);
      }
      if (settings.numAgents !== undefined) {
        SIM_CONFIG.numAgents = parseInt(settings.numAgents);
      }
      // Trust growth
      if (settings.trustIncrement !== undefined) {
        SIM_CONFIG.trustGrowth.increment = parseFloat(settings.trustIncrement);
      }
      if (settings.trustDecrement !== undefined) {
        SIM_CONFIG.trustGrowth.decrement = parseFloat(settings.trustDecrement);
      }
      // Expiration rules
      if (settings.expirationBase !== undefined) {
        SIM_CONFIG.enforcementRules.expirationBase = parseInt(settings.expirationBase);
      }
      if (settings.expirationRandom !== undefined) {
        SIM_CONFIG.enforcementRules.expirationRandom = parseInt(settings.expirationRandom);
      }
      // Reproduction and death
      if (settings.reproductionChance !== undefined) {
        SIM_CONFIG.reproduction.chance = parseFloat(settings.reproductionChance);
      }
      if (settings.deathRate !== undefined) {
        SIM_CONFIG.death.baseRate = parseFloat(settings.deathRate);
      }
      // Force constants
      if (settings.cohesion !== undefined) {
        SIM_CONFIG.forceParams.cohesion = parseFloat(settings.cohesion);
      }
      if (settings.separation !== undefined) {
        SIM_CONFIG.forceParams.separation = parseFloat(settings.separation);
      }
      if (settings.alignment !== undefined) {
        SIM_CONFIG.forceParams.alignment = parseFloat(settings.alignment);
      }
      if (settings.trustAttraction !== undefined) {
        SIM_CONFIG.forceParams.trustAttraction = parseFloat(settings.trustAttraction);
      }
      // Memory and moral stance distributions
      if (settings.memoryBase !== undefined) {
        advancedSettings.memoryBase = parseFloat(settings.memoryBase);
      }
      if (settings.moralStanceDistribution !== undefined) {
        advancedSettings.moralStanceDistribution = settings.moralStanceDistribution;
      }
      // Validation mode toggling
      if (settings.validationMode !== undefined) {
        validationMode = !!settings.validationMode;
      }
    }

    ,
    // Handle custom norm injection.  When users define a new norm via
    // the advanced settings panel this callback registers the norm
    // with the norm registry, extends the list of norm types and
    // updates existing agents and UI elements accordingly.
    onAddNorm: ({ name, color }) => {
      if (!name) return;
      const lower = name.toLowerCase();
      // Avoid duplicates by checking existing norm types
      if (SIM_CONFIG.normTypes.includes(lower)) return;
      // Register the new norm with default enforcement and acknowledgment
      registerNorm(lower, {
        color,
        // Delegate to the default enforcement logic provided in norms.js.
        // Without this wrapper the obligation will not be processed.
        enforceFn: (vec, state) => defaultEnforce(vec, state),
        acknowledgeFn: (agent) => agent[`${lower}Acknowledges`]
      });
      // Extend the normTypes array; normTypes is a reference to SIM_CONFIG.normTypes
      SIM_CONFIG.normTypes.push(lower);
      // Add colour definition to the global palette so that agents and
      // obligations are rendered consistently.  Because COLORS.norms
      // is an object, mutating it here updates the palette seen by
      // other modules.
      COLORS.norms[lower] = color;
      // The exported normTypes constant references SIM_CONFIG.normTypes, so
      // pushing onto SIM_CONFIG.normTypes suffices.  Do not push to
      // normTypes again or it will create duplicates.
      // Update the norm distribution selector in the GUI.  See gui.js
      // where window.normSelect is assigned.
      if (window.normSelect && typeof window.normSelect.option === 'function') {
        const label = lower.charAt(0).toUpperCase() + lower.slice(1) + ' biased';
        window.normSelect.option(label);
      }
      // Augment existing agents with acknowledgment and default
      // preference values.  By default agents randomise their
      // acknowledgment for the new norm.
      for (const agent of agents) {
        // Randomly decide if this agent acknowledges the new norm
        agent[`${lower}Acknowledges`] = random() > 0.5;
        // Ensure lastAcknowledgments is defined for the new norm
        if (!agent.lastAcknowledgments) agent.lastAcknowledgments = {};
        agent.lastAcknowledgments[lower] = agent[`${lower}Acknowledges`];
      }
    }
    ,
    onShowAbout: () => {
      showAboutPopup();
    }
  });

  initializeAgents();
  loadScenario(scenario);
  generateObligations();
  // Log initial state
  logGeneration(agents, generation, log);

  frameRate(60);
  smooth();
  pixelDensity(1);
  running = true;
  loop();
}

/**
 * The main draw loop.  This function executes repeatedly at the
 * configured frame rate.  It handles drawing the environment,
 * updating agents and obligations, logging and generation
 * transitions.
 */
export function draw() {
  background(245);

  // Validation (dry-run) mode: skip all rendering and instead
  // perform state updates only.  In this mode we still enforce
  // obligations, update agents and increment generations, but avoid
  // drawing to the canvas.  Metrics and logs continue to update.
  if (validationMode) {
    // Update agent lookup
    agentMap.clear();
    for (const a of agents) agentMap.set(a.id, a);
    window.agents = agents;
    window.agentMap = agentMap;
    // Enforce obligations without drawing lines
    for (const vec of obligationVectors) {
      vec.enforce({ generation, obligationLog });
    }
    // Update agents without drawing them
    for (const agent of agents) {
      agent.update();
    }
    // Advance generation logic
    if (running) {
      generationTimer++;
      if (generationTimer >= generationInterval) {
        evolveGeneration();
        generationTimer = 0;
      }
    }
    // Display minimal label indicating validation mode with scenario and generation info
    fill(0);
    noStroke();
    textSize(14);
    textAlign(CENTER, CENTER);
    let msg = 'Validation mode – running without rendering';
    msg += `\nScenario: ${scenario}  Generation: ${generation}`;
    if (batchMode) msg += `  Run: ${batchIndex + 1}/${batchTotalRuns}`;
    text(msg, width / 2, height / 2);
    return;
  }

  // Update the global agent map for lookup operations in the Agent
  // methods.  Reassign the window globals each frame so that
  // references remain up to date if the agents array is replaced.
  agentMap.clear();
  for (const a of agents) agentMap.set(a.id, a);
  window.agents = agents;
  window.agentMap = agentMap;

  drawTraitBars();
  drawLabels();

  // If paused, show static positions and graphs but do not advance
  if (isPaused) {
    // Display obligations
    for (const vec of obligationVectors) vec.display();
    // Draw heatmaps beneath agents when paused for inspection
    if (enableAffiliationHeatmap) {
      drawAffiliationHeatmap();
    }
    if (enableConflictHeatmap) {
      drawConflictHeatmap();
    }
    // Display agents
    for (const agent of agents) agent.display();
    drawLegend();
    drawDebtConflictGraph();
    return;
  }

  // Enforce and render obligations
  for (const vec of obligationVectors) {
    vec.enforce({ generation, obligationLog });
    vec.display();
  }
  // Draw optional heatmaps before updating agent positions so that
  // agents remain visible on top of the heatmap layers.  The
  // affiliation heatmap visualises group clustering, while the
  // conflict heatmap highlights locations with high inter‑group
  // friction.
  if (enableAffiliationHeatmap) {
    drawAffiliationHeatmap();
  }
  if (enableConflictHeatmap) {
    drawConflictHeatmap();
  }

  // Update and draw agents
  for (const agent of agents) {
    agent.update();
agent.updateConflictAndDebt();
    agent.display();
  }

  // Tooltip on hover
  for (const agent of agents) {
    if (dist(mouseX, mouseY, agent.pos.x, agent.pos.y) < agent.r) {
      fill(255);
      stroke(100);
      rect(mouseX + 10, mouseY - 10, 160, 70, 8);
      noStroke();
      fill(0);
      textSize(11);
      textAlign(LEFT, TOP);
      text(`Agent #${agent.id}\nNorm: ${agent.normPreference}\nTrust: ${agent.trustMap?.size ?? 0}\nDebt: ${agent.contradictionDebt?.toFixed(2) ?? 0}\nConflict: ${agent.internalConflict?.toFixed(2) ?? 0}`, mouseX + 14, mouseY - 6);
      break;
    }
  }

  drawLegend();
  drawDebtConflictGraph();


  // Render additional visual layers if enabled.  Heatmap and
  // trails are drawn after the main elements so they are visible
  // beneath agent circles.
  if (enableTrustHeatmap) {
    drawTrustHeatmap();
  }
  if (enableAgentTrails) {
    drawTrails();
  }

  // Advance generation on timer
  if (running) {
    generationTimer++;
    if (generationTimer >= generationInterval) {
      evolveGeneration();
      generationTimer = 0;
    }
  }
}

/**
 * Reset the simulation while preserving the unique id counter.  This
 * function clears all agents, logs and obligations and then
 * reinitialises the agents and obligations according to the current
 * scenario and toggle settings.
 */
function resetSimulation() {
  falsifyFlags = [];
  interpretiveSummary = '';
  log = [];
  agentLog = [];
  obligationLog = [];
  generation = 0;
  generationTimer = 0;
  // Clear group colours so that new runs generate fresh colours for emerging groups
  window.groupColors = {};
  initializeAgents();
  loadScenario(scenario);
  generateObligations();
  logGeneration(agents, generation, log);
  running = true;
}

/**
 * Update the affiliation of each agent based on the affiliations of
 * their trusted neighbours.  An agent examines its trustMap and
 * aggregates trust scores by neighbour group; it then adopts the
 * group with the highest cumulative trust.  If an agent has no
 * trusted neighbours, it retains its current group, but if the
 * group does not exist yet (e.g. due to norm drift) a new group
 * labelled pref_<norm> is created.  New groups are assigned random
 * colours and stored in window.groupColors.
 */
function updateAffiliations() {
  // For each agent compute the best group to join
  for (const agent of agents) {
    const groupScores = {};
    // Accumulate trust by neighbour group
    agent.trustMap.forEach((trust, id) => {
      const neighbour = agentMap.get(id);
      if (neighbour) {
        const group = neighbour.affiliation || `pref_${neighbour.normPreference}`;
        groupScores[group] = (groupScores[group] || 0) + trust;
      }
    });
    // Determine the group with the highest trust
    let bestGroup = agent.affiliation;
    let maxScore = -Infinity;
    for (const group in groupScores) {
      const score = groupScores[group];
      if (score > maxScore) {
        maxScore = score;
        bestGroup = group;
      }
    }
    // If no neighbours contributed scores and the current group is undefined,
    // fall back to the agent's norm-based group
    if (Object.keys(groupScores).length === 0) {
      bestGroup = `pref_${agent.normPreference}`;
    }
    // If this is a new group, assign a colour
    if (!window.groupColors[bestGroup]) {
      window.groupColors[bestGroup] = color(
        random(100, 255),
        random(100, 255),
        random(100, 255),
        220
      );
    }
    agent.affiliation = bestGroup;
  }
}

/**
 * Update the scenario classification of each agent based on its
 * current pattern of norm acknowledgments.  This function uses
 * classifyScenario() to assign the scenarioGroup property, allowing
 * scenarios to evolve dynamically over time.
 */
function updateScenarios() {
  for (const agent of agents) {
    agent.scenarioGroup = classifyScenario(agent);
  }
}

/**
 * Compute trust relationships between affiliation groups and update
 * hostile/merge dynamics.  Groups with very low mutual trust are
 * recorded in the hostilePairs set, which influences obligation
 * generation.  Groups with high mutual trust may merge into a single
 * affiliation.  Merges adopt the name and colour of the larger
 * partner.  Thresholds are heuristic and can be tuned for different
 * dynamics.
 */
function updateGroupDynamics() {
  // Reset hostile pairs
  hostilePairs.clear();
  // Partition agents by affiliation
  const groupMembers = {};
  for (const agent of agents) {
    const g = agent.affiliation;
    if (!groupMembers[g]) groupMembers[g] = [];
    groupMembers[g].push(agent);
  }
  const groups = Object.keys(groupMembers);
  // Compute average trust between every pair of groups
  const mergeThreshold = 3; // average trust above which groups merge
  const hostileThreshold = 0.5; // below this average trust groups become hostile
  // Keep track of which groups should merge into which
  const mergeTargets = {};
  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      const g1 = groups[i];
      const g2 = groups[j];
      // Compute average trust from g1 to g2 and g2 to g1
      let trustSum = 0;
      let count = 0;
      for (const a of groupMembers[g1]) {
        for (const b of groupMembers[g2]) {
          const trust = a.trustMap.get(b.id) || 0;
          trustSum += trust;
          count++;
        }
      }
      for (const a of groupMembers[g2]) {
        for (const b of groupMembers[g1]) {
          const trust = a.trustMap.get(b.id) || 0;
          trustSum += trust;
          count++;
        }
      }
      const avgTrust = count > 0 ? trustSum / count : 0;
      // Determine hostile or merge relation
      if (avgTrust < hostileThreshold) {
        // Record hostility in symmetric manner
        const key = [g1, g2].sort().join('|');
        hostilePairs.add(key);
      } else if (avgTrust > mergeThreshold) {
        // Plan to merge the smaller group into the larger one
        const size1 = groupMembers[g1].length;
        const size2 = groupMembers[g2].length;
        if (size1 >= size2) {
          mergeTargets[g2] = g1;
        } else {
          mergeTargets[g1] = g2;
        }
      }
    }
  }
  // Perform merges: update agent affiliations, colours and groupColours
  for (const [from, to] of Object.entries(mergeTargets)) {
    // Reassign all members of 'from' to 'to'
    for (const agent of groupMembers[from] || []) {
      agent.affiliation = to;
    }
    // Remove the old colour entry and rely on the new group's colour
    delete window.groupColors[from];
  }
}

/**
 * Apply a scenario and toggle combination for batch mode.  This
 * helper updates the global scenario variable and toggle flags
 * according to the provided configuration object.  Heatmap and
 * trail toggles are disabled during batch runs to minimise
 * overhead and because visual output is suppressed.
 *
 * @param {Object} cfg An object containing {scenario, combo}
 */
function applyBatchConfig(cfg) {
  if (!cfg) return;
  scenario = cfg.scenario;
  enableMoralRepair = !!cfg.combo.enableMoralRepair;
  enableDirectedEmergence = !!cfg.combo.enableDirectedEmergence;
  enableNonReciprocalTargeting = !!cfg.combo.enableNonReciprocalTargeting;
  // Disable visual layers in batch mode
  enableTrustHeatmap = false;
  enableAgentTrails = false;
}

/**
 * Create the initial population of agents.  The number of agents is
 * determined by SIM_CONFIG.numAgents.  Each agent is assigned a
 * unique id.
 */
function initializeAgents() {
  agents = [];
  // Use the advanced settings to determine the initial number of agents
  const count = parseInt(advancedSettings.numAgents) || SIM_CONFIG.numAgents;
  for (let i = 0; i < count; i++) {
    const agent = new Agent(globalAgentIndex++);
    agent.birthGeneration = generation;
    // Override the agent's preferred norm based on the advanced
    // distribution setting.  When biased toward a specific norm,
    // approximately 60% of agents will adopt that norm as their
    // preference, with the remainder distributed uniformly among the
    // other norms.  For the uniform case no adjustment is made.
    const dist = (advancedSettings.defaultNormDistribution || 'uniform');
    if (dist !== 'uniform') {
      const target = dist;
      if (random() < 0.6) {
        agent.normPreference = target;
      } else {
        // choose uniformly from other norms
        const others = normTypes.filter(n => n !== target);
        agent.normPreference = random(others);
      }
    }
    agents.push(agent);
  }

    // After creating new agents assign their scenario group to match
    // their norm preference.  This initialises emergent scenarios.
    for (const agent of agents) {
      // Initial scenario group is the current global scenario.  The
      // classification will update automatically each generation.
      agent.scenarioGroup = scenario;
      // Initialise affiliations based on preference and assign a colour
      agent.affiliation = `pref_${agent.normPreference}`;
      if (!window.groupColors[agent.affiliation]) {
        // Assign a random pastel colour for the group for visibility
        window.groupColors[agent.affiliation] = color(
          random(100, 255),
          random(100, 255),
          random(100, 255),
          220
        );
      }
    }

    // After creating new agents assign memory length and moral stance
    // based on advanced settings.  Memory length is drawn from a
    // distribution centred on memoryBase, and moral stance can be
    // biased toward reactive or proactive if selected.
    for (const agent of agents) {
      if (advancedSettings.memoryBase) {
        const base = parseFloat(advancedSettings.memoryBase);
        const minVal = Math.max(0.1, base - 0.2);
        const maxVal = Math.min(1.0, base + 0.2);
        agent.memoryLength = random(minVal, maxVal);
      }
      if (advancedSettings.moralStanceDistribution) {
        const dist = advancedSettings.moralStanceDistribution;
        if (dist === 'reactive-biased') {
          agent.moralStance = random() < 0.7 ? 'reactive' : 'proactive';
        } else if (dist === 'proactive-biased') {
          agent.moralStance = random() < 0.7 ? 'proactive' : 'reactive';
        }
        // uniform case uses whatever the Agent constructor set.
      }
    }
}

/**
 * Apply a scenario to all agents.  Scenario functions mutate
 * acknowledgments and preferences according to their definitions in
 * scenarios.js.
 *
 * @param {string} type The name of the scenario to apply
 */
function loadScenario(type) {
  const fn = SCENARIO_FUNCTIONS[type];
  if (!fn) return;
  for (const agent of agents) {
    fn(agent);
  }
}

/**
 * Generate a set of obligation vectors between agents based on the
 * configured proximity threshold and maximum count.  Each vector
 * represents a social obligation that will either be fulfilled,
 * denied or expire.
 */
function generateObligations() {
  obligationVectors = [];
  if (!agents || agents.length < 2) return;
  const maxVectors = SIM_CONFIG.obligation.maxVectors;
  const multiplier = SIM_CONFIG.obligation.countMultiplier;
  // Use advancedSettings proximity if provided
  const proximity = advancedSettings.proximityThreshold || SIM_CONFIG.enforcementRules.proximityThreshold;
  const vectorCount = Math.min(agents.length * multiplier, maxVectors);
  for (let i = 0; i < vectorCount; i++) {
    const source = random(agents);
    let nearby = agents.filter(a => a !== source && p5.Vector.dist(a.pos, source.pos) < proximity);
    // Filter out targets from hostile affiliation pairs
    nearby = nearby.filter(a => {
      const key = [source.affiliation, a.affiliation].sort().join('|');
      return !hostilePairs.has(key);
    });
    if (nearby.length === 0) continue;
    const target = random(nearby);
    const strength = random(0.2, 1.0);
    const norm = random(normTypes);
    obligationVectors.push(new ObligationVector(source, target, strength, norm));
  }
}

/**
 * Compute statistics, perform reproduction and death, record
 * biographies and refresh obligations.  This function is called
 * whenever a generation elapses.
 */
function evolveGeneration() {
  // Death based on age and conflict
  agents = agents.filter(agent => {
    const age = generation - (agent.birthGeneration || 0);
    const baseDeathRate = SIM_CONFIG.death.baseRate;
    // Conflict penalty is capped to avoid excessively high mortality from
    // extremely conflicted agents.  A constant cap of 0.1 mirrors the
    // behaviour of the original sketch.
    const conflictPenalty = Math.min(agent.internalConflict * SIM_CONFIG.death.conflictWeight, 0.1);
    const oldAgeBoost = age > SIM_CONFIG.death.ageThreshold ? SIM_CONFIG.death.oldAgeBoost * (age - SIM_CONFIG.death.ageThreshold) : 0;
    const deathChance = baseDeathRate + conflictPenalty + oldAgeBoost;
    if (random() < deathChance) {
      return false;
    }
    return true;
  });
for (const agent of agents) {
  agent.updateConflictAndDebt();
}

  // Update agent map after removing dead agents
  agentMap.clear();
  for (const a of agents) agentMap.set(a.id, a);

  generation++;
  // Create new obligations after reproduction/death; logging will
  // occur later after agents update conflict/debt for this generation.
  generateObligations();

  // First pass: update normative preferences and scenario groups
  for (const agent of agents) {
    // Normative drift: with a small probability agents may change their
    // preferred norm, simulating evolving norms and emergent scenarios.
    const driftChance = 0.02; // 2% chance per generation
    if (random() < driftChance) {
      const others = normTypes.filter(n => n !== agent.normPreference);
      agent.normPreference = random(others);
    }
    // Scenario group will be re-evaluated after drift using
    // updateScenarios().
  }
  // Re-evaluate scenario membership after normative drift.  This
  // classification allows scenario groups to evolve dynamically.
  updateScenarios();
  // Update affiliations based on trust networks after preferences shift
  updateAffiliations();
  // Compute group-level trust and handle hostile or merging dynamics
  updateGroupDynamics();

  // Second pass: record biographies, update conflict/debt and log entries
  for (const agent of agents) {
    agent.recordBiography(generation);
    agent.updateConflictAndDebt();
    // Evaluate relational ledger outcomes
    const ledger = Array.from(agent.relationalLedger.values());
    const fulfilled = ledger.filter(v => v === 'fulfilled').length;
    const denied = ledger.filter(v => v === 'denied').length;
    const expired = ledger.filter(v => v === 'expired').length;
    const repaired = ledger.filter(v => v === 'repaired').length;
    // Monitor acknowledgment changes
    for (const norm of normTypes) {
      const key = `${norm}Acknowledges`;
      if (agent[key] !== agent.lastAcknowledgments[norm]) {
        falsifyFlags.push(`Agent #${agent.id} changed ${norm} to ${agent[key]} @ Gen ${generation}`);
        agent.lastAcknowledgments[norm] = agent[key];
      }
    }
    // Capture per-agent log entry
    agentLog.push({
      generation,
      scenario,
      id: agent.id,
      normPref: agent.normPreference || 'n/a',
      aprioriAck: agent.aprioriAcknowledges || false,
      legalAck: agent.legalAcknowledges || false,
      careAck: agent.careAcknowledges || false,
      epistemicAck: agent.epistemicAcknowledges || false,
      attempts: agent.obligationAttempts || 0,
      successes: agent.obligationSuccesses || 0,
      conflict: agent.internalConflict || 0,
      debt: agent.contradictionDebt || 0,
      momentum: (agent.culturalMomentum || 0).toFixed(3),
      trustCount: agent.trustMap.size || 0,
      trustMax: Math.max(...Array.from(agent.trustMap.values()), 0),
      fulfilled,
      denied,
      expired,
      repaired,
      role: agent.role,
      temperament: agent.temperament,
      moralStance: agent.moralStance,
      scenarioGroup: agent.scenarioGroup,
      memoryLength: agent.memoryLength,
      // Include the agent's current affiliation to track emergent group
      affiliation: agent.affiliation
    });
  }

  // After agents update conflict and debt, log aggregate metrics for
  // this generation.  This ensures that avgDebt and avgConflict
  // reflect the latest updates rather than the previous
  // generation's values.
  logGeneration(agents, generation, log);

  // If running in batch mode, check whether this run has reached
  // the configured generation limit.  When the limit is hit, export
  // the logs for this run, increment the batch counter and either
  // reset the simulation for the next run or end batch mode.  The
  // exported filenames include the scenario and run index for
  // disambiguation.
  if (batchMode && generation >= batchGenerations) {
    // Clone logs before they are cleared by resetSimulation()
    const agentLogCopy = agentLog.slice();
    const obligationLogCopy = obligationLog.slice();
    // Append these logs to the batch accumulators.  We include
    // run index and scenario name in each entry so that the
    // aggregated CSV can be analysed later and replicate can be
    // distinguished.  Determine the current scenario name from the
    // batch configuration.
    const cfg = batchMode ? batchRunsSequence[batchIndex] : { scenario };
    const runNum = batchIndex + 1;
    // Enrich agent log rows with run and scenario
    for (const row of agentLogCopy) {
      row.run = runNum;
      row.batchScenario = cfg.scenario;
    }
    // Enrich obligation log rows with run and scenario
    for (const row of obligationLogCopy) {
      row.run = runNum;
      row.batchScenario = cfg.scenario;
    }
    batchAgentLog.push(...agentLogCopy);
    batchObligationLog.push(...obligationLogCopy);
    batchIndex++;
    if (batchIndex < batchTotalRuns) {
      // Apply the next scenario and toggle combination before resetting
      applyBatchConfig(batchRunsSequence[batchIndex]);
      resetSimulation();
    } else {
      // All runs completed: disable batch/validation modes and
      // export the aggregated logs as single CSV files.  Use a
      // generic filename for the batch.
      batchMode = false;
      validationMode = false;
      running = false;
      // Export aggregated logs if any entries were collected
      if (batchAgentLog.length > 0) {
        downloadAgentLog(batchAgentLog, 'batch_runs');
      }
      if (batchObligationLog.length > 0) {
        downloadObligationLog(batchObligationLog, 'batch_runs');
      }
      // When batch mode ends, display an interpretive summary of the final run
      interpretiveSummary = generateInterpretiveSummary(log, agents, scenario);
      summaryPopup?.remove();
      summaryPopup = createDiv(interpretiveSummary)
        .style('position', 'absolute')
        .style('top', '60px')
        .style('left', '50%')
        .style('transform', 'translateX(-50%)')
        .style('background', '#ffffff')
        .style('padding', '12px')
        .style('border', '1px solid #ccc')
        .style('border-radius', '8px')
        .style('max-width', '440px')
        .style('z-index', '1000');
    }
  }

  // Moral repair: attempt to repair denied or expired obligations
  if (enableMoralRepair) {
    for (const agent of agents) {
      for (const [targetID, status] of agent.relationalLedger.entries()) {
        if ((status === 'denied' || status === 'expired') && random() < SIM_CONFIG.repairChance) {
          agent.relationalLedger.set(targetID, 'repaired');
          obligationLog.push({
            status: 'repaired',
            norm: 'n/a',
            from: agent.id,
            to: targetID,
            generation
          });
        }
      }
    }
  }

  // Reproduction: offspring inherit or mutate acknowledgments and preferences
  const offspring = [];
  for (const parent of agents) {
    if (random() < SIM_CONFIG.reproduction.chance && agents.length + offspring.length < SIM_CONFIG.numAgents * 10) {
      const child = new Agent(globalAgentIndex++);
      // Mutate acknowledgments based on parent's conflict
      const mutationRate = SIM_CONFIG.reproduction.mutationBase + SIM_CONFIG.reproduction.maxConflictMutation * parent.internalConflict;
      for (const norm of normTypes) {
        const key = `${norm}Acknowledges`;
        child[key] = (random() < (1 - mutationRate)) ? parent[key] : random() > 0.5;
      }
      // Inherit or mutate norm preference
      child.normPreference = (random() < SIM_CONFIG.reproduction.preferenceInheritance)
        ? parent.normPreference
        : random(normTypes);
      // Inherit scenario and affiliation from parent.  These may be
      // re-classified in the next generation but preserve continuity.
      child.scenarioGroup = parent.scenarioGroup;
      child.affiliation = parent.affiliation;
      // Jitter cultural momentum
      child.culturalMomentum = constrain(
        (parent.culturalMomentum || 0.5) + random(-0.1, 0.1),
        0.1,
        1.0
      );
      child.birthGeneration = generation;
      offspring.push(child);
    }
  }
  agents = agents.concat(offspring);
}

/**
 * Draw labelled metrics in the top left corner of the canvas.  The
 * values displayed are taken from the most recent log entry and
 * toggle variables.  Falsifiability flags are displayed if present.
 */
function drawLabels() {
  const x = 20;
  let y = 20;
  const lineHeight = 18;
  fill(0);
  textAlign(LEFT);
  textSize(12);
  noStroke();
  const metrics = [
    `Generation: ${generation}`,
    `Agents: ${agents.length}`,
    `Scenario: ${scenario.charAt(0).toUpperCase() + scenario.slice(1)}`,
    `Moral Repair: ${enableMoralRepair ? 'On' : 'Off'}`,
    `Directed Norms: ${enableDirectedEmergence ? 'On' : 'Off'}`,
    `Vulnerability Targeting: ${enableNonReciprocalTargeting ? 'On' : 'Off'}`
  ];
  // Append batch run information if a batch is in progress
  if (batchMode) {
    metrics.push(`Batch Run: ${batchIndex + 1}/${batchTotalRuns}`);
  }
  // Append population counts for each high-level scenario.  The
  // scenarioGroup property reflects the agent's current normative
  // environment.  Displaying these counts shows how scenarios split
  // and merge over time.
  const scenarioCounts = {};
  for (const a of agents) {
    const s = a.scenarioGroup || 'n/a';
    scenarioCounts[s] = (scenarioCounts[s] || 0) + 1;
  }
  const scenarioStrings = Object.entries(scenarioCounts)
    .map(([s, count]) => `${s}: ${count}`)
    .join(', ');
  metrics.push(`Scenarios: ${scenarioStrings}`);
  // Append population counts for each affiliation group.  Groups are
  // keyed by the agents’ affiliation property which evolves based on
  // trust networks.  This allows live tracking of splitting and
  // merging social alliances.
  const groupCounts = {};
  for (const a of agents) {
    const g = a.affiliation || 'n/a';
    groupCounts[g] = (groupCounts[g] || 0) + 1;
  }
  const groupStrings = Object.entries(groupCounts)
    .map(([g, count]) => `${g}: ${count}`)
    .join(', ');
  metrics.push(`Groups: ${groupStrings}`);
  if (log.length > 0) {
    const latest = log[log.length - 1];
  metrics.push(
  `Fulfillment Rate: ${latest.fulfillmentRate?.toFixed(2)}`,
  `Relational Integrity: ${latest.avgRI?.toFixed(2)}`,
  `Contradiction Debt (Denied+Expired): ${latest.avgDebt?.toFixed(2)}`,
  `Internal Conflict: ${latest.avgConflict?.toFixed(2)}`,
  `Repair Events: ${latest.repairEvents}`,
  `Emergent Norms: ${latest.emergentNorms}`
);

  }
  for (const line of metrics) {
    text(line, x, y);
    y += lineHeight;
  }
  if (falsifyFlags.length > 0) {
    fill(150, 0, 0);
    textSize(11);
    text(`⚠ Falsifiability Flags (${falsifyFlags.length}):`, x, y);
    y += lineHeight;
    falsifyFlags.slice(0, 3).forEach(flag => {
      text(`- ${flag}`, x + 10, y);
      y += lineHeight - 5;
    });
  }
}

/**
 * Draw a legend explaining the meanings of colours and line styles
 * used in the simulation.  The legend appears in the bottom right
 * corner of the canvas and automatically uses the colour palette
 * defined in config.js.
 */
function drawLegend() {
  const legendX = width - 190;
  const legendY = height - 250;
  const legendW = 170;
  const legendH = 270;
  fill(255);
  stroke(180);
  rect(legendX, legendY, legendW, legendH, 6);
  fill(0);
  textSize(12);
  textAlign(LEFT, TOP);
  text('Legend:', legendX + 8, legendY + 5);
  let y = legendY + 20;
  // Agent fill legend: build dynamic entries for each norm in the system.
  const dynamicAgentColours = normTypes.map(norm => {
    const label = `${norm.charAt(0).toUpperCase() + norm.slice(1)} (preferred)`;
    return [label, getNormColor(norm, true)];
  });
  // Append a generic entry for agents that do not acknowledge a norm.
  dynamicAgentColours.push(['Not Acknowledged', getNormColor(normTypes[0] || 'legal', false)]);
  text('Agent Fill:', legendX + 8, y);
  y += 16;
  for (const [label, col] of dynamicAgentColours) {
    fill(col);
    stroke(0);
    ellipse(legendX + 18, y + 6, 12, 12);
    noStroke();
    fill(0);
    text(label, legendX + 32, y);
    y += 18;
  }
  y += 8;
  // Obligation lines: dynamic entries for each norm type followed by status lines.
  const dynamicObligationItems = normTypes.map(norm => {
    const normLabel = `${norm.charAt(0).toUpperCase() + norm.slice(1)}`;
    return [normLabel, color(...(COLORS.norms[norm] || [120, 120, 120]))];
  });
  // Status line definitions remain static
  dynamicObligationItems.push(['Fulfilled', null, COLORS.obligations.fulfilledWeight]);
  dynamicObligationItems.push(['Denied', null, COLORS.obligations.unfulfilledWeight, COLORS.obligations.dashDenied]);
  dynamicObligationItems.push(['Expired', null, COLORS.obligations.unfulfilledWeight, COLORS.obligations.dashExpired]);
  text('Obligations:', legendX + 8, y);
  y += 16;
  for (const [label, col, weight = COLORS.obligations.unfulfilledWeight, dash = []] of dynamicObligationItems) {
    stroke(col || 0);
    strokeWeight(weight);
    if (dash && dash.length) drawingContext.setLineDash(dash);
    else drawingContext.setLineDash([]);
    line(legendX + 10, y + 6, legendX + 40, y + 6);
    drawingContext.setLineDash([]);
    noStroke();
    fill(0);
    text(label, legendX + 50, y);
    y += 16;
  }
}

/**
 * Draw horizontal bar charts showing the fraction of agents
 * acknowledging each norm and the average cultural momentum.
 */
function drawTraitBars() {
  const margin = 20;
  const barHeight = 18;
  const spacing = 6;
  const total = agents.length;
  if (total === 0) return;
  const counts = normTypes.map(norm => agents.filter(a => a[`${norm}Acknowledges`]).length);
  const avgMomentum = agents.reduce((sum, a) => sum + a.culturalMomentum, 0) / total;
  const barWidth = width - 2 * margin;
  const startY = height - margin - (normTypes.length + 1) * (barHeight + spacing);
  normTypes.forEach((norm, i) => {
    const count = counts[i];
    const y = startY + i * (barHeight + spacing);
    const normColour = getNormColor(norm, true);
    fill(normColour);
    rect(margin, y, (count / total) * barWidth, barHeight);
    fill(0);
    textSize(12);
    textAlign(LEFT, CENTER);
    text(`${norm.charAt(0).toUpperCase() + norm.slice(1)} (${count}/${total})`, margin + 5, y + barHeight / 2);
  });
  // Average momentum bar
  const momentumY = startY + normTypes.length * (barHeight + spacing);
  fill(180);
  rect(margin, momentumY, avgMomentum * barWidth, barHeight);
  fill(0);
  textAlign(LEFT, CENTER);
  text(`Avg Momentum: ${avgMomentum.toFixed(2)}`, margin + 5, momentumY + barHeight / 2);
}

/**
 * Display a miniature line chart of average conflict and debt in the
 * top right of the canvas.  The chart scales dynamically to the
 * maximum value in the recent history.  Each point represents one
 * generation (not frame).
 */
function drawDebtConflictGraph() {
  const graphWidth = 260;
  const graphHeight = 80;
  const xOffset = width - graphWidth - 20;
  const yOffset = 40;
  const maxPoints = Math.floor(graphWidth / 3);
  const recentLog = log.slice(-maxPoints);
  const maxConflict = Math.max(...recentLog.map(e => parseFloat(e.avgConflict ?? 0)), 0.01);
  const maxDebt = Math.max(...recentLog.map(e => parseFloat(e.avgDebt ?? 0)), 0.01);
  const yMax = Math.max(maxConflict, maxDebt);
  // Background panel
  noStroke();
  fill(255, 240);
  rect(xOffset - 10, yOffset - 30, graphWidth + 20, graphHeight + 50, 12);
  // Axis label
  fill(0);
  textSize(10);
  text('Conflict / Debt (scaled)', xOffset, yOffset - 12);
  // Conflict curve
  noFill();
  stroke(200, 50, 50);
  beginShape();
  for (let i = 0; i < recentLog.length; i++) {
    const val = recentLog[i].avgConflict ?? 0;
    const y = map(val, 0, yMax, yOffset + graphHeight, yOffset);
    vertex(xOffset + i * 3, y);
  }
  endShape();
  // Debt curve
  stroke(50, 50, 200);
  beginShape();
  for (let i = 0; i < recentLog.length; i++) {
    const val = recentLog[i].avgDebt ?? 0;
    const y = map(val, 0, yMax, yOffset + graphHeight, yOffset);
    vertex(xOffset + i * 3, y);
  }
  endShape();
  // Legend
  noStroke();
  fill(200, 50, 50);
  text('Conflict', xOffset, yOffset + graphHeight + 12);
  fill(50, 50, 200);
  text('Debt', xOffset + 80, yOffset + graphHeight + 12);
}

/**
 * Draw a trust intensity heatmap.  Each agent emits a radial blob
 * whose alpha is proportional to the sum of its trust scores.  The
 * radius of the blob is fixed for all agents but the opacity varies
 * according to trust magnitude.  The heatmap is drawn using a
 * translucent red colour on top of the canvas but beneath agent
 * circles for clarity.  Agents with no trust connections produce
 * little to no glow.
 */
function drawTrustHeatmap() {
  noStroke();
  for (const agent of agents) {
    let totalTrust = 0;
    for (const value of agent.trustMap.values()) {
      totalTrust += value;
    }
    const alpha = constrain(totalTrust * 10, 0, 255);
    if (alpha > 5) {
      fill(255, 50, 50, alpha);
      const radius = 50 + (agent.culturalMomentum || 0.5) * 40;
      ellipse(agent.pos.x, agent.pos.y, radius, radius);
    }
  }
}

/**
 * Draw motion trails for each agent.  Trails are rendered as
 * semi‑transparent polyline segments connecting the agent's recent
 * positions.  The colour of the trail uses the agent's current
 * display colour but with reduced alpha.  Trail history is
 * maintained on the Agent instance and updated each frame.  Trails
 * are only visible when the corresponding toggle is enabled.
 */
function drawTrails() {
  for (const agent of agents) {
    const trail = agent.trail || [];
    if (trail.length < 2) continue;
    const c = agent.displayColor;
    const trailColour = color(red(c), green(c), blue(c), 80);
    stroke(trailColour);
    noFill();
    beginShape();
    for (const v of trail) {
      vertex(v.x, v.y);
    }
    endShape();
  }
}

/**
 * Draw a heatmap representing affiliation group densities.  Each
 * agent contributes a semi‑transparent circle coloured according
 * to its current affiliation.  Overlapping circles produce a
 * blended heatmap showing areas dominated by particular groups.
 */
function drawAffiliationHeatmap() {
  noStroke();
  // Use a fixed radius for all heat circles.  Larger values
  // produce more continuous regions but may blur small groups.
  const radius = 80;
  for (const agent of agents) {
    const group = agent.affiliation;
    const col = window.groupColors[group];
    if (!col) continue;
    // Copy the colour to adjust alpha without mutating the
    // original group colour.
    const c = color(col);
    // Lower alpha for the heatmap overlay.  Increase slightly
    // with group size to make larger groups more prominent.
    fill(red(c), green(c), blue(c), 40);
    ellipse(agent.pos.x, agent.pos.y, radius, radius);
  }
}

/**
 * Draw a heatmap highlighting inter‑group conflict intensity.  The
 * colour intensity of each circle scales with the agent's
 * conflict metric, providing a visual indication of where
 * cross‑group obligations are failing.  Areas with little
 * conflict remain faint while hotspots glow red.
 */
function drawConflictHeatmap() {
  noStroke();
  // Use a fixed radius for conflict circles.  Smaller values
  // localise conflict regions more precisely.
  const radius = 60;
  for (const agent of agents) {
    const conflict = agent.internalConflict || 0;
    if (conflict <= 0) continue;
    // Scale the alpha to the conflict value.  The factor 100
    // maps typical conflict levels (0–1) to 0–100; adjust as
    // necessary to tune visibility.
    const alpha = constrain(conflict * 120, 10, 200);
    fill(255, 50, 50, alpha);
    ellipse(agent.pos.x, agent.pos.y, radius, radius);
  }
}

/**
 * Display the interpretive summary inside the popup div.  A close
 * button is added to allow dismissal.  The popup can be invoked
 * from the Stop button in the GUI.
 */
function showInterpretivePopup() {
  summaryPopup.html(`
    <div style="text-align:right;">
      <button onclick="document.getElementById('summary-popup').style.display='none'" style="font-size:16px;">✖</button>
    </div>
    <div>${interpretiveSummary.replace(/\n/g, '<br>')}</div>
  `);
  summaryPopup.style('display', 'block');
}

/**
 * Show the about popup with descriptive text about the simulation and
 * its theoretical grounding.  The popup includes a close button and
 * uses similar styling to the summary popup.
 */
function showAboutPopup() {
  const html = `
    <div style="text-align:right;">
      <button onclick="document.getElementById('about-popup').style.display='none'" style="font-size:16px;">✖</button>
    </div>
    <div style="max-height:60vh; overflow-y:auto;">
    <p><strong>About the Relational Obligation Simulation</strong></p>
    <p>This interactive model is inspired by the ontological framework described in <em>The Geometry of the Good</em>,
    which argues that ethical obligation arises from the structure of relation itself rather than from contracts
    or rules.  Obligations here are modelled as directed vectors between agents; they exert attractive forces and
    succeed or fail depending on acknowledgment, proximity and time.  Agents accumulate contradiction debt when
    obligations are denied or expire, adjust trust based on interactions, and engage in moral repair.</p>
    <p>The simulation allows you to explore how different normative environments—such as pluralist, authoritarian,
    utopian, anomic or collapsed—affect the coherence of obligations.  You can also inject custom norms and
    modify parameters like trust growth, obligation expiry, reproduction, mortality and force constants using
    the Advanced Settings panel.  Additional visualisations, including trust heatmaps and motion trails, can be
    toggled on to deepen your understanding of emergent relational patterns.</p>
    <p>By experimenting with these settings you can test hypotheses about how directedness, recognition and
    repair contribute to moral stability.  The model serves as a flexible testbed for computational metaphysics,
    enabling formal exploration of the conditions under which ethical life flourishes or fragments.</p>
    </div>
  `;
  aboutPopup.html(html);
  aboutPopup.style('display', 'block');
}

// Bind window functions for p5 to call.  P5 expects setup() and draw()
// to exist in the global scope.  When using modules we must
// explicitly attach them to window.
window.setup = setup;
window.draw = draw;