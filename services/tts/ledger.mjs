import { DatabaseSync } from 'node:sqlite';

export function period(date = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit' }).format(date);
}
export class UsageLedger {
  constructor(path, clock = () => new Date()) {
    this.clock = clock;
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY, segment TEXT, period TEXT, engine TEXT, characters INTEGER, voice TEXT, state TEXT, requested TEXT, firstAudio TEXT, completed TEXT, mode TEXT);
      CREATE TABLE IF NOT EXISTS warnings(period TEXT, level INTEGER, PRIMARY KEY(period, level));
      CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE IF NOT EXISTS segments(id TEXT PRIMARY KEY, created TEXT);`);
    // A terminated process may have submitted a request; preserve that estimate.
    this.db.exec("UPDATE requests SET state='uncertain' WHERE state='submitted'");
  }
  settings() { return Object.fromEntries(this.db.prepare('SELECT key,value FROM settings').all().map(r => [r.key, JSON.parse(r.value)])); }
  configure(settings) { const stmt = this.db.prepare('INSERT OR REPLACE INTO settings VALUES (?,?)'); for (const [k,v] of Object.entries(settings)) stmt.run(k, JSON.stringify(v)); }
  usage() {
    const billingPeriod = period(this.clock());
    const rows = this.db.prepare("SELECT engine,SUM(characters) AS n,MAX(requested) AS updated FROM requests WHERE period=? AND state IN ('submitted','success','partial','uncertain') GROUP BY engine").all(billingPeriod);
    return { billingPeriod, googleChirpCharacters: Number(rows.find(r => r.engine === 'chirp')?.n ?? 0), googleWaveNetCharacters: Number(rows.find(r => r.engine === 'wavenet')?.n ?? 0), lastUpdated: rows.map(r => r.updated).sort().at(-1) ?? null };
  }
  claim(segment) { return this.db.prepare('INSERT OR IGNORE INTO segments VALUES (?,?)').run(segment, this.clock().toISOString()).changes > 0; }
  submit(id, segment, engine, text, voice, mode) {
    this.db.prepare('INSERT INTO requests(id,segment,period,engine,characters,voice,state,requested,mode) VALUES (?,?,?,?,?,?,?,?,?)').run(id, segment, period(this.clock()), engine, [...text].length, voice, 'submitted', this.clock().toISOString(), mode);
  }
  audio(id) { this.db.prepare('UPDATE requests SET firstAudio=COALESCE(firstAudio,?) WHERE id=?').run(this.clock().toISOString(), id); }
  finish(id, state) { this.db.prepare('UPDATE requests SET state=?,completed=? WHERE id=?').run(state, this.clock().toISOString(), id); }
  warnings(threshold) {
    const u = this.usage(); const levels = [];
    for (const level of [80,90,100]) if (u.googleChirpCharacters >= threshold * level / 100 && this.db.prepare('INSERT OR IGNORE INTO warnings VALUES (?,?)').run(u.billingPeriod, level).changes) levels.push(level);
    return levels;
  }
  close() { this.db.close(); }
}
