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

  // 商品模板表
  db.exec(`
    CREATE TABLE IF NOT EXISTS product_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      unit TEXT NOT NULL DEFAULT '万金',
      unit_price REAL NOT NULL DEFAULT 0,
      publish_count INTEGER NOT NULL DEFAULT 1,
      contact_mode INTEGER NOT NULL DEFAULT 1,
      phone TEXT,
      compensation_type TEXT NOT NULL DEFAULT '不包赔',
      trade_time_range TEXT NOT NULL DEFAULT '全天',
      fund_settlement TEXT NOT NULL DEFAULT '平台代收',
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    )
  `)

  // 任务记录表
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER NOT NULL,
      product_name TEXT NOT NULL,
      spec TEXT NOT NULL,
      unit_price REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      progress INTEGER NOT NULL DEFAULT 0,
      current_step TEXT,
      params_snapshot TEXT NOT NULL,
      fail_reason TEXT,
      result_screenshot TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      completed_at TEXT,
      FOREIGN KEY (template_id) REFERENCES product_templates(id)
    )
  `)

  // 运行日志表
  db.exec(`
    CREATE TABLE IF NOT EXISTS run_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER,
      level TEXT NOT NULL DEFAULT 'info',
      message TEXT NOT NULL,
      screenshot_path TEXT,
      exception_level TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (task_id) REFERENCES task_records(id) ON DELETE SET NULL
    )
  `)

  // 索引
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON task_records(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_created ON task_records(created_at);
    CREATE INDEX IF NOT EXISTS idx_logs_task ON run_logs(task_id);
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
