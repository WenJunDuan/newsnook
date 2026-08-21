import { useState, type ReactNode } from 'react'
import {
  Cloud,
  Download,
  Eye,
  EyeOff,
  Import,
  LoaderCircle,
  Trash2,
} from 'lucide-react'

import { SettingsHint, SettingsSection, SettingsShell } from '../../components/SettingsShell'
import { OptionPickerDialog } from '../../components/ConfirmDialog'
import { ToggleSwitch } from '../../components/ToggleSwitch'
import { listOpenAiModels } from '../../features/translation/openai'
import type { CloudTranslationConfig } from '../../features/translation/types'
import { chatComplete } from '../../features/ai/client'
import { isAiConfigured } from '../../features/ai/config'
import { clearAiCaches } from '../../features/ai/storage'
import type { AiConfig, AiPrefs } from '../../features/ai/types'

interface Props {
  prefs: AiPrefs
  /** AI 翻译（OpenAI 兼容）的云配置，供一键导入 */
  translationOpenAi?: CloudTranslationConfig
  onChange: (prefs: AiPrefs) => void
  onBack: () => void
}

type AsyncState = 'idle' | 'working' | 'success' | 'error'

function Field({
  label,
  value,
  placeholder,
  type = 'text',
  onChange,
  suffix,
}: {
  label: string
  value: string
  placeholder?: string
  type?: 'text' | 'password'
  onChange: (value: string) => void
  suffix?: ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block font-mono text-[10px] tracking-[0.12em] text-paper-faint">
        {label}
      </span>
      <span className="flex min-h-12 items-center rounded-xl border border-haze bg-ink px-3.5 focus-within:border-cinnabar/55">
        <input
          type={type}
          value={value}
          placeholder={placeholder}
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
          onChange={(event) => onChange(event.target.value)}
          className="min-w-0 flex-1 bg-transparent py-3 text-[13px] text-paper outline-none placeholder:text-paper-faint/65"
        />
        {suffix}
      </span>
    </label>
  )
}

export function AiSettingsScreen({ prefs, translationOpenAi, onChange, onBack }: Props) {
  const [showKey, setShowKey] = useState(false)
  const [testState, setTestState] = useState<AsyncState>('idle')
  const [testMessage, setTestMessage] = useState('')
  const [modelListState, setModelListState] = useState<AsyncState>('idle')
  const [modelListMessage, setModelListMessage] = useState('')
  const [modelPickerOpen, setModelPickerOpen] = useState(false)
  const [remoteModels, setRemoteModels] = useState<string[]>([])
  const [clearedCaches, setClearedCaches] = useState(false)

  const { config } = prefs
  const configured = isAiConfigured(prefs)
  const canImport = Boolean(translationOpenAi?.apiKey.trim() && translationOpenAi.endpoint.trim())

  const updateConfig = (patch: Partial<AiConfig>) => {
    onChange({ ...prefs, config: { ...config, ...patch } })
    setTestState('idle')
    setTestMessage('')
  }

  const importFromTranslation = () => {
    if (!translationOpenAi) return
    updateConfig({
      apiKey: translationOpenAi.apiKey,
      endpoint: translationOpenAi.endpoint,
      model: translationOpenAi.model ?? '',
    })
  }

  const fetchModels = async () => {
    setModelListState('working')
    setModelListMessage('正在拉取模型列表…')
    try {
      const models = await listOpenAiModels({ apiKey: config.apiKey, endpoint: config.endpoint })
      setRemoteModels(models)
      setModelPickerOpen(true)
      setModelListState('success')
      setModelListMessage(models.length ? `已获取 ${models.length} 个模型` : '列表为空，请手填 Model')
    } catch (error) {
      setModelListState('error')
      setModelListMessage(error instanceof Error ? error.message : '拉取模型失败')
    }
  }

  const testConnection = async () => {
    setTestState('working')
    setTestMessage('正在连接…')
    try {
      const reply = await chatComplete(
        config,
        [{ role: 'user', content: '请回复两个字：就绪' }],
        { temperature: 0, maxTokens: 20 },
      )
      setTestState('success')
      setTestMessage(`连接成功 · ${reply.slice(0, 40)}`)
    } catch (error) {
      setTestState('error')
      setTestMessage(error instanceof Error ? error.message : '连接失败')
    }
  }

  return (
    <SettingsShell
      title="AI 智读"
      caption={configured ? `${config.model} · 接口已配置` : '未配置 · 摘要 / 精选 / 助手 / 舆情'}
      onBack={onBack}
    >
      <SettingsSection title="功能入口">
        <div className="divide-y divide-haze border-y border-haze bg-ink">
          <div className="page-x flex items-center justify-between py-4">
            <div className="pr-4">
              <span className="block text-[14px] text-paper">阅读器 AI 解读</span>
              <span className="mt-1 block text-[11px] leading-relaxed text-paper-faint">
                文章页顶栏显示「解读」入口：摘要、要点、标签与情绪
              </span>
            </div>
            <ToggleSwitch
              checked={prefs.digestEnabled}
              label={prefs.digestEnabled ? '关闭阅读器 AI 解读' : '开启阅读器 AI 解读'}
              onChange={() => onChange({ ...prefs, digestEnabled: !prefs.digestEnabled })}
            />
          </div>
          <div className="page-x flex items-center justify-between py-4">
            <div className="pr-4">
              <span className="block text-[14px] text-paper">首页 AI 精选</span>
              <span className="mt-1 block text-[11px] leading-relaxed text-paper-faint">
                按本地阅读记录从当前分类挑选感兴趣的文章；不改变时间线排序
              </span>
            </div>
            <ToggleSwitch
              checked={prefs.recommendEnabled}
              label={prefs.recommendEnabled ? '关闭首页 AI 精选' : '开启首页 AI 精选'}
              onChange={() => onChange({ ...prefs, recommendEnabled: !prefs.recommendEnabled })}
            />
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title="接口配置（OpenAI 兼容）">
        <div className="page-x pt-4">
          <div className="mx-auto max-w-3xl space-y-4 rounded-2xl border border-haze bg-ink-raised p-5 shadow-[var(--shadow-lift)]">
            {canImport && (
              <button
                type="button"
                onClick={importFromTranslation}
                className="flex min-h-12 w-full items-center justify-center gap-2 rounded-full border border-haze bg-ink px-4 text-[12.5px] text-paper"
              >
                <Import size={15} />
                从「翻译 → AI 翻译」导入接口配置
              </button>
            )}
            <Field
              label="BASE URL"
              value={config.endpoint}
              placeholder="https://api.openai.com/v1"
              onChange={(endpoint) => updateConfig({ endpoint })}
            />
            <Field
              label="API KEY"
              value={config.apiKey}
              type={showKey ? 'text' : 'password'}
              placeholder="仅保存在这台设备"
              onChange={(apiKey) => updateConfig({ apiKey })}
              suffix={
                <button
                  type="button"
                  aria-label={showKey ? '隐藏 API Key' : '显示 API Key'}
                  onClick={() => setShowKey((value) => !value)}
                  className="ml-2 p-2"
                >
                  {showKey ? (
                    <EyeOff size={15} className="text-paper-faint" />
                  ) : (
                    <Eye size={15} className="text-paper-faint" />
                  )}
                </button>
              }
            />
            <Field
              label="MODEL"
              value={config.model}
              placeholder="例如 gpt-4o-mini"
              onChange={(model) => updateConfig({ model })}
            />
            <button
              type="button"
              disabled={
                modelListState === 'working' || !config.endpoint.trim() || !config.apiKey.trim()
              }
              onClick={() => void fetchModels()}
              className="flex min-h-12 w-full items-center justify-center gap-2 rounded-full border border-haze bg-ink px-4 text-[12.5px] text-paper disabled:opacity-35"
            >
              {modelListState === 'working' ? (
                <LoaderCircle size={15} className="animate-spin" />
              ) : (
                <Download size={15} />
              )}
              拉取模型列表
            </button>
            {modelListMessage && (
              <p
                className={`text-[11px] leading-relaxed ${modelListState === 'error' ? 'text-cinnabar-soft' : 'text-paper-faint'}`}
              >
                {modelListMessage}
              </p>
            )}
            <button
              type="button"
              disabled={testState === 'working' || !configured}
              onClick={() => void testConnection()}
              className="flex min-h-12 w-full items-center justify-center gap-2 rounded-full border border-cinnabar/50 bg-cinnabar/12 px-4 text-[12.5px] text-paper disabled:opacity-35"
            >
              {testState === 'working' ? (
                <LoaderCircle size={15} className="animate-spin" />
              ) : (
                <Cloud size={15} />
              )}
              测试连接
            </button>
            {testMessage && (
              <p
                className={`text-[11px] leading-relaxed ${testState === 'error' ? 'text-cinnabar-soft' : 'text-paper-faint'}`}
              >
                {testMessage}
              </p>
            )}
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title="本地数据">
        <div className="divide-y divide-haze border-y border-haze bg-ink">
          <div className="page-x flex items-center justify-between py-3 bg-ink/40">
            <div>
              <span className="block text-[13px] text-paper">清空 AI 缓存</span>
              <span className="text-[11px] text-paper-faint">删除本机已生成的解读结果与助手对话记录</span>
            </div>
            <button
              type="button"
              onClick={() => {
                clearAiCaches()
                setClearedCaches(true)
                setTimeout(() => setClearedCaches(false), 2000)
              }}
              className="flex items-center gap-1.5 rounded-full border border-haze bg-paper/5 px-3 py-1 text-[11.5px] text-paper-muted hover:border-paper-faint hover:text-paper transition-colors"
            >
              <Trash2 size={12} />
              {clearedCaches ? '已清空' : '立即清空'}
            </button>
          </div>
        </div>
      </SettingsSection>

      <SettingsHint>
        所有 AI 功能均直连你自己填写的 OpenAI 兼容接口，API Key 只保存在这台设备；发送内容仅限当次所需的文章文本与本机阅读画像（标题级），应用不经手任何服务器。
      </SettingsHint>

      <OptionPickerDialog
        open={modelPickerOpen && remoteModels.length > 0}
        title="选择模型"
        value={(config.model && remoteModels.includes(config.model)
          ? config.model
          : remoteModels[0]) as string}
        options={remoteModels.map((id) => ({ id, label: id }))}
        onCancel={() => setModelPickerOpen(false)}
        onChange={(model) => {
          updateConfig({ model })
          setModelPickerOpen(false)
        }}
      />
    </SettingsShell>
  )
}
