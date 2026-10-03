import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'node:path'
import log from 'electron-log'

let db: Database.Database | null = null

/** run_logs 表体：建表与外键重建共用，避免两处定义漂移 */
const RUN_LOGS_BODY = `
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      script_id INTEGER,
      level TEXT NOT NULL DEFAULT 'info',
      message TEXT NOT NULL,
      screenshot_path TEXT,
      exception_level TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (script_id) REFERENCES recorded_scripts(id) ON DELETE SET NULL
`

/** 重建 run_logs，把 script_id 的外键改指向 recorded_scripts；已失效的历史日志行置空外键 */
function repairRunLogsForeignKey(database: Database.Database) {
  const fks = database.pragma('foreign_key_list(run_logs)') as { table: string }[]
  if (!fks.some(fk => fk.table === 'task_records')) return
  database.pragma('foreign_keys = OFF')
  try {
    database.transaction(() => {
      database.exec(`
        ALTER TABLE run_logs RENAME TO run_logs_legacy;
        CREATE TABLE run_logs (${RUN_LOGS_BODY});
        INSERT INTO run_logs (id, script_id, level, message, screenshot_path, exception_level, created_at)
          SELECT id,
                 CASE WHEN script_id IN (SELECT id FROM recorded_scripts) THEN script_id END,
                 level, message, screenshot_path, exception_level, created_at
          FROM run_logs_legacy;
        DROP TABLE run_logs_legacy;
      `)
    })()
  } finally {
    // 迁移中途抛错也必须恢复外键检查，否则这个连接后续都不再受约束保护
    database.pragma('foreign_keys = ON')
  }
  log.info('数据库迁移: run_logs 外键已改指向 recorded_scripts')
}

/** 数据库初始化 - 建表 */
export function initDatabase() {
  if (db) return
  const dbPath = join(app.getPath('userData'), 'auto-shoping.db')
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  // SQLite 每个连接默认 foreign_keys = OFF。显式打开，外键行为才不依赖「这台机器是否跑过修复迁移」
  db.pragma('foreign_keys = ON')

  // 录制脚本表
  db.exec(`
    CREATE TABLE IF NOT EXISTS recorded_scripts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      target_url TEXT NOT NULL,
      steps_json TEXT NOT NULL DEFAULT '[]',
      data_json TEXT NOT NULL DEFAULT '',
      monitor_json TEXT NOT NULL DEFAULT '',
      run_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    )
  `)

  // 运行日志表
  db.exec(`CREATE TABLE IF NOT EXISTS run_logs (${RUN_LOGS_BODY})`)

  // 迁移：老库缺新增列时补上，旧脚本按「无数据 / 无监控」执行
  const scriptColumns = db.pragma('table_info(recorded_scripts)') as { name: string }[]
  for (const column of ['data_json', 'monitor_json']) {
    if (!scriptColumns.some(c => c.name === column)) {
      db.exec(`ALTER TABLE recorded_scripts ADD COLUMN ${column} TEXT NOT NULL DEFAULT ''`)
      log.info(`数据库迁移: recorded_scripts 新增 ${column}`)
    }
  }

  // 迁移：旧版 task_id → script_id
  const columns = db.pragma('table_info(run_logs)') as { name: string }[]
  const hasTaskId = columns.some(c => c.name === 'task_id')
  const hasScriptId = columns.some(c => c.name === 'script_id')
  if (hasTaskId && !hasScriptId) {
    db.exec(`ALTER TABLE run_logs RENAME COLUMN task_id TO script_id`)
    log.info('数据库迁移: task_id → script_id 完成')
  }

  // 迁移：RENAME COLUMN 不会改写外键，老库的 script_id 仍指向已废弃的 task_records，
  // 导致写脚本日志必然 FOREIGN KEY constraint failed，并连带打断执行完成通知。
  repairRunLogsForeignKey(db)

  // 启动自愈：进程刚起来时不可能有脚本在执行，清掉上次异常退出残留的「运行中」，
  // 否则脚本管理页会一直显示运行中且执行按钮禁用
  const stale = db.prepare(`UPDATE recorded_scripts SET status = 'ready' WHERE status = 'running'`).run()
  if (stale.changes > 0) log.info(`数据库迁移: 复位 ${stale.changes} 个残留的运行中状态`)

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
