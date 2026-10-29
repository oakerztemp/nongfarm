// Memories tests (CONTRACT_V9): journal.js, birthday.js, weather.js, album.js. (Engine snapshot + rain: world.test.js. State v7: core.test.js.)
import { test, assert, assertEq, withFakeNow } from './harness.js';
import { migrate, createNewState, JOURNAL_DAYS_MAX, JOURNAL_LINES_MAX } from '../js/state.js';
import {
  addJournal, journalEvent, journalDays, journalAway, syncJournal, journalText, JOURNAL_KINDS,
} from '../js/journal.js';
import { birthdayInfo, birthdayPets, claimBirthday, dayIndex, BIRTHDAY_DAYS } from '../js/birthday.js';
import { BOND_DAILY_CAP, addBond } from '../js/pets.js';
import { weatherAt, weatherLabel, nextWeatherChange, bindWeather, HOUR_MS, RAIN_SHARE } from '../js/weather.js';
import { buildAwayDigest, snapshotForAway } from '../js/away.js';
import * as album from '../js/album.js';
import { onNotify } from '../js/util.js';

const DAY = 24 * HOUR_MS;
const NOON = new Date(2026, 9, 25, 12, 0, 0).getTime(); // local noon, 2026-10-25
const key = ms => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

function game(petDefs = [{ id: 'p1', name: 'มีมี่' }]) {
  const pets = petDefs.map(d => ({ id: d.id, speciesId: d.species || 'hamster', nickname: d.name ?? '', bornAt: d.bornAt ?? NOON - 5 * DAY, status: d.status || 'idle' }));
  return migrate({ version: 7, pets, lastTick: NOON });
}

// ---------------------------------------------------------------- journal

test('journal: a line lands in today with emoji, text and petId; the same kind for the same pet is written once a day', () => withFakeNow(NOON, () => {
  const s = game();
  assert(addJournal(s, { kind: 'photo', petId: 'p1', emoji: '📸', text: 'ถ่ายรูปกับมีมี่' }));
  assertEq(s.journal, [{ day: key(NOON), lines: [{ emoji: '📸', text: 'ถ่ายรูปกับมีมี่', petId: 'p1', kind: 'photo' }] }]);
  assert(!addJournal(s, { kind: 'photo', petId: 'p1', text: 'อีกรอบ' }), 'same kind + pet + day is a duplicate');
  assert(addJournal(s, { kind: 'melt', petId: 'p1', text: 'ละลาย' }), 'another kind is fine');
  assert(addJournal(s, { kind: 'photo', petId: 'p2', text: 'อีกตัว' }), 'another pet is fine');
  assert(!addJournal(s, { kind: 'x', text: '   ' }) && !addJournal(s, { kind: 'x' }) && !addJournal(null, { text: 'a' }), 'empty / junk refused');
  assertEq(s.journal[0].lines.length, 3);
}));

test('journal: no pet -> deduped by text; the next day starts a new bucket; the old day is untouched', () => withFakeNow(NOON, async clock => {
  const s = game();
  assert(addJournal(s, { kind: 'away', text: 'ฝนตกพรำๆ' }));
  assert(!addJournal(s, { kind: 'away', text: 'ฝนตกพรำๆ' }));
  assert(addJournal(s, { kind: 'away', text: 'แดดจ้า' }));
  clock.advance(DAY);
  assert(addJournal(s, { kind: 'away', text: 'ฝนตกพรำๆ' }), 'same text, next day');
  assertEq(s.journal.map(d => [d.day, d.lines.length]), [[key(NOON), 2], [key(NOON + DAY), 1]]);
  assertEq(journalDays(s).map(d => d.day), [key(NOON + DAY), key(NOON)], 'journalDays: newest day first');
}));

test('journal: caps at 14 days and 6 lines a day (oldest dropped), days stay sorted even if written out of order', () => withFakeNow(NOON, clock => {
  const s = game();
  for (let i = 0; i < 20; i++) { for (let j = 0; j < 9; j++) addJournal(s, { kind: `k${j}`, petId: 'p1', text: `d${i}l${j}` }); clock.advance(DAY); }
  assertEq(s.journal.length, JOURNAL_DAYS_MAX);
  assert(s.journal.every(d => d.lines.length === JOURNAL_LINES_MAX), '6 lines per day');
  assertEq(s.journal[0].lines.at(-1).text, 'd6l8', 'oldest kept day, newest lines');
  const t = [...s.journal.map(d => d.day)];
  assertEq(t, [...t].sort(), 'sorted');
  addJournal(s, { kind: 'late', petId: 'p1', text: 'วันเก่า', day: s.journal[3].day });
  assertEq(s.journal.length, JOURNAL_DAYS_MAX, 'still capped');
  assertEq(s.journal[3].lines.at(-1).text, 'วันเก่า', 'written into that day');
  assertEq(migrate(JSON.parse(JSON.stringify(s))).journal, s.journal, 'survives migrate unchanged');
}));

test('journal: every event kind has cute Thai text with the pet name, short, deterministic', () => withFakeNow(NOON, () => {
  const s = game([{ id: 'p1', name: 'มีมี่' }, { id: 'p2', name: 'โมจิ' }]);
  assertEq(JOURNAL_KINDS.sort(), ['away', 'birthday', 'bestFriend', 'favSpot', 'firstWear', 'hatch', 'melt', 'photo', 'postcard', 'familyEgg', 'familyHatch', 'favDish', 'favToy', 'cook', 'dish'].sort());
  const ctx = { petId: 'p1', otherId: 'p2', spot: 'chin', acc: '🎩 หมวกทรงสูง', months: 3 };
  for (const [i, kind] of JOURNAL_KINDS.filter(k => k !== 'away').entries()) {
    ctx.day = `2026-09-0${i + 1}`; // one day each: a day only holds 6 lines
    const text = journalText(kind, { name: 'มีมี่', other: 'โมจิ', spot: 'คาง', acc: 'โบว์', months: 3 });
    assert((kind === 'cook' ? text.includes('โบว์') : text.includes('มีมี่')) && text.length <= 60 && !text.includes('{'), `${kind}: ${text}`);
    assertEq(journalText(kind, { name: 'มีมี่', other: 'โมจิ', spot: 'คาง', acc: 'โบว์', months: 3 }), text, 'deterministic');
    assert(journalEvent(s, kind, ctx), `${kind} written`);
    assert(!journalEvent(s, kind, ctx), `${kind} only once a day`);
  }
  const lines = s.journal.flatMap(d => d.lines);
  assert(lines.find(l => l.kind === 'favSpot').text.includes('คาง'), 'spot translated');
  assert(lines.find(l => l.kind === 'bestFriend').text.includes('โมจิ'), 'friend named from the state');
  assert(lines.find(l => l.kind === 'birthday').text.includes('3'), 'months');
  assert(lines.every(l => l.emoji), 'every line has an emoji');
  assert(!journalEvent(s, 'nope', ctx) && !journalEvent(null, 'hatch', ctx), 'unknown kind / null state: false, no throw');
}));

test('journal: name falls back to nickname -> species name; postcards of one day are separate lines', () => withFakeNow(NOON, () => {
  const s = game([{ id: 'p1', name: '' }]);
  journalEvent(s, 'hatch', { petId: 'p1' });
  assert(!s.journal[0].lines[0].text.includes('undefined') && s.journal[0].lines[0].text.length > 5);
  s.postcards = [{ id: 'c1', petName: 'ปุย', speciesId: 'cat', text: 'hi', at: NOON - HOUR_MS, read: false }, { id: 'c2', petName: 'ปุย', speciesId: 'cat', text: 'hi', at: NOON - 2 * HOUR_MS, read: false },
    { id: 'old', petName: 'เก่า', speciesId: 'cat', text: 'hi', at: NOON - 3 * DAY, read: true }];
  const n = syncJournal(s);
  assertEq(n, 2, 'both of today\'s postcards, not the old one');
  assertEq(syncJournal(s), 0, 'idempotent');
}));

test('syncJournal: pets hatched today (yard and nursery) get a hatch line once', () => withFakeNow(NOON, () => {
  const s = game([{ id: 'old', name: 'เก่า', bornAt: NOON - 9 * DAY }, { id: 'new', name: 'ใหม่', bornAt: NOON - 2 * HOUR_MS }]);
  s.nursery = [{ pet: { ...s.pets[1], id: 'baby', nickname: 'เบบี้', bornAt: NOON - HOUR_MS, status: 'nursery' }, hatchedAt: NOON - HOUR_MS }];
  assertEq(syncJournal(s), 2);
  const lines = s.journal[0].lines;
  assertEq(lines.map(l => l.petId).sort(), ['baby', 'new']);
  assertEq(syncJournal(s), 0);
}));

test('journalAway: digest lines become diary lines once a day; best friends event writes a line', () => withFakeNow(NOON, () => {
  const s = game();
  const digest = { lines: [{ petId: 'p1', emoji: '😴', text: 'มีมี่ หลับไปแล้ว' }, { emoji: '🎁', text: 'ของขวัญรออยู่' }], highlights: ['p1'] };
  assertEq(journalAway(s, digest), 2);
  assertEq(journalAway(s, digest), 0);
  assertEq(s.journal[0].lines.map(l => l.kind), ['away', 'away']);
  assertEq(journalAway(s, null), 0);
}));

// ---------------------------------------------------------------- birthdays

test('birthdayInfo: every 30 calendar days since hatch; months counts completed blocks; day 0 is never a birthday', () => {
  const born = new Date(2026, 8, 1, 23, 50).getTime(); // late evening hatch
  const at = (days, h = 0, m = 5) => { const d = new Date(2026, 8, 1 + days, h, m); return d.getTime(); };
  const pet = { bornAt: born };
  assertEq(birthdayInfo(pet, at(0, 23, 59)), { isToday: false, months: 0 });
  assertEq(birthdayInfo(pet, at(1)), { isToday: false, months: 0 }, 'ten minutes later but a new calendar day: day 1');
  assertEq(birthdayInfo(pet, at(29)), { isToday: false, months: 0 });
  assertEq(birthdayInfo(pet, at(30)), { isToday: true, months: 1 });
  assertEq(birthdayInfo(pet, at(30, 23, 59)), { isToday: true, months: 1 }, 'the whole calendar day');
  assertEq(birthdayInfo(pet, at(31)), { isToday: false, months: 1 });
  assertEq(birthdayInfo(pet, at(60)), { isToday: true, months: 2 });
  assertEq(birthdayInfo(pet, at(365)), { isToday: false, months: 12 });
  assertEq(birthdayInfo(pet, at(360)), { isToday: true, months: 12 });
  assertEq(birthdayInfo({ bornAt: 0 }, at(30)), { isToday: false, months: 0 }, 'unknown birth: no party');
  assertEq(birthdayInfo(null, at(30)), { isToday: false, months: 0 });
  assertEq(birthdayInfo({ bornAt: born }, born - DAY), { isToday: false, months: 0 }, 'clock before hatch: never negative');
  assertEq(BIRTHDAY_DAYS, 30);
  assertEq(dayIndex(new Date(2026, 9, 25, 0, 0).getTime()) - dayIndex(new Date(2026, 9, 24, 23, 59).getTime()), 1);
});

function birthdayGame() {
  // pet is exactly 30 calendar days old at NOON; bond 10, nothing earned today
  const born = new Date(2026, 8, 25, 8, 0).getTime();
  const s = game([{ id: 'p1', name: 'มีมี่', bornAt: born }, { id: 'p2', name: 'โมจิ', bornAt: NOON - 3 * DAY }]);
  s.pets[0].bond = 10;
  return s;
}

test('claimBirthday: +1 bond once per birthday, diary line + toast, lastBirthdayGift remembers the month', () => withFakeNow(NOON, () => {
  const s = birthdayGame();
  assertEq(birthdayPets(s), [{ petId: 'p1', months: 1, claimed: false }]);
  const toasts = [];
  const off = onNotify((m, t) => toasts.push([m, t]));
  const r = claimBirthday(s, 'p1');
  off();
  assertEq([r.ok, r.months, r.gained, r.name], [true, 1, 1, 'มีมี่']);
  assertEq(s.pets[0].bond, 11);
  assertEq(s.pets[0].lastBirthdayGift, 1);
  assert(toasts.some(([m]) => m === '🎂 วันนี้วันเกิดมีมี่ ครบ 1 เดือน!'), `toast: ${JSON.stringify(toasts)}`);
  assert(s.journal[0].lines.some(l => l.kind === 'birthday' && l.petId === 'p1'), 'diary line');
  assertEq(claimBirthday(s, 'p1'), { ok: false, reason: 'claimed' }, 'second tap the same day gives nothing');
  assertEq(s.pets[0].bond, 11);
  assertEq(birthdayPets(s), [{ petId: 'p1', months: 1, claimed: true }]);
  assertEq(claimBirthday(s, 'p2'), { ok: false, reason: 'notToday' });
  assertEq(claimBirthday(s, 'ghost'), { ok: false, reason: 'nopet' });
  assertEq(claimBirthday(null, 'p1'), { ok: false, reason: 'nopet' });
}));

test('claimBirthday: the next birthday (month 2) can be claimed again; the daily bond cap of 30 still holds', () => withFakeNow(NOON, clock => {
  const s = birthdayGame();
  s.pets[0].lastBirthdayGift = 1;
  clock.advance(30 * DAY);
  assertEq(birthdayInfo(s.pets[0], clock.get()), { isToday: true, months: 2 });
  assertEq(claimBirthday(s, 'p1').ok, true, 'a new birthday, a new gift');
  clock.set(NOON);
  // cap: a pet that already earned 30 today gets no bond, but the gift is still marked taken (no retry loop)
  const c = birthdayGame();
  c.pets[0].bondDay = key(NOON);
  c.pets[0].bondToday = BOND_DAILY_CAP;
  c.pets[0].bond = 100;
  const r = claimBirthday(c, 'p1');
  assertEq([r.ok, r.gained, c.pets[0].bond, c.pets[0].bondToday], [true, 0, 100, BOND_DAILY_CAP], 'capped: no bond, still counts as taken');
  assertEq(claimBirthday(c, 'p1').reason, 'claimed');
  // and the birthday +1 is part of the 30, never on top of it
  const d = birthdayGame();
  d.pets[0].bondDay = key(NOON);
  d.pets[0].bondToday = BOND_DAILY_CAP - 1;
  assertEq(claimBirthday(d, 'p1').gained, 1);
  assertEq(d.pets[0].bondToday, BOND_DAILY_CAP);
  assertEq(addBond(d, 'p1', 5), 0, 'the cap is shared with every other bond source');
}));

test('birthday: a missed birthday is mentioned by the away digest, but there is no backfill gift', () => withFakeNow(NOON, () => {
  const s = birthdayGame();
  const before = new Date(2026, 9, 24, 9, 0).getTime(); // yesterday morning: pet is 29 days old
  s.lastTick = before;
  const snap = snapshotForAway(s);
  assertEq(snap.pets.p1.months, 0);
  s.lastTick = NOON + 2 * DAY; // came back two days after the birthday
  const digest = buildAwayDigest(snap, s, 3 * DAY);
  assert(digest.lines.some(l => l.petId === 'p1' && l.emoji === '🎂' && l.text.includes('1')), `digest: ${JSON.stringify(digest.lines)}`);
  assert(digest.highlights.includes('p1'));
  assertEq(claimBirthday(s, 'p1').ok, true, 'NOON is the real clock here: still the day');
  withFakeNow(NOON + 2 * DAY, () => {
    const t = birthdayGame();
    assertEq(claimBirthday(t, 'p1').reason, 'notToday', 'two days late: no gift');
    assertEq(t.pets[0].bond, 10);
  });
}));

// ---------------------------------------------------------------- weather

test('weatherAt: deterministic per hour, same for every minute of the hour, ~15 % rain, valid ranges', () => {
  const t0 = Date.UTC(2026, 9, 25, 7, 0, 0);
  const a = weatherAt(t0), b = weatherAt(t0 + 59 * 60 * 1000 + 59000);
  assertEq(a, b, 'constant within the hour');
  assertEq(weatherAt(t0), weatherAt(t0), 'pure');
  let rain = 0, cloudy = 0, sunny = 0, runs = 0, prev = '';
  const N = 24 * 400;
  for (let i = 0; i < N; i++) {
    const w = weatherAt(t0 + i * HOUR_MS);
    assert(['sunny', 'cloudy', 'rain'].includes(w.kind), 'kind');
    assert(w.intensity >= 0 && w.intensity <= 1 && (w.kind !== 'sunny' || w.intensity === 0) && (w.kind === 'sunny' || w.intensity > 0.2), `intensity ${JSON.stringify(w)}`);
    if (w.kind === 'rain') rain++; else if (w.kind === 'cloudy') cloudy++; else sunny++;
    if (w.kind !== prev) runs++;
    prev = w.kind;
  }
  assert(Math.abs(rain / N - RAIN_SHARE) < 0.03, `rain share ${(rain / N).toFixed(3)}`);
  assert(cloudy / N > 0.18 && cloudy / N < 0.32 && sunny / N > 0.5, `cloudy ${cloudy / N} sunny ${sunny / N}`);
  assert(runs > N / 4, 'the weather changes hour to hour, not in huge blocks');
  assertEq(weatherAt(NaN).kind, weatherAt(Date.now()).kind, 'junk time -> now');
});

test('weatherAt: every day has some dry hours and rain is not endless; label + nextWeatherChange make sense', () => {
  const day0 = Date.UTC(2026, 0, 1);
  let longest = 0, cur = 0;
  for (let i = 0; i < 24 * 365; i++) {
    if (weatherAt(day0 + i * HOUR_MS).kind === 'rain') { cur++; longest = Math.max(longest, cur); } else cur = 0;
  }
  assert(longest <= 8, `longest rainy spell ${longest} h`);
  for (let d = 0; d < 365; d++) assert(Array.from({ length: 24 }, (_, h) => weatherAt(day0 + (d * 24 + h) * HOUR_MS)).some(w => w.kind === 'sunny'), `day ${d} has sun`);
  assertEq(weatherLabel({ kind: 'rain' }), '🌧️ ฝนตกพรำๆ');
  assert(weatherLabel(null).includes('แดด') && weatherLabel({ kind: 'cloudy' }).includes('ครึ้ม'));
  const t = Date.UTC(2026, 9, 25, 7, 30);
  const next = nextWeatherChange(t);
  assert(next > t && next % HOUR_MS === 0 && next - t <= 25 * HOUR_MS);
});

test('bindWeather: applies now, re-applies on change, reports kind changes, stops when the world is disposed', async () => {
  const calls = [], changes = [];
  const disposers = new Set();
  const world = { setWeather: (k, i) => calls.push([k, i]), onDispose: fn => { disposers.add(fn); return () => disposers.delete(fn); } };
  let hourMs = Date.UTC(2026, 9, 25, 0, 0);
  // find an hour that rains and the next that does not
  while (weatherAt(hourMs).kind !== 'rain') hourMs += HOUR_MS;
  const stop = bindWeather(world, { clock: () => hourMs, onChange: w => changes.push(w.kind) });
  assertEq(calls.length, 1);
  assertEq(calls[0][0], 'rain');
  assertEq(changes, ['rain']);
  stop();
  assertEq(disposers.size, 0, 'unbinds itself from the world');
  const none = bindWeather({ setWeather() { throw new Error('boom'); } }, { clock: () => hourMs });
  none();
});

// ---------------------------------------------------------------- album (IndexedDB, local only)

const tinyJpeg = (w = 1600, h = 900, color = '#e08040') => {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = color; g.fillRect(0, 0, w, h);
  g.fillStyle = '#fff'; g.fillRect(w / 4, h / 4, w / 2, h / 2);
  return c.toDataURL('image/jpeg', 0.9);
};
const imgSize = url => new Promise((res, rej) => { const i = new Image(); i.onload = () => res([i.naturalWidth, i.naturalHeight]); i.onerror = rej; i.src = url; });

test('album: saves a ~960 px JPEG with metadata, lists newest first, reads it back, deletes it', async () => {
  if (!album.albumAvailable()) { console.log('PASS note: no IndexedDB, skipped'); return; }
  await album.clearAlbum();
  const r1 = await withFakeNow(1790000000000, () => album.savePhoto(tinyJpeg(), { petIds: ['p1', 'p2'], frame: 3 }));
  assert(r1.ok && r1.stored && r1.id, JSON.stringify(r1));
  assertEq([r1.meta.petIds, r1.meta.frame, r1.meta.at], [['p1', 'p2'], 3, 1790000000000]);
  assertEq([r1.meta.w, r1.meta.h], [960, 540], 'long side scaled to 960');
  assert(r1.meta.bytes > 500 && r1.meta.bytes < 400000, `bytes ${r1.meta.bytes}`);
  const r2 = await withFakeNow(1790000005000, () => album.savePhoto(tinyJpeg(300, 300, '#4080e0'), { petIds: [] }));
  assertEq([r2.meta.w, r2.meta.h], [300, 300], 'small pictures are not enlarged');
  const list = await album.listPhotos();
  assertEq(list.map(m => m.id), [r2.id, r1.id], 'newest first');
  assert(list.every(m => !('blob' in m)), 'listing carries no pictures');
  const blob = await album.getPhotoBlob(r1.id);
  assert(blob && blob.type === 'image/jpeg' && blob.size === r1.meta.bytes, 'blob round-trips');
  const url = await album.getPhotoUrl(r1.id);
  assertEq(await imgSize(url), [960, 540]);
  URL.revokeObjectURL(url);
  assertEq(await album.getPhotoBlob('nope'), null);
  assert(await album.deletePhoto(r1.id));
  assertEq((await album.listPhotos()).map(m => m.id), [r2.id]);
  assertEq(await album.getPhotoBlob(r1.id), null, 'picture gone too');
  await album.clearAlbum();
  assertEq(await album.photoCount(), 0);
});

test('album: keeps only the newest 30 photos', async () => {
  if (!album.albumAvailable()) { console.log('PASS note: no IndexedDB, skipped'); return; }
  await album.clearAlbum();
  const src = tinyJpeg(120, 80);
  const ids = [];
  for (let i = 0; i < album.ALBUM_MAX + 3; i++) {
    const r = await withFakeNow(1790000000000 + i * 1000, () => album.savePhoto(src, { petIds: [`p${i}`] }));
    assert(r.ok && r.stored, `save ${i}`);
    ids.push(r.id);
  }
  const list = await album.listPhotos();
  assertEq(list.length, album.ALBUM_MAX);
  assertEq(list[0].id, ids.at(-1), 'newest first');
  assertEq(list.at(-1).id, ids[3], 'the three oldest were dropped');
  for (const gone of ids.slice(0, 3)) assertEq(await album.getPhotoBlob(gone), null, 'their pictures were dropped too');
  await album.clearAlbum();
});

test('album: without IndexedDB the photo is offered as a download instead (no throw, nothing stored)', async () => {
  album.setAlbumBackend(null);
  const clicks = [];
  const realClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { clicks.push([this.download, this.href.slice(0, 5)]); };
  try {
    assertEq(album.albumAvailable(), false);
    const r = await withFakeNow(1790000000000, () => album.savePhoto(tinyJpeg(200, 100), { petIds: ['p1'] }));
    assertEq([r.ok, r.stored, r.fallback], [true, false, 'download']);
    assertEq(clicks.length, 1);
    assert(/^nongfarm-\d{4}-\d{2}-\d{2}-\d{4}\.jpg$/.test(clicks[0][0]) && clicks[0][1] === 'blob:', JSON.stringify(clicks));
    assertEq(await album.listPhotos(), []);
    assertEq(await album.getPhotoBlob('x'), null);
    assertEq(await album.deletePhoto('x'), false);
    const bad = await album.savePhoto('data:image/jpeg;base64,AAAA', {});
    assertEq([bad.ok, bad.stored], [false, false], 'undecodable picture: reported, not thrown');
  } finally {
    HTMLAnchorElement.prototype.click = realClick;
    album.setAlbumBackend();
  }
});

test('createNewState / save: the album and weather add nothing to the save (photos never enter state)', () => {
  const s = createNewState();
  const keys = Object.keys(s);
  assert(!keys.some(k => /photo|album|weather/i.test(k)), `unexpected keys: ${keys}`);
  assertEq([s.wardrobe, s.journal], [{}, []]);
});

test('syncJournal: 7 postcards + a user line: written once, never churns, never evicts other lines, state untouched on repeat calls', () => withFakeNow(NOON + 5 * DAY, () => {
  const s = game();
  s.postcards = Array.from({ length: 7 }, (_, i) => ({ id: `sc${i}`, petName: `ปุย${i}`, speciesId: 'cat', text: 'hi', at: NOON + 5 * DAY - HOUR_MS, read: false }));
  assert(journalEvent(s, 'firstWear', { petId: 'p1', acc: 'โบว์' }));
  const first = syncJournal(s);
  assertEq(first, 5, 'room for 5 more lines, the rest skipped');
  const snap = JSON.stringify(s);
  assertEq([syncJournal(s), syncJournal(s)], [0, 0]);
  assertEq(JSON.stringify(s), snap, 'state not dirtied');
  assert(s.journal.at(-1).lines.some(l => l.kind === 'firstWear'), 'user line survives');
  assertEq(s.journal.at(-1).lines.length, JOURNAL_LINES_MAX);
}));

test('journal: two distinct away lines about the same pet both survive', () => withFakeNow(NOON, () => {
  const s = game();
  assert(addJournal(s, { kind: 'away', petId: 'p1', text: 'หลับแล้ว' }) && addJournal(s, { kind: 'away', petId: 'p1', text: 'ตื่นแล้ว' }));
  assert(!addJournal(s, { kind: 'away', petId: 'p1', text: 'ตื่นแล้ว' }));
}));
