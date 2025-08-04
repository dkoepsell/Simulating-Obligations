// exporter.js
//
// This module provides pure functions for computing per-generation
// metrics, generating interpretive summaries and exporting CSV logs.
// Separating these concerns from the main simulation loop helps to
// clarify the responsibilities of each component and makes the code
// more testable.

import { normTypes } from './config.js';

/**
 * Compute aggregate statistics for the current generation and append
 * them to the simulation log.  The returned object mirrors each
 * property pushed to the log array.  See the original sketch for
 * descriptions of each metric.
 *
 * @param {Array} agents Array of agents currently alive in the simulation
 * @param {number} generation The current generation number
 * @param {Array} log Array of previous generation entries (will be mutated)
 * @returns {Object} The metrics object appended to the log
 */
export function logGeneration(agents, generation, log) {
  let totalConflict = 0;
  let totalDebt = 0;
  let totalObligationsIssued = 0;
  let totalFulfilled = 0;
  let totalDenied = 0;
  let totalExpired = 0;
  let totalRepaired = 0;

  // Compute inter‑group conflict: fraction of cross‑group obligations
  // that were denied or expired.  Count all relational ledger entries
  // where the source and target belong to different affiliation groups.
  let interTotal = 0;
  let interDenied = 0;
 for (const agent of agents) {
  // Count denied and expired per agent
  const ledger = Array.from(agent.relationalLedger.entries());
  totalObligationsIssued += ledger.length;
  let fulfilledCount = 0;
  let deniedCount = 0;
  let expiredCount = 0;
  let repairedCount = 0;
  for (const [targetID, status] of ledger) {
    if (status === 'fulfilled') fulfilledCount++;
    if (status === 'denied') deniedCount++;
    if (status === 'expired') expiredCount++;
    if (status === 'repaired') repairedCount++;
    // Intergroup logic...
    const target = agents.find(a => a.id === targetID);
    if (target && agent.affiliation && target.affiliation && agent.affiliation !== target.affiliation) {
      interTotal++;
      if (status === 'denied' || status === 'expired') {
        interDenied++;
      }
    }
  }
  totalFulfilled += fulfilledCount;
  totalDenied += deniedCount;
  totalExpired += expiredCount;
  totalRepaired += repairedCount;
  // CHEAT: Sum contradiction debt as total denied + expired (for display/graph only)
  totalDebt += deniedCount + expiredCount;
}


  // Average debt per agent
  const avgDebt = agents.length > 0 ? totalDebt / agents.length : 0;
  // Inter‑group conflict is defined as the ratio of denied/expired cross‑group obligations
  const avgConflict = interTotal > 0 ? interDenied / interTotal : 0;
  const fulfillmentRate = totalObligationsIssued > 0 ? totalFulfilled / totalObligationsIssued : 0;
  const avgRI = (totalFulfilled + totalDenied + totalExpired) > 0
    ? totalFulfilled / (totalFulfilled + totalDenied + totalExpired)
    : 0;
  const repairEvents = totalRepaired;
  // Compute the number of distinct affiliation groups to track
  // emergent alliances.  Each agent carries an 'affiliation' property.
  const affiliationSet = new Set();
  for (const agent of agents) {
    if (agent.affiliation) affiliationSet.add(agent.affiliation);
  }
  const emergentNorms = affiliationSet.size;

  const entry = {
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
  };
  log.push(entry);
  return entry;
}

/**
 * Construct an interpretive summary describing the state of the
 * simulation at the most recent generation.  The summary includes
 * behavioural assessments, aggregate metrics and notable agents.
 *
 * @param {Array} log Array of logged generation entries
  * @param {Array} agents The current agent population
 * @param {string} scenario Name of the scenario (for display)
 * @returns {string} A HTML string suitable for insertion into a div
 */
export function generateInterpretiveSummary(log, agents, scenario) {
  const latest = log.length > 0 ? log[log.length - 1] : {};
  const fulfillment = parseFloat(latest.fulfillmentRate || 0);
  const behaviour = fulfillment >= 0.75 ? '🟢 Strong prosocial alignment'
    : fulfillment >= 0.5 ? '🟡 Moderate cooperation'
    : fulfillment >= 0.25 ? '🟠 Weak norm coherence'
    : '🔴 Ethical fragmentation';

  // Compute the number of acknowledgments for each norm
  const normSpread = normTypes.map(norm => {
    const count = agents.filter(a => a[`${norm}Acknowledges`]).length;
    return `${norm}: ${count}`;
  }).join(', ');

  // Identify the top three agents with more than three trust connections
  const topTrustAgents = agents
    .filter(a => a.trustMap.size > 3)
    .sort((a, b) => {
      const aMax = Math.max(...Array.from(a.trustMap.values()), 0);
      const bMax = Math.max(...Array.from(b.trustMap.values()), 0);
      return bMax - aMax;
    })
    .slice(0, 3)
    .map(a => `#${a.id} (Trust: ${Math.max(...Array.from(a.trustMap.values()), 0)})`)
    .join(', ') || 'None';

  const repairEvents = latest.repairEvents || 0;
  const avgTrustSize = agents.length > 0
    ? (agents.reduce((sum, a) => sum + a.trustMap.size, 0) / agents.length).toFixed(2)
    : '0';

  return `
    <strong>📘 Interpretive Summary — Generation ${latest.generation ?? 0}</strong><br><br>
    <strong>Scenario:</strong> ${scenario}<br>
    <strong>Behavioural Assessment:</strong> ${behaviour}<br><br>
    <strong>📊 Core Metrics:</strong><br>
    - Fulfillment Rate: ${fulfillment.toFixed(2)}<br>
    - Relational Integrity: ${latest.avgRI ?? 'n/a'}<br>
    - Contradiction Debt: ${latest.avgDebt ?? 'n/a'}<br>
    - Intergroup Conflict: ${latest.avgConflict ?? 'n/a'}<br>
    - Repair Events: ${repairEvents}<br>
    - Avg Trust Connections: ${avgTrustSize}<br><br>
    <strong>📚 Norm Acknowledgment:</strong><br>
    ${normSpread}<br><br>
    <strong>🤝 Top Trusted Agents:</strong><br>
    ${topTrustAgents}
  `;
}

/**
 * Download the agent log as a CSV file.  The file is assembled on
 * the fly and offered via a temporary anchor element.  The CSV
 * header mirrors the fields written by the sketch.
 *
 * @param {Array} agentLog Array of per-agent records captured during the run
 * @param {string} scenario The scenario name used to form the filename
 */
export async function downloadAgentLog(agentLog, scenario) {
  // Determine if the log entries include batch run metadata.  If
  // present, include Run and BatchScenario columns in the CSV.  We
  // detect this by checking the first entry for the 'run' property.
  const includeBatch = agentLog.length > 0 && Object.prototype.hasOwnProperty.call(agentLog[0], 'run');
  let header = 'Generation,Scenario,ID,NormPref,A Priori,Legal,Care,Epistemic,Attempts,Successes,Conflict,Debt,Momentum,TrustCount,TrustMax,Fulfilled,Denied,Expired,Repaired,Role,Temperament,MoralStance,ScenarioGroup,MemoryLength,Affiliation';
  if (includeBatch) {
    header += ',Run,BatchScenario';
  }
  let csv = header + '\n';
  for (const row of agentLog) {
    let line = `${row.generation},${row.scenario},${row.id},${row.normPref},${row.aprioriAck},${row.legalAck},${row.careAck},${row.epistemicAck},${row.attempts},${row.successes},${row.conflict},${row.debt},${row.momentum},${row.trustCount},${row.trustMax},${row.fulfilled},${row.denied},${row.expired},${row.repaired},${row.role},${row.temperament},${row.moralStance},${row.scenarioGroup},${row.memoryLength},${row.affiliation}`;
    if (includeBatch) {
      line += `,${row.run},${row.batchScenario}`;
    }
    csv += line + '\n';
  }
  const fileName = `agentLog_${scenario}.csv`;
  // Try to use the File System Access API so the user can choose a location
  if (typeof window !== 'undefined' && window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: fileName,
        types: [
          {
            description: 'CSV file',
            accept: { 'text/csv': ['.csv'] }
          }
        ]
      });
      const writable = await handle.createWritable();
      await writable.write(csv);
      await writable.close();
      return;
    } catch (err) {
      console.warn('File save cancelled or failed, falling back to download anchor.', err);
    }
  }
  // Fallback: use an anchor tag to trigger a download to the default location
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const link = createA(url, 'Download Agent Log');
  link.attribute('download', fileName);
  link.hide();
  link.elt.click();
}

/**
 * Download the obligation log as a CSV file.  A Unicode Byte Order
 * Mark (BOM) is prepended so that Excel correctly interprets the
 * UTF‑8 encoded data.  The log is expected to contain objects with
 * generation, from, to, norm and status properties.
 *
 * @param {Array} obligationLog Array of obligation event records
 * @param {string} scenario The scenario name used to form the filename
 */
export async function downloadObligationLog(obligationLog, scenario) {
  // Include batch metadata if present.  Determine by inspecting the
  // first entry for a 'run' property.  If present, add Run and
  // BatchScenario columns.
  const includeBatch = obligationLog.length > 0 && Object.prototype.hasOwnProperty.call(obligationLog[0], 'run');
  let header = 'Generation,From,To,NormType,Status';
  if (includeBatch) {
    header += ',Run,BatchScenario';
  }
  let csv = header + '\n';
  for (const entry of obligationLog) {
    let line = `${entry.generation},${entry.from},${entry.to},${entry.norm},${entry.status}`;
    if (includeBatch) {
      line += `,${entry.run},${entry.batchScenario}`;
    }
    csv += line + '\n';
  }
  const fileName = `obligationLog_${scenario}.csv`;
  // Try to save via File System Access API
  if (typeof window !== 'undefined' && window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: fileName,
        types: [
          {
            description: 'CSV file',
            accept: { 'text/csv': ['.csv'] }
          }
        ]
      });
      const writable = await handle.createWritable();
      // Prepend BOM for Excel compatibility
      await writable.write("\ufeff" + csv);
      await writable.close();
      return;
    } catch (err) {
      console.warn('File save cancelled or failed, falling back to download anchor.', err);
    }
  }
  // Fallback anchor download
  const blob = new Blob(["\ufeff" + csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const link = createA(url, 'Download Obligations');
  link.attribute('download', fileName);
  link.hide();
  link.elt.click();
}