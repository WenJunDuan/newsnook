import { useState } from 'react'
import { Trash2 } from 'lucide-react'

import { SettingsHint, SettingsSection, SettingsShell } from '../../components/SettingsShell'
import { ToggleSwitch } from '../../components/ToggleSwitch'
import { ReadingPrefsPanel } from '../../features/ai/components/ReadingPrefsPanel'
import { clearAiCaches } from '../../features/ai/storage'
import type { AiPrefs, InterestCategory } from '../../features/ai/types'

interface Props {
  prefs: AiPrefs
  seedCategories: InterestCategory[]
  onChange: (prefs: AiPrefs) => void
  onBack: () => void
}

export function AiSettingsScreen({
  prefs,
  seedCategories,
  onChange,
  onBack,
}: Props) {
  const [clearedCaches, setClearedCaches] = useState(false)

  return (
    <SettingsShell
      title="智读与精选"
      caption="开关、阅读偏好与精选算法；不改变首页时间线"
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
                按阅读偏好从当前分类与跨分类兴趣中挑选；不改变时间线排序
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

      {prefs.recommendEnabled ? (
        <SettingsSection title="精选阅读偏好">
          <ReadingPrefsPanel
            prefs={prefs}
            seedCategories={seedCategories}
            onChange={(readingPrefs) => onChange({ ...prefs, readingPrefs })}
          />
        </SettingsSection>
      ) : null}

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
        模型接口在「AI 助手」里配置。分类/出品方由阅读日志标出偏好，只影响精选，不改首页时间线。
      </SettingsHint>
    </SettingsShell>
  )
}
