// agent.js
//
// Contains the Agent and ObligationVector classes which embody the
// behavioural logic of the simulation.  Each agent moves according to
// simple flocking rules and forms or fulfils obligations to other
// agents.  The ObligationVector class mediates interactions between
// agents and records the outcome of those interactions.

import { SIM_CONFIG, COLORS, normTypes } from './config.js';
import { normRegistry, defaultEnforce } from './norms.js';

/**
 * Convert a norm type and acknowledgment flag into a p5 colour.  The
 * colours for each norm are defined in the global CONFIG module.  If
 * the norm is not acknowledged the alpha channel is reduced to the
 * configured noAckAlpha to visually fade the agent.
 *
 * @param {string} norm The name of the norm (must exist in COLORS.norms)
 * @param {boolean} acknowledged Whether the agent recognises the norm
 * @returns {p5.Color} A p5 colour object
 */
export function getNormColor(norm, acknowledged) {
  const rgb = COLORS.norms[norm] || [120, 120, 120];
  const alpha = acknowledged ? COLORS.agent.baseAlpha : COLORS.agent.noAckAlpha;
  // p5.js's colour() function is globally available once the sketch
  // starts executing.  Returning the colour directly avoids repeated
  // construction of identical colour objects.
  return color(rgb[0], rgb[1], rgb[2], alpha);
}

/**
 * Agent class representing a single autonomous entity in the simulation.
 * Instances manage their own position, velocity and state.  Forces are
 * applied using simple rules based on nearby agents and trust values.
 */
export class Agent {
  /**
   * Create a new Agent.
   *
   * @param {number} id A unique identifier for the agent
   */
  constructor(id) {
    this.id = id;

    // Extract margins for positioning from the configuration
    const { left, right, top, bottom } = SIM_CONFIG.margins;

    // Initialise spatial vectors.  Agents start at a random position
    // within the margins and with zero velocity.
    this.pos = createVector(
      random(left, width - right),
      random(top, height - bottom)
    );
    this.vel = createVector();
    this.acc = createVector();

    // Radius for drawing; vulnerability influences behavioural
    // responses (unused in the current logic but retained for
    // extensibility).  wander introduces a slight random drift.
    this.r = 10;
    this.vulnerability = random();
    this.wander = p5.Vector.random2D();

    // Each norm is acknowledged or not and stored as a property
    // named `${norm}Acknowledges` on the agent.  Initialise them
    // randomly to ensure diversity at the start of the simulation.
    normTypes.forEach(norm => {
      this[`${norm}Acknowledges`] = random() > 0.5;
    });

    // The norm preference determines the colour used when drawing the
    // agent.  Preference is chosen uniformly from the set of norms.
    this.normPreference = random(normTypes);

    // The scenario group tracks which emergent scenario the agent
    // currently belongs to.  Initially it matches the preferred norm
    // but may diverge as norms evolve and scenarios change.  This
    // property is used for colouring and logging.
    this.scenarioGroup = this.normPreference;

    // Agents also hold an affiliation label that reflects which
    // emerging alliance or social group they currently belong to.  By
    // default this is derived from the norm preference so that
    // initial alliances mirror normative clusters, but it may change
    // over time through updateAffiliations() in sketch.js.
    this.affiliation = `pref_${this.normPreference}`;

    // The current colour used for rendering is interpolated toward
    // getNormColor() on each update to produce smooth transitions when
    // preferences or acknowledgments change.
    this.displayColor = getNormColor(this.normPreference, this[`${this.normPreference}Acknowledges`]);
    this.lastPref = this.normPreference;

    // Maintain a record of previous acknowledgments to generate
    // falsifiability flags.  The object is keyed by norm name and
    // updated whenever acknowledgments change.
    this.lastAcknowledgments = {};
    normTypes.forEach(norm => {
      this.lastAcknowledgments[norm] = this[`${norm}Acknowledges`];
    });

    // Trust map stores numerical trust scores keyed by target agent id.
    // Relational ledger stores the status of obligations issued to other
    // agents (fulfilled, denied, expired or repaired).
    this.trustMap = new Map();
    this.relationalLedger = new Map();

    // Counters for obligations attempted and succeeded.  These are
    // recorded in the agent log and influence reproduction and trust.
    this.obligationAttempts = 0;
    this.obligationSuccesses = 0;

    // Measures of internal state used in the interpreter and logging.
    this.contradictionDebt = 0;
    this.internalConflict = 0;
    this.culturalMomentum = random(0.3, 1.0);

    // Assign a role to the agent.  Roles influence how agents
    // interpret or respond to obligations in future extensions.  The
    // initial role is chosen uniformly from a fixed set.
    const roles = ['initiator', 'responder', 'mediator', 'disruptor'];
    this.role = random(roles);
    // Additional behavioural traits.  Temperament governs how
    // strongly the agent reacts to conflict, moral stance indicates
    // whether the agent is more proactive or reactive in making
    // obligations, and memoryLength controls how long the agent
    // remembers past interactions (reserved for future decay logic).
    this.temperament = random();
    this.moralStance = random(['reactive', 'proactive']);
    this.memoryLength = random(0.2, 1.0);

    // Keep a history of recent positions for drawing motion trails.
    // Each entry is a p5.Vector copied from the agent's current
    // position.  The trail length is capped to avoid unbounded
    // memory growth.  When the trail exceeds the limit oldest
    // entries are removed.  See sketch.js drawTrails() for
    // rendering.
    this.trail = [];

    // Narrative and conflict logs reserved for future work.  Biography
    // records a per-generation snapshot of key metrics.
    this.narrativeLog = [];
    this.conflictLog = new Map();
    this.biography = [];

    // The generation in which the agent was created.  Used for
    // computing age and death rate.
    this.birthGeneration = 0;
  }

  /**
   * Apply a force to the agent by adding to its acceleration.  All
   * force generators call this method so that forces accumulate over
   * the frame.
   *
   * @param {p5.Vector} force The force to apply
   */
  applyForce(force) {
    this.acc.add(force);
  }

  /**
   * Apply a cohesion force towards the local centre of mass.  Agents
   * within the cohesion radius pull this agent gently toward their
   * average position.
   */
  applyCohesionForce() {
    const { cohesion } = SIM_CONFIG.forceParams;
    let count = 0;
    const centre = createVector();
    for (const other of window.agents) {
      const d = p5.Vector.dist(this.pos, other.pos);
      if (other !== this && d < 60) {
        centre.add(other.pos);
        count++;
      }
    }
    if (count > 0) {
      centre.div(count);
      const desired = p5.Vector.sub(centre, this.pos);
      desired.setMag(cohesion);
      this.applyForce(desired);
    }
  }

incrementContradictionDebt(reason = "unspecified") {    
  this.contradictionDebt++;
  
}


  /**
   * Apply an alignment force to match the average velocity of nearby
   * agents.  Agents within the alignment radius influence the agent
   * proportionally.
   */
  applyAlignmentForce() {
    const { alignment } = SIM_CONFIG.forceParams;
    let count = 0;
    const avgVel = createVector();
    for (const other of window.agents) {
      const d = p5.Vector.dist(this.pos, other.pos);
      if (other !== this && d < 60) {
        avgVel.add(other.vel);
        count++;
      }
    }
    if (count > 0) {
      avgVel.div(count);
      avgVel.setMag(alignment);
      this.applyForce(avgVel);
    }
  }

  /**
   * Apply a separation force to avoid crowding.  Nearby agents push
   * this agent away based on inverse distance weighting.
   */
  applySeparationForce() {
    const { separation } = SIM_CONFIG.forceParams;
    let count = 0;
    const steer = createVector();
    for (const other of window.agents) {
      const d = p5.Vector.dist(this.pos, other.pos);
      if (other !== this && d < 24) {
        const diff = p5.Vector.sub(this.pos, other.pos);
        diff.normalize();
        diff.div(d);
        steer.add(diff);
        count++;
      }
    }
    if (count > 0) {
      steer.div(count);
      steer.setMag(separation);
      this.applyForce(steer);
    }
  }



  /**
   * Update the internal conflict and contradiction debt by scanning
   * the relational ledger.  Denied obligations contribute to
   * conflict; expired obligations contribute to debt.
   */
  updateConflictAndDebt() {
    let conflict = 0;
    let debt = 0;
    for (const status of this.relationalLedger.values()) {
  if (status === 'denied' || status === 'expired') {
    debt++;
  }
  if (status === 'denied') {
    conflict++;
  }
}

    this.internalConflict = conflict;
    this.contradictionDebt = debt;
  }

  /**
   * Record a snapshot of the agent's state at the given generation.  This
   * biography is used for offline analysis and could be exported as
   * part of a batch run.
   *
   * @param {number} generation The current generation number
   */
  recordBiography(generation) {
    this.biography.push({
      generation,
      normPreference: this.normPreference,
      acknowledgments: normTypes.reduce((acc, n) => {
        acc[n] = this[`${n}Acknowledges`];
        return acc;
      }, {}),
      trustCount: this.trustMap.size,
      trustMax: Math.max(...Array.from(this.trustMap.values()), 0),
      momentum: this.culturalMomentum,
      debt: this.contradictionDebt,
      conflict: this.internalConflict,
      role: this.role,
      temperament: this.temperament,
      moralStance: this.moralStance,
      memoryLength: this.memoryLength
    });
  }

  /**
   * Update the agent's motion and colour.  Trust forces, flocking
   * forces and wander combine to produce a smooth trajectory.  The
   * colour gradually interpolates toward the current norm colour.
   */
  update() {
    // Trust attraction toward peers with high trust scores
    let moved = false;
    for (const [id, score] of this.trustMap.entries()) {
      if (score > 2) {
        const peer = window.agentMap.get(parseInt(id));
        if (peer) {
          const seek = p5.Vector.sub(peer.pos, this.pos).setMag(SIM_CONFIG.forceParams.trustAttraction * score);
          this.applyForce(seek);
          moved = true;
        }
      }
    }

    // Apply flocking forces
    this.applySeparationForce();
    this.applyCohesionForce();
    this.applyAlignmentForce();

    // If no trust-directed movement occurred then wander slowly
    if (!moved) {
      this.wander.rotate(random(-0.1, 0.1));
      this.applyForce(p5.Vector.mult(this.wander, 0.03));
    }

    // Integrate acceleration into velocity and position
    this.acc.limit(0.2);
    this.vel.add(this.acc);
    this.vel.mult(0.95);
    this.vel.limit(1.5);
    this.pos.add(this.vel);
    this.acc.mult(0.6);

    // Record position into trail for motion visualisation.  Make a
    // copy so that subsequent updates do not mutate stored vectors.
    if (Array.isArray(this.trail)) {
      this.trail.push(this.pos.copy());
      // Limit the trail length to 40 samples.  If the trail exceeds
      // the limit remove the oldest entry.  This retains recent
      // motion while preventing unbounded growth.
      const maxTrailLength = 40;
      if (this.trail.length > maxTrailLength) {
        this.trail.shift();
      }
    }

    // Choose a target colour based on the agent's current affiliation
    // group.  If a group colour has been defined on the window
    // (populated by sketch.js), use it; otherwise fall back to the
    // scenarioGroup/normPreference colour.  Acknowledgment controls
    // the lightness when falling back to norm colours.
    let targetColour;
    if (typeof window !== 'undefined' && window.groupColors && window.groupColors[this.affiliation]) {
      targetColour = window.groupColors[this.affiliation];
    } else {
      const scenarioKey = this.scenarioGroup || this.normPreference;
      const ackProp = `${scenarioKey}Acknowledges`;
      const acknowledged = this[ackProp] !== undefined ? this[ackProp] : true;
      targetColour = getNormColor(scenarioKey, acknowledged);
    }
    this.displayColor = lerpColor(this.displayColor, targetColour, 0.05);

    this.wrapAround();
  }

  /**
   * Wrap agents around the margins to avoid abrupt reflections.  The
   * margins define the active area of the simulation; leaving it
   * reintroduces the agent on the opposite side.
   */
  wrapAround() {
    const { left, right, top, bottom } = SIM_CONFIG.margins;
    if (this.pos.x < left) this.pos.x = width - right;
    if (this.pos.x > width - right) this.pos.x = left;
    if (this.pos.y < top) this.pos.y = height - bottom;
    if (this.pos.y > height - bottom) this.pos.y = top;
  }

  /**
   * Draw the agent at its current location.  The id is rendered
   * underneath the circle for identification purposes.
   */
  display() {
    fill(this.displayColor);
    noStroke();
    push();
    translate(this.pos.x, this.pos.y);
    ellipse(0, 0, this.r * 2);
    pop();
    // ID text slightly offset below the agent
    push();
    translate(this.pos.x, this.pos.y + 1);
    fill(0);
    textAlign(CENTER, CENTER);
    textSize(10);
    text(this.id, 0, 0);
    pop();
  }

  /**
   * Adjust the trust score toward another agent.  Fulfilled obligations
   * increase trust, failed obligations decrease it.  Trust scores may
   * become negative but a lower bound is not enforced here.
   *
   * @param {number|string} targetID The id of the target agent
   * @param {boolean} fulfilled Whether the obligation was fulfilled
   */
  recordTrust(targetID, fulfilled) {
    const current = this.trustMap.get(targetID) || 0;
    const delta = fulfilled ? SIM_CONFIG.trustGrowth.increment : -SIM_CONFIG.trustGrowth.decrement;
    this.trustMap.set(targetID, current + delta);
  }
}

/**
 * ObligationVector mediates the interaction between two agents.  It
 * applies an attractive force from the source toward the target and
 * logs the outcome when obligations are fulfilled, denied or expire.
 */
export class ObligationVector {
  /**
   * Create a new ObligationVector.
   *
   * @param {Agent} source The agent issuing the obligation
   * @param {Agent} target The agent receiving the obligation
   * @param {number} strength The magnitude of the force
   * @param {string} normType The normative context for the obligation
   */
  constructor(source, target, strength, normType = 'legal') {
    this.source = source;
    this.target = target;
    this.strength = strength;
    this.normType = normType;
    this.fulfilled = false;
    this.age = 0;
    // Lifespan of an obligation is configured via enforcementRules.
    const { expirationBase, expirationRandom } = SIM_CONFIG.enforcementRules;
    this.expiration = expirationBase + floor(random(expirationRandom));
  }

  /**
   * Render the obligation as a line between source and target.  Line
   * style and alpha depend on whether the obligation is fulfilled,
   * expired or denied.  Colours are derived from the configured
   * norm palette.
   */
  display() {
    // Use the colour defined in the norm registry; fall back to
    // grey if undefined.  Alpha depends on fulfilment and status.
    const entry = normRegistry[this.normType] || {};
    const baseRGB = entry.color || [120, 120, 120];
    let alpha = this.fulfilled ? COLORS.obligations.lineAlpha / 2 : COLORS.obligations.lineAlpha * 0.3;
    // Dash patterns based on expiration or denial
    if (!this.fulfilled && this.age >= this.expiration) {
      drawingContext.setLineDash(COLORS.obligations.dashExpired);
      alpha = COLORS.obligations.lineAlpha * 0.2;
    } else if (!this.fulfilled && entry && entry.acknowledgeFn && !entry.acknowledgeFn(this.target)) {
      drawingContext.setLineDash(COLORS.obligations.dashDenied);
      alpha = COLORS.obligations.lineAlpha * 0.25;
    } else {
      drawingContext.setLineDash([]);
    }
    stroke(baseRGB[0], baseRGB[1], baseRGB[2], alpha);
    strokeWeight(this.fulfilled ? COLORS.obligations.fulfilledWeight : COLORS.obligations.unfulfilledWeight);
    line(this.source.pos.x, this.source.pos.y, this.target.pos.x, this.target.pos.y);
    drawingContext.setLineDash([]);
  }

  /**
   * Apply the obligation force and update its status.  If either
   * party does not acknowledge the norm the obligation is denied.  If
   * the obligation reaches its expiration without fulfilment it is
   * recorded as expired.  If the distance between the agents falls
   * below the proximity threshold the obligation is fulfilled.  All
   * outcomes are logged to the provided obligationLog.
   *
   * @param {Object} state An object carrying simulation state
   * @param {number} state.generation Current generation number
   * @param {Array} state.obligationLog Array to receive obligation events
   */
  enforce(state) {
    // Delegate to the registered norm enforcement function.  If no
    // custom enforce function is provided, use the default logic.
    const entry = normRegistry[this.normType];
    if (entry && typeof entry.enforceFn === 'function') {
      entry.enforceFn(this, state);
    } else {
      defaultEnforce(this, state);
    }
  }
}