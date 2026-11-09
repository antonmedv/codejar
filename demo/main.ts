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

function renderStatus() {
  const code = jar.toString()
  $('#status-size').textContent = `${code.length} chars`
  $('#status-lang').textContent = current.name
  // Measure the text up to the caret (the selection focus) with a Range,
  // instead of jar.save(), which mutates the DOM.
  const selection = getSelection()
  const focus = selection?.focusNode
  if (!focus || !editor.contains(focus)) return
  const range = document.createRange()
  range.selectNodeContents(editor)
  range.setEnd(focus, selection.focusOffset)
  const before = range.toString().split('\n')
  $('#status-pos').textContent =
    `Ln ${before.length}, Col ${before[before.length - 1].length + 1}`
}

jar.onUpdate((code) => {
  storage.set(`codejar:code:${current.id}`, code)
  renderStatus()
})
document.addEventListener('selectionchange', renderStatus)

function select(sample: Sample) {
  current = sample
  for (const tab of tabs.children) {
    tab.setAttribute('aria-selected', String(tab.id === `tab-${sample.id}`))
  }
  editor.className = `editor language-${sample.grammar}`
  editor.classList.toggle('show-tokens', optOutline.checked)
  jar.updateCode(storage.get(`codejar:code:${sample.id}`) ?? sample.code)
  storage.set('codejar:lang', sample.id)
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

$('#reset').addEventListener('click', () => {
  jar.updateCode(current.code)
  editor.focus()
})

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
    if (name === 'spellcheck') {
      editor.spellcheck = input.checked
    }
  })
}

const optOutline = $<HTMLInputElement>('#opt-outline')
optOutline.addEventListener('change', () => {
  editor.classList.toggle('show-tokens', optOutline.checked)
})

select(samples.find((s) => s.id === storage.get('codejar:lang')) ?? samples[0])
