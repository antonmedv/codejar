import Prism from 'prismjs'
import 'prismjs/components/prism-typescript'
import 'prismjs/components/prism-python'
import 'prismjs/components/prism-json'
import { CodeJar, type Options } from '../src/codejar'
import { samples, type Sample } from './samples'

const $ = <T extends HTMLElement>(selector: string) =>
  document.querySelector(selector) as T

const storage = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value)
    } catch {
      // Storage may be unavailable (private mode, blocked cookies).
    }
  },
}

// Theme toggle
const root = document.documentElement
const savedTheme = storage.get('codejar:theme')
if (savedTheme) root.dataset.theme = savedTheme
$('#theme-toggle').addEventListener('click', () => {
  const dark =
    root.dataset.theme === 'dark' ||
    (!root.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches)
  root.dataset.theme = dark ? 'light' : 'dark'
  storage.set('codejar:theme', root.dataset.theme)
})

// Copy buttons
for (const button of document.querySelectorAll<HTMLButtonElement>(
  '[data-copy]',
)) {
  button.addEventListener('click', async () => {
    const text = $(button.dataset.copy!).textContent ?? ''
    try {
      await navigator.clipboard.writeText(text)
      button.textContent = 'Copied!'
    } catch {
      button.textContent = 'Failed'
    }
    setTimeout(() => (button.textContent = 'Copy'), 1500)
  })
}

// Static snippets
for (const pre of document.querySelectorAll<HTMLElement>('.snippet')) {
  const code = pre.querySelector('code')!
  const lang = pre.dataset.lang ?? 'javascript'
  code.innerHTML = Prism.highlight(
    code.textContent ?? '',
    Prism.languages[lang],
    lang,
  )
}

// Live editor
const editor = $('#editor')
const tabs = $('#lang-tabs')
let current: Sample = samples[0]

const highlight = (el: HTMLElement) => {
  el.innerHTML = Prism.highlight(
    el.textContent ?? '',
    Prism.languages[current.grammar],
    current.grammar,
  )
}

const jar = CodeJar(editor, highlight, { tab: '  ' })

const optOutline = $<HTMLInputElement>('#opt-outline')
optOutline.addEventListener('change', () => {
  editor.classList.toggle('show-tokens', optOutline.checked)
})

function select(sample: Sample) {
  current = sample
  for (const tab of tabs.children) {
    tab.setAttribute('aria-selected', String(tab.id === `tab-${sample.id}`))
  }
  jar.updateCode(sample.code)
}

for (const sample of samples) {
  const tab = document.createElement('button')
  tab.type = 'button'
  tab.id = `tab-${sample.id}`
  tab.setAttribute('role', 'tab')
  tab.textContent = sample.file
  tab.title = sample.name
  tab.addEventListener('click', () => select(sample))
  tabs.append(tab)
}

// Options panel
const optTab = $<HTMLSelectElement>('#opt-tab')
optTab.addEventListener('change', () => {
  jar.updateOptions({ tab: optTab.value })
  editor.style.tabSize =
    optTab.value === '\t' ? '4' : String(optTab.value.length)
})

const toggles = [
  'addClosing',
  'preserveIdent',
  'catchTab',
  'history',
  'spellcheck',
] as const satisfies (keyof Options)[]

for (const name of toggles) {
  const input = $<HTMLInputElement>(`#opt-${name}`)
  input.addEventListener('change', () => {
    jar.updateOptions({ [name]: input.checked })
  })
}

select(samples[0])
