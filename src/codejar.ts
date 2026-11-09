export type Options = {
  tab: string
  indentOn: RegExp
  moveToNewLine: RegExp
  spellcheck: boolean
  catchTab: boolean
  preserveIdent: boolean
  addClosing: boolean
  history: boolean
  window: typeof window
  autoclose: {
    open: string
    close: string
  }
}

type HistoryRecord = {
  html: string
  pos: Position
}

export type Position = {
  start: number
  end: number
  dir?: '->' | '<-'
}

export type CodeJar = ReturnType<typeof CodeJar>

export function CodeJar(
  editor: HTMLElement,
  highlight: (e: HTMLElement, pos?: Position) => void,
  opt: Partial<Options> = {},
) {
  const options: Options = {
    tab: '\t',
    indentOn: /[({[]$/,
    moveToNewLine: /^[)}\]]/,
    spellcheck: false,
    catchTab: true,
    preserveIdent: true,
    addClosing: true,
    history: true,
    window: globalThis.window,
    autoclose: {
      open: `([{'"`,
      close: `)]}'"`,
    },
    ...opt,
  }

  const window = options.window
  const document = window.document

  const listeners: [string, any][] = []
  const timeouts = new Set<number>() // pending debounced calls
  const history: HistoryRecord[] = []
  let at = -1
  // The element may already have focus, e.g. with autofocus.
  let focus =
    (editor.getRootNode() as Document | ShadowRoot).activeElement === editor
  let onUpdate: (code: string) => void | undefined = () => void 0
  let prev: string // code content prior keydown event
  let sentinel = false // an extra trailing newline was added on Enter

  editor.setAttribute('contenteditable', 'plaintext-only')
  editor.setAttribute('spellcheck', options.spellcheck ? 'true' : 'false')
  editor.style.outline = 'none'
  editor.style.overflowWrap = 'break-word'
  editor.style.overflowY = 'auto'
  editor.style.whiteSpace = 'pre-wrap'

  const doHighlight = (editor: HTMLElement, pos?: Position) => {
    highlight(editor, pos)
  }

  const matchFirefoxVersion =
    window.navigator.userAgent.match(/Firefox\/([0-9]+)\./)
  const firefoxVersion = matchFirefoxVersion
    ? parseInt(matchFirefoxVersion[1])
    : 0
  let isLegacy = false // true if plaintext-only is not supported
  if (editor.contentEditable !== 'plaintext-only' || firefoxVersion >= 136)
    isLegacy = true
  if (isLegacy) editor.setAttribute('contenteditable', 'true')

  const debounceHighlight = debounce(() => {
    const pos = save()
    doHighlight(editor, pos)
    restore(pos)
  }, 30)

  let recording = false
  const shouldRecord = (event: KeyboardEvent): boolean => {
    return (
      !isUndo(event) &&
      !isRedo(event) &&
      event.key !== 'Meta' &&
      event.key !== 'Control' &&
      event.key !== 'Alt' &&
      !event.key.startsWith('Arrow')
    )
  }
  const debounceRecordHistory = debounce((event: KeyboardEvent) => {
    if (shouldRecord(event)) {
      recordHistory()
      recording = false
    }
  }, 300)

  const on = <K extends keyof HTMLElementEventMap>(
    type: K,
    fn: (event: HTMLElementEventMap[K]) => void,
  ) => {
    listeners.push([type, fn])
    editor.addEventListener(type, fn)
  }

  on('keydown', (event) => {
    if (event.defaultPrevented) return

    prev = toString()
    if (options.preserveIdent) handleNewLine(event)
    else legacyNewLineFix(event)
    if (options.catchTab) handleTabCharacters(event)
    if (options.addClosing) handleSelfClosingCharacters(event)
    if (options.history) {
      handleUndoRedo(event)
      if (shouldRecord(event) && !recording) {
        recordHistory()
        recording = true
      }
    }
    if (isLegacy && !isCopy(event)) restore(save())
  })

  on('keyup', (event) => {
    if (event.defaultPrevented) return
    if (event.isComposing) return

    if (sentinel) removeSentinel()
    if (prev !== toString()) debounceHighlight()
    debounceRecordHistory(event)
    onUpdate(toString())
  })

  on('focus', (_event) => {
    focus = true
  })

  on('blur', (_event) => {
    focus = false
  })

  on('paste', (event) => {
    recordHistory()
    handlePaste(event)
    recordHistory()
    onUpdate(toString())
  })

  on('cut', (event) => {
    recordHistory()
    handleCut(event)
    recordHistory()
    onUpdate(toString())
  })

  function save(): Position {
    const s = getSelection()
    const { anchorNode, anchorOffset, focusNode, focusOffset } = s
    if (!anchorNode || !focusNode) throw 'error1'

    const start = textOffset(anchorNode, anchorOffset)
    const end = textOffset(focusNode, focusOffset)
    return { start, end, dir: start <= end ? '->' : '<-' }
  }

  // Number of characters of code before the given DOM position.
  function textOffset(node: Node, offset: number): number {
    if (!editor.contains(node)) {
      const after =
        editor.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING
      return after ? toString().length : 0
    }
    const range = document.createRange()
    range.selectNodeContents(editor)
    range.setEnd(node, offset)
    return range.toString().length
  }

  function restore(position: Position) {
    const pos = { ...position }
    const s = getSelection()
    let startNode: Node | undefined,
      startOffset = 0
    let endNode: Node | undefined,
      endOffset = 0

    if (!pos.dir) pos.dir = '->'
    if (pos.start < 0) pos.start = 0
    if (pos.end < 0) pos.end = 0

    // Flip start and end if the direction reversed
    if (pos.dir == '<-') {
      const { start, end } = pos
      pos.start = end
      pos.end = start
    }

    let current = 0

    visit(editor, (el) => {
      if (el.nodeType !== Node.TEXT_NODE) return

      const len = (el.nodeValue || '').length
      if (current + len > pos.start) {
        if (!startNode) {
          startNode = el
          startOffset = pos.start - current
        }
        if (current + len > pos.end) {
          endNode = el
          endOffset = pos.end - current
          return 'stop'
        }
      }
      current += len
    })

    if (!startNode) {
      startNode = editor
      startOffset = editor.childNodes.length
    }
    if (!endNode) {
      endNode = editor
      endOffset = editor.childNodes.length
    }

    // Flip back the selection
    if (pos.dir == '<-') {
      ;[startNode, startOffset, endNode, endOffset] = [
        endNode,
        endOffset,
        startNode,
        startOffset,
      ]
    }

    {
      // If nodes not editable, create a text node.
      const startEl = uneditable(startNode)
      if (startEl) {
        const node = document.createTextNode('')
        startEl.parentNode?.insertBefore(node, startEl)
        startNode = node
        startOffset = 0
      }
      const endEl = uneditable(endNode)
      if (endEl) {
        const node = document.createTextNode('')
        endEl.parentNode?.insertBefore(node, endEl)
        endNode = node
        endOffset = 0
      }
    }

    s.setBaseAndExtent(startNode, startOffset, endNode, endOffset)
    editor.normalize() // collapse empty text nodes
  }

  function uneditable(node: Node): Element | undefined {
    while (node && node !== editor) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as Element
        if (el.getAttribute('contenteditable') == 'false') {
          return el
        }
      }
      node = node.parentNode!
    }
  }

  function beforeCursor() {
    const s = getSelection()
    const r0 = s.getRangeAt(0)
    const r = document.createRange()
    r.selectNodeContents(editor)
    r.setEnd(r0.startContainer, r0.startOffset)
    return r.toString()
  }

  function afterCursor() {
    const s = getSelection()
    const r0 = s.getRangeAt(0)
    const r = document.createRange()
    r.selectNodeContents(editor)
    r.setStart(r0.endContainer, r0.endOffset)
    return r.toString()
  }

  function handleNewLine(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      const before = beforeCursor()
      const after = afterCursor()

      let [padding] = findPadding(before)
      let newLinePadding = padding

      // If last symbol is "{" ident new line
      if (options.indentOn.test(before)) {
        newLinePadding += options.tab
      }

      // Preserve padding
      if (newLinePadding.length > 0) {
        preventDefault(event)
        event.stopPropagation()
        insert('\n' + newLinePadding)
      } else {
        legacyNewLineFix(event)
      }

      // Place adjacent "}" on next line
      if (newLinePadding !== padding && options.moveToNewLine.test(after)) {
        const pos = save()
        insert('\n' + padding)
        restore(pos)
      }
    }
  }

  function legacyNewLineFix(event: KeyboardEvent) {
    // Firefox does not support plaintext-only mode
    // and puts <div><br></div> on Enter. Let's help.
    if (isLegacy && event.key === 'Enter') {
      preventDefault(event)
      event.stopPropagation()
      if (afterCursor() == '') {
        // A trailing newline doesn't render a new line, so the caret would
        // stay on the previous one. Add a second newline (like Chrome does)
        // and put the caret between them.
        insert('\n\n')
        const pos = save()
        pos.start = --pos.end
        restore(pos)
        sentinel = true
      } else {
        insert('\n')
      }
    }
  }

  // Removes the extra newline added by legacyNewLineFix once the last line
  // has text, as it no longer needs the newline to render.
  function removeSentinel() {
    const code = toString()
    if (!code.endsWith('\n')) {
      sentinel = false
      return
    }
    if (!getSelection().isCollapsed) return
    const pos = save()
    // Wait until the caret is at the end of a non-empty last line.
    if (pos.start !== code.length - 1 || code[code.length - 2] === '\n') return
    restore({ start: code.length - 1, end: code.length })
    document.execCommand('delete')
    restore(pos)
    sentinel = false
  }

  function handleSelfClosingCharacters(event: KeyboardEvent) {
    const open = options.autoclose.open
    const close = options.autoclose.close
    // Leave shortcuts like Ctrl+[ alone. Ctrl+Alt is AltGr on Windows,
    // which some layouts need to type brackets.
    if (event.metaKey || (event.ctrlKey && !event.altKey)) return
    if (event.key.length === 1 && open.includes(event.key)) {
      preventDefault(event)
      const pos = save()
      const wrapText = pos.start == pos.end ? '' : getSelection().toString()
      const text = event.key + wrapText + (close[open.indexOf(event.key)] ?? '')
      insert(text)
      pos.start++
      pos.end++
      restore(pos)
    }
  }

  function handleTabCharacters(event: KeyboardEvent) {
    if (event.key !== 'Tab') return
    preventDefault(event)
    if (event.shiftKey) {
      indentLines(false)
    } else if (getSelection().toString().includes('\n')) {
      indentLines(true)
    } else {
      insert(options.tab)
    }
  }

  // Indents or outdents every line touched by the selection.
  function indentLines(indent: boolean) {
    const code = toString()
    const pos = save()
    const from = Math.min(pos.start, pos.end)
    let to = Math.max(pos.start, pos.end)
    // A selection ending at the very start of a line doesn't include it.
    if (to > from && code[to - 1] === '\n') to--

    const blockStart = code.lastIndexOf('\n', from - 1) + 1
    let blockEnd = code.indexOf('\n', to)
    if (blockEnd < 0) blockEnd = code.length

    const lines = code.slice(blockStart, blockEnd).split('\n')
    // Characters added (positive) or removed (negative) at each line start.
    const deltas = lines.map((line) =>
      indent
        ? options.tab.length
        : -Math.min(options.tab.length, /^[ \t]*/.exec(line)![0].length),
    )
    if (deltas.every((d) => d === 0)) return

    const block = lines
      .map((line, i) => (indent ? options.tab + line : line.slice(-deltas[i])))
      .join('\n')

    // Moves a position by the change in its own line and all lines above.
    const move = (p: number) => {
      let lineStart = blockStart
      let shift = 0
      for (let i = 0; i < lines.length; i++) {
        const lineEnd = lineStart + lines[i].length
        if (p <= lineEnd) {
          const column = p - lineStart
          if (indent) return p + shift + (column > 0 ? deltas[i] : 0)
          return p + shift - Math.min(column, -deltas[i])
        }
        shift += deltas[i]
        lineStart = lineEnd + 1
      }
      return p + shift
    }

    restore({ start: blockStart, end: blockEnd })
    insert(block)
    // Keep the caret and selection on the same code; a selection that
    // starts at a line start stays there so the whole line remains selected.
    restore({ start: move(pos.start), end: move(pos.end), dir: pos.dir })
  }

  function handleUndoRedo(event: KeyboardEvent) {
    if (isUndo(event)) {
      preventDefault(event)
      // Save keystrokes that haven't been recorded yet, so they can be redone.
      if (recording) {
        recordHistory()
        recording = false
      }
      at--
      const record = history[at]
      if (record) {
        editor.innerHTML = record.html
        restore(record.pos)
      }
      if (at < 0) at = 0
    }
    if (isRedo(event)) {
      preventDefault(event)
      at++
      const record = history[at]
      if (record) {
        editor.innerHTML = record.html
        restore(record.pos)
      }
      if (at >= history.length) at--
    }
  }

  function recordHistory() {
    if (!focus) return

    const html = editor.innerHTML
    const pos = save()

    const lastRecord = history[at]
    if (lastRecord) {
      if (
        lastRecord.html === html &&
        lastRecord.pos.start === pos.start &&
        lastRecord.pos.end === pos.end
      )
        return
    }

    at++
    history[at] = { html, pos }
    history.splice(at + 1)

    const maxHistory = 300
    if (at > maxHistory) {
      at = maxHistory
      history.splice(0, 1)
    }
  }

  function handlePaste(event: ClipboardEvent) {
    if (event.defaultPrevented) return
    preventDefault(event)
    const originalEvent = (event as any).originalEvent ?? event
    const text = originalEvent.clipboardData
      .getData('text/plain')
      .replace(/\r\n?/g, '\n')
    const pos = save()
    insert(text)
    doHighlight(editor)
    restore({
      start: Math.min(pos.start, pos.end) + text.length,
      end: Math.min(pos.start, pos.end) + text.length,
      dir: '<-',
    })
  }

  function handleCut(event: ClipboardEvent) {
    if (event.defaultPrevented) return
    const selection = getSelection()
    if (selection.isCollapsed) return // nothing to cut
    const pos = save()
    const originalEvent = (event as any).originalEvent ?? event
    originalEvent.clipboardData.setData('text/plain', selection.toString())
    document.execCommand('delete')
    doHighlight(editor)
    restore({
      start: Math.min(pos.start, pos.end),
      end: Math.min(pos.start, pos.end),
      dir: '<-',
    })
    preventDefault(event)
  }

  function visit(
    editor: HTMLElement,
    visitor: (el: Node) => 'stop' | undefined,
  ) {
    const queue: Node[] = []
    if (editor.firstChild) queue.push(editor.firstChild)
    let el = queue.pop()
    while (el) {
      if (visitor(el) === 'stop') break
      if (el.nextSibling) queue.push(el.nextSibling)
      if (el.firstChild) queue.push(el.firstChild)
      el = queue.pop()
    }
  }

  function isCtrl(event: KeyboardEvent) {
    return event.metaKey || event.ctrlKey
  }

  function isUndo(event: KeyboardEvent) {
    return isCtrl(event) && !event.shiftKey && getKeyCode(event) === 'Z'
  }

  function isRedo(event: KeyboardEvent) {
    return isCtrl(event) && event.shiftKey && getKeyCode(event) === 'Z'
  }

  function isCopy(event: KeyboardEvent) {
    return isCtrl(event) && getKeyCode(event) === 'C'
  }

  function getKeyCode(event: KeyboardEvent): string | undefined {
    let key = event.key || event.keyCode || event.which
    if (!key) return undefined
    return (
      typeof key === 'string' ? key : String.fromCharCode(key)
    ).toUpperCase()
  }

  function insert(text: string) {
    text = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;')
    document.execCommand('insertHTML', false, text)
  }

  function debounce(cb: any, wait: number) {
    let timeout = 0
    return (...args: any) => {
      window.clearTimeout(timeout)
      timeouts.delete(timeout)
      timeout = window.setTimeout(() => {
        timeouts.delete(timeout)
        cb(...args)
      }, wait)
      timeouts.add(timeout)
    }
  }

  function findPadding(text: string): [string, number, number] {
    // Find beginning of previous line.
    let i = text.length - 1
    while (i >= 0 && text[i] !== '\n') i--
    i++
    // Find padding of the line.
    let j = i
    while (j < text.length && /[ \t]/.test(text[j])) j++
    return [text.substring(i, j) || '', i, j]
  }

  function toString() {
    return editor.textContent || ''
  }

  function preventDefault(event: Event) {
    event.preventDefault()
  }

  function getSelection() {
    // @ts-ignore
    return editor.getRootNode().getSelection() as Selection
  }

  return {
    updateOptions(newOptions: Partial<Options>) {
      Object.assign(options, newOptions)
      editor.setAttribute('spellcheck', options.spellcheck ? 'true' : 'false')
    },
    updateCode(code: string, callOnUpdate: boolean = true) {
      editor.textContent = code
      doHighlight(editor)
      if (callOnUpdate) onUpdate(code)
    },
    onUpdate(callback: (code: string) => void) {
      onUpdate = callback
    },
    toString,
    save,
    restore,
    recordHistory,
    destroy() {
      for (let [type, fn] of listeners) {
        editor.removeEventListener(type, fn)
      }
      for (const timeout of timeouts) window.clearTimeout(timeout)
      timeouts.clear()
    },
  }
}
