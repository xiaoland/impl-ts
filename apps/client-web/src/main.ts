import { computed, createApp } from 'vue'
import { INK_I18N_KEY, type InkI18n } from '@inkcre/ui-web'
import App from './App.vue'
import i18n from './locales'
import router from './router'
import { setInfoBaseRouter, store } from '@inkcre/core'
import { createInfoBaseRouterAdapter } from './router'

// 样式
import 'uno.css'
import '@inkcre/ui-web/styles'
import '@vue-flow/core/dist/style.css'
import './styles/entity-card.scss'

const app = createApp(App)

app.use(i18n)
app.provide<InkI18n>(INK_I18N_KEY, {
  t: (key) => i18n.global.t(`ui.${key}`),
  locale: computed(() => i18n.global.locale.value),
})
app.use(store)
app.use(router)
setInfoBaseRouter(createInfoBaseRouterAdapter(router))

app.mount('#app')
