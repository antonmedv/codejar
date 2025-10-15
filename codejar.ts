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
  autoclose: {
    open: string;
    close: string;
  }
  bracketMatching: boolean
  bracketMatchingClass: string
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
    autoclose: {
      open: `([{'"`,
      close: `)]}'"`,
    },
    bracketMatching: false,
    bracketMatchingClass: 'matching',
    ...opt,
  }

  const window = options.window
  const document = window.document

  const listeners: [string, any][] = []
  const history: HistoryRecord[] = []
  let at = -1
  let focus = false
  let onUpdate: (code: string) => void | undefined = () => void 0
  let prev: string // code content prior keydown event

  // Variables for bracket matching
  let bracketMap: Array<{pos: number, bracket: string, node: Element}> = []
  let matchingMap: Record<number, number> = {}
  let highlightedNodes: Element[] = [] // Nodes currently highlighted

  editor.setAttribute('contenteditable', 'plaintext-only')
  editor.setAttribute('spellcheck', options.spellcheck ? 'true' : 'false')
  editor.style.outline = 'none'
  editor.style.overflowWrap = 'break-word'
  editor.style.overflowY = 'auto'
  editor.style.whiteSpace = 'pre-wrap'

  const doHighlight = (editor: HTMLElement, pos?: Position) => {
    highlight(editor, pos)
    if (options.bracketMatching) {
      bracketMap = getBracketMap()
      matchingMap = buildMatchingMap(bracketMap)
    }
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

  // Debounced function for bracket matching
  const debounceBracketMatching = debounce(() => {
    if (!options.bracketMatching) return

    // Clear previous highlights
    highlightedNodes.forEach(node => node.classList.remove(options.bracketMatchingClass))
    highlightedNodes = []

    // Get current selection and ensure it's a single cursor position.
    const s = getSelection()
    if (s.rangeCount === 0) return
    const range = s.getRangeAt(0)
    if (!range.collapsed) return // Only highlight when there's a single caret

    const pos = save()
    const cursorPos = pos.start

    // Determine which bracket pair to highlight based on VS Code–like behavior.
    const pairPositions = findBracketPair(cursorPos)

    if (pairPositions.length) {
      for (const position of pairPositions) {
        const bracket = bracketMap.find(b => b.pos === position)
        if (bracket) {
          bracket.node.classList.add(options.bracketMatchingClass)
          highlightedNodes.push(bracket.node)
        }
      }
    }
  }, 30)

  function findBracketPair(cursorPos: number): number[] {
    // Check for adjacent brackets first.
    const before = bracketMap.find(b => b.pos === cursorPos - 1)
    const after = bracketMap.find(b => b.pos === cursorPos)

    // If a closing bracket is immediately after the cursor, prefer that.
    if (after && '}])'.includes(after.bracket)) {
      const match = matchingMap[after.pos]
      if (match !== undefined) {
        return [match, after.pos]
      }
    }
    // Otherwise, if an opening bracket is immediately before the cursor, use that.
    if (before && '{[('.includes(before.bracket)) {
      const match = matchingMap[before.pos]
      if (match !== undefined) {
        return [before.pos, match]
      }
    }

    // If no adjacent bracket is found, search for an enclosing pair.
    let candidate: {open: number, close: number} | null = null
    for (const b of bracketMap) {
      if ('{[('.includes(b.bracket)) {
        const openPos = b.pos
        const closePos = matchingMap[openPos]
        // Check if the cursor lies strictly between the opening and closing bracket.
        if (openPos < cursorPos && closePos > cursorPos) {
          // Choose the innermost (closest) enclosing pair.
          if (!candidate || openPos > candidate.open) {
            candidate = { open: openPos, close: closePos }
          }
        }
      }
    }
    if (candidate) {
      return [candidate.open, candidate.close]
    }
    return []
  }

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
    if (isLegacy && !isCopy(event)) restore(save())
  })

  on('keyup', event => {
    if (event.defaultPrevented) return
    if (event.isComposing) return

    if (prev !== toString()) debounceHighlight()
    debounceRecordHistory(event)
    onUpdate(toString())
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
    onUpdate(toString())
  })

  on('cut', event => {
    recordHistory()
    handleCut(event)
    recordHistory()
    onUpdate(toString())
  })

  // Add bracket matching listeners if enabled
  if (options.bracketMatching) {
    on('keyup', debounceBracketMatching)
    on('mouseup', debounceBracketMatching)
  }

  function save(): Position {
    const s = getSelection()
    const pos: Position = { start: 0, end: 0, dir: undefined }

    let { anchorNode, anchorOffset, focusNode, focusOffset } = s
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
        if (pos.dir != '->') pos.start += el.nodeValue!.length
        if (pos.dir != '<-') pos.end += el.nodeValue!.length
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
    if (pos.dir == '<-') {
      const { start, end } = pos
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
    const open = options.autoclose.open
    const close = options.autoclose.close
    if (open.includes(event.key)) {
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
    if (event.key === 'Tab') {
      preventDefault(event)
      if (event.shiftKey) {
        const before = beforeCursor()
        let [padding, start] = findPadding(before)
        if (padding.length > 0) {
          const pos = save()
          // Remove full length tab or just remaining padding
          const len = Math.min(options.tab.length, padding.length)
          restore({ start, end: start + len })
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
    const text = originalEvent.clipboardData.getData('text/plain').replace(/\r\n?/g, '\n')
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
    const pos = save()
    const selection = getSelection()
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

  function getBracketMap(): Array<{pos: number, bracket: string, node: Element}> {
    const brackets: Array<{pos: number, bracket: string, node: Element}> = []
    let pos = 0

    function traverse(node: Node) {
      if (node.nodeType === Node.TEXT_NODE) {
        pos += node.nodeValue?.length || 0
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        // If it's a SPAN and qualifies as a bracket token.
        if (node.nodeName === 'SPAN' && node.childNodes.length === 1 && node.firstChild?.nodeType === Node.TEXT_NODE) {
          const text = node.textContent
          if (text?.length === 1 && '{[()]}'.includes(text)) {
            brackets.push({ pos, bracket: text, node: node as Element })
            pos += 1
            return // Skip traversing children, we've handled the token.
          }
        }
        // For non-bracket elements or multi-character spans, traverse children.
        for (let i = 0; i < node.childNodes.length; i++) {
          traverse(node.childNodes[i])
        }
      }
    }

    traverse(editor)
    return brackets
  }

  function buildMatchingMap(brackets: Array<{pos: number, bracket: string, node: Element}>): Record<number, number> {
    const matching: Record<number, number> = {}
    const stack: Array<{pos: number, bracket: string, node: Element}> = []
    const bracketPairs: Record<string, string> = {
      '(': ')',
      '[': ']',
      '{': '}'
    }

    for (const bracket of brackets) {
      if (bracket.bracket in bracketPairs) {
        // Opening bracket: push it onto the stack.
        stack.push(bracket)
      } else {
        // Closing bracket: iterate backward in the stack to find a matching opening bracket.
        for (let i = stack.length - 1; i >= 0; i--) {
          if (bracketPairs[stack[i].bracket] === bracket.bracket) {
            const openBracket = stack.splice(i, 1)[0]
            matching[openBracket.pos] = bracket.pos
            matching[bracket.pos] = openBracket.pos
            break
          }
        }
      }
    }
    return matching
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
    return (typeof key === 'string' ? key : String.fromCharCode(key)).toUpperCase()
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
    // @ts-ignore
    return editor.getRootNode().getSelection() as Selection
  }

  return {
    updateOptions(newOptions: Partial<Options>) {
      Object.assign(options, newOptions)
    },
    updateCode(code: string, callOnUpdate: boolean = true) {
      editor.textContent = code
      doHighlight(editor)
      callOnUpdate && onUpdate(code)
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
    },
  }
}
