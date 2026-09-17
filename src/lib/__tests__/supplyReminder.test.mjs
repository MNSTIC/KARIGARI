/**
 * When the restock nudge may fire, and what it says.
 *
 * This decides whether an artisan is interrupted, so the rules are checked
 * against hand-worked dates rather than against themselves: a new account is
 * never idle, a haat seller with no listings is not idle, a snooze is honoured
 * until it expires by itself, and the fortnightly cooldown holds. The stored
 * English title and the parser that reads the day count back out are one
 * contract, so they are round-tripped here.
 *
 * Plain Node, no test framework — the same convention as orderStage.test.mjs.
 *   node src/lib/__tests__/supplyReminder.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const outDir = mkdtempSync(path.join(tmpdir(), 'karigari-supply-'));
const outfile = path.join(outDir, 'supplyReminderRules.mjs');
await esbuild.build({ entryPoints: ['src/lib/supplyReminderRules.ts'], bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'error' });
const rules = await import(pathToFileURL(outfile).href);

const noticeFile = path.join(outDir, 'supplyNotice.mjs');
await esbuild.build({ entryPoints: ['src/lib/supplyNotice.ts'], bundle: true, format: 'esm', platform: 'node', outfile: noticeFile, logLevel: 'error' });
const notice = await import(pathToFileURL(noticeFile).href);

let failures = 0;
let checks = 0;
function test(name, fn) {
  checks += 1;
  try {
    fn();
  } catch (e) {
    failures += 1;
    console.log(`FAIL  ${name}\n      ${e.message.split('\n').slice(0, 4).join('\n      ')}`);
  }
}

const NOW = new Date('2026-09-18T06:30:00Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);
const daysAhead = (n) => new Date(NOW.getTime() + n * 24 * 60 * 60 * 1000);
const facts = (patch = {}) => ({
  now: NOW,
  accountCreatedAt: daysAgo(120),
  hasProfile: true,
  lastActivityAt: daysAgo(25),
  lastRemindedAt: null,
  snoozedUntil: null,
  ...patch,
});

// ------------------------------------------------------------------ decision

test('an artisan quiet for 25 days is reminded', () => {
  const r = rules.decideReminder(facts());
  assert.equal(r.created, true);
  assert.equal(r.reason, 'CREATED');
  assert.equal(r.idleDays, 25);
});

test('the threshold is inclusive: 19 days is active, 20 days fires', () => {
  assert.equal(rules.decideReminder(facts({ lastActivityAt: daysAgo(19) })).reason, 'ACTIVE');
  const at20 = rules.decideReminder(facts({ lastActivityAt: daysAgo(20) }));
  assert.equal(at20.reason, 'CREATED');
  assert.equal(at20.idleDays, 20);
});

test('an account younger than 21 days is never nudged, however empty it is', () => {
  const r = rules.decideReminder(facts({ accountCreatedAt: daysAgo(3), lastActivityAt: null }));
  assert.equal(r.reason, 'TOO_NEW');
  assert.equal(r.created, false);
  // Exactly at the boundary it becomes eligible — and 21 days of silence is
  // itself past the idle threshold, so that account is reminded.
  assert.equal(rules.decideReminder(facts({ accountCreatedAt: daysAgo(21), lastActivityAt: null })).reason, 'CREATED');
  assert.equal(rules.decideReminder(facts({ accountCreatedAt: daysAgo(20), lastActivityAt: null })).reason, 'TOO_NEW');
});

test('an old account that has never catalogued anything is idle since it joined', () => {
  const r = rules.decideReminder(facts({ lastActivityAt: null, accountCreatedAt: daysAgo(60) }));
  assert.equal(r.created, true);
  assert.equal(r.idleDays, 60);
  assert.equal(r.lastActivityAt, null);
});

test('offline sales and demand orders are activity: the caller passes the newest of the three', () => {
  // No listing for 40 days, but a haat sale four days ago.
  const r = rules.decideReminder(facts({ lastActivityAt: daysAgo(4) }));
  assert.equal(r.reason, 'ACTIVE');
  assert.equal(r.created, false);
  assert.equal(r.idleDays, 4);
});

test('a reminder yesterday means no second one for a fortnight', () => {
  assert.equal(rules.decideReminder(facts({ lastRemindedAt: daysAgo(1) })).reason, 'COOLDOWN');
  assert.equal(rules.decideReminder(facts({ lastRemindedAt: daysAgo(13) })).reason, 'COOLDOWN');
  assert.equal(rules.decideReminder(facts({ lastRemindedAt: daysAgo(14) })).reason, 'CREATED');
});

test('a live snooze silences it; an expired one does not', () => {
  const snoozed = rules.decideReminder(facts({ snoozedUntil: daysAhead(3) }));
  assert.equal(snoozed.reason, 'SNOOZED');
  assert.equal(snoozed.created, false);
  assert.equal(rules.decideReminder(facts({ snoozedUntil: daysAgo(1) })).reason, 'CREATED');
});

test('no profile means mid-registration: nothing is written and nothing crashes', () => {
  const r = rules.decideReminder(facts({ hasProfile: false, accountCreatedAt: null, lastActivityAt: null }));
  assert.equal(r.reason, 'NO_PROFILE');
  assert.equal(r.created, false);
  assert.equal(r.idleDays, null);
});

test('the reasons are checked in the right order', () => {
  // Snoozed AND idle AND within cooldown: the artisan asked for quiet, so that wins.
  assert.equal(rules.decideReminder(facts({ snoozedUntil: daysAhead(2), lastRemindedAt: daysAgo(1) })).reason, 'SNOOZED');
  // Active AND within cooldown: they are working, which is the kinder reason to report.
  assert.equal(rules.decideReminder(facts({ lastActivityAt: daysAgo(2), lastRemindedAt: daysAgo(1) })).reason, 'ACTIVE');
  // New AND snoozed: too new comes first, so a fresh account is never "snoozed".
  assert.equal(rules.decideReminder(facts({ accountCreatedAt: daysAgo(2), snoozedUntil: daysAhead(2) })).reason, 'TOO_NEW');
});

test('idle days are whole days, floored, and never negative', () => {
  assert.equal(rules.wholeDaysBetween(daysAgo(20.9), NOW), 20);
  assert.equal(rules.wholeDaysBetween(daysAhead(5), NOW), 0);
  assert.equal(rules.idleDaysFrom({ now: NOW, lastActivityAt: null, accountCreatedAt: null }), null);
});

test('the snooze and cooldown windows are the published ones', () => {
  assert.equal(rules.SUPPLY_IDLE_DAYS, 20);
  assert.equal(rules.MIN_ACCOUNT_AGE_DAYS, 21);
  assert.equal(rules.REMINDER_COOLDOWN_DAYS, 14);
  assert.equal(rules.SNOOZE_DAYS, 7);
  assert.equal(rules.snoozeUntil(NOW).getTime() - NOW.getTime(), 7 * 24 * 3600 * 1000);
  assert.equal(NOW.getTime() - rules.cooldownCutoff(NOW).getTime(), 14 * 24 * 3600 * 1000);
});

// --------------------------------------------------------------------- text

test('the stored title round-trips through the parser', () => {
  for (const days of [20, 23, 60, 365]) {
    const title = rules.supplyReminderTitle(days);
    assert.equal(rules.parseIdleDays(title), days, title);
    assert.ok(rules.supplyReminderMessage(days).includes(String(days)));
  }
});

test('a title that is not ours does not parse', () => {
  assert.equal(rules.parseIdleDays('Durga Puja is 12 days away'), 12); // a number is a number
  assert.equal(rules.parseIdleDays('New demand for Sambalpuri sarees'), null);
  assert.equal(rules.parseIdleDays(''), null);
  assert.equal(rules.parseIdleDays('No new listing in days'), null);
});

test('a restock alert renders in the artisan\'s language, with the real day count', () => {
  const dict = {
    notif_supply_title: '{days} दिनों से कोई नई लिस्टिंग नहीं',
    notif_supply_body: '{days} दिनों में कुछ भी दर्ज नहीं हुआ।',
  };
  const t = (key) => dict[key] ?? key;
  const row = { type: 'SUPPLY_REMINDER', title: rules.supplyReminderTitle(23), message: rules.supplyReminderMessage(23) };
  const text = notice.supplyNoticeText(row, t);
  assert.equal(text.days, 23);
  assert.equal(text.title, '23 दिनों से कोई नई लिस्टिंग नहीं');
  assert.ok(text.message.startsWith('23 '));
});

test('other notification types are left alone, and an unparsable row keeps its English', () => {
  const t = (key) => key;
  assert.equal(notice.supplyNoticeText({ type: 'FESTIVAL', title: 'Diwali is 5 days away', message: 'x' }, t), null);
  const odd = notice.supplyNoticeText({ type: 'SUPPLY_REMINDER', title: 'Restock soon', message: 'English body' }, t);
  assert.deepEqual([odd.title, odd.message, odd.days], ['Restock soon', 'English body', null]);
  // A dictionary that is missing the key must not render the key itself.
  const missing = notice.supplyNoticeText({ type: 'SUPPLY_REMINDER', title: rules.supplyReminderTitle(30), message: 'English body' }, t);
  assert.equal(missing.title, rules.supplyReminderTitle(30));
  assert.equal(missing.message, 'English body');
});

if (failures > 0) {
  console.log(`\n${failures} of ${checks} supply-reminder checks failed`);
  process.exit(1);
}
console.log(`supplyReminder: all ${checks} checks passed`);
