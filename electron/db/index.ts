import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'node:path'
import log from 'electron-log'

let db: Database.Database | null = null

/** 数据库初始化 - 建表 */
export function initDatabase() {
  if (db) return
  const dbPath = join(app.getPath('userData'), 'auto-shoping.db')
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')

  // 录制脚本表
  db.exec(`
    CREATE TABLE IF NOT EXISTS recorded_scripts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      target_url TEXT NOT NULL,
      steps_json TEXT NOT NULL DEFAULT '[]',
      run_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    )
  `)

  // 运行日志表
  db.exec(`
    CREATE TABLE IF NOT EXISTS run_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      script_id INTEGER,
      level TEXT NOT NULL DEFAULT 'info',
      message TEXT NOT NULL,
      screenshot_path TEXT,
      exception_level TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (script_id) REFERENCES recorded_scripts(id) ON DELETE SET NULL
    )
  `)

  // 迁移：旧版 task_id → script_id
  const columns = db.pragma('table_info(run_logs)') as { name: string }[]
  const hasTaskId = columns.some(c => c.name === 'task_id')
  const hasScriptId = columns.some(c => c.name === 'script_id')
  if (hasTaskId && !hasScriptId) {
    db.exec(`ALTER TABLE run_logs RENAME COLUMN task_id TO script_id`)
    log.info('数据库迁移: task_id → script_id 完成')
  }

  // 索引
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_scripts_status ON recorded_scripts(status);
    CREATE INDEX IF NOT EXISTS idx_scripts_created ON recorded_scripts(created_at);
    CREATE INDEX IF NOT EXISTS idx_logs_script ON run_logs(script_id);
    CREATE INDEX IF NOT EXISTS idx_logs_level ON run_logs(level);
  `)

  log.info('数据库初始化完成')
}

export function getDb(): Database.Database {
  if (!db) throw new Error('数据库未初始化')
  return db
}

export function closeDatabase() {
  if (db) {
    db.close()
    db = null
    log.info('数据库已关闭')
  }
}
