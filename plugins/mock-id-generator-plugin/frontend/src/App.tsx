import { useEffect, useState } from 'react'
import { getHostBootstrap, invokeHostMethod, type HostBootstrap } from './hostBridge'

type WorkspaceMode = 'profile' | 'password'
type PasswordTab = 'password' | 'passphrase' | 'username'

type RandomProfileResponse = {
  name: string
  uscc: string
  id_card: string
  bank_card: string
  mobile: string
  email: string
  address: string
}

type GeneratedTextResponse = {
  value: string
  strength_label?: string
  helper_text?: string
}

type ProfileField = {
  key: keyof RandomProfileResponse
  label: string
  helper: string
}

type PasswordFormState = {
  length: number
  include_uppercase: boolean
  include_lowercase: boolean
  include_numbers: boolean
  include_symbols: boolean
  min_numbers: number
  min_symbols: number
  avoid_ambiguous: boolean
}

type PassphraseFormState = {
  word_count: number
  separator: string
  capitalize_words: boolean
  append_number: boolean
}

type UsernameStyle = 'word_combo' | 'pinyin_style' | 'tech_style'

type UsernameFormState = {
  length: number
  separator: string
  append_number: boolean
  avoid_ambiguous: boolean
  style: UsernameStyle
}

const PROFILE_FIELDS: ProfileField[] = [
  { key: 'name', label: '姓名', helper: '中文随机姓名' },
  { key: 'uscc', label: '统一社会信用代码', helper: '18 位，含校验位' },
  { key: 'id_card', label: '身份证号', helper: '18 位，含校验位' },
  { key: 'bank_card', label: '银行卡号', helper: '16-19 位，Luhn 校验' },
  { key: 'mobile', label: '手机号', helper: '中国大陆号段' },
  { key: 'email', label: '邮箱地址', helper: '随机邮箱' },
  { key: 'address', label: '住址', helper: '省市区 + 路名 + 门牌号' },
]

const DEFAULT_PASSWORD_FORM: PasswordFormState = {
  length: 14,
  include_uppercase: true,
  include_lowercase: true,
  include_numbers: true,
  include_symbols: true,
  min_numbers: 1,
  min_symbols: 1,
  avoid_ambiguous: false,
}

const DEFAULT_PASSPHRASE_FORM: PassphraseFormState = {
  word_count: 4,
  separator: '-',
  capitalize_words: true,
  append_number: false,
}

const DEFAULT_USERNAME_FORM: UsernameFormState = {
  length: 12,
  separator: '',
  append_number: true,
  avoid_ambiguous: false,
  style: 'word_combo',
}

const PASSWORD_TAB_LABELS: Record<PasswordTab, string> = {
  password: '密码',
  passphrase: '密码短语',
  username: '用户名',
}

const USERNAME_STYLE_OPTIONS: Array<{ label: string; value: UsernameStyle }> = [
  { label: '英文组合', value: 'word_combo' },
  { label: '拼音风格', value: 'pinyin_style' },
  { label: '技术风格', value: 'tech_style' },
]

const SEPARATOR_OPTIONS: Array<{ label: string; value: string }> = [
  { label: '无', value: '' },
  { label: '-', value: '-' },
  { label: '_', value: '_' },
  { label: '.', value: '.' },
  { label: '空格', value: ' ' },
]

export default function App() {
  const [bootstrap, setBootstrap] = useState<HostBootstrap | null>(null)
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('profile')

  const [profileData, setProfileData] = useState<RandomProfileResponse | null>(null)
  const [profileLoading, setProfileLoading] = useState(false)
  const [profileError, setProfileError] = useState('')
  const [profileUpdatedAt, setProfileUpdatedAt] = useState('')
  const [copiedProfileKey, setCopiedProfileKey] = useState('')
  const [copiedAll, setCopiedAll] = useState(false)

  const [passwordTab, setPasswordTab] = useState<PasswordTab>('password')
  const [passwordForm, setPasswordForm] = useState(DEFAULT_PASSWORD_FORM)
  const [passphraseForm, setPassphraseForm] = useState(DEFAULT_PASSPHRASE_FORM)
  const [usernameForm, setUsernameForm] = useState(DEFAULT_USERNAME_FORM)

  const [passwordResult, setPasswordResult] = useState<GeneratedTextResponse | null>(null)
  const [passphraseResult, setPassphraseResult] = useState<GeneratedTextResponse | null>(null)
  const [usernameResult, setUsernameResult] = useState<GeneratedTextResponse | null>(null)

  const [passwordLoading, setPasswordLoading] = useState(false)
  const [passphraseLoading, setPassphraseLoading] = useState(false)
  const [usernameLoading, setUsernameLoading] = useState(false)

  const [passwordError, setPasswordError] = useState('')
  const [passphraseError, setPassphraseError] = useState('')
  const [usernameError, setUsernameError] = useState('')
  const [copiedGeneratorTab, setCopiedGeneratorTab] = useState('')

  useEffect(() => {
    let mounted = true

    void getHostBootstrap().then((payload) => {
      if (mounted) {
        setBootstrap(payload)
      }
    })

    void handleGenerateProfile()

    return () => {
      mounted = false
    }
  }, [])

  async function handleGenerateProfile() {
    setProfileLoading(true)
    setProfileError('')
    try {
      const result = await invokeHostMethod<RandomProfileResponse>('mock.generate_profile', {})
      setProfileData(result)
      setProfileUpdatedAt(new Date().toLocaleString('zh-CN'))
      setCopiedProfileKey('')
      setCopiedAll(false)
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : '随机信息生成失败')
    } finally {
      setProfileLoading(false)
    }
  }

  async function handleGeneratePassword() {
    setPasswordLoading(true)
    setPasswordError('')
    try {
      const result = await invokeHostMethod<GeneratedTextResponse>('password.generate', passwordForm)
      setPasswordResult(result)
      setCopiedGeneratorTab('')
    } catch (error) {
      setPasswordError(error instanceof Error ? error.message : '密码生成失败')
    } finally {
      setPasswordLoading(false)
    }
  }

  async function handleGeneratePassphrase() {
    setPassphraseLoading(true)
    setPassphraseError('')
    try {
      const result = await invokeHostMethod<GeneratedTextResponse>(
        'password.generate_passphrase',
        passphraseForm,
      )
      setPassphraseResult(result)
      setCopiedGeneratorTab('')
    } catch (error) {
      setPassphraseError(error instanceof Error ? error.message : '密码短语生成失败')
    } finally {
      setPassphraseLoading(false)
    }
  }

  async function handleGenerateUsername() {
    setUsernameLoading(true)
    setUsernameError('')
    try {
      const result = await invokeHostMethod<GeneratedTextResponse>(
        'password.generate_username',
        usernameForm,
      )
      setUsernameResult(result)
      setCopiedGeneratorTab('')
    } catch (error) {
      setUsernameError(error instanceof Error ? error.message : '用户名生成失败')
    } finally {
      setUsernameLoading(false)
    }
  }

  function ensureGeneratorResult(tab: PasswordTab) {
    if (tab === 'password' && !passwordResult && !passwordLoading) {
      void handleGeneratePassword()
      return
    }

    if (tab === 'passphrase' && !passphraseResult && !passphraseLoading) {
      void handleGeneratePassphrase()
      return
    }

    if (tab === 'username' && !usernameResult && !usernameLoading) {
      void handleGenerateUsername()
    }
  }

  function handleWorkspaceSwitch(nextMode: WorkspaceMode) {
    setWorkspaceMode(nextMode)
    if (nextMode === 'password') {
      ensureGeneratorResult(passwordTab)
    }
  }

  function handlePasswordTabSwitch(nextTab: PasswordTab) {
    setPasswordTab(nextTab)
    ensureGeneratorResult(nextTab)
  }

  async function copyText(value: string, token: string, onEmpty?: () => void) {
    if (!value.trim()) {
      onEmpty?.()
      return
    }

    try {
      await navigator.clipboard.writeText(value)
      setCopiedGeneratorTab(token)
      window.setTimeout(() => {
        setCopiedGeneratorTab((current) => (current === token ? '' : current))
      }, 1200)
    } catch {
      if (token === 'password') {
        setPasswordError('复制失败，请检查剪贴板权限')
      } else if (token === 'passphrase') {
        setPassphraseError('复制失败，请检查剪贴板权限')
      } else if (token === 'username') {
        setUsernameError('复制失败，请检查剪贴板权限')
      }
    }
  }

  async function copyProfileField(key: keyof RandomProfileResponse, value: string) {
    if (!value.trim()) {
      return
    }

    try {
      await navigator.clipboard.writeText(value)
      setCopiedProfileKey(String(key))
      window.setTimeout(() => {
        setCopiedProfileKey((current) => (current === key ? '' : current))
      }, 1200)
    } catch {
      setProfileError('复制失败，请检查剪贴板权限')
    }
  }

  async function copyAllProfile() {
    if (!profileData) {
      return
    }

    const content = PROFILE_FIELDS.map(
      (item) => `${item.label}：${profileData[item.key]}`,
    ).join('\n')

    try {
      await navigator.clipboard.writeText(content)
      setCopiedAll(true)
      window.setTimeout(() => {
        setCopiedAll(false)
      }, 1200)
    } catch {
      setProfileError('复制失败，请检查剪贴板权限')
    }
  }

  const activeGeneratedResult =
    passwordTab === 'password'
      ? passwordResult
      : passwordTab === 'passphrase'
        ? passphraseResult
        : usernameResult

  const activeGeneratedLoading =
    passwordTab === 'password'
      ? passwordLoading
      : passwordTab === 'passphrase'
        ? passphraseLoading
        : usernameLoading

  const activeGeneratedError =
    passwordTab === 'password'
      ? passwordError
      : passwordTab === 'passphrase'
        ? passphraseError
        : usernameError

  const activeResultMeta = copiedGeneratorTab === passwordTab
    ? '已复制到剪贴板'
    : [activeGeneratedResult?.strength_label, activeGeneratedResult?.helper_text]
        .filter(Boolean)
        .join(' · ') || '调整下方选项后可重新生成'
  const heroTitle = workspaceMode === 'profile' ? '随机信息生成' : '密码工具'
  const heroSummary = workspaceMode === 'profile'
    ? '一次产出常用的中国大陆模拟数据，适合界面联调、表单填充、联机演示。'
    : '生成密码、密码短语或用户名，支持长度、字符类型、最少个数和易混淆字符控制。'

  return (
    <div className="page-shell">
      <div className="ambient ambient-left"></div>
      <div className="ambient ambient-right"></div>
      <div className="ambient ambient-bottom"></div>

      <header className="glass-card hero-card">
        <div className="hero-copy">
          <h1>{heroTitle}</h1>
          <p className="hero-summary">{heroSummary}</p>
        </div>

        <div className="hero-side">
          <div className="workspace-switch">
            <button
              className={workspaceMode === 'profile' ? 'is-active' : ''}
              type="button"
              onClick={() => handleWorkspaceSwitch('profile')}
            >
              随机信息
            </button>
            <button
              className={workspaceMode === 'password' ? 'is-active' : ''}
              type="button"
              onClick={() => handleWorkspaceSwitch('password')}
            >
              密码工具
            </button>
          </div>

          {workspaceMode === 'profile' ? (
            <div className="hero-action-panel">
              <div className="profile-meta-panel">
                <span>更新时间</span>
                <strong>{profileUpdatedAt || '等待首次生成'}</strong>
              </div>
              <div className="action-row">
                <button
                  className="primary-btn"
                  disabled={profileLoading}
                  type="button"
                  onClick={() => void handleGenerateProfile()}
                >
                  {profileLoading ? '生成中...' : '换一组'}
                </button>
                <button
                  className="secondary-btn"
                  disabled={!profileData}
                  type="button"
                  onClick={() => void copyAllProfile()}
                >
                  {copiedAll ? '已复制' : '复制全部'}
                </button>
              </div>
              {profileError ? <p className="error-line">{profileError}</p> : null}
            </div>
          ) : (
            <div className="hero-meta">
              <span>当前类型 {PASSWORD_TAB_LABELS[passwordTab]}</span>
              <span>{bootstrap ? `插件版本 ${bootstrap.plugin_version}` : '插件信息读取中'}</span>
            </div>
          )}
        </div>
      </header>

      <main className="workspace-body">
        {workspaceMode === 'profile' ? (
          <section className="profile-layout">
            <div className="profile-grid">
              {PROFILE_FIELDS.map((field) => {
                const value = profileData?.[field.key] ?? '等待生成'

                return (
                  <article className="glass-card profile-card" key={field.key}>
                    <div className="profile-card-head">
                      <div>
                        <h3>{field.label}</h3>
                        <span>{field.helper}</span>
                      </div>
                      <button
                        className="ghost-btn"
                        disabled={!profileData}
                        type="button"
                        onClick={() => void copyProfileField(field.key, value)}
                      >
                        {copiedProfileKey === field.key ? '已复制' : '复制'}
                      </button>
                    </div>
                    <div className="profile-value">{value}</div>
                  </article>
                )
              })}
            </div>
          </section>
        ) : (
          <section className="password-layout">
            <div className="tool-switch">
              {(['password', 'passphrase', 'username'] as PasswordTab[]).map((tab) => (
                <button
                  key={tab}
                  className={passwordTab === tab ? 'is-active' : ''}
                  type="button"
                  onClick={() => handlePasswordTabSwitch(tab)}
                >
                  {PASSWORD_TAB_LABELS[tab]}
                </button>
              ))}
            </div>

            <article className="glass-card result-card">
              <div className="result-card-body">
                <div>
                  <div className="result-value">
                    {activeGeneratedResult?.value || (activeGeneratedLoading ? '生成中...' : '等待生成')}
                  </div>
                  <p className="result-meta">{activeResultMeta}</p>
                </div>

                <div className="result-actions">
                  <button
                    className="icon-btn"
                    disabled={activeGeneratedLoading}
                    type="button"
                    onClick={() => {
                      if (passwordTab === 'password') {
                        void handleGeneratePassword()
                      } else if (passwordTab === 'passphrase') {
                        void handleGeneratePassphrase()
                      } else {
                        void handleGenerateUsername()
                      }
                    }}
                  >
                    <RefreshIcon />
                    <span className="sr-only">重新生成</span>
                  </button>
                  <button
                    className="icon-btn"
                    disabled={!activeGeneratedResult?.value}
                    type="button"
                    onClick={() => void copyText(activeGeneratedResult?.value ?? '', passwordTab)}
                  >
                    <CopyIcon />
                    <span className="sr-only">复制结果</span>
                  </button>
                </div>
              </div>

              {activeGeneratedError ? <p className="error-line inline-error">{activeGeneratedError}</p> : null}
            </article>

            {passwordTab === 'password' ? (
              <>
                <section className="glass-card option-card">
                  <div className="option-card-head">
                    <h3>选项</h3>
                  </div>

                  <label className="input-shell">
                    <span>长度</span>
                    <input
                      max={128}
                      min={5}
                      type="number"
                      value={passwordForm.length}
                      onChange={(event) =>
                        setPasswordForm((current) => ({
                          ...current,
                          length: Number(event.target.value) || 0,
                        }))
                      }
                    />
                  </label>
                  <p className="field-note">值必须在 5 和 128 之间。使用 14 个或更多字符生成更强的密码。</p>
                </section>

                <section className="glass-card option-card">
                  <div className="option-card-head">
                    <h3>包含</h3>
                  </div>

                  <div className="checkbox-grid">
                    <label className="check-pill">
                      <input
                        checked={passwordForm.include_uppercase}
                        type="checkbox"
                        onChange={(event) =>
                          setPasswordForm((current) => ({
                            ...current,
                            include_uppercase: event.target.checked,
                          }))
                        }
                      />
                      <span>A-Z</span>
                    </label>
                    <label className="check-pill">
                      <input
                        checked={passwordForm.include_lowercase}
                        type="checkbox"
                        onChange={(event) =>
                          setPasswordForm((current) => ({
                            ...current,
                            include_lowercase: event.target.checked,
                          }))
                        }
                      />
                      <span>a-z</span>
                    </label>
                    <label className="check-pill">
                      <input
                        checked={passwordForm.include_numbers}
                        type="checkbox"
                        onChange={(event) =>
                          setPasswordForm((current) => ({
                            ...current,
                            include_numbers: event.target.checked,
                            min_numbers: event.target.checked
                              ? Math.max(current.min_numbers, 1)
                              : 0,
                          }))
                        }
                      />
                      <span>0-9</span>
                    </label>
                    <label className="check-pill">
                      <input
                        checked={passwordForm.include_symbols}
                        type="checkbox"
                        onChange={(event) =>
                          setPasswordForm((current) => ({
                            ...current,
                            include_symbols: event.target.checked,
                            min_symbols: event.target.checked
                              ? Math.max(current.min_symbols, 1)
                              : 0,
                          }))
                        }
                      />
                      <span>!@#$%^&*</span>
                    </label>
                  </div>

                  <div className="inline-field-grid">
                    <label className="input-shell">
                      <span>数字最少个数</span>
                      <input
                        disabled={!passwordForm.include_numbers}
                        min={0}
                        type="number"
                        value={passwordForm.min_numbers}
                        onChange={(event) =>
                          setPasswordForm((current) => ({
                            ...current,
                            min_numbers: Number(event.target.value) || 0,
                          }))
                        }
                      />
                    </label>
                    <label className="input-shell">
                      <span>符号最少个数</span>
                      <input
                        disabled={!passwordForm.include_symbols}
                        min={0}
                        type="number"
                        value={passwordForm.min_symbols}
                        onChange={(event) =>
                          setPasswordForm((current) => ({
                            ...current,
                            min_symbols: Number(event.target.value) || 0,
                          }))
                        }
                      />
                    </label>
                  </div>

                  <label className="toggle-row">
                    <input
                      checked={passwordForm.avoid_ambiguous}
                      type="checkbox"
                      onChange={(event) =>
                        setPasswordForm((current) => ({
                          ...current,
                          avoid_ambiguous: event.target.checked,
                        }))
                      }
                    />
                    <span>避免易混淆的字符</span>
                  </label>

                  <button className="primary-btn wide-btn" type="button" onClick={() => void handleGeneratePassword()}>
                    按当前选项生成
                  </button>
                </section>
              </>
            ) : null}

            {passwordTab === 'passphrase' ? (
              <section className="glass-card option-card">
                <div className="option-card-head">
                  <h3>密码短语选项</h3>
                </div>

                <div className="inline-field-grid">
                  <label className="input-shell">
                    <span>单词数</span>
                    <input
                      max={8}
                      min={3}
                      type="number"
                      value={passphraseForm.word_count}
                      onChange={(event) =>
                        setPassphraseForm((current) => ({
                          ...current,
                          word_count: Number(event.target.value) || 0,
                        }))
                      }
                    />
                  </label>
                  <label className="input-shell">
                    <span>分隔符</span>
                    <select
                      value={passphraseForm.separator}
                      onChange={(event) =>
                        setPassphraseForm((current) => ({
                          ...current,
                          separator: event.target.value,
                        }))
                      }
                    >
                      {SEPARATOR_OPTIONS.map((option) => (
                        <option key={`pass-${option.label}`} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <label className="toggle-row">
                  <input
                    checked={passphraseForm.capitalize_words}
                    type="checkbox"
                    onChange={(event) =>
                      setPassphraseForm((current) => ({
                        ...current,
                        capitalize_words: event.target.checked,
                      }))
                    }
                  />
                  <span>首字母大写</span>
                </label>

                <label className="toggle-row">
                  <input
                    checked={passphraseForm.append_number}
                    type="checkbox"
                    onChange={(event) =>
                      setPassphraseForm((current) => ({
                        ...current,
                        append_number: event.target.checked,
                      }))
                    }
                  />
                  <span>末尾追加两位数字</span>
                </label>

                <button className="primary-btn wide-btn" type="button" onClick={() => void handleGeneratePassphrase()}>
                  生成密码短语
                </button>
              </section>
            ) : null}

            {passwordTab === 'username' ? (
              <section className="glass-card option-card">
                <div className="option-card-head">
                  <h3>用户名选项</h3>
                </div>

                <div className="inline-field-grid">
                  <label className="input-shell">
                    <span>长度</span>
                    <input
                      max={24}
                      min={6}
                      type="number"
                      value={usernameForm.length}
                      onChange={(event) =>
                        setUsernameForm((current) => ({
                          ...current,
                          length: Number(event.target.value) || 0,
                        }))
                      }
                    />
                  </label>

                  <label className="input-shell">
                    <span>风格</span>
                    <select
                      value={usernameForm.style}
                      onChange={(event) =>
                        setUsernameForm((current) => ({
                          ...current,
                          style: event.target.value as UsernameStyle,
                        }))
                      }
                    >
                      {USERNAME_STYLE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="input-shell">
                    <span>分隔符</span>
                    <select
                      value={usernameForm.separator}
                      onChange={(event) =>
                        setUsernameForm((current) => ({
                          ...current,
                          separator: event.target.value,
                        }))
                      }
                    >
                      {SEPARATOR_OPTIONS.map((option) => (
                        <option key={`user-${option.label}`} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <label className="toggle-row">
                  <input
                    checked={usernameForm.append_number}
                    type="checkbox"
                    onChange={(event) =>
                      setUsernameForm((current) => ({
                        ...current,
                        append_number: event.target.checked,
                      }))
                    }
                  />
                  <span>附加数字后缀</span>
                </label>

                <label className="toggle-row">
                  <input
                    checked={usernameForm.avoid_ambiguous}
                    type="checkbox"
                    onChange={(event) =>
                      setUsernameForm((current) => ({
                        ...current,
                        avoid_ambiguous: event.target.checked,
                      }))
                    }
                  />
                  <span>避免易混淆的字符</span>
                </label>

                <button className="primary-btn wide-btn" type="button" onClick={() => void handleGenerateUsername()}>
                  生成用户名
                </button>
              </section>
            ) : null}
          </section>
        )}
      </main>

      <footer className="page-footer">
        <span>power by wx_guzb_7558</span>
        <span>zszc-sql-client 插件工作区</span>
      </footer>
    </div>
  )
}

function RefreshIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path
        d="M20 11a8 8 0 0 0-13.66-5.66L4 7.67V3H0v12h12V11H7.33l2.59-2.59A5 5 0 1 1 15 17h2.83A8 8 0 0 0 20 11Z"
        fill="currentColor"
      />
    </svg>
  )
}

function CopyIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path
        d="M16 1H6a3 3 0 0 0-3 3v10h3V4h10V1Zm3 6H10a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h9a3 3 0 0 0 3-3V10a3 3 0 0 0-3-3Zm0 13h-9V10h9v10Z"
        fill="currentColor"
      />
    </svg>
  )
}
