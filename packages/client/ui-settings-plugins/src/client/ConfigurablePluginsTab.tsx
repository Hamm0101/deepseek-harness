/** Configurable Host plugins contributed to the shared Plugins section. */

import type { HostObservable, InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from './slot-contract.ts'
import css from './PluginsSettingsSection.module.css'

/** Registration-side business face for the configurable tab. */
export interface ConfigurablePluginsTabInjected {
  hooks: {
    /**
     * How many cards currently render: namespaces this deployment both
     * registers and serves to the client. A registered namespace that is not
     * exposed renders nothing, so the empty state counts VISIBLE cards — the
     * tab reflects what the user can actually configure.
     */
    visibleCardCount: HostObservable<number>
  }
}

/** Props the renderer binds for the configurable tab. */
export type ConfigurablePluginsTabProps =
  PropsRuntime<'settings.plugins.tab'>
  & PropsLocale<'settings.plugins'>
  & PropsRenderSlots<'settings.plugin.item'>
  & InjectFace<ConfigurablePluginsTabInjected>

/** Render cards registered by plugins that expose editable settings. */
export function ConfigurablePluginsTab({ t, renderSlot, useVisibleCardCount }: ConfigurablePluginsTabProps) {
  const visibleCardCount = useVisibleCardCount(value => value)
  return visibleCardCount === 0
    ? <p className={css.empty}>{t('empty')}</p>
    : <ul className={css.cards}>{renderSlot('settings.plugin.item', {})}</ul>
}
