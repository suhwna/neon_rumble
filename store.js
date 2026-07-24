const path = require('path');
const { DatabaseSync } = require('node:sqlite');

class StatsStore {
  constructor(filename = path.join(__dirname, 'neon-rumble.sqlite')) {
    this.db = new DatabaseSync(filename);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS players (
        id TEXT PRIMARY KEY,
        nickname TEXT NOT NULL,
        matches INTEGER NOT NULL DEFAULT 0,
        wins INTEGER NOT NULL DEFAULT 0,
        kos INTEGER NOT NULL DEFAULT 0,
        falls INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS matches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_code TEXT NOT NULL,
        mode TEXT NOT NULL,
        stage_id TEXT NOT NULL,
        winner_player_id TEXT,
        duration_ticks INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS match_players (
        match_id INTEGER NOT NULL,
        player_id TEXT NOT NULL,
        character_id TEXT NOT NULL,
        placement INTEGER NOT NULL,
        kos INTEGER NOT NULL,
        falls INTEGER NOT NULL,
        score INTEGER NOT NULL,
        PRIMARY KEY (match_id, player_id)
      );
      CREATE INDEX IF NOT EXISTS idx_match_players_player ON match_players(player_id);
    `);
    this.upsertPlayer = this.db.prepare(`
      INSERT INTO players (id, nickname) VALUES (?, ?)
      ON CONFLICT(id) DO UPDATE SET nickname = excluded.nickname, updated_at = CURRENT_TIMESTAMP
    `);
    this.selectPlayer = this.db.prepare('SELECT id, nickname, matches, wins, kos, falls FROM players WHERE id = ?');
  }

  ensurePlayer(id, nickname) {
    this.upsertPlayer.run(id, nickname);
    return this.getPlayer(id);
  }

  getPlayer(id) {
    const row = this.selectPlayer.get(id);
    return row ? { ...row } : null;
  }

  recordMatch(code, world, slots) {
    const ranked = [...world.players].sort((a, b) => {
      if (a.eliminated !== b.eliminated) return a.eliminated ? 1 : -1;
      if (world.rules.mode === 'time') return b.score - a.score;
      return b.stocks - a.stocks || a.falls - b.falls;
    });
    const winner = ranked[0];
    const winnerSlot = slots.find(slot => slot.index === winner?.i);
    this.db.exec('BEGIN');
    try {
      const result = this.db.prepare(`INSERT INTO matches (room_code, mode, stage_id, winner_player_id, duration_ticks) VALUES (?, ?, ?, ?, ?)`)
        .run(code, world.rules.mode, world.rules.stageId, winnerSlot?.clientId || null, world.tick);
      const insertParticipant = this.db.prepare(`INSERT INTO match_players (match_id, player_id, character_id, placement, kos, falls, score) VALUES (?, ?, ?, ?, ?, ?, ?)`);
      const updateStats = this.db.prepare(`UPDATE players SET matches = matches + 1, wins = wins + ?, kos = kos + ?, falls = falls + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`);
      ranked.forEach((player, placement) => {
        const slot = slots.find(entry => entry.index === player.i);
        if (!slot || slot.clientId.startsWith('cpu:')) return;
        insertParticipant.run(result.lastInsertRowid, slot.clientId, player.characterId, placement + 1, player.kos, player.falls, player.score);
        updateStats.run(placement === 0 ? 1 : 0, player.kos, player.falls, slot.clientId);
      });
      this.db.exec('COMMIT');
      return Number(result.lastInsertRowid);
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  close() { this.db.close(); }
}

module.exports = { StatsStore };
