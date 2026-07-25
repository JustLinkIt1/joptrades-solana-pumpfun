// Dead-simple JSON-file position + daily-spend store. Survives restarts.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(dir, '..', 'positions.json');

function load() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); }
  catch { return { positions: {}, spend: {} }; }
}
function save(state) {
  fs.writeFileSync(FILE, JSON.stringify(state, null, 2));
}

const todayKey = () => new Date().toISOString().slice(0, 10); // UTC yyyy-mm-dd

export const store = {
  open() {
    return Object.values(load().positions);
  },
  openCount() {
    return Object.keys(load().positions).length;
  },
  get(mint) {
    return load().positions[mint];
  },
  add(mint, pos) {
    const s = load();
    s.positions[mint] = { mint, ...pos, openedAt: Date.now() };
    save(s);
  },
  remove(mint) {
    const s = load();
    delete s.positions[mint];
    save(s);
  },
  spentToday() {
    return load().spend[todayKey()] || 0;
  },
  recordSpend(sol) {
    const s = load();
    const k = todayKey();
    s.spend[k] = (s.spend[k] || 0) + sol;
    save(s);
  },
};
