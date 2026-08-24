import { useState, type ReactNode } from 'react'
import { Cloud, Download, Eye, EyeOff, Import, LoaderCircle } from 'lucide-react'

import { OptionPickerDialog } from '../../../components/ConfirmDialog'
import { listOpenAiModels } from '../../translation/openai'
import type { CloudTranslationConfig } from '../../translation/types'
import { chatComplete } from '../client'
import { isAiConfigured } from '../config'
import type { AiConfig, AiPrefs } from '../types'

interface Props {
  prefs: AiPrefs
  translationOpenAi?: CloudTranslationConfig
  onChange: (prefs: AiPrefs) => void
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

/** 助手页内嵌的模型接口表单 */
export function AiModelConfigForm({ prefs, translationOpenAi, onChange }: Props) {
  const [showKey, setShowKey] = useState(false)
  const [testState, setTestState] = useState<AsyncState>('idle')
  const [testMessage, setTestMessage] = useState('')
  const [modelListState, setModelListState] = useState<AsyncState>('idle')
  const [modelListMessage, setModelListMessage] = useState('')
  const [modelPickerOpen, setModelPickerOpen] = useState(false)
  const [remoteModels, setRemoteModels] = useState<string[]>([])

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
    <div className="space-y-4 rounded-2xl border border-haze bg-ink-raised p-5 shadow-[var(--shadow-lift)]">
      <p className="font-mono text-[10px] tracking-[0.14em] text-paper-faint">OpenAI 兼容接口 · 仅存本机</p>
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
        placeholder="https://api.openai.com/v1 或 http://127.0.0.1:11434/v1"
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
        disabled={modelListState === 'working' || !config.endpoint.trim() || !config.apiKey.trim()}
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
    </div>
  )
}
