import { useEffect, useState } from 'react'
import './App.css'

type DesktopOverview = {
  app_name: string
  storage_engine: string
  app_data_dir: string
  default_database: string
}

function App() {
  const [desktopOverview, setDesktopOverview] = useState<DesktopOverview | null>(
    null,
  )
  const [desktopError, setDesktopError] = useState('')

  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) {
      return
    }

    let cancelled = false

    async function loadDesktopOverview() {
      try {
        const { invoke } = await import('@tauri-apps/api/core')
        const overview = await invoke<DesktopOverview>('app_overview')

        if (!cancelled) {
          setDesktopOverview(overview)
        }
      } catch (error) {
        if (!cancelled) {
          setDesktopError(
            error instanceof Error ? error.message : '桌面端初始化信息读取失败',
          )
        }
      }
    }

    void loadDesktopOverview()

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <main className="page-shell">
      <section className="hero-panel">
        <div className="hero-copy glass-panel">
          <span className="eyebrow">Desktop MySQL Client Bootstrap</span>
          <h1>ZSZC SQL Client</h1>
          <p className="hero-text">
            使用 Rust、React、Tauri 与 SQLite 初始化的纯桌面端骨架，业务能力直接由
            Tauri command 与本地 SQLite 提供，后续将按 Calicat 原型继续落地连接管理、
            SQL 编辑器与结果视图。
          </p>

          <div className="stack-list">
            <span>Rust</span>
            <span>React</span>
            <span>Tauri</span>
            <span>SQLite</span>
          </div>

          <div className="hero-actions">
            <div className="primary-action">纯 Tauri + React + SQLite</div>
            <div className="secondary-action">等待 Calicat 原型接入</div>
          </div>

          <div className="signature-chip">power by wx_guzb_7558</div>
        </div>

        <aside className="hero-side glass-panel">
          <div className="status-head">
            <span className="status-dot" />
            <strong>桌面端状态</strong>
          </div>

          {desktopOverview ? (
            <dl className="status-grid">
              <div>
                <dt>应用名称</dt>
                <dd>{desktopOverview.app_name}</dd>
              </div>
              <div>
                <dt>本地存储</dt>
                <dd>{desktopOverview.storage_engine}</dd>
              </div>
              <div>
                <dt>数据目录</dt>
                <dd>{desktopOverview.app_data_dir}</dd>
              </div>
              <div>
                <dt>默认数据库</dt>
                <dd>{desktopOverview.default_database}</dd>
              </div>
            </dl>
          ) : (
            <div className="status-placeholder">
              <p>
                当前是 Web 预览模式，桌面端启动后会在这里显示本地 SQLite
                初始化结果。
              </p>
              {desktopError ? <p className="status-error">{desktopError}</p> : null}
            </div>
          )}
        </aside>
      </section>

      <section className="feature-grid">
        <article className="feature-card glass-panel">
          <span className="feature-index">01</span>
          <h2>Connection Hub</h2>
          <p>统一管理 MySQL 连接、收藏、最近访问实例，并通过桌面端 Rust 能力直接执行连接测试。</p>
        </article>

        <article className="feature-card glass-panel">
          <span className="feature-index">02</span>
          <h2>SQL Workspace</h2>
          <p>承载 SQL 编辑、执行结果、分页网格和草稿缓存，后续根据原型补全交互节奏。</p>
        </article>

        <article className="feature-card glass-panel">
          <span className="feature-index">03</span>
          <h2>Local Memory</h2>
          <p>本地 SQLite 负责保存连接配置、查询历史和偏好设置，不直接替代目标数据库。</p>
        </article>
      </section>
    </main>
  )
}

export default App
