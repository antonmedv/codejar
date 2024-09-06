const globalWindow = window

type Options = {
  tab: string
  indentOn: RegExp
  moveToNewLine: RegExp
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
    indentOn: /[({\[]$/,
    moveToNewLine: /^[)}\]]/,
    spellcheck: false,
    catchTab: true,
    preserveIdent: true,
    addClosing: true,
    history: true,
    window: globalWindow,
    ...opt,
  }

  const window = options.window
  const document = window.document

  const listeners: [keyof HTMLElementEventMap, (event: Event) => void][] = []
  const history: HistoryRecord[] = []
  let at = -1
  let focus = false
  let onUpdate: (code: string) => void = () => { }
  let prev: string // code content prior keydown event

  editor.setAttribute('contenteditable', 'plaintext-only')
  editor.setAttribute('spellcheck', options.spellcheck ? 'true' : 'false')
  editor.style.outline = 'none'
  editor.style.overflowWrap = 'break-word'
  editor.style.overflowY = 'auto'
  editor.style.whiteSpace = 'pre-wrap'

  let isLegacy = false // true if plaintext-only is not supported
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
    listeners.push([type, fn as (event: Event) => void])
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
    if (isLegacy && !isCopy(event)) restore(save())
  })

  on('keyup', event => {
    if (event.defaultPrevented) return
    if (event.isComposing) return

    if (prev !== toString()) debounceHighlight()
    debounceRecordHistory(event)
    onUpdate(toString())
  })

  on('focus', () => focus = true)
  on('blur', () => focus = false)

  on('paste', event => {
    recordHistory()
    handlePaste(event)
    recordHistory()
    onUpdate(toString())
  })

  on('cut', event => {
    recordHistory()
    handleCut(event)
    recordHistory()
    onUpdate(toString())
  })

  function save(): Position {
    const s = getSelection()
    const pos: Position = {start: 0, end: 0, dir: undefined}

    let {anchorNode, anchorOffset, focusNode, focusOffset} = s
    if (!anchorNode || !focusNode) throw 'error1'

    // If the anchor and focus are the editor element, return either a full
    // highlight or a start/end cursor position depending on the selection
    if (anchorNode === editor && focusNode === editor) {
      pos.start = (anchorOffset > 0 && editor.textContent) ? editor.textContent.length : 0
      pos.end = (focusOffset > 0 && editor.textContent) ? editor.textContent.length : 0
      pos.dir = (focusOffset >= anchorOffset) ? '->' : '<-'
      return pos
    }

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
        if (pos.dir !== '->') pos.start += el.nodeValue!.length
        if (pos.dir !== '<-') pos.end += el.nodeValue!.length
      }
    })

    editor.normalize() // collapse empty text nodes
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
    if (pos.dir === '<-') {
      const {start, end} = pos
      pos.start = end
      pos.end = start
    }

    let current = 0

    visit(editor, el => {
      if (el.nodeType !== Node.TEXT_NODE) return

      const len = el.nodeValue?.length ?? 0
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
    if (pos.dir === '<-') {
      [startNode, startOffset, endNode, endOffset] = [endNode, endOffset, startNode, startOffset]
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
        if (el.getAttribute('contenteditable') === 'false') {
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

      const [padding] = findPadding(before)
      let newLinePadding = padding

      // If last symbol is "{" ident new line
      if (options.indentOn.test(before)) {
        newLinePadding += options.tab
      }

      // Preserve padding
      if (newLinePadding.length > 0) {
        event.preventDefault()
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
      event.preventDefault()
      event.stopPropagation()
      if (afterCursor() === '') {
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
    if (open.includes(event.key)) {
      event.preventDefault()
      const pos = save()
      const wrapText = pos.start === pos.end ? '' : getSelection().toString()
      const text = event.key + wrapText + close[open.indexOf(event.key)]
      insert(text)
      pos.start++
      pos.end++
      restore(pos)
    }
  }

  function handleTabCharacters(event: KeyboardEvent) {
    if (event.key === 'Tab') {
      event.preventDefault()
      if (event.shiftKey) {
        const before = beforeCursor()
        const [padding, start] = findPadding(before)
        if (padding.length > 0) {
          const pos = save()
          // Remove full length tab or just remaining padding
          const len = Math.min(options.tab.length, padding.length)
          restore({start, end: start + len})
          insert('') // deletes the selection
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
      event.preventDefault()
      at--
      const record = history[at]
      if (record) {
        editor.innerHTML = record.html
        restore(record.pos)
      }
      if (at < 0) at = 0
    }
    if (isRedo(event)) {
      event.preventDefault()
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
    if (event.defaultPrevented) return
    event.preventDefault()
    const text = event.clipboardData?.getData('text/plain').replace(/\r\n?/g, '\n') ?? ''
    const pos = save()
    insert(text)
    highlight(editor)
    restore({
      start: Math.min(pos.start, pos.end) + text.length,
      end: Math.min(pos.start, pos.end) + text.length,
      dir: '<-',
    })
  }

  function handleCut(event: ClipboardEvent) {
    const pos = save()
    const selection = getSelection()
    event.clipboardData?.setData('text/plain', selection.toString())
    insert('') // deletes the selection
    highlight(editor)
    restore({
      start: Math.min(pos.start, pos.end),
      end: Math.min(pos.start, pos.end),
      dir: '<-',
    })
    event.preventDefault()
  }

  function visit(editor: HTMLElement, visitor: (el: Node) => 'stop' | undefined) {
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
    return isCtrl(event) && !event.shiftKey && getKey(event) === 'Z'
  }

  function isRedo(event: KeyboardEvent) {
    return isCtrl(event) && event.shiftKey && getKey(event) === 'Z'
  }

  function isCopy(event: KeyboardEvent) {
    return isCtrl(event) && getKey(event) === 'C'
  }

  function getKey(event: KeyboardEvent): string | undefined {
    return event.key.toUpperCase()
  }

  function insert(inserted: string) {
    let {start, end} = save()
    const text = toString()
    const before = text.slice(0, start)
    const after = text.slice(end)
    editor.textContent = before + inserted + after
    start += inserted.length
    restore({start, end: start})
  }

  function debounce<Args extends unknown[]>(cb: (...args: Args) => void, wait: number) {
    let timeout = 0
    return (...args: Args) => {
      clearTimeout(timeout)
      timeout = setTimeout(() => cb(...args), wait)
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
    return [text.substring(i, j), i, j]
  }

  function toString() {
    return editor.textContent ?? ''
  }

  function getSelection() {
    return (editor.getRootNode() as Document).getSelection()!
  }

  return {
    updateOptions(newOptions: Partial<Options>) {
      Object.assign(options, newOptions)
    },
    updateCode(code: string, callOnUpdate: boolean = true) {
      editor.textContent = code
      highlight(editor)
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
      for (const [type, fn] of listeners) {
        editor.removeEventListener(type, fn)
      }
    },
  }
}
