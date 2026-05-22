#!/usr/bin/env tsx
// Validates data/efficiency.json and data/realtime.json against the contract.
// Run: npx tsx scripts/validate_payload.ts

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { EfficiencyPayload, RealtimePayload } from '../lib/types';
import { HALF_HOUR_SLOTS } from '../lib/types';

interface Failure { path: string; msg: string; }

function assert(cond: unknown, path: string, msg: string, failures: Failure[]): asserts cond {
  if (!cond) failures.push({ path, msg });
}

function validateEfficiency(p: EfficiencyPayload): Failure[] {
  const f: Failure[] = [];
  assert(p.schemaVersion === 1, '.schemaVersion', 'must be 1', f);
  assert(typeof p.generatedAt === 'string' && p.generatedAt.length > 0, '.generatedAt', 'must be ISO string', f);
  assert(p.timezone === 'US/Eastern', '.timezone', 'must be US/Eastern', f);
  assert(typeof p.retentionDays === 'number' && p.retentionDays > 0, '.retentionDays', 'must be positive', f);
  assert(typeof p.backlogThresholdMin === 'number' && p.backlogThresholdMin > 0, '.backlogThresholdMin', 'must be positive', f);

  // Hierarchy referential integrity
  const cityIds = new Set(p.hierarchy.cities.map((c) => c.id));
  const regionIds = new Set<string>();
  for (const c of p.hierarchy.cities) {
    for (const r of c.regions) {
      assert(r.cityId === c.id, `.hierarchy.regions[${r.id}]`, `cityId mismatch (${r.cityId} !== ${c.id})`, f);
      regionIds.add(r.id);
    }
  }
  for (const s of p.hierarchy.stores) {
    assert(cityIds.has(s.cityId), `.stores[${s.shopNumber}]`, `unknown cityId ${s.cityId}`, f);
    assert(regionIds.has(s.regionId), `.stores[${s.shopNumber}]`, `unknown regionId ${s.regionId}`, f);
  }

  // Daily rows: non-negative counters, shopNumber known
  const shopSet = new Set(p.hierarchy.stores.map((s) => s.shopNumber));
  for (const r of p.dailyStoreRows) {
    assert(shopSet.has(r.shopNumber), `.dailyStoreRows[${r.date}/${r.shopNumber}]`, 'unknown shopNumber', f);
    for (const k of ['totalOrders', 'completedOrders', 'backlogOrders', 'responseSecondsSum', 'responseOrdersCount', 'makeSecondsSum', 'equivProductsMadeSum', 'freshMadeCount', 'purchasedCount'] as const) {
      assert((r[k] as number) >= 0, `.dailyStoreRows[${r.date}/${r.shopNumber}].${k}`, `${k} must be non-negative`, f);
    }
    assert(r.backlogOrders <= r.totalOrders, `.dailyStoreRows[${r.date}/${r.shopNumber}]`, 'backlogOrders must not exceed totalOrders', f);
    assert(r.responseOrdersCount <= r.completedOrders + 0, `.dailyStoreRows[${r.date}/${r.shopNumber}]`, 'responseOrdersCount must not exceed completedOrders', f);
  }

  // Interval rows: slot must be one of the 48 known half-hour slots.
  const validSlots = new Set<string>(HALF_HOUR_SLOTS as readonly string[]);
  for (const r of p.intervalRows) {
    assert(validSlots.has(r.slot), `.intervalRows[${r.date}/${r.slot}/${r.shopNumber}]`, `unknown slot ${r.slot}`, f);
    assert(shopSet.has(r.shopNumber), `.intervalRows[${r.date}/${r.slot}/${r.shopNumber}]`, 'unknown shopNumber', f);
    for (const k of ['responseSecondsSum', 'responseOrdersCount', 'makeSecondsSum', 'equivProductsMadeSum'] as const) {
      assert((r[k] as number) >= 0, `.intervalRows[${r.date}/${r.slot}/${r.shopNumber}].${k}`, `${k} must be non-negative`, f);
    }
  }

  return f;
}

function validateRealtime(p: RealtimePayload, efficiency: EfficiencyPayload): Failure[] {
  const f: Failure[] = [];
  assert(p.schemaVersion === 1, '.schemaVersion', 'must be 1', f);
  assert(p.backlogThresholdMin === efficiency.backlogThresholdMin, '.backlogThresholdMin', 'must match efficiency.backlogThresholdMin', f);
  assert(typeof p.staleThresholdMin === 'number' && p.staleThresholdMin > 0, '.staleThresholdMin', 'must be positive', f);
  const shopSet = new Set(efficiency.hierarchy.stores.map((s) => s.shopNumber));
  for (const r of p.byStore) {
    assert(shopSet.has(r.shopNumber), `.byStore[${r.shopNumber}]`, 'unknown shopNumber', f);
    for (const k of ['backlogEquivProducts', 'backlogOrdersOpen', 'totalOrdersToday', 'backlogOrdersToday'] as const) {
      assert((r[k] as number) >= 0, `.byStore[${r.shopNumber}].${k}`, `${k} must be non-negative`, f);
    }
  }
  return f;
}

function main(): number {
  const root = resolve(__dirname, '..');
  const efficiency = JSON.parse(readFileSync(resolve(root, 'data/efficiency.json'), 'utf-8')) as EfficiencyPayload;
  const realtime = JSON.parse(readFileSync(resolve(root, 'data/realtime.json'), 'utf-8')) as RealtimePayload;

  const allFailures: Failure[] = [];
  allFailures.push(...validateEfficiency(efficiency));
  allFailures.push(...validateRealtime(realtime, efficiency));

  if (allFailures.length === 0) {
    console.log('payloads OK —',
      efficiency.dailyStoreRows.length, 'daily rows,',
      efficiency.intervalRows.length, 'interval rows,',
      realtime.byStore.length, 'realtime store rows');
    return 0;
  }

  console.error(`payload validation FAILED — ${allFailures.length} issue(s):`);
  for (const f of allFailures) console.error(`  ${f.path}: ${f.msg}`);
  return 1;
}

process.exit(main());
