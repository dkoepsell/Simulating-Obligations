// norms.js
//
// Defines a registry of norm definitions.  Each norm entry provides a
// colour for drawing and functions for acknowledging and enforcing
// obligations.  Researchers can register additional norms at run
// time via the `registerNorm` function.  The enforcement logic here
// encapsulates the default behaviour for obligations: denying when
// one party does not acknowledge the norm, expiring after a
// configurable lifespan and fulfilling when agents come within a
// specified proximity.

import { COLORS, SIM_CONFIG } from './config.js';

/**
 * Registry of norms.  Keys correspond to norm names.  Each value
 * defines:
 *  - color: an array of RGB values used to colour obligation lines
 *  - enforceFn: a function taking (vector, state) and returning
 *    nothing; it should handle fulfillment, denial, expiration and
 *    force application
 *  - acknowledgeFn: a function taking (agent) and returning
 *    a boolean indicating whether the agent acknowledges the norm
 */
export const normRegistry = {
  legal: {
    color: COLORS.norms.legal,
    enforceFn: (vec, state) => defaultEnforce(vec, state),
    acknowledgeFn: (agent) => agent.legalAcknowledges
  },
  apriori: {
    color: COLORS.norms.apriori,
    enforceFn: (vec, state) => defaultEnforce(vec, state),
    acknowledgeFn: (agent) => agent.aprioriAcknowledges
  },
  care: {
    color: COLORS.norms.care,
    enforceFn: (vec, state) => defaultEnforce(vec, state),
    acknowledgeFn: (agent) => agent.careAcknowledges
  },
  epistemic: {
    color: COLORS.norms.epistemic,
    enforceFn: (vec, state) => defaultEnforce(vec, state),
    acknowledgeFn: (agent) => agent.epistemicAcknowledges
  }
};

/**
 * Add a new norm definition to the registry.  If a key already
 * exists it will be overwritten.  The specification must include
 * colour, enforceFn and acknowledgeFn entries as described above.
 *
 * @param {string} name The unique name of the norm
 * @param {Object} spec The norm definition
 */
export function registerNorm(name, spec) {
  normRegistry[name] = spec;
}

/**
 * Default enforcement logic used by all built in norms.  The logic
 * reflects the behaviour of the original monolithic sketch: if
 * either agent does not acknowledge the norm the obligation is
 * denied; obligations expire after a configurable number of ticks;
 * when the agents come within the proximity threshold the
 * obligation is fulfilled and trust is incremented.
 *
 * @param {Object} vec The obligation vector (with source/target)
 * @param {Object} state Simulation state containing generation and obligationLog
 */
export function defaultEnforce(vec, { generation, obligationLog }) {
  const { enforcementRules, trustGrowth } = SIM_CONFIG;
  const proximity = enforcementRules.proximityThreshold;
  const dist = p5.Vector.dist(vec.source.pos, vec.target.pos);
  const source = vec.source;
  const target = vec.target;
  const norm = vec.normType;

  // Check acknowledgments
  if (!normRegistry[norm].acknowledgeFn(source) || !normRegistry[norm].acknowledgeFn(target)) {
    if (!source.relationalLedger.has(target.id)) {
      source.relationalLedger.set(target.id, 'denied');
      obligationLog.push({ status: 'denied', norm, from: source.id, to: target.id, generation });
    }
    return;
  }

  // Expiration
  if (!vec.fulfilled && vec.age >= vec.expiration) {
    if (!source.relationalLedger.has(target.id)) {
      source.relationalLedger.set(target.id, 'expired');
      obligationLog.push({ status: 'expired', norm, from: source.id, to: target.id, generation });
    }
    return;
  }

  // Fulfilment
  if (dist < proximity && !vec.fulfilled) {
    source.obligationAttempts++;
    source.obligationSuccesses++;
    // Trust increment uses configured trust growth
    const currentTrust = source.trustMap.get(target.id) || 0;
    source.trustMap.set(target.id, currentTrust + trustGrowth.increment);
    source.relationalLedger.set(target.id, 'fulfilled');
    vec.fulfilled = true;
    obligationLog.push({ status: 'fulfilled', norm, from: source.id, to: target.id, generation });
  }
  // Apply force
  const force = p5.Vector.sub(target.pos, source.pos);
  force.setMag(vec.strength);
  source.applyForce(force);
  vec.age++;
}