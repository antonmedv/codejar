const globalWindow = window

type Options = {
  tab: string
  indentOn: RegExp
  spellcheck: boolean
  catchTab: boolean
  preserveIdent: boolean
  addClosing: boolean
  history: boolean
  window: typeof window
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

export function CodeJar(editor: HTMLElement, highlight: (e: HTMLElement, pos?: Position) => void, opt: Partial<Options> = {}) {
  const options: Options = {
    tab: '\t',
    indentOn: /{$/,
    spellcheck: false,
    catchTab: true,
    preserveIdent: true,
    addClosing: true,
    history: true,
    window: globalWindow,
    ...opt
  }

  const window = options.window
  const document = window.document

  let listeners: [string, any][] = []
  let history: HistoryRecord[] = []
  let at = -1
  let focus = false
  let callback: (code: string) => void | undefined
  let prev: string // code content prior keydown event

  editor.setAttribute('contenteditable', 'plaintext-only')
  editor.setAttribute('spellcheck', options.spellcheck ? 'true' : 'false')
  editor.style.outline = 'none'
  editor.style.overflowWrap = 'break-word'
  editor.style.overflowY = 'auto'
  editor.style.whiteSpace = 'pre-wrap'

  let isLegacy = false // true if plaintext-only is not supported

  highlight(editor)
  if (editor.contentEditable !== 'plaintext-only') isLegacy = true
  if (isLegacy) editor.setAttribute('contenteditable', 'true')

  const debounceHighlight = debounce(() => {
    const pos = save()
    highlight(editor, pos)
    restore(pos)
  }, 30)

  let recording = false
  const shouldRecord = (event: KeyboardEvent): boolean => {
    return !isUndo(event) && !isRedo(event)
      && event.key !== 'Meta'
      && event.key !== 'Control'
      && event.key !== 'Alt'
      && !event.key.startsWith('Arrow')
  }
  const debounceRecordHistory = debounce((event: KeyboardEvent) => {
    if (shouldRecord(event)) {
      recordHistory()
      recording = false
    }
  }, 300)

  const on = <K extends keyof HTMLElementEventMap>(type: K, fn: (event: HTMLElementEventMap[K]) => void) => {
    listeners.push([type, fn])
    editor.addEventListener(type, fn)
  }

  on('keydown', event => {
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

    if (isLegacy) restore(save())
  })

  on('keyup', event => {
    if (event.defaultPrevented) return
    if (event.isComposing) return

    if (prev !== toString()) debounceHighlight()
    debounceRecordHistory(event)
    if (callback) callback(toString())
  })

  on('focus', _event => {
    focus = true
  })

  on('blur', _event => {
    focus = false
  })

  on('paste', event => {
    recordHistory()
    handlePaste(event)
    recordHistory()
    if (callback) callback(toString())
  })

  function save(): Position {
    const s = getSelection()
    const pos: Position = {start: 0, end: 0, dir: undefined}

    let {anchorNode, anchorOffset, focusNode, focusOffset} = s
    if (!anchorNode || !focusNode) throw 'error1'

    // Selection anchor and focus are expected to be text nodes,
    // so normalize them.
    if (anchorNode.nodeType === Node.ELEMENT_NODE) {
      const node = document.createTextNode('')
      anchorNode.insertBefore(node, anchorNode.childNodes[anchorOffset])
      anchorNode = node
      anchorOffset = 0
    }
    if (focusNode.nodeType === Node.ELEMENT_NODE) {
      const node = document.createTextNode('')
      focusNode.insertBefore(node, focusNode.childNodes[focusOffset])
      focusNode = node
      focusOffset = 0
    }

    visit(editor, el => {
      if (el === anchorNode && el === focusNode) {
        pos.start += anchorOffset
        pos.end += focusOffset
        pos.dir = anchorOffset <= focusOffset ? '->' : '<-'
        return 'stop'
      }

      if (el === anchorNode) {
        pos.start += anchorOffset
        if (!pos.dir) {
          pos.dir = '->'
        } else {
          return 'stop'
        }
      } else if (el === focusNode) {
        pos.end += focusOffset
        if (!pos.dir) {
          pos.dir = '<-'
        } else {
          return 'stop'
        }
      }

      if (el.nodeType === Node.TEXT_NODE) {
        if (pos.dir != '->') pos.start += el.nodeValue!.length
        if (pos.dir != '<-') pos.end += el.nodeValue!.length
      }
    })

    // collapse empty text nodes
    editor.normalize()

    return pos
  }

  function restore(pos: Position) {
    const s = getSelection()
    let startNode: Node | undefined, startOffset = 0
    let endNode: Node | undefined, endOffset = 0

    if (!pos.dir) pos.dir = '->'
    if (pos.start < 0) pos.start = 0
    if (pos.end < 0) pos.end = 0

    // Flip start and end if the direction reversed
    if (pos.dir == '<-') {
      const {start, end} = pos
      pos.start = end
      pos.end = start
    }

    let current = 0

    visit(editor, el => {
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

    if (!startNode) startNode = editor, startOffset = editor.childNodes.length
    if (!endNode) endNode = editor, endOffset = editor.childNodes.length

    // Flip back the selection
    if (pos.dir == '<-') {
      [startNode, startOffset, endNode, endOffset] = [endNode, endOffset, startNode, startOffset]
    }

    s.setBaseAndExtent(startNode, startOffset, endNode, endOffset)
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
      // Allow user defines indent rule
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
      if (newLinePadding !== padding && after[0] === '}') {
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
        insert('\n ')
        const pos = save()
        pos.start = --pos.end
        restore(pos)
      } else {
        insert('\n')
      }
    }
  }

  function handleSelfClosingCharacters(event: KeyboardEvent) {
    const open = `([{'"`
    const close = `)]}'"`
    const codeAfter = afterCursor()
    const codeBefore = beforeCursor()
    const escapeCharacter = codeBefore.substr(codeBefore.length - 1) === '\\'
    const charAfter = codeAfter.substr(0, 1)
    if (close.includes(event.key) && !escapeCharacter && charAfter === event.key) {
      // We already have closing char next to cursor.
      // Move one char to right.
      const pos = save()
      preventDefault(event)
      pos.start = ++pos.end
      restore(pos)
    } else if (
      open.includes(event.key)
      && !escapeCharacter
      && (`"'`.includes(event.key) || ['', ' ', '\n'].includes(charAfter))
    ) {
      preventDefault(event)
      const pos = save()
      const wrapText = pos.start == pos.end ? '' : getSelection().toString()
      const text = event.key + wrapText + close[open.indexOf(event.key)]
      insert(text)
      pos.start++
      pos.end++
      restore(pos)
    }
  }

  function handleTabCharacters(event: KeyboardEvent) {
    if (event.key === 'Tab') {
      preventDefault(event)
      if (event.shiftKey) {
        const before = beforeCursor()
        let [padding, start,] = findPadding(before)
        if (padding.length > 0) {
          const pos = save()
          // Remove full length tab or just remaining padding
          const len = Math.min(options.tab.length, padding.length)
          restore({start, end: start + len})
          document.execCommand('delete')
          pos.start -= len
          pos.end -= len
          restore(pos)
        }
      } else {
        insert(options.tab)
      }
    }
  }

  function handleUndoRedo(event: KeyboardEvent) {
    if (isUndo(event)) {
      preventDefault(event)
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
      if (lastRecord.html === html
        && lastRecord.pos.start === pos.start
        && lastRecord.pos.end === pos.end) return
    }

    at++
    history[at] = {html, pos}
    history.splice(at + 1)

    const maxHistory = 300
    if (at > maxHistory) {
      at = maxHistory
      history.splice(0, 1)
    }
  }

  function handlePaste(event: ClipboardEvent) {
    preventDefault(event)
    const text = ((event as any).originalEvent || event)
      .clipboardData
      .getData('text/plain')
      .replace(/\r/g, '')
    const pos = save()
    insert(text)
    highlight(editor)
    restore({start: pos.start + text.length, end: pos.start + text.length})
  }


  function visit(editor: HTMLElement, visitor: (el: Node) => 'stop' | undefined) {
    const queue: Node[] = []

    if (editor.firstChild) queue.push(editor.firstChild)

    let el = queue.pop()

    while (el) {
      if (visitor(el) === 'stop')
        break

      if (el.nextSibling) queue.push(el.nextSibling)
      if (el.firstChild) queue.push(el.firstChild)

      el = queue.pop()
    }
  }

  function isCtrl(event: KeyboardEvent) {
    return event.metaKey || event.ctrlKey
  }

  function isUndo(event: KeyboardEvent) {
    return isCtrl(event) && !event.shiftKey && event.code === 'KeyZ'
  }

  function isRedo(event: KeyboardEvent) {
    return isCtrl(event) && event.shiftKey && event.code === 'KeyZ'
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
      clearTimeout(timeout)
      timeout = window.setTimeout(() => cb(...args), wait)
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
    if (editor.parentNode?.nodeType == Node.DOCUMENT_FRAGMENT_NODE) {
      return (editor.parentNode as Document).getSelection()!
    }
    return window.getSelection()!
  }

  return {
    updateOptions(newOptions: Partial<Options>) {
      Object.assign(options, newOptions)
    },
    updateCode(code: string) {
      editor.textContent = code
      highlight(editor)
    },
    onUpdate(cb: (code: string) => void) {
      callback = cb
    },
    toString,
    save,
    restore,
    recordHistory,
    destroy() {
      for (let [type, fn] of listeners) {
        editor.removeEventListener(type, fn)
      }
    },
  }
}
