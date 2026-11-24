import { createApp } from 'vue'
import { createPinia } from 'pinia'
import PrimeVue from 'primevue/config'
import ToastService from 'primevue/toastservice'
import Tooltip from 'primevue/tooltip'
import 'primeicons/primeicons.css'
import './styles/main.css'
import App from './App.vue'
import { router } from './router'
import { RmsPreset } from './theme'
import { registerPwa } from './pwa'

async function bootstrap() {
  if (__RMS_USE_MOCKS__) {
    // Compile-time constant: the mock code is not even bundled when mocks are off.
    const { startMocks } = await import('./mocks/browser')
    await startMocks()
  } else {
    registerPwa()
  }

  const app = createApp(App)
  app.use(createPinia())
  app.use(router)
  app.use(PrimeVue, {
    theme: { preset: RmsPreset, options: { darkModeSelector: '.rms-dark', cssLayer: false } },
  })
  app.use(ToastService)
  app.directive('tooltip', Tooltip)
  app.mount('#app')
}

void bootstrap()
