import { defineConfig, presetUno, presetAttributify, presetIcons } from 'unocss'
import { presetInk } from '@inkcre/ui-web/uno'

export default defineConfig({
  presets: [presetUno(), presetInk(), presetAttributify(), presetIcons()],
  safelist: [
    'i-mdi-menu',
    'i-mdi-loading',
    'i-mdi-refresh',
    'i-mdi-chevron-right',
    'i-mdi-chevron-left',
    'i-mdi-chevron-down',
    'i-mdi-close',
    'i-mdi-magnify',
    'animate-spin',
  ],
})
