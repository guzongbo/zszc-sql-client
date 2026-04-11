import { useEffect, useState } from 'react'
import { getHostBootstrap, invokeHostMethod, type HostBootstrap } from './hostBridge'

type DecryptResponse = {
  plain_text: string
}

type EncryptDbResponse = {
  encrypted_text: string
}

export default function App() {
  const [bootstrap, setBootstrap] = useState<HostBootstrap | null>(null)
  const [encryptedText, setEncryptedText] = useState('')
  const [replaceUnderscore, setReplaceUnderscore] = useState(true)
  const [decryptResult, setDecryptResult] = useState('')
  const [decryptStatus, setDecryptStatus] = useState('等待输入')
  const [decryptError, setDecryptError] = useState('')
  const [decryptLoading, setDecryptLoading] = useState(false)

  const [plainText, setPlainText] = useState('')
  const [encryptResult, setEncryptResult] = useState('')
  const [encryptStatus, setEncryptStatus] = useState('等待输入')
  const [encryptError, setEncryptError] = useState('')
  const [encryptLoading, setEncryptLoading] = useState(false)

  useEffect(() => {
    let mounted = true

    void getHostBootstrap().then((payload) => {
      if (mounted) {
        setBootstrap(payload)
      }
    })

    return () => {
      mounted = false
    }
  }, [])

  async function handleDecrypt() {
    if (!encryptedText.trim()) {
      setDecryptError('请先输入加密数据')
      setDecryptStatus('校验失败')
      return
    }

    setDecryptLoading(true)
    setDecryptError('')
    setDecryptStatus('正在解密...')
    try {
      const response = await invokeHostMethod<DecryptResponse>('password.decrypt', {
        encrypted_text: encryptedText.trim(),
        replace_underscore: replaceUnderscore,
      })
      setDecryptResult(response.plain_text)
      setDecryptStatus('解密成功')
    } catch (error) {
      setDecryptError(error instanceof Error ? error.message : '解密失败')
      setDecryptStatus('解密失败')
    } finally {
      setDecryptLoading(false)
    }
  }

  async function handleEncryptDb() {
    if (!plainText.trim()) {
      setEncryptError('请先输入明文')
      setEncryptStatus('校验失败')
      return
    }

    setEncryptLoading(true)
    setEncryptError('')
    setEncryptStatus('正在生成数据库密文...')
    try {
      const response = await invokeHostMethod<EncryptDbResponse>('password.encrypt_db', {
        plain_text: plainText,
      })
      setEncryptResult(response.encrypted_text)
      setEncryptStatus('生成成功')
    } catch (error) {
      setEncryptError(error instanceof Error ? error.message : '生成失败')
      setEncryptStatus('生成失败')
    } finally {
      setEncryptLoading(false)
    }
  }

  async function copyText(value: string, emptyMessage: string, successSetter: (value: string) => void) {
    if (!value.trim()) {
      successSetter(emptyMessage)
      return
    }

    try {
      await navigator.clipboard.writeText(value)
      successSetter('已复制到剪贴板')
    } catch {
      successSetter('复制失败，请检查系统剪贴板权限')
    }
  }

  return (
    <div className="page-shell">
      <div className="ambient ambient-left"></div>
      <div className="ambient ambient-right"></div>

      <main className="tool-grid">
        <section className="glass-card panel">
          <div className="panel-head">
            <div>
              <span className="panel-kicker">功能一</span>
              <h2>密文解密</h2>
            </div>
            <span className="badge badge-soft">RSA 私钥解密</span>
          </div>

          <label className="field">
            <div className="field-head">
              <span className="field-title">加密数据</span>
              <span className="field-extra">
                <label className="toggle-inline">
                  <input
                    checked={replaceUnderscore}
                    type="checkbox"
                    onChange={(event) => setReplaceUnderscore(event.target.checked)}
                  />
                  <span>将 "_" 替换为 "+"</span>
                </label>
              </span>
            </div>
            <textarea
              className="editor-textarea"
              placeholder="请输入加密数据"
              value={encryptedText}
              onChange={(event) => setEncryptedText(event.target.value)}
            />
          </label>

          <div className="action-row">
            <button className="primary-btn" disabled={decryptLoading} type="button" onClick={() => void handleDecrypt()}>
              {decryptLoading ? '解密中...' : '执行解密'}
            </button>
            <button
              className="secondary-btn"
              type="button"
              onClick={() => {
                setEncryptedText('')
                setDecryptResult('')
                setDecryptStatus('已清空')
                setDecryptError('')
              }}
            >
              清空
            </button>
            <button
              className="secondary-btn"
              type="button"
              onClick={() => void copyText(decryptResult, '暂无可复制内容', setDecryptStatus)}
            >
              复制结果
            </button>
          </div>

          <div aria-live="polite" className="feedback-stack">
            <p className="status-line">{decryptStatus}</p>
            <p className={`error-line ${decryptError ? '' : 'is-empty'}`}>
              {decryptError || '占位'}
            </p>
          </div>

          <label className="field result-field">
            <div className="field-head">
              <span className="field-title">解密结果</span>
            </div>
            <textarea className="result-textarea" readOnly value={decryptResult} />
          </label>
        </section>

        <section className="glass-card panel">
          <div className="panel-head">
            <div>
              <span className="panel-kicker">功能二</span>
              <h2>明文转数据库密文</h2>
            </div>
            <span className="badge badge-strong">BCrypt + 前缀</span>
          </div>

          <label className="field">
            <div className="field-head">
              <span className="field-title">明文密码</span>
            </div>
            <textarea
              className="editor-textarea"
              placeholder="请输入明文"
              value={plainText}
              onChange={(event) => setPlainText(event.target.value)}
            />
          </label>

          <div className="action-row">
            <button className="primary-btn" disabled={encryptLoading} type="button" onClick={() => void handleEncryptDb()}>
              {encryptLoading ? '生成中...' : '生成数据库密文'}
            </button>
            <button
              className="secondary-btn"
              type="button"
              onClick={() => {
                setPlainText('')
                setEncryptResult('')
                setEncryptStatus('已清空')
                setEncryptError('')
              }}
            >
              清空
            </button>
            <button
              className="secondary-btn"
              type="button"
              onClick={() => void copyText(encryptResult, '暂无可复制内容', setEncryptStatus)}
            >
              复制结果
            </button>
          </div>

          <div aria-live="polite" className="feedback-stack">
            <p className="status-line">{encryptStatus}</p>
            <p className={`error-line ${encryptError ? '' : 'is-empty'}`}>
              {encryptError || '占位'}
            </p>
          </div>

          <label className="field result-field">
            <div className="field-head">
              <span className="field-title">数据库密文</span>
            </div>
            <textarea className="result-textarea" readOnly value={encryptResult} />
          </label>
        </section>
      </main>

      <footer className="page-meta-strip">
        <span>power by wx_guzb_7558</span>
        <span>
          {bootstrap
            ? `插件版本 ${bootstrap.plugin_version} · ${bootstrap.current_platform}`
            : '插件信息读取中'}
        </span>
      </footer>
    </div>
  )
}
