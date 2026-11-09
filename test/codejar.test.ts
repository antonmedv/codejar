import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { CodeJar, type Options } from '../src/codejar'

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Wraps keywords in spans, so the editor contains nested nodes like a real
// highlighter would produce.
const highlight = vi.fn((editor: HTMLElement) => {
  editor.innerHTML = escape(editor.textContent ?? '').replace(
    /\b(let|const|function)\b/g,
    '<span class="kw">$1</span>',
  )
})

let editor: HTMLElement
let jar: CodeJar

function setup(code = '', options: Partial<Options> = {}) {
  jar = CodeJar(editor, highlight, options)
  jar.updateCode(code)
  return jar
}

// Focus the editor and put the caret (or a selection) at the given offsets.
async function focusAt(start: number, end = start) {
  await userEvent.click(editor)
  jar.restore({ start, end })
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

beforeEach(() => {
  highlight.mockClear()
  editor = document.createElement('div')
  editor.style.fontFamily = 'monospace'
  editor.style.minHeight = '100px'
  document.body.append(editor)
})

afterEach(() => {
  jar?.destroy()
  editor.remove()
})

describe('setup', () => {
  test('makes the element editable', () => {
    setup()
    expect(['true', 'plaintext-only']).toContain(
      editor.getAttribute('contenteditable'),
    )
    expect(editor.getAttribute('spellcheck')).toBe('false')
    expect(editor.style.whiteSpace).toBe('pre-wrap')
  })

  test('enables spellcheck', () => {
    setup('', { spellcheck: true })
    expect(editor.getAttribute('spellcheck')).toBe('true')
  })
})

describe('updateCode', () => {
  test('sets code, highlights and notifies', () => {
    const onUpdate = vi.fn()
    setup()
    jar.onUpdate(onUpdate)
    jar.updateCode('let a = 1')
    expect(jar.toString()).toBe('let a = 1')
    expect(editor.querySelector('.kw')?.textContent).toBe('let')
    expect(onUpdate).toHaveBeenCalledWith('let a = 1')
  })

  test('skips onUpdate when callOnUpdate is false', () => {
    const onUpdate = vi.fn()
    setup()
    jar.onUpdate(onUpdate)
    jar.updateCode('x', false)
    expect(jar.toString()).toBe('x')
    expect(onUpdate).not.toHaveBeenCalled()
  })
})

describe('typing', () => {
  test('inserts text and calls onUpdate', async () => {
    const onUpdate = vi.fn()
    setup()
    jar.onUpdate(onUpdate)
    await focusAt(0)
    await userEvent.keyboard('abc')
    expect(jar.toString()).toBe('abc')
    expect(onUpdate).toHaveBeenLastCalledWith('abc')
  })

  test('keeps HTML characters as text', async () => {
    setup()
    await focusAt(0)
    await userEvent.keyboard('a<b>&c')
    expect(jar.toString()).toBe('a<b>&c')
  })

  test('re-highlights after typing', async () => {
    setup()
    await focusAt(0)
    await userEvent.keyboard('const x')
    await wait(100) // highlight is debounced
    expect(editor.querySelector('.kw')?.textContent).toBe('const')
    expect(jar.toString()).toBe('const x')
  })
})

describe('auto-closing', () => {
  test('closes brackets and places the caret inside', async () => {
    setup()
    await focusAt(0)
    await userEvent.keyboard('(x')
    expect(jar.toString()).toBe('(x)')
    expect(jar.save()).toMatchObject({ start: 2, end: 2 })
  })

  test('closes quotes', async () => {
    setup()
    await focusAt(0)
    await userEvent.keyboard('"')
    expect(jar.toString()).toBe('""')
  })

  test('wraps the selection', async () => {
    setup('foo')
    await focusAt(0, 3)
    await userEvent.keyboard('[[') // "[[" types a literal "["
    expect(jar.toString()).toBe('[foo]')
  })

  test('supports custom pairs', async () => {
    setup('', { autoclose: { open: '<', close: '>' } })
    await focusAt(0)
    await userEvent.keyboard('<(')
    expect(jar.toString()).toBe('<(>')
  })

  test('can be disabled', async () => {
    setup('', { addClosing: false })
    await focusAt(0)
    await userEvent.keyboard('(')
    expect(jar.toString()).toBe('(')
  })
})

describe('new lines', () => {
  test('preserves indentation', async () => {
    setup('  foo')
    await focusAt(5)
    await userEvent.keyboard('{Enter}bar')
    expect(jar.toString()).toBe('  foo\n  bar')
  })

  test('indents after an opening bracket and moves the closing one', async () => {
    setup('{}', { tab: '  ' })
    await focusAt(1)
    await userEvent.keyboard('{Enter}x')
    expect(jar.toString()).toBe('{\n  x\n}')
  })

  test('respects a custom indentOn', async () => {
    setup('foo:', { tab: '  ', indentOn: /:$/ })
    await focusAt(4)
    await userEvent.keyboard('{Enter}x')
    expect(jar.toString()).toBe('foo:\n  x')
  })
})

describe('tab key', () => {
  test('inserts the tab string', async () => {
    setup('x', { tab: '    ' })
    await focusAt(0)
    await userEvent.keyboard('{Tab}')
    expect(jar.toString()).toBe('    x')
  })

  test('outdents with Shift+Tab', async () => {
    setup('    x', { tab: '  ' })
    await focusAt(5)
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}')
    expect(jar.toString()).toBe('  x')
  })

  test('is ignored when catchTab is false', async () => {
    setup('x', { catchTab: false })
    await focusAt(0)
    await userEvent.keyboard('{Tab}')
    expect(jar.toString()).toBe('x')
  })
})

describe('history', () => {
  test('undo and redo', async () => {
    setup()
    await focusAt(0)
    await userEvent.keyboard('abc')
    await wait(400) // history is recorded after a 300ms pause
    await userEvent.keyboard('{Control>}z{/Control}')
    expect(jar.toString()).toBe('')
    await userEvent.keyboard('{Control>}{Shift>}z{/Shift}{/Control}')
    expect(jar.toString()).toBe('abc')
  })
})

describe('save and restore', () => {
  test('round-trips a caret across highlighted nodes', async () => {
    setup('let x = 1')
    await focusAt(5)
    expect(jar.save()).toEqual({ start: 5, end: 5, dir: '->' })
  })

  test('round-trips a forward selection', async () => {
    setup('let x = 1')
    await focusAt(1, 6)
    expect(jar.save()).toEqual({ start: 1, end: 6, dir: '->' })
    expect(getSelection()?.toString()).toBe('et x ')
  })

  test('round-trips a backward selection', async () => {
    setup('let x = 1')
    await userEvent.click(editor)
    jar.restore({ start: 6, end: 1, dir: '<-' })
    expect(jar.save()).toEqual({ start: 6, end: 1, dir: '<-' })
    expect(getSelection()?.toString()).toBe('et x ')
  })
})

describe('clipboard', () => {
  test('copies and pastes with the real clipboard', async () => {
    const onUpdate = vi.fn()
    setup('let a = <b>')
    jar.onUpdate(onUpdate)
    await focusAt(8, 11)
    await userEvent.copy()
    jar.restore({ start: 0, end: 0 })
    await userEvent.paste()
    expect(jar.toString()).toBe('<b>let a = <b>')
    expect(jar.save()).toMatchObject({ start: 3, end: 3 })
    expect(onUpdate).toHaveBeenLastCalledWith('<b>let a = <b>')
  })

  test('cuts the selection', async () => {
    setup('hello world')
    await focusAt(0, 6)
    await userEvent.cut()
    expect(jar.toString()).toBe('world')
    jar.restore({ start: 5, end: 5 })
    await userEvent.paste()
    expect(jar.toString()).toBe('worldhello ')
  })

  // Firefox ignores clipboardData on synthetic events, and a real clipboard
  // can't be filled with "\r\n" from the page, so this one is Chromium only.
  test.skipIf(navigator.userAgent.includes('Firefox'))(
    'normalizes pasted line endings',
    async () => {
      setup('ab')
      await focusAt(1)
      const data = new DataTransfer()
      data.setData('text/plain', 'x\r\ny\rz')
      editor.dispatchEvent(
        new ClipboardEvent('paste', {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        }),
      )
      expect(jar.toString()).toBe('ax\ny\nzb')
      expect(jar.save()).toMatchObject({ start: 6, end: 6 })
    },
  )
})

describe('options and lifecycle', () => {
  test('updateOptions changes behavior at runtime', async () => {
    setup()
    jar.updateOptions({ addClosing: false })
    await focusAt(0)
    await userEvent.keyboard('(')
    expect(jar.toString()).toBe('(')
  })

  test('destroy cancels pending highlight and history updates', async () => {
    setup()
    await focusAt(0)
    await userEvent.keyboard('abc')
    highlight.mockClear()
    jar.destroy()
    editor.remove() // pending callbacks would throw on a detached element
    await wait(400)
    expect(highlight).not.toHaveBeenCalled()
  })

  test('destroy removes event listeners', async () => {
    setup()
    jar.destroy()
    await focusAt(0)
    await userEvent.keyboard('(')
    expect(jar.toString()).toBe('(')
  })
})
