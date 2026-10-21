import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const bootstrap = readFileSync(new URL('../src/BootstrapRoot.tsx', import.meta.url), 'utf8')
const launchTheme = readFileSync(new URL('../android/app/src/main/res/values/styles.xml', import.meta.url), 'utf8')
const application = readFileSync(new URL('../android/app/src/main/java/com/aizeek/newsnook/NewsNookApplication.java', import.meta.url), 'utf8')
const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8')
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const settings = readFileSync(new URL('../src/screens/settings/AppearanceScreen.tsx', import.meta.url), 'utf8')
assert.doesNotMatch(bootstrap, /<StartupSplash|FULL_DURATION_MS|STATIC_DURATION_MS|SPLASH_EXIT_MS|SPLASH_ENABLED|2400\s*\)/,
  'A cosmetic startup sequence must never gate the real app')
assert.match(bootstrap, /await hydrateNativeStorage\(\)/)
assert.match(bootstrap, /await migrateLegacyNativeSecretsOnce\(\)/)
assert.match(bootstrap, /await hydrateRuntimeSecrets\(\)/)
assert.match(bootstrap, /setAppReady\(true\)/)
assert.match(bootstrap, /if \(!appReady\) return\s+clearBootSplashShell\(\)/,
  'The document placeholder should not disappear before the real app is committed')
assert.doesNotMatch(settings, /下次完整开场|clearStartupSplashSeen/)
assert.doesNotMatch(app, /import \{ (?:AppearanceScreen|AboutScreen|TranslationScreen|CategorySettingsScreen) \} from ['"]\.\/screens\/settings\//, 'Settings screens not used by home must be loaded on navigation')
assert.match(app, /const AppearanceScreen = lazy\(/)
assert.doesNotMatch(main, /lazy\(\(\) => import\(['"]\.\/BootstrapRoot/, 'The startup root must not insert an extra lazy-loading waterfall')
assert.match(main, /import \{ BootstrapRoot \} from ['"]\.\/BootstrapRoot['"]/) 
assert.match(application, /WebViewCompat\.startUpWebView\(/, 'Start WebView background work while Activity initialization proceeds')
assert.doesNotMatch(launchTheme, /windowSplashScreenAnimatedIcon\">@drawable\/splash_transparent/, 'Native splash cannot be an uninformative blank screen')
console.log('Android startup critical-path regression checks passed')
