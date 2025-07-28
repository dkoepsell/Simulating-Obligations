// 👥 Initialize core variables
let agents = [];
let obligationVectors = [];
let numAgents = 100;
let generation = 0;
let generationInterval = 100;
let generationTimer = 0;
let scenario = 'pluralist';
let falsifyFlags = [];
let obligationLog = [];
let traitBarHistory = [];
let agentLog = [];
let log = [];
let running = true;
let interpretiveSummary = '';
let enableMoralRepair = true;
let enableDirectedEmergence = false;
let enableNonReciprocalTargeting = false;
let guiPanel;
let summaryPopup;
let agentMap = new Map(); // also required globally
let globalAgentIndex = 0; // ensures unique agent IDs

const MAX_AGENTS = 1000;

const normTypes = ['legal', 'apriori', 'care', 'epistemic'];

function setup() {
  const canvas = createCanvas(windowWidth - 40, windowHeight - 100);
  canvas.parent('sketch-holder');

  // Create and style the summary popup
  summaryPopup = createDiv('');
  summaryPopup.id('summary-popup');
  summaryPopup.html(''); // optionally set default content
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
  document.body.appendChild(summaryPopup.elt);  // ✅ append manually

  // Create GUI and initialize agents
  createGUI();
  initializeAgents();
  loadScenario(scenario);
  generateObligations();
  logGeneration();
frameRate(60);
smooth(); // smoothing of drawn shapes
 pixelDensity(1);  // prevent high-DPI doubling
  running = true;
  loop();
}

function draw() {
  background(245);

  // Update global agent map
  agentMap.clear();
  for (let a of agents) agentMap.set(a.id, a);

  drawTraitBars();
  drawLabels();

  // Pause mode: render state but don't advance simulation
  if (isPaused) {
    for (let vec of obligationVectors) vec.display();
    for (let agent of agents) agent.display();
    drawLegend();
    drawDebtConflictGraph();  // Show graph even when paused
    return;
  }

  // Enforce and display obligations
  for (let vec of obligationVectors) {
    vec.enforce();
    vec.display();
  }

  // Update and display agents
  for (let agent of agents) {
    agent.update();
    agent.display();
  }

  // Tooltip on hover
  for (let agent of agents) {
    if (dist(mouseX, mouseY, agent.pos.x, agent.pos.y) < agent.r) {
      fill(255);
      stroke(100);
      rect(mouseX + 10, mouseY - 10, 160, 70, 8);
      noStroke();
      fill(0);
      textSize(11);
      textAlign(LEFT, TOP);
      text(`Agent #${agent.id}
Norm: ${agent.normPreference}
Trust: ${agent.trustMap?.size ?? 0}
Debt: ${agent.contradictionDebt?.toFixed(2) ?? 0}
Conflict: ${agent.internalConflict?.toFixed(2) ?? 0}`, mouseX + 14, mouseY - 6);
      break;
    }
  }

  drawLegend();
  drawDebtConflictGraph();  // ✅ Live tension graph

  // Advance simulation
  if (running) {
    generationTimer++;
    if (generationTimer >= generationInterval) {
      evolveGeneration();
      generationTimer = 0;
    }
  }
}


function downloadAgentLog() {
  let csv = 'Generation,Scenario,ID,NormPref,A Priori,Legal,Care,Epistemic,Attempts,Successes,Conflict,Debt,Momentum,TrustCount,TrustMax,Fulfilled,Denied,Expired,Repaired\n';
  for (let row of agentLog) {
    csv += `${row.generation},${row.scenario},${row.id},${row.normPref},${row.aprioriAck},${row.legalAck},${row.careAck},${row.epistemicAck},${row.attempts},${row.successes},${row.conflict},${row.debt},${row.momentum},${row.trustCount},${row.trustMax},${row.fulfilled},${row.denied},${row.expired},${row.repairs}\n`;

  }
  let blob = new Blob([csv], { type: 'text/csv' });
  let url = URL.createObjectURL(blob);
  let link = createA(url, 'Download Agent Log');
  link.attribute('download', `agentLog_${scenario}.csv`);
  link.hide();
  link.elt.click(); 
} 

function windowResized() {
  resizeCanvas(windowWidth - 40, windowHeight - 100);
}

function resetSimulation() {
  falsifyFlags = [];
  interpretiveSummary = '';
  log = [];
  agentLog = [];
  obligationLog = [];
  generation = 0;
  generationTimer = 0;
  initializeAgents();
  loadScenario(scenario);
  generateObligations();
  logGeneration();
  running = true;
}

function getNormColor(norm, acknowledged) {
  const baseColors = {
    legal: color(128, 0, 128),
    apriori: color(0, 0, 255),
    care: color(0, 150, 0),
    epistemic: color(255, 165, 0)
  };
  let base = baseColors[norm];
  return acknowledged ? base : color(red(base), green(base), blue(base), 80); // faded if not acknowledged
}


function generateObligations() {
  obligationVectors = [];
  if (!agents || agents.length < 2) return;

  let vectorCount = Math.min(agents.length * 2, 500);
  let proximityThreshold = 150;

  for (let i = 0; i < vectorCount; i++) {
    let source = random(agents);
    let nearby = agents.filter(a =>
      a !== source && p5.Vector.dist(a.pos, source.pos) < proximityThreshold
    );

    if (nearby.length === 0) continue;

    let target = random(nearby);
    let strength = random(0.2, 1.0);
    let norm = random(normTypes);

    obligationVectors.push(new ObligationVector(source, target, strength, norm));
  }
}

function generateInterpretiveSummary() {
  const latest = log[log.length - 1] || {};
  const fulfillment = parseFloat(latest.fulfillmentRate || 0);

  const behavior = fulfillment >= 0.75 ? "🟢 Strong prosocial alignment"
                  : fulfillment >= 0.5 ? "🟡 Moderate cooperation"
                  : fulfillment >= 0.25 ? "🟠 Weak norm coherence"
                  : "🔴 Ethical fragmentation";

  const normSpread = normTypes.map(norm => {
    const count = agents.filter(a => a[`${norm}Acknowledges`]).length;
    return `${norm}: ${count}`;
  }).join(', ');

  const topTrustAgents = agents
    .filter(a => a.trustMap.size > 3)
    .sort((a, b) => (Math.max(...b.trustMap.values(), 0) - Math.max(...a.trustMap.values(), 0)))
    .slice(0, 3)
    .map(a => `#${a.id} (Trust: ${Math.max(...a.trustMap.values(), 0)})`)
    .join(', ') || 'None';

  const repairEvents = latest.repairEvents || 0;
  const avgTrustSize = (agents.reduce((sum, a) => sum + a.trustMap.size, 0) / agents.length).toFixed(2);

  interpretiveSummary = `
    <strong>📘 Interpretive Summary — Generation ${generation}</strong><br><br>
    <strong>Scenario:</strong> ${scenario}<br>
    <strong>Behavioral Assessment:</strong> ${behavior}<br><br>
    
    <strong>📊 Core Metrics:</strong><br>
    - Fulfillment Rate: ${fulfillment.toFixed(2)}<br>
    - Relational Integrity: ${latest.avgRI || 'n/a'}<br>
    - Contradiction Debt: ${latest.avgDebt || 'n/a'}<br>
    - Internal Conflict: ${latest.avgConflict || 'n/a'}<br>
    - Repair Events: ${repairEvents}<br>
    - Avg Trust Connections: ${avgTrustSize}<br><br>
    - Trust Alignment (Same Norm): ${latest.normTrustAlignment}<br>


    <strong>📚 Norm Acknowledgment:</strong><br>
    ${normSpread}<br><br>

    <strong>🤝 Top Trusted Agents:</strong><br>
    ${topTrustAgents}
  `;
}

function evolveGeneration() {
  // 🪦 Aging and Death
  agents = agents.filter(agent => {
    const age = generation - (agent.birthGeneration ?? 0);
    const baseDeathRate = 0.05;
    const conflictPenalty = Math.min(agent.internalConflict * 0.01, 0.1);
    const deathChance = baseDeathRate + conflictPenalty + (age > 5 ? 0.05 * (age - 5) : 0);

    if (random() < deathChance) {
      log.push(`Agent #${agent.id} died @ Gen ${generation} (age ${age})`);
      return false;
    }
    return true;
  });

  // 🔄 Update agentMap
  agentMap.clear();
  for (let a of agents) agentMap.set(a.id, a);

  generation++;
  logGeneration();            // Log system-wide averages
  generateObligations();      // Refresh obligations

  for (let agent of agents) {
    agent.recordBiography(generation);
    agent.updateConflictAndDebt();

    // Track ledger outcomes
    const ledger = [...agent.relationalLedger.values()];
    const fulfilled = ledger.filter(v => v === 'fulfilled').length;
    const denied = ledger.filter(v => v === 'denied').length;
    const expired = ledger.filter(v => v === 'expired').length;
    const repaired = ledger.filter(v => v === 'repaired').length;

    // Track norm acknowledgment changes
    for (let norm of normTypes) {
      const key = `${norm}Acknowledges`;
      if (agent[key] !== agent.lastAcknowledgments[norm]) {
        falsifyFlags.push(`Agent #${agent.id} changed ${norm} to ${agent[key]} @ Gen ${generation}`);
        agent.lastAcknowledgments[norm] = agent[key];
      }
    }

    // Log individual agent state
    agentLog.push({
      generation,
      scenario,
      id: agent.id,
      normPref: agent.normPreference ?? 'n/a',
      aprioriAck: agent.aprioriAcknowledges ?? false,
      legalAck: agent.legalAcknowledges ?? false,
      careAck: agent.careAcknowledges ?? false,
      epistemicAck: agent.epistemicAcknowledges ?? false,
      attempts: agent.obligationAttempts ?? 0,
      successes: agent.obligationSuccesses ?? 0,
      conflict: agent.internalConflict ?? 0,
      debt: agent.contradictionDebt ?? 0,
      momentum: agent.culturalMomentum?.toFixed(3) ?? 0,
      trustCount: agent.trustMap?.size ?? 0,
      trustMax: Math.max(...(agent.trustMap?.values?.() ?? [0])),
      fulfilled,
      denied,
      expired,
      repaired
    });
  }

  // ♻️ Moral Repair
  if (enableMoralRepair) {
    for (let agent of agents) {
      for (let [targetID, status] of agent.relationalLedger.entries()) {
        if ((status === 'denied' || status === 'expired') && random() < 0.1) {
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

  // 👶 Reproduction
  let offspring = [];
  for (let i = 0; i < agents.length; i++) {
    if (random() < 0.25 && agents.length + offspring.length < MAX_AGENTS) {
      let parent = agents[i];
      let child = new Agent(globalAgentIndex++);

      // Mutate norm acknowledgments
      let mutationRate = 0.05 + 0.1 * parent.internalConflict;
      for (let norm of normTypes) {
        let key = `${norm}Acknowledges`;
        child[key] = (random() < (0.85 - mutationRate))
          ? parent[key]
          : random() > 0.5;
      }

      // Inherit or mutate norm preference
      child.normPreference = (random() < 0.75)
        ? parent.normPreference
        : random(normTypes);

      // Jitter momentum
      child.culturalMomentum = constrain(
        (parent.culturalMomentum ?? 0.5) + random(-0.1, 0.1),
        0.1,
        1.0
      );

      offspring.push(child);
    }
  }

  agents = agents.concat(offspring);
}

class Agent {
  constructor(id) {
    this.id = id;

    let marginLeft = 180;
    let marginRight = 20;
    let marginTop = 50;
    let marginBottom = 150;

    this.pos = createVector(
      random(marginLeft, width - marginRight),
      random(marginTop, height - marginBottom)
    );

    this.vel = createVector();
    this.acc = createVector();
    this.r = 10;
    this.vulnerability = random();
    this.wander = p5.Vector.random2D(); // smooth background motion

    normTypes.forEach(norm => this[`${norm}Acknowledges`] = random() > 0.5);
    this.normPreference = random(normTypes);
    this.displayColor = getNormColor(this.normPreference, this[`${this.normPreference}Acknowledges`]);
    this.lastPref = this.normPreference;
    this.lastAck = this[`${this.normPreference}Acknowledges`];

    this.trustMap = new Map();
    this.relationalLedger = new Map();
    this.obligationAttempts = 0;
    this.obligationSuccesses = 0;
    this.contradictionDebt = 0;
    this.internalConflict = 0;
    this.culturalMomentum = random(0.3, 1.0);
    this.narrativeLog = [];
    this.conflictLog = new Map();
    this.biography = [];
    this.birthGeneration = generation;

    this.lastAcknowledgments = {};
    normTypes.forEach(n => this.lastAcknowledgments[n] = this[`${n}Acknowledges`]);
  }

  applyForce(force) {
    this.acc.add(force);
  }

  applyCohesionForce() {
    let total = 0;
    let center = createVector();

    for (let other of agents) {
      let d = p5.Vector.dist(this.pos, other.pos);
      if (other !== this && d < 60) {
        center.add(other.pos);
        total++;
      }
    }

    if (total > 0) {
      center.div(total);
      let desired = p5.Vector.sub(center, this.pos);
      desired.setMag(0.02); // small attractive force
      this.applyForce(desired);
    }
  }

  applyAlignmentForce() {
    let total = 0;
    let avgVel = createVector();

    for (let other of agents) {
      let d = p5.Vector.dist(this.pos, other.pos);
      if (other !== this && d < 60) {
        avgVel.add(other.vel);
        total++;
      }
    }

    if (total > 0) {
      avgVel.div(total);
      avgVel.setMag(0.02); // gentle matching
      this.applyForce(avgVel);
    }
  }

  applySeparationForce() {
    let total = 0;
    let steer = createVector();

    for (let other of agents) {
      let d = p5.Vector.dist(this.pos, other.pos);
      if (other !== this && d < 24) {
        let diff = p5.Vector.sub(this.pos, other.pos);
        diff.normalize();
        diff.div(d); // weighted by distance
        steer.add(diff);
        total++;
      }
    }

    if (total > 0) {
      steer.div(total);
      steer.setMag(0.05); // tweak for more or less separation
      this.applyForce(steer);
    }
  }

  updateConflictAndDebt() {
    let conflict = 0;
    let debt = 0;

    for (let status of this.relationalLedger?.values?.() ?? []) {
      if (status === 'denied') conflict++;
      if (status === 'expired') debt++;
    }

    this.internalConflict = conflict;
    this.contradictionDebt = debt;
  }

  recordBiography(gen) {
    this.biography.push({
      generation: gen,
      normPreference: this.normPreference,
      acknowledgments: normTypes.reduce((acc, n) => {
        acc[n] = this[`${n}Acknowledges`];
        return acc;
      }, {}),
      trustCount: this.trustMap.size,
      trustMax: Math.max(...this.trustMap.values(), 0),
      momentum: this.culturalMomentum,
      debt: this.contradictionDebt,
      conflict: this.internalConflict
    });
  }

  update() {
    let moved = false;

    for (let [id, score] of this.trustMap.entries()) {
      if (score > 2) {
        let peer = agentMap.get(parseInt(id));
        if (peer) {
          let seek = p5.Vector.sub(peer.pos, this.pos).setMag(0.05 * score);
          this.applyForce(seek);
          moved = true;
        }
      }
    }

    this.applySeparationForce();
    this.applyCohesionForce();
    this.applyAlignmentForce();

    if (!moved) {
      this.wander.rotate(random(-0.1, 0.1));
      this.applyForce(this.wander.copy().mult(0.03));
    }

    this.acc.limit(0.2);
    this.vel.add(this.acc);
    this.vel.mult(0.95);
    this.vel.limit(1.5);
    this.pos.add(this.vel);
    this.acc.mult(0.6);

    let targetColor = getNormColor(this.normPreference, this[`${this.normPreference}Acknowledges`]);
    this.displayColor = lerpColor(this.displayColor, targetColor, 0.05);

    this.wrapAround();
  }

  wrapAround() {
    let marginLeft = 180;
    let marginRight = 20;
    let marginTop = 50;
    let marginBottom = 150;

    if (this.pos.x < marginLeft) this.pos.x = width - marginRight;
    if (this.pos.x > width - marginRight) this.pos.x = marginLeft;
    if (this.pos.y < marginTop) this.pos.y = height - marginBottom;
    if (this.pos.y > height - marginBottom) this.pos.y = marginTop;
  }

  display() {
    fill(this.displayColor);
    push();
    translate(this.pos.x, this.pos.y);
    ellipse(0, 0, this.r * 2);
    pop();

    push();
    translate(this.pos.x, this.pos.y + 1);
    fill(0);
    textAlign(CENTER, CENTER);
    textSize(10);
    text(this.id, 0, 0);
    pop();
  }

  recordTrust(targetID, fulfilled) {
    let current = this.trustMap.get(targetID) || 0;
    this.trustMap.set(targetID, fulfilled ? current + 1 : current - 1);
  }
}

class ObligationVector {
  constructor(source, target, strength, normType = 'legal') {
    this.source = source;
    this.target = target;
    this.strength = strength;
    this.normType = normType;
    this.fulfilled = false;
    this.age = 0;
    this.expiration = 10 + floor(random(10));
  }

  display() {
    let baseColor;
    switch (this.normType) {
      case 'legal': baseColor = color(128, 0, 128); break;
      case 'apriori': baseColor = color(0, 0, 255); break;
      case 'care': baseColor = color(0, 150, 0); break;
      case 'epistemic': baseColor = color(255, 165, 0); break;
      default: baseColor = color(120);
    }

    let alpha = this.fulfilled ? 50 : 30;

    if (!this.fulfilled && this.age >= this.expiration) {
      drawingContext.setLineDash([3, 6]);
      alpha = 20;
    } else if (!this.fulfilled && !this.target[`${this.normType}Acknowledges`]) {
      drawingContext.setLineDash([8, 4]);
      alpha = 25;
    } else {
      drawingContext.setLineDash([]);
    }

    stroke(baseColor.levels[0], baseColor.levels[1], baseColor.levels[2], alpha);
    strokeWeight(this.fulfilled ? 1.2 : 0.7);
    line(this.source.pos.x, this.source.pos.y, this.target.pos.x, this.target.pos.y);
    drawingContext.setLineDash([]);
  }

  enforce() {
    let dist = p5.Vector.dist(this.source.pos, this.target.pos);

    if (!this.source[this.normType + 'Acknowledges'] || !this.target[this.normType + 'Acknowledges']) {
      if (!this.source.relationalLedger.has(this.target.id)) {
        this.source.relationalLedger.set(this.target.id, 'denied');
        obligationLog.push({
          status: 'denied',
          norm: this.normType,
          from: this.source.id,
          to: this.target.id,
          generation: generation
        });
      }
      return;
    }

    if (!this.fulfilled && this.age >= this.expiration) {
      if (!this.source.relationalLedger.has(this.target.id)) {
        this.source.relationalLedger.set(this.target.id, 'expired');
        obligationLog.push({
          status: 'expired',
          norm: this.normType,
          from: this.source.id,
          to: this.target.id,
          generation: generation
        });
      }
      return;
    }

    if (dist < 150 && !this.fulfilled) {
      this.source.obligationAttempts++;
      this.source.obligationSuccesses++;
      this.source.recordTrust(this.target.id, true);
      this.source.relationalLedger.set(this.target.id, 'fulfilled');
      this.fulfilled = true;

      obligationLog.push({
        status: 'fulfilled',
        norm: this.normType,
        from: this.source.id,
        to: this.target.id,
        generation: generation
      });
    }

    let force = p5.Vector.sub(this.target.pos, this.source.pos);
    force.setMag(this.strength);
    this.source.applyForce(force);

    this.age++;
  }
} // ✅ Closing brace added


function logGeneration() {
  // Track system-wide totals
  let totalConflict = 0;
  let totalDebt = 0;
  let totalObligationsIssued = 0;
  let totalFulfilled = 0;
  let totalDenied = 0;
  let totalExpired = 0;
  let totalRepaired = 0;

  for (let agent of agents) {
    totalConflict += agent.internalConflict || 0;
    totalDebt += agent.contradictionDebt || 0;

    const ledger = [...agent.relationalLedger.values()];
    totalObligationsIssued += ledger.length;
    totalFulfilled += ledger.filter(v => v === 'fulfilled').length;
    totalDenied += ledger.filter(v => v === 'denied').length;
    totalExpired += ledger.filter(v => v === 'expired').length;
    totalRepaired += ledger.filter(v => v === 'repaired').length;
  }

  let avgConflict = agents.length > 0 ? totalConflict / agents.length : 0;
  let avgDebt = agents.length > 0 ? totalDebt / agents.length : 0;

  let fulfillmentRate = totalObligationsIssued > 0
    ? totalFulfilled / totalObligationsIssued
    : 0;

  let avgRI = (totalFulfilled + totalDenied + totalExpired) > 0
    ? totalFulfilled / (totalFulfilled + totalDenied + totalExpired)
    : 0;

  let repairEvents = totalRepaired;

  // Optional: placeholder until you define an actual function
  let emergentNorms = 0; // or call computeEmergentNorms() if defined

  log.push({
    generation,
    avgConflict,
    avgDebt,
    totalObligationsIssued,
    totalFulfilled,
    totalDenied,
    totalExpired,
    totalRepaired,
    fulfillmentRate,
    avgRI,
    repairEvents,
    emergentNorms
  });

  // Optional: console debugging
  console.log(`Gen ${generation} | Fulfillment: ${fulfillmentRate.toFixed(2)} | RI: ${avgRI.toFixed(2)} | Conflict: ${avgConflict.toFixed(2)} | Debt: ${avgDebt.toFixed(2)}`);
}


function initializeAgents() {
  agents = [];
  for (let i = 0; i < numAgents; i++) {
    agents.push(new Agent(globalAgentIndex++));
  }
}


function loadScenario(type) {
  for (let agent of agents) {
    const settings = {
      pluralist: () => normTypes.forEach(norm => agent[`${norm}Acknowledges`] = random() > 0.5),
      authoritarian: () => {
        agent.aprioriAcknowledges = false;
        agent.legalAcknowledges = true;
        agent.careAcknowledges = false;
        agent.epistemicAcknowledges = false;
      },
      utopian: () => normTypes.forEach(norm => agent[`${norm}Acknowledges`] = true),
      collapsed: () => normTypes.forEach(norm => agent[`${norm}Acknowledges`] = false),
      anomic: () => normTypes.forEach(norm => agent[`${norm}Acknowledges`] = random() > 0.1),

      // 🔽 NEW SCENARIOS BELOW

      allCare: () => {
        normTypes.forEach(norm => agent[`${norm}Acknowledges`] = (norm === 'care'));
        agent.normPreference = 'care';
      },
      allLegal: () => {
        normTypes.forEach(norm => agent[`${norm}Acknowledges`] = (norm === 'legal'));
        agent.normPreference = 'legal';
      },
      noApriori: () => {
        normTypes.forEach(norm => agent[`${norm}Acknowledges`] = (norm !== 'apriori'));
        if (agent.normPreference === 'apriori') {
          agent.normPreference = random(['care', 'legal', 'epistemic']);
        }
      },
      asymmetryOnly: () => {
        normTypes.forEach(norm => agent[`${norm}Acknowledges`] = false);
        if (random() < 0.5) {
          let n = random(normTypes);
          agent[`${n}Acknowledges`] = true;
          agent.normPreference = n;
        } else {
          agent.normPreference = random(normTypes);
        }
      },
      genocideShock: () => {
        normTypes.forEach(norm => agent[`${norm}Acknowledges`] = false);
        agent.normPreference = random(normTypes);
      }
    };

    // Apply the selected scenario logic
    settings[type]?.();
  }
}

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
  if (log.length > 0) {
    const latest = log[log.length - 1];
    metrics.push(
      `Fulfillment Rate: ${latest.fulfillmentRate}`,
      `Relational Integrity: ${latest.avgRI}`,
      `Contradiction Debt: ${latest.avgDebt}`,
      `Internal Conflict: ${latest.avgConflict}`,
      `Repair Events: ${latest.repairEvents}`,
      `Emergent Norms: ${latest.emergentNorms}`
    );
  }
  for (let line of metrics) {
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

function drawLegend() {
  let legendX = width - 190;
  let legendY = height - 250;
  let legendW = 170;
  let legendH = 270;

  fill(255);
  stroke(180);
  rect(legendX, legendY, legendW, legendH, 6);

  fill(0);
  textSize(12);
  textAlign(LEFT, TOP);
  text('Legend:', legendX + 8, legendY + 5);

  let y = legendY + 20;

  // Norm Colors (Agent Fill)
  const agentColors = [
    ['Legal (preferred)', getNormColor('legal', true)],
    ['A Priori (preferred)', getNormColor('apriori', true)],
    ['Care (preferred)', getNormColor('care', true)],
    ['Epistemic (preferred)', getNormColor('epistemic', true)],
    ['Not Acknowledged', getNormColor('legal', false)]
  ];
  text('Agent Fill:', legendX + 8, y);
  y += 16;
  for (let [label, col] of agentColors) {
    fill(col);
    stroke(0);
    ellipse(legendX + 18, y + 6, 12, 12);
    noStroke();
    fill(0);
    text(label, legendX + 32, y);
    y += 18;
  }

  y += 8;
  // Obligation Lines
  const items = [
    ['Legal Obligation', color(128, 0, 128)],
    ['A Priori', color(0, 0, 255)],
    ['Care', color(0, 150, 0)],
    ['Epistemic', color(255, 165, 0)],
    ['Fulfilled', null, 2.5],
    ['Denied', null, 1.2, [8, 4]],
    ['Expired', null, 1.2, [3, 6]]
  ];

  text('Obligations:', legendX + 8, y);
  y += 16;

  for (let [label, col, weight = 1.2, dash = []] of items) {
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

function drawTraitBars() {
  let margin = 20;
  let barHeight = 18;
  let spacing = 6;
  let total = agents.length;
  if (total === 0) return;

  let counts = normTypes.map(norm => agents.filter(a => a[`${norm}Acknowledges`]).length);
  let avgMomentum = agents.reduce((sum, a) => sum + a.culturalMomentum, 0) / total;
  let barWidth = width - 2 * margin;

  let startY = height - margin - (normTypes.length + 1) * (barHeight + spacing); // reserve space for all bars

  normTypes.forEach((norm, i) => {
    let count = counts[i];
    let y = startY + i * (barHeight + spacing);
    let normColor = getNormColor(norm, true);

    // Draw bar
    fill(normColor);
    rect(margin, y, (count / total) * barWidth, barHeight);

    // Draw label aligned to bar center
    fill(0);
    textSize(12);
    textAlign(LEFT, CENTER);
    text(`${norm.charAt(0).toUpperCase() + norm.slice(1)} (${count}/${total})`, margin + 5, y + barHeight / 2);
  });

  // Draw Avg Momentum bar last
  let momentumY = startY + normTypes.length * (barHeight + spacing);
  fill(180);
  rect(margin, momentumY, avgMomentum * barWidth, barHeight);
  fill(0);
  textAlign(LEFT, CENTER);
  text(`Avg Momentum: ${avgMomentum.toFixed(2)}`, margin + 5, momentumY + barHeight / 2);
}

function showInterpretivePopup() {
  summaryPopup.html(`
    <div style="text-align:right;">
      <button onclick="document.getElementById('summary-popup').style.display='none'" style="font-size:16px;">✖</button>
    </div>
    <div>${interpretiveSummary.replace(/\n/g, '<br>')}</div>
  `);
  summaryPopup.style('display', 'block');
}

let isPaused = false; // declare at top level

function downloadObligationLog() {
  let csv = 'Generation,From,To,NormType,Status\n';
  for (let entry of obligationLog) {
    csv += `${entry.generation},${entry.from},${entry.to},${entry.norm},${entry.status}\n`;
  }
  let blob = new Blob(["\ufeff" + csv], { type: 'text/csv' });
  let url = URL.createObjectURL(blob);
  let link = createA(url, 'Download Obligations');
  link.attribute('download', `obligationLog_${scenario}.csv`);
  link.hide();
  link.elt.click();
}

function drawDebtConflictGraph() {
  const graphWidth = 260;
  const graphHeight = 80;
  const xOffset = width - graphWidth - 20;  // move to right
const yOffset = 40;                       // near top


  const maxPoints = Math.floor(graphWidth / 3);
  const recentLog = log.slice(-maxPoints);

  // Dynamically scale Y-axis
 let maxConflict = Math.max(...recentLog.map(e => parseFloat(e.avgConflict ?? 0)), 0.01);
let maxDebt = Math.max(...recentLog.map(e => parseFloat(e.avgDebt ?? 0)), 0.01);
let yMax = Math.max(maxConflict, maxDebt);


  // Background panel
  noStroke();
  fill(255, 240);
  rect(xOffset - 10, yOffset - 30, graphWidth + 20, graphHeight + 50, 12);

  // Axis label
  fill(0);
  textSize(10);
  text("Conflict / Debt (scaled)", xOffset, yOffset - 12);

  // 🔴 Conflict curve
  noFill();
  stroke(200, 50, 50);
  beginShape();
  for (let i = 0; i < recentLog.length; i++) {
    let val = recentLog[i].avgConflict ?? 0;
    let y = map(val, 0, yMax, yOffset + graphHeight, yOffset);
    vertex(xOffset + i * 3, y);
  }
  endShape();

  // 🔵 Debt curve
  stroke(50, 50, 200);
  beginShape();
  for (let i = 0; i < recentLog.length; i++) {
    let val = recentLog[i].avgDebt ?? 0;
    let y = map(val, 0, yMax, yOffset + graphHeight, yOffset);
    vertex(xOffset + i * 3, y);
  }
  endShape();

  // Legend
  noStroke();
  fill(200, 50, 50);
  text("Conflict", xOffset, yOffset + graphHeight + 12);
  fill(50, 50, 200);
  text("Debt", xOffset + 80, yOffset + graphHeight + 12);
}


function createGUI() {
  guiPanel = createDiv().id('guiPanel')
    .style('position', 'relative')
    .style('font-family', 'Arial')
    .style('background', '#f7f7f7')
    .style('padding', '14px')
    .style('border-radius', '10px')
    .style('box-shadow', '0 2px 6px rgba(0,0,0,0.1)')
    .style('max-width', '95vw')
    .style('text-align', 'center');

  createP('🧭 <strong>Scenario Modes</strong>').parent(guiPanel).style('margin-bottom', '8px');
  let scenarioRow = createDiv().parent(guiPanel)
    .style('display', 'flex')
    .style('flex-wrap', 'wrap')
    .style('justify-content', 'center')
    .style('gap', '8px')
    .style('margin-bottom', '12px');

 ['pluralist', 'authoritarian', 'utopian', 'collapsed', 'anomic',
 'allCare', 'allLegal', 'noApriori', 'asymmetryOnly', 'genocideShock'].forEach(type => {
  createButton(type)
    .parent(scenarioRow)
    .style('padding', '6px 16px')
    .style('font-size', '14px')
    .mousePressed(() => {
      scenario = type;
      resetSimulation();
    });
});


  createP('🧪 <strong>Toggle Experiments</strong>').parent(guiPanel).style('margin-bottom', '8px');
  let experimentRow = createDiv().parent(guiPanel)
    .style('display', 'flex')
    .style('flex-wrap', 'wrap')
    .style('justify-content', 'center')
    .style('gap', '8px')
    .style('margin-bottom', '12px');

  createButton('Moral Repair').parent(experimentRow).mousePressed(() => enableMoralRepair = !enableMoralRepair);
  createButton('Directed Norms').parent(experimentRow).mousePressed(() => enableDirectedEmergence = !enableDirectedEmergence);
  createButton('Vulnerability Targeting').parent(experimentRow).mousePressed(() => enableNonReciprocalTargeting = !enableNonReciprocalTargeting);

  createP('🎛 <strong>Simulation Controls</strong>').parent(guiPanel).style('margin-bottom', '8px');
  let controlRow = createDiv().parent(guiPanel)
    .style('display', 'flex')
    .style('flex-wrap', 'wrap')
    .style('justify-content', 'center')
    .style('gap', '8px');

  createButton('Pause/Resume').parent(controlRow).mousePressed(() => {
    isPaused = !isPaused;
    running = !isPaused;
  });

  createButton('Stop').parent(controlRow).mousePressed(() => {
    running = false;
    generateInterpretiveSummary();
    showInterpretivePopup();
  });

  createButton('Reset').parent(controlRow).mousePressed(resetSimulation);
  createButton('Download CSV').parent(controlRow).mousePressed(downloadAgentLog);
createButton('Download Obligations').parent(controlRow).mousePressed(downloadObligationLog);

}
