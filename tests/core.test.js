// Core/platform tests: state, migration (v1 fixtures), util, quests, storage merge (mock Firestore).
import { test, assert, assertEq, withFakeNow, freshState } from './harness.js';
import {
  STATE_VERSION, createNewState, migrate, isNewerSave, bumpStat, replaceState, getState,
  addItem, removeItem, countItem, addCoins, spendCoins, addPlayerXp, xpForLevel,
} from '../js/state.js';
import { QUESTS, currentQuest, claimQuest } from '../js/quests.js';
import {
  formatDuration, escapeHtml, todayKey, pickWeighted, randInt, uid, morph, now, onNotify,
} from '../js/util.js';
import * as storage from '../js/storage.js';

const HOUR = 3600 * 1000;
const FIXTURES = ['save_v1_typical', 'save_v1_midgame', 'save_v1_corrupt'];

async function loadFixture(name) {
  const res = await fetch(new URL(`./fixtures/${name}.json`, import.meta.url));
  assert(res.ok, `cannot load fixture ${name}`);
  return res.json();
}

/** Path of the first non-finite number / undefined inside obj, or null. */
function findBad(obj, path = 'state') {
  if (typeof obj === 'number') return Number.isFinite(obj) ? null : path;
  if (obj === undefined) return path;
  if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      const bad = findBad(v, `${path}.${k}`);
      if (bad) return bad;
    }
  }
  return null;
}

// ---- state helpers ----

test('createNewState: v2 start kit', () => {
  const s = createNewState();
  assertEq(s.version, STATE_VERSION, 'version');
  assertEq(s.player.coins, 100, 'coins');
  assertEq(s.inventory, { egg_farm: 1, seed_carrot: 3, food_kibble: 2 }, 'inventory');
  assertEq(s.plots.length, 4, 'plots');
  assertEq(s.barnCapacity, 3, 'barn');
  assertEq(s.incubatorCapacity, 1, 'incubator');
  assertEq(s.quests, { step: 0, done: false }, 'quests');
  assertEq(s.stardust, 0, 'stardust');
  assertEq(s.claimedGoals, [], 'claimedGoals');
  assertEq(s.stats.hatched, 0, 'stats.hatched');
  assertEq(s.orders, { day: null, list: [], week: null, weekly: null }, 'orders');
});

test('inventory + coin helpers', () => {
  const s = createNewState();
  addItem(s, 'seed_corn', 2);
  addItem(s, 'seed_corn', 0);
  assertEq(countItem(s, 'seed_corn'), 2, 'count');
  assert(!removeItem(s, 'seed_corn', 3), 'cannot remove more than owned');
  assertEq(countItem(s, 'seed_corn'), 2, 'unchanged after failed remove');
  assert(removeItem(s, 'seed_corn', 2), 'remove all');
  assert(!('seed_corn' in s.inventory), 'key deleted at 0');
  assert(!spendCoins(s, 101), 'cannot overspend');
  assertEq(s.player.coins, 100, 'coins unchanged');
  assert(spendCoins(s, 40), 'spend');
  addCoins(s, 5);
  assertEq(s.player.coins, 65, 'coins');
});

test('addPlayerXp levels up and carries over', () => {
  const s = createNewState();
  const seen = [];
  const off = onNotify(msg => seen.push(msg));
  addPlayerXp(s, xpForLevel(1) + 10);
  off();
  assertEq([s.player.level, s.player.xp], [2, 10], 'level/xp');
  assert(seen.some(m => m.includes('Lv.2')), 'level-up notification');
  assertEq(xpForLevel(4), Math.round(50 * 8), 'xpForLevel');
});

test('bumpStat creates, increments, ignores n <= 0', () => {
  const s = createNewState();
  bumpStat(s, 'fed');
  bumpStat(s, 'fed', 2);
  bumpStat(s, 'customStat', 5);
  bumpStat(s, 'fed', 0);
  bumpStat(s, 'fed', -3);
  assertEq([s.stats.fed, s.stats.customStat], [3, 5], 'counters');
  const bare = { };
  bumpStat(bare, 'sold', 2);
  assertEq(bare.stats.sold, 2, 'creates stats object');
});

// ---- migration ----

test('migrate: v1 fixtures reach the current version and keep their data', async () => {
  const typical = await loadFixture('save_v1_typical');
  const s = migrate(typical);
  assertEq(s.version, STATE_VERSION, 'version');
  assertEq(s.player.farmName, 'ฟาร์มทดสอบ', 'farm name kept');
  assertEq(s.player.coins, 240, 'coins kept (no free loot)');
  assertEq(s.inventory, typical.inventory, 'inventory kept');
  assertEq(s.pets.length, 2, 'pets kept');
  assertEq(s.plots.length, 4, 'plots kept');
  assertEq(s.plots[0].cropId, 'carrot', 'planted crop kept');
  assertEq(s.incubator.length, 1, 'incubator kept');
  assertEq(s.stardust, 0, 'stardust');
  assertEq(s.claimedGoals, [], 'claimedGoals');
  assert(s.orders && Array.isArray(s.orders.list), 'orders');
  assertEq(findBad(s), null, 'no NaN/undefined');
});

test('migrate: veterans skip finished starter quests without rewards', async () => {
  const typical = migrate(await loadFixture('save_v1_typical'));
  // hatched (collection), fed (lastFedAt), planted (plot has a crop) are done; nobody works a plot yet
  assertEq([typical.quests.step, typical.quests.done], [3, false], 'typical quest step');
  assertEq(currentQuest(typical).id, 'help', 'next quest');
  assertEq(typical.player.coins, 240, 'no coins granted');
  // 'harvest' is also satisfied (level 2) although 'help' is not: it must never pay out later
  assertEq(typical.quests.preDone, ['hatch', 'feed', 'plant', 'harvest'], 'recorded pre-done steps');
  bumpStat(typical, 'helped');
  const res = claimQuest(typical);
  assert(res.ok, 'claim help');
  assertEq(typical.player.coins, 290, 'only the help reward (50), harvest pays nothing');
  assertEq(currentQuest(typical).id, 'order', 'pre-done harvest step skipped without a reward');

  const mid = migrate(await loadFixture('save_v1_midgame'));
  assertEq(mid.quests.step, 5, 'midgame skips to orders');
  assertEq(currentQuest(mid).id, 'order', 'next quest');
  assertEq(mid.player.coins, 2300, 'no coins granted');
});

test('migrate: corrupt v1 save never throws and is repaired', async () => {
  const raw = await loadFixture('save_v1_corrupt');
  const s = migrate(raw);
  assertEq(s.version, STATE_VERSION, 'version');
  assert(Array.isArray(s.pets) && s.pets.length === 0, 'pets repaired');
  assert(Array.isArray(s.plots) && s.plots.length === 4, 'plots recreated');
  assertEq(s.player.coins, 100, 'player repaired');
  assertEq(s.inventory, { seed_carrot: 3, food_kibble: 2, egg_farm: 1 }, 'only valid stacks kept');
  assertEq(s.incubator.length, 1, 'only object slots kept');
  assertEq(s.expeditions, [], 'junk expeditions dropped');
  assert(Array.isArray(s.log), 'log repaired');
  assertEq(s.mysteryField, { keep: 'me' }, 'unknown fields survive');
  assertEq(findBad(s), null, 'no NaN/undefined');
});

test('migrate: junk input and idempotence', async () => {
  for (const junk of [null, undefined, 42, 'x', [], {}, { version: 'abc' }, { version: -4 }]) {
    const s = migrate(junk);
    assertEq(s.version, STATE_VERSION, `version for ${JSON.stringify(junk)}`);
    assertEq(s.plots.length, 4, 'plots');
  }
  const once = migrate(await loadFixture('save_v1_midgame'));
  const twice = migrate(JSON.parse(JSON.stringify(once)));
  assertEq(twice, once, 'migrate(migrate(x)) is stable');
});

test('migrate: a newer save is kept as-is and flagged', () => {
  const warnings = [];
  const off = onNotify((msg, type) => warnings.push(type));
  const s = migrate({ version: 99, player: { coins: 7 }, futureThing: { a: 1 } });
  off();
  assertEq(s.version, 99, 'version untouched');
  assertEq(s.futureThing, { a: 1 }, 'unknown field kept');
  assertEq(s.player.coins, 7, 'data kept');
  assert(isNewerSave(s), 'isNewerSave');
  assert(!isNewerSave(createNewState()), 'current is not newer');
  assert(warnings.length === 0 || warnings.includes('warn'), 'warns at most once with type warn');
});

test('v1 fixtures survive a 72 h offline catch-up (no NaN, nothing lost)', async () => {
  const { advance } = await import('../js/tick.js'); // loads pets.js + farm.js: a failure there fails only this test
  for (const name of FIXTURES) {
    const raw = await loadFixture(name);
    const lastTick = Number.isFinite(raw.lastTick) ? raw.lastTick : 1790000000000;
    await withFakeNow(lastTick, async clock => {
      const s = migrate(raw);
      s.lastTick = lastTick;
      const before = { ...s.inventory };
      const petCount = s.pets.length;
      const owned = Object.keys(s.collection).length;
      clock.advance(72 * HOUR);
      const { replayed } = advance(s, clock.get());
      assert(replayed, `${name}: replayed as offline time`);
      assertEq(findBad(s), null, `${name}: no NaN/undefined after catch-up`);
      for (const [id, n] of Object.entries(before)) {
        assert((s.inventory[id] || 0) >= n, `${name}: item ${id} lost (${n} -> ${s.inventory[id] || 0})`);
      }
      assertEq(s.pets.length, petCount, `${name}: pets kept`);
      assertEq(Object.keys(s.collection).length, owned, `${name}: collection kept`);
      for (const p of s.pets) {
        for (const v of Object.values(p.stats)) assert(v >= 0 && v <= 100, `${name}: stat out of range`);
      }
    });
  }
});

// ---- quests ----

const QUEST_STAT = {
  hatch: 'hatched', feed: 'fed', plant: 'planted', help: 'helped',
  harvest: 'harvested', order: 'ordersDone', explore: 'expeditionsStarted',
};

test('quests: claim only when done, grants reward, advances, finishes', () => {
  const s = freshState();
  assertEq(QUESTS.length, 7, 'seven steps');
  assertEq(currentQuest(s).id, 'hatch', 'first quest');
  assert(!claimQuest(s).ok, 'cannot claim before the condition is met');
  assertEq(s.quests.step, 0, 'still step 0');

  const coinsBefore = s.player.coins;
  for (const q of QUESTS) {
    assertEq(currentQuest(s).id, q.id, 'current quest');
    const before = { coins: s.player.coins, inv: { ...s.inventory } };
    bumpStat(s, QUEST_STAT[q.id]);
    const res = claimQuest(s);
    assert(res.ok, `claim ${q.id}: ${res.reason}`);
    assertEq(s.player.coins - before.coins, q.reward.coins || 0, `${q.id} coins`);
    for (const [id, n] of Object.entries(q.reward.items || {})) {
      assertEq(countItem(s, id) - (before.inv[id] || 0), n, `${q.id} item ${id}`);
    }
  }
  assert(s.quests.done, 'done after the last step');
  assertEq(currentQuest(s), null, 'no current quest');
  assert(!claimQuest(s).ok, 'nothing left to claim');
  assert(s.player.coins > coinsBefore, 'coins granted overall');
});

// ---- util ----

test('formatDuration', () => {
  assertEq(formatDuration(0), 'เสร็จแล้ว', 'zero');
  assertEq(formatDuration(-5), 'เสร็จแล้ว', 'negative');
  assertEq(formatDuration(12 * 1000), '12ว.', 'seconds');
  assertEq(formatDuration(200 * 1000), '3น. 20ว.', 'minutes');
  assertEq(formatDuration(65 * 60 * 1000), '1ชม. 5น.', 'hours');
});

test('escapeHtml escapes & < > " \'', () => {
  assertEq(escapeHtml(`<a href="x" onclick='y'>&</a>`), '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;', 'escaped');
  assertEq(escapeHtml(null), '', 'null');
  assertEq(escapeHtml(12), '12', 'number');
});

test('fake clock drives now() and todayKey()', async () => {
  await withFakeNow(new Date(2026, 0, 5, 23, 59, 0).getTime(), clock => {
    assertEq(now(), clock.get(), 'now');
    assertEq(todayKey(), '2026-01-05', 'day before');
    clock.advance(2 * 60 * 1000);
    assertEq(todayKey(), '2026-01-06', 'day after');
  });
  assert(Math.abs(now() - Date.now()) < 1000, 'real clock restored');
});

test('randInt / pickWeighted / uid', () => {
  for (let i = 0; i < 200; i++) {
    const n = randInt(3, 5);
    assert(n >= 3 && n <= 5 && Number.isInteger(n), 'randInt range');
  }
  assertEq(pickWeighted(['a', 'b'], x => (x === 'b' ? 1 : 0)), 'b', 'zero weights never picked');
  assertEq(pickWeighted([], () => 1), undefined, 'empty list');
  assert(uid() !== uid(), 'uid unique');
});

test('morph keeps node identity, updates text/attrs, removes extras', () => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  try {
    morph(root, '<p class="a" data-x="1">one</p><span>two</span><b>three</b>');
    const [p, span] = root.children;
    morph(root, '<p class="b">uno</p><span>two</span>');
    assert(root.children[0] === p && root.children[1] === span, 'nodes reused');
    assertEq([p.className, p.textContent, p.hasAttribute('data-x')], ['b', 'uno', false], 'p updated');
    assertEq(root.children.length, 2, 'extra node removed');
    morph(root, '');
    assertEq(root.childNodes.length, 0, 'emptied');
  } finally {
    root.remove();
  }
});

test('morph: keyed reorder keeps identity; focused input keeps its value', () => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  try {
    morph(root, '<div data-key="a">A</div><div data-key="b">B</div>');
    const [a, b] = root.children;
    morph(root, '<div data-key="b">B2</div><div data-key="a">A</div>');
    assert(root.children[0] === b && root.children[1] === a, 'keyed nodes follow their key');
    assertEq(b.textContent, 'B2', 'content updated');

    morph(root, '<input name="n" value="start">');
    const input = root.querySelector('input');
    input.focus();
    input.value = 'typed by user';
    morph(root, '<input name="n" value="start">');
    assert(root.querySelector('input') === input, 'input reused');
    assertEq(input.value, 'typed by user', 'typing preserved while focused');
  } finally {
    root.remove();
  }
});

// ---- storage merge (mock Firestore) ----

/** Mirrors firestore.rules: creating is free; updating needs rev == old rev + 1 and a version >= the old one. */
function rulesAllow(existing, data) {
  if (!existing) return true;
  return data.rev === (existing.rev ?? 0) + 1 && (data.version ?? 1) >= (existing.version ?? 1);
}

function fakeCloud() {
  const docs = {};
  const cloud = { docs, writes: 0, denied: 0 };
  cloud.setDoc = async (id, data) => {
    if (!rulesAllow(docs[id], data)) {
      cloud.denied += 1;
      throw Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
    }
    cloud.writes += 1;
    docs[id] = data;
  };
  cloud.provider = async () => ({
    db: {},
    doc: (_db, _col, id) => id,
    getDoc: async id => ({ exists: () => id in docs, data: () => docs[id] }),
    setDoc: cloud.setDoc,
  });
  return cloud;
}

function mkState(name, updatedAt, { pets = 0, coins = 100, version } = {}) {
  const s = createNewState();
  s.player.farmName = name;
  s.player.coins = coins;
  s.updatedAt = updatedAt;
  s.pets = Array.from({ length: pets }, (_, i) => ({ id: `p${i}`, speciesId: 'hamster' }));
  if (version) s.version = version;
  return JSON.parse(JSON.stringify(s));
}

const putCloud = (cloud, uid, state) => {
  cloud.docs[uid] = { state: JSON.stringify(state), updatedAt: state.updatedAt };
};
const cloudName = (cloud, uid) => JSON.parse(cloud.docs[uid].state).player.farmName;
const backups = uid => Object.keys(localStorage).filter(k => k.startsWith(`nongfarm_${uid}_backup_`));
const apply = s => replaceState(s);

/** Runs fn(cloud) with storage wired to a fake Firestore and a clean guest slot; always restores everything. */
async function withCloud(fn) {
  const cloud = fakeCloud();
  freshState();
  storage.setDbProvider(cloud.provider);
  try {
    await fn(cloud);
  } finally {
    storage.disconnectUser(apply);
    storage.setDbProvider();
    freshState();
  }
}

const noAsk = async () => { throw new Error('askWhichFarm must not be called'); };

test('storage: first login uploads the guest farm and retires the guest slot', () => withCloud(async cloud => {
  replaceState(mkState('GUEST', 5000, { pets: 1 }));
  storage.saveLocal(storage.GUEST_KEY, getState());
  const res = await storage.connectUser('u1', apply, noAsk);
  await storage.flushSave();
  assertEq(res.source, 'guest', 'source');
  assertEq(cloudName(cloud, 'u1'), 'GUEST', 'uploaded');
  assertEq(localStorage.getItem(storage.GUEST_KEY), null, 'guest slot retired');
  assertEq(getState().player.farmName, 'GUEST', 'still playing it');
}));

test('storage: existing cloud farm + untouched guest -> cloud wins silently', () => withCloud(async cloud => {
  putCloud(cloud, 'u1', mkState('CLOUD', 9000, { pets: 3 }));
  const res = await storage.connectUser('u1', apply, noAsk);
  assertEq(res.source, 'cloud', 'source');
  assertEq(getState().player.farmName, 'CLOUD', 'cloud farm loaded');
  assertEq(getState().pets.length, 3, 'pets loaded');
}));

test('storage: real guest farm vs cloud asks, default keeps cloud and backs up the guest', () => withCloud(async cloud => {
  putCloud(cloud, 'u1', mkState('CLOUD', 5000, { pets: 3 }));
  replaceState(mkState('GUEST', 9000, { pets: 1 }));
  storage.saveLocal(storage.GUEST_KEY, getState());
  let asked = null;
  const res = await storage.connectUser('u1', apply, async (account, guest) => {
    asked = { account, guest };
    return 'cloud';
  });
  assertEq(res.source, 'cloud', 'source');
  assertEq([asked.account.farmName, asked.account.pets, asked.guest.farmName, asked.guest.pets], ['CLOUD', 3, 'GUEST', 1], 'summaries shown');
  assertEq(getState().player.farmName, 'CLOUD', 'cloud kept');
  assertEq(localStorage.getItem(storage.GUEST_KEY), null, 'guest slot cleared');
  const saved = backups('u1').map(k => JSON.parse(localStorage.getItem(k)).player.farmName);
  assertEq(saved, ['GUEST'], 'guest farm backed up');
  assertEq(cloudName(cloud, 'u1'), 'CLOUD', 'cloud untouched');
}));

test('storage: choosing the guest farm backs up the account save (even a "pristine" one with coins)', () => withCloud(async cloud => {
  putCloud(cloud, 'u1', mkState('RICH', 0, { coins: 927 }));
  replaceState(mkState('GUEST', 9000, { pets: 2 }));
  storage.saveLocal(storage.GUEST_KEY, getState());
  const res = await storage.connectUser('u1', apply, async () => 'guest');
  await storage.flushSave();
  assertEq(res.source, 'guest', 'source');
  assertEq(cloudName(cloud, 'u1'), 'GUEST', 'cloud replaced');
  const coins = backups('u1').map(k => JSON.parse(localStorage.getItem(k)).player.coins);
  assert(coins.includes(927), `account save with 927 coins was backed up (${JSON.stringify(coins)})`);
  assertEq(localStorage.getItem(storage.GUEST_KEY), null, 'guest slot retired');
}));

test('storage: a cloud save from a newer client wins and is never overwritten', () => withCloud(async cloud => {
  const newer = mkState('FUTURE', 100, { version: 99 });
  newer.futureField = { keep: true };
  putCloud(cloud, 'u1', newer);
  const original = cloud.docs.u1.state;
  replaceState(mkState('GUEST', 9000, { pets: 2 }));
  storage.saveLocal(storage.GUEST_KEY, getState());
  const res = await storage.connectUser('u1', apply, noAsk);
  assertEq(res.source, 'cloud', 'newer cloud chosen without asking');
  assertEq(getState().version, 99, 'version preserved');
  await storage.flushSave();
  assertEq(cloud.docs.u1.state, original, 'cloud copy untouched');
  assert(localStorage.getItem(storage.GUEST_KEY) !== null, 'guest farm kept');
}));

test('storage: a newer local save is never uploaded', () => withCloud(async cloud => {
  const res = await storage.connectUser('u2', apply, noAsk); // no cloud copy yet: uploads the fresh guest
  await storage.flushSave();
  assertEq(res.source, 'guest', 'source');
  const before = cloud.docs.u2.state;
  replaceState(mkState('FROM_FUTURE', 777, { version: 99 }));
  await storage.flushSave();
  assertEq(cloud.docs.u2.state, before, 'cloud not overwritten by a newer-version save');
}));

test('storage: only the latest 3 backups are kept', () => withCloud(async cloud => {
  for (let i = 0; i < 5; i++) {
    putCloud(cloud, 'u3', mkState(`ACCOUNT${i}`, 1000 + i, { pets: 1 }));
    replaceState(mkState(`GUEST${i}`, 5000 + i, { pets: 1 }));
    storage.saveLocal(storage.GUEST_KEY, getState());
    await storage.connectUser('u3', apply, async () => 'guest');
    await storage.flushSave();
    storage.disconnectUser(apply);
  }
  assert(backups('u3').length <= 3, `at most 3 backups, got ${backups('u3').length}`);
  assert(backups('u3').length >= 1, 'backups exist');
}));

test('storage: logout into an untouched guest farm asks for a farm name', () => withCloud(async () => {
  await storage.connectUser('u4', apply, noAsk);
  await storage.flushSave();
  const res = storage.disconnectUser(apply);
  assertEq(res.isNew, true, 'fresh guest farm needs a name');
  replaceState(mkState('PLAYED', 4000, { pets: 1 }));
  storage.saveLocal(storage.GUEST_KEY, getState());
  await storage.connectUser('u4', apply, async () => 'cloud');
  storage.saveLocal(storage.GUEST_KEY, mkState('PLAYED', 4000, { pets: 1 }));
  const res2 = storage.disconnectUser(apply);
  assertEq(res2.isNew, false, 'a played guest farm is not new');
}));

test('storage: unreachable cloud keeps the guest save and never uploads', () => withCloud(async cloud => {
  storage.setDbProvider(async () => ({
    db: {}, doc: () => 'x',
    getDoc: async () => { throw new Error('offline'); },
    setDoc: async () => { throw new Error('offline'); },
  }));
  replaceState(mkState('GUEST', 5000, { pets: 1 }));
  storage.saveLocal(storage.GUEST_KEY, getState());
  const res = await storage.connectUser('u5', apply, noAsk);
  assertEq([res.cloudFailed, res.switched], [true, false], 'failed, stayed on guest');
  assertEq(getState().player.farmName, 'GUEST', 'still playing the guest farm');
  assertEq(Object.keys(cloud.docs).length, 0, 'nothing uploaded');
}));

// ---- optimistic concurrency (rev), single writer ----

const delay = ms => new Promise(r => setTimeout(r, ms));
const backupNames = uid => backups(uid).map(k => JSON.parse(localStorage.getItem(k)).player.farmName);

/** A player action: changes the state and emits 'change'. */
function act() {
  const s = getState();
  s.player.coins += 1;
  s.updatedAt += 1;
  replaceState(s);
}

test('firestore.rules enforces the rev rule (and the mock mirrors it)', async () => {
  const text = await (await fetch(new URL('../firestore.rules', import.meta.url))).text();
  assert(text.includes("request.resource.data.rev == resource.data.get('rev', 0) + 1"), 'rev rule present');
  assert(text.includes("request.resource.data.get('version', 1) >= resource.data.get('version', 1)"), 'version rule present');
  assert(text.includes('resource == null'), 'creation allowed');
  const doc = { state: '{}', rev: 4, version: 2 };
  assert(rulesAllow(null, { state: '{}' }), 'create without rev');
  assert(rulesAllow(doc, { rev: 5, version: 2 }), 'next rev accepted');
  assert(!rulesAllow(doc, { rev: 4, version: 2 }), 'same rev rejected');
  assert(!rulesAllow(doc, { rev: 6, version: 2 }), 'skipping a rev rejected');
  assert(!rulesAllow(doc, { state: '{}', updatedAt: 1 }), 'v1-style write without rev rejected');
  assert(!rulesAllow(doc, { rev: 5, version: 1 }), 'older client version rejected');
  assert(rulesAllow({ state: '{}' }, { rev: 1, version: 2 }), 'doc without rev counts as rev 0');
});

test('rev: every write is lastKnownRev + 1 and carries the version', () => withCloud(async cloud => {
  putCloud(cloud, 'r1', mkState('CLOUD', 100, { pets: 1 }));
  cloud.docs.r1.rev = 7;
  await storage.connectUser('r1', apply, noAsk);
  act();
  await storage.flushSave();
  assertEq([cloud.docs.r1.rev, cloud.docs.r1.version], [8, 2], 'first write');
  act();
  await storage.flushSave();
  assertEq(cloud.docs.r1.rev, 9, 'second write');
  assertEq(cloud.denied, 0, 'nothing denied');
}));

test('stale write is rejected: adopt the cloud save, back up the local copy, no retry loop', () => withCloud(async cloud => {
  const warnings = [];
  const off = onNotify((msg, type) => warnings.push([msg, type]));
  try {
    putCloud(cloud, 'r2', mkState('BASE', 100, { pets: 1 }));
    cloud.docs.r2.rev = 5;
    await storage.connectUser('r2', apply, noAsk);
    // this tab keeps playing...
    const s = getState();
    s.player.farmName = 'LOCAL';
    s.updatedAt = 500;
    replaceState(s);
    // ...while another device writes first
    const other = mkState('OTHER_DEVICE', 900, { pets: 4 });
    cloud.docs.r2 = { state: JSON.stringify(other), updatedAt: 900, version: 2, rev: 6 };
    await storage.flushSave();
    assertEq(cloud.denied, 1, 'exactly one rejected write, no retry loop');
    assertEq(getState().player.farmName, 'OTHER_DEVICE', 'cloud save adopted');
    assertEq(getState().pets.length, 4, 'cloud pets adopted');
    assertEq(backupNames('r2'), ['LOCAL'], 'local copy backed up');
    assertEq(JSON.parse(cloud.docs.r2.state).player.farmName, 'OTHER_DEVICE', 'cloud untouched');
    assert(warnings.some(([m, t]) => t === 'warn' && m.includes('อัปเดตจากอีกแท็บ')), 'warn toast');
    // uploads continue normally from the adopted rev
    act();
    await storage.flushSave();
    assertEq(cloud.docs.r2.rev, 7, 'next write continues from the adopted rev');
    assertEq(cloud.denied, 1, 'still only one denial');
  } finally {
    off();
  }
}));

test('a late-landing duplicate of our own write is not mistaken for another device', () => withCloud(async cloud => {
  putCloud(cloud, 'r3', mkState('ME', 100, { pets: 1 }));
  await storage.connectUser('r3', apply, noAsk);
  const realSet = cloud.setDoc;
  let first = true;
  storage.setDbProvider(async () => ({
    db: {},
    doc: (_d, _c, id) => id,
    getDoc: async id => ({ exists: () => id in cloud.docs, data: () => cloud.docs[id] }),
    // the write lands but the client is told it was refused (e.g. a queued offline write replayed twice)
    setDoc: async (id, data) => {
      await realSet(id, data);
      if (first) {
        first = false;
        throw Object.assign(new Error('denied'), { code: 'permission-denied' });
      }
    },
  }));
  act();
  await storage.flushSave();
  assertEq(getState().player.farmName, 'ME', 'own state kept');
  assertEq(backups('r3').length, 0, 'no backup needed');
  assertEq(cloud.docs.r3.rev, 2, 'landed write (rev 1) then re-sent from the landed rev');
  act();
  await storage.flushSave();
  assertEq(cloud.docs.r3.rev, 3, 'keeps counting from the landed rev');
}));

test('v1-style client (no rev) can no longer overwrite an existing cloud save', () => withCloud(async cloud => {
  putCloud(cloud, 'r4', mkState('PRECIOUS', 100, { pets: 2 }));
  const api = await cloud.provider();
  let denied = false;
  try {
    await api.setDoc('r4', { state: JSON.stringify(mkState('OLD_CLIENT', 5, {})), updatedAt: 5 });
  } catch (e) {
    denied = e.code === 'permission-denied';
  }
  assert(denied, 'write without rev is refused');
  assertEq(JSON.parse(cloud.docs.r4.state).player.farmName, 'PRECIOUS', 'save untouched');
}));

/** Another browser tab, simulated with a second BroadcastChannel instance; collects what this tab announces. */
function fakeOtherTab(scope) {
  const ch = new BroadcastChannel('nongfarm-writer');
  const heard = [];
  ch.onmessage = e => {
    heard.push(e.data);
    // like a real writer tab: acknowledge a claim so the claimant knows to wait for our final save
    if (e.data.type === 'claim') ch.postMessage({ type: 'ack', scope, tab: 'other-tab', writer: true });
  };
  return {
    heard,
    claim: () => ch.postMessage({ type: 'claim', scope, tab: 'other-tab' }),
    yielded: () => ch.postMessage({ type: 'yielded', scope, tab: 'other-tab', rev: 0, updatedAt: 0 }),
    close: () => ch.close(),
  };
}

test('two tabs: a tab that loses focus writes the shared cache first and announces it', () => withCloud(async cloud => {
  putCloud(cloud, 'r5', mkState('SHARED', 100, { pets: 1 }));
  await storage.connectUser('r5', apply, noAsk);
  await delay(250); // the load-time sync window (UI is locked meanwhile) is over
  const tab = fakeOtherTab('uid:r5');
  try {
    act(); // an action not yet saved anywhere
    const stamp = getState().updatedAt;
    tab.claim();
    await delay(100);
    assertEq(storage.getSaveStatus(), 'othertab', 'this tab steps back');
    assertEq(JSON.parse(localStorage.getItem('nongfarm_r5')).updatedAt, stamp, 'shared local cache already has the last action');
    const msg = tab.heard.find(m => m.type === 'yielded');
    assert(msg && msg.updatedAt === stamp && Number.isFinite(msg.rev), `yielded announced with rev + updatedAt (${JSON.stringify(msg)})`);

    const writes = cloud.writes;
    act();
    await storage.flushSave();
    assertEq(cloud.writes, writes, 'non-writer tab does not upload');
  } finally {
    tab.close();
  }
}));

test('two tabs: the new writer adopts the newest of memory / local cache / cloud', () => withCloud(async cloud => {
  putCloud(cloud, 'r6', mkState('BASE', 100, { pets: 1 }));
  cloud.docs.r6.rev = 2;
  await storage.connectUser('r6', apply, noAsk);
  await delay(250);
  const tab = fakeOtherTab('uid:r6');
  try {
    tab.claim();
    await delay(60);
    // the other tab plays on and saves only locally so far (its upload is still in flight)
    localStorage.setItem('nongfarm_r6', JSON.stringify(mkState('FROM_TAB_A', 700, { pets: 2 })));
    storage.claimWriter(); // we come back to the front
    tab.yielded();
    await delay(120);
    assert(storage.getSaveStatus() !== 'othertab', 'writer again');
    assertEq(getState().player.farmName, 'FROM_TAB_A', 'adopted the newer local cache, not the older cloud copy');
    await storage.flushSave();
    assertEq(JSON.parse(cloud.docs.r6.state).player.farmName, 'FROM_TAB_A', 'uploaded the adopted copy');
    assert(cloud.docs.r6.rev >= 3, `rev continues from the cloud rev 2 (got ${cloud.docs.r6.rev})`);
    assertEq(cloud.denied, 0, 'no rejected writes');

    // and when the cloud is the newest, it wins
    tab.claim();
    await delay(60);
    cloud.docs.r6 = { state: JSON.stringify(mkState('CLOUD_NEWEST', 900, { pets: 3 })), updatedAt: 900, version: 2, rev: 4 };
    storage.claimWriter();
    tab.yielded();
    await delay(120);
    assertEq(getState().player.farmName, 'CLOUD_NEWEST', 'cloud adopted when newest');
    act();
    await storage.flushSave();
    assertEq(cloud.docs.r6.rev, 5, 'lastKnownRev follows the cloud doc');
  } finally {
    tab.close();
  }
}));

test('two guest tabs: the idle tab never overwrites the active one; coming back reloads', () => withCloud(async () => {
  storage.disconnectUser(apply); // plain guest mode
  replaceState(mkState('G_A', 100, { pets: 1, coins: 99999 }));
  storage.saveLocal(storage.GUEST_KEY, getState());
  await delay(250);
  const tab = fakeOtherTab('guest');
  try {
    tab.claim();
    await delay(100);
    assertEq(storage.getSaveStatus(), 'othertab', 'guest tab steps back too');
    assertEq(JSON.parse(localStorage.getItem(storage.GUEST_KEY)).player.coins, 99999, 'cache written when stepping back');
    assert(tab.heard.some(m => m.type === 'yielded'), 'yielded announced');

    // the other tab saves 120000 coins; this stale tab keeps ticking and must not clobber it
    localStorage.setItem(storage.GUEST_KEY, JSON.stringify(mkState('G_B', 900, { pets: 1, coins: 120000 })));
    act();
    await storage.flushSave();
    assertEq(JSON.parse(localStorage.getItem(storage.GUEST_KEY)).player.coins, 120000, 'stale tab did not overwrite the guest save');

    storage.claimWriter();
    tab.yielded();
    await delay(120);
    assertEq([getState().player.farmName, getState().player.coins], ['G_B', 120000], 'reloaded the newer guest save');
    assert(storage.getSaveStatus() !== 'othertab', 'writer again');
  } finally {
    tab.close();
  }
}));

/** Pretends the tab is in the background (document.visibilityState === 'hidden') while fn runs. */
async function whileHidden(fn) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
  try {
    await fn();
  } finally {
    delete document.visibilityState;
  }
}

test('background tab: starts as a non-writer and never writes the shared guest save', () => withCloud(async () => {
  storage.saveLocal(storage.GUEST_KEY, mkState('ACTIVE_TAB', 900, { pets: 1, coins: 500 }));
  await whileHidden(async () => {
    storage.disconnectUser(apply); // what a freshly opened background tab does at startup
    assertEq(storage.getSaveStatus(), 'othertab', 'not the writer');
    // the tab in front keeps playing and saves
    storage.saveLocal(storage.GUEST_KEY, mkState('ACTIVE_TAB', 2000, { pets: 1, coins: 120000 }));
    act();
    await storage.flushSave();
    assertEq(JSON.parse(localStorage.getItem(storage.GUEST_KEY)).player.coins, 120000, 'background tab did not overwrite');
  });
  // when it comes to the front it compares itself with the newer save instead of overwriting it
  storage.claimWriter();
  await delay(400);
  assertEq(getState().player.coins, 120000, 'adopted the newer save');
  assert(storage.getSaveStatus() !== 'othertab', 'writer after focus');
}));

test('background tab: an auth change does not make it a writer', () => withCloud(async cloud => {
  putCloud(cloud, 'h1', mkState('ACCOUNT', 100, { pets: 1 }));
  await whileHidden(async () => {
    await storage.connectUser('h1', apply, noAsk); // onAuthStateChanged fires in every tab
    assertEq(storage.getSaveStatus(), 'othertab', 'hidden tab is not the writer');
    assertEq(localStorage.getItem('nongfarm_h1'), null, 'shared cache untouched');
    const writes = cloud.writes;
    act();
    await storage.flushSave();
    assertEq(cloud.writes, writes, 'no upload from a background tab');
    assertEq(localStorage.getItem('nongfarm_h1'), null, 'still nothing written locally');
    storage.disconnectUser(apply); // logout in the same background tab
    assertEq(storage.getSaveStatus(), 'othertab', 'still not the writer after logout');
  });
}));

test('a visible tab becomes the writer right after a normal load', () => withCloud(async cloud => {
  putCloud(cloud, 'v1', mkState('ACCOUNT', 100, { pets: 1 }));
  await storage.connectUser('v1', apply, noAsk);
  assert(['saved', 'syncing', 'saving'].includes(storage.getSaveStatus()), 'writer (not othertab)');
  await delay(300);
  assertEq(storage.getSaveStatus(), 'saved', 'no other tab: sync finishes quickly');
  act();
  await storage.flushSave();
  assertEq(cloud.docs.v1.rev, 1, 'uploads work');
}));

test('reconcile: the new writer is locked while syncing and backs up every losing copy', () => withCloud(async cloud => {
  putCloud(cloud, 'r9', mkState('BASE', 100, { pets: 1 }));
  cloud.docs.r9.rev = 1;
  await storage.connectUser('r9', apply, noAsk);
  await delay(250);
  const tab = fakeOtherTab('uid:r9');
  try {
    tab.claim();
    await delay(80);
    act(); // unsent action in this (now background) tab: memory updatedAt 101
    localStorage.setItem('nongfarm_r9', JSON.stringify(mkState('CACHE_COPY', 500, { pets: 2 })));
    cloud.docs.r9 = { state: JSON.stringify(mkState('CLOUD_NEWEST', 900, { pets: 3 })), updatedAt: 900, version: 2, rev: 2 };

    storage.claimWriter();
    await delay(50);
    assertEq([storage.isSyncing(), storage.getSaveStatus()], [true, 'syncing'], 'locked while syncing');
    const before = localStorage.getItem('nongfarm_r9');
    assertEq(localStorage.getItem('nongfarm_r9'), before, 'nothing written during the sync');
    tab.yielded();
    await delay(250);
    assertEq([storage.isSyncing(), getState().player.farmName], [false, 'CLOUD_NEWEST'], 'cloud copy won');
    assertEq(backupNames('r9').sort(), ['BASE', 'CACHE_COPY'], 'both losing copies backed up (memory with the unsent action, cache)');
  } finally {
    tab.close();
  }
}));

test('reconcile: an action taken during the sync window does not silently drop the other tab\'s changes', () => withCloud(async cloud => {
  putCloud(cloud, 'r10', mkState('BASE', 100, { pets: 1 }));
  await storage.connectUser('r10', apply, noAsk);
  await delay(250);
  const tab = fakeOtherTab('uid:r10');
  try {
    tab.claim();
    await delay(80);
    localStorage.setItem('nongfarm_r10', JSON.stringify(mkState('OLD_TAB_UNSENT', 4000, { pets: 2 })));
    storage.claimWriter();
    await delay(50);
    const s = getState(); // a click that slipped in during the window: memory becomes the newest copy
    s.player.farmName = 'QUICK_CLICK';
    s.updatedAt = 5000;
    replaceState(s);
    tab.yielded();
    await delay(250);
    assertEq(getState().player.farmName, 'QUICK_CLICK', 'memory won by updatedAt');
    assertEq(backupNames('r10'), ['OLD_TAB_UNSENT'], 'the other tab\'s copy was backed up, not dropped');
  } finally {
    tab.close();
  }
}));

test('rev reset: doc overwritten by an old client -> keep the newer copy, back up the other', () => withCloud(async cloud => {
  putCloud(cloud, 'r7', mkState('BASE', 100, { pets: 1 }));
  cloud.docs.r7.rev = 10;
  await storage.connectUser('r7', apply, noAsk);
  const s = getState();
  s.player.farmName = 'LOCAL7';
  s.updatedAt = 500;
  replaceState(s);
  // an old (rev-less) client replaced the doc before the rules were published
  cloud.docs.r7 = { state: JSON.stringify(mkState('OLD_CLIENT', 300, { pets: 2 })), updatedAt: 300 };
  await storage.flushSave();
  assertEq(cloud.denied, 1, 'one rejected write, no loop');
  assertEq([JSON.parse(cloud.docs.r7.state).player.farmName, cloud.docs.r7.rev], ['LOCAL7', 1], 'newer local copy uploaded from the doc rev');
  assertEq(backupNames('r7'), ['OLD_CLIENT'], 'overwritten cloud copy backed up');
}));

test('rev reset: old client wrote something newer -> adopt it, back up the local copy', () => withCloud(async cloud => {
  putCloud(cloud, 'r8', mkState('BASE', 100, { pets: 1 }));
  cloud.docs.r8.rev = 10;
  await storage.connectUser('r8', apply, noAsk);
  const s = getState();
  s.player.farmName = 'LOCAL8';
  s.updatedAt = 500;
  replaceState(s);
  cloud.docs.r8 = { state: JSON.stringify(mkState('OLD_NEWER', 900, { pets: 2 })), updatedAt: 900 };
  await storage.flushSave();
  assertEq(getState().player.farmName, 'OLD_NEWER', 'newer cloud copy adopted');
  assertEq(backupNames('r8'), ['LOCAL8'], 'local copy backed up');
  act();
  await storage.flushSave();
  assertEq(cloud.docs.r8.rev, 1, 'counting restarts from the doc rev');
  assertEq(cloud.denied, 1, 'only the first write was refused');
}));

test('quests preDone: veteran steps never pay out even when claimed in order', async () => {
  const mid = migrate(await loadFixture('save_v1_midgame'));
  assertEq(mid.quests.preDone, ['hatch', 'feed', 'plant', 'help', 'harvest', 'explore'], 'midgame pre-done');
  const coins = mid.player.coins;
  bumpStat(mid, 'ordersDone');
  assert(claimQuest(mid).ok, 'order step pays');
  assertEq(mid.player.coins, coins, 'order reward is an egg, no coins');
  assertEq(mid.quests.done, true, 'explore was pre-done, chain finished');
  assertEq(currentQuest(mid), null, 'no quest left');
  assert(!claimQuest(mid).ok, 'nothing left to claim');
});
