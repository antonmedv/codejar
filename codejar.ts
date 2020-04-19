type Options = {
  tab: string
}

type HistoryRecord = {
  html: string
  pos: Position
}

type Position = {
  start: number
  end: number
  dir?: "->" | "<-"
}

export function CodeJar(editor: HTMLElement, highlight: (e: HTMLElement) => void, opt: Partial<Options> = {}) {
  const options = {
    tab: "\t",
    ...opt
  }
  let listeners: [string, any][] = []
  let history: HistoryRecord[] = []
  let at = -1
  let focus = false
  let callback: (code: string) => void | undefined
  let prev: string // code content prior keydown event
  let isFirefox = navigator.userAgent.toLowerCase().indexOf("firefox") > -1

  editor.setAttribute("contentEditable", isFirefox ? "true" : "plaintext-only")
  editor.setAttribute("spellcheck", "false")
  editor.style.outline = "none"
  editor.style.overflowWrap = "break-word"
  editor.style.overflowY = "auto"
  editor.style.resize = "vertical"
  editor.style.whiteSpace = "pre-wrap"

  highlight(editor)

  const debounceHighlight = debounce(() => {
    const pos = save()
    highlight(editor)
    restore(pos)
  }, 30)

  let recording = false
  const shouldRecord = (event: KeyboardEvent): boolean => {
    return !isUndo(event) && !isRedo(event)
      && event.key !== "Meta"
      && event.key !== "Control"
      && event.key !== "Alt"
      && !event.key.startsWith("Arrow")
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

  on("keydown", event => {
    if (event.defaultPrevented) return

    prev = toString()
    handleNewLine(event)
    handleTabCharacters(event)
    handleJumpToBeginningOfLine(event)
    handleSelfClosingCharacters(event)
    handleUndoRedo(event)
    if (shouldRecord(event) && !recording) {
      recordHistory()
      recording = true
    }
  })

  on("keyup", event => {
    if (event.defaultPrevented) return
    if (event.isComposing) return

    if (prev !== toString()) debounceHighlight()
    debounceRecordHistory(event)
    if (callback) callback(toString())
  })

  on("focus", _event => {
    focus = true
  })

  on("blur", _event => {
    focus = false
  })

  on("paste", event => {
    recordHistory()
    handlePaste(event)
    recordHistory()
    if (callback) callback(toString())
  })

  function save(): Position {
    const s = window.getSelection()!
    const pos: Position = {start: 0, end: 0, dir: undefined}

    visit(editor, el => {
      if (el === s.anchorNode && el === s.focusNode) {
        pos.start += s.anchorOffset
        pos.end += s.focusOffset
        pos.dir = s.anchorOffset <= s.focusOffset ? "->" : "<-"
        return "stop"
      }

      if (el === s.anchorNode) {
        pos.start += s.anchorOffset
        if (!pos.dir) {
          pos.dir = "->"
        } else {
          return "stop"
        }
      } else if (el === s.focusNode) {
        pos.end += s.focusOffset
        if (!pos.dir) {
          pos.dir = "<-"
        } else {
          return "stop"
        }
      }

      if (el.nodeType === Node.TEXT_NODE) {
        if (pos.dir != "->") pos.start += el.nodeValue!.length
        if (pos.dir != "<-") pos.end += el.nodeValue!.length
      }
    })

    return pos
  }

  function restore(pos: Position) {
    const s = window.getSelection()!
    let startNode: Node | undefined, startOffset = 0
    let endNode: Node | undefined, endOffset = 0

    if (!pos.dir) pos.dir = "->"
    if (pos.start < 0) pos.start = 0
    if (pos.end < 0) pos.end = 0

    // Flip start and end if the direction reversed
    if (pos.dir == "<-") {
      const {start, end} = pos
      pos.start = end
      pos.end = start
    }

    let current = 0

    visit(editor, el => {
      if (el.nodeType !== Node.TEXT_NODE) return

      const len = (el.nodeValue || "").length
      if (current + len >= pos.start) {
        if (!startNode) {
          startNode = el
          startOffset = pos.start - current
        }
        if (current + len >= pos.end) {
          endNode = el
          endOffset = pos.end - current
          return "stop"
        }
      }
      current += len
    })

    // If everything deleted place cursor at editor
    if (!startNode) startNode = editor
    if (!endNode) endNode = editor

    // Flip back the selection
    if (pos.dir == "<-") {
      [startNode, startOffset, endNode, endOffset] = [endNode, endOffset, startNode, startOffset]
    }

    s.setBaseAndExtent(startNode, startOffset, endNode, endOffset)
  }

  function beforeCursor() {
    const s = window.getSelection()!
    const r0 = s.getRangeAt(0)
    const r = document.createRange()
    r.selectNodeContents(editor)
    r.setEnd(r0.startContainer, r0.startOffset)
    return r.toString()
  }

  function afterCursor() {
    const s = window.getSelection()!
    const r0 = s.getRangeAt(0)
    const r = document.createRange()
    r.selectNodeContents(editor)
    r.setStart(r0.endContainer, r0.endOffset)
    return r.toString()
  }

  function handleNewLine(event: KeyboardEvent) {
    if (event.key === "Enter") {
      const before = beforeCursor()
      const after = afterCursor()

      let [padding] = findPadding(before)
      let newLinePadding = padding

      // If last symbol is "{" ident new line
      if (before[before.length - 1] === "{") {
        newLinePadding += options.tab
      }

      if (isFirefox) {
        event.preventDefault()
        insert("\n" + newLinePadding)
      } else {
        // Normal browsers
        if (newLinePadding.length > 0) {
          event.preventDefault()
          insert("\n" + newLinePadding)
        }
      }

      // Place adjacent "}" on next line
      if (newLinePadding !== padding && after[0] === "}") {
        const pos = save()
        insert("\n" + padding)
        restore(pos)
      }
    }
  }

  function handleSelfClosingCharacters(event: KeyboardEvent) {
    const open = `([{'"`
    const close = `)]}'"`
    const codeAfter = afterCursor()
    if (close.includes(event.key) && codeAfter.substr(0, 1) === event.key) {
      const pos = save()
      event.preventDefault()
      pos.start = ++pos.end
      restore(pos)
    } else if (open.includes(event.key)) {
      const pos = save()
      event.preventDefault()
      const text = event.key + close[open.indexOf(event.key)]
      insert(text)
      pos.start = ++pos.end
      restore(pos)
    }
  }

  function handleTabCharacters(event: KeyboardEvent) {
    if (event.key === "Tab") {
      event.preventDefault()
      if (event.shiftKey) {
        const before = beforeCursor()
        let [padding, start,] = findPadding(before)
        if (padding.length > 0) {
          const pos = save()
          // Remove full length tab or just remaining padding
          const len = Math.min(options.tab.length, padding.length)
          restore({start, end: start + len})
          document.execCommand("delete")
          pos.start -= len
          pos.end -= len
          restore(pos)
        }
      } else {
        insert(options.tab)
      }
    }
  }

  function handleJumpToBeginningOfLine(event: KeyboardEvent) {
    if (event.key === "ArrowLeft" && event.metaKey) {
      event.preventDefault()
      const before = beforeCursor()
      let [padding, start, end] = findPadding(before)
      if (before.endsWith(padding)) {
        if (event.shiftKey) {
          const pos = save()
          restore({start, end: pos.end}) // Select from line start.
        } else {
          restore({start, end: start}) // Jump to line start.
        }
      } else {
        if (event.shiftKey) {
          const pos = save()
          restore({start: end, end: pos.end}) // Select from beginning of text.
        } else {
          restore({start: end, end}) // Jump to beginning of text.
        }
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
    event.preventDefault()
    const text = ((event as any).originalEvent || event).clipboardData.getData("text/plain")
    const pos = save()
    insert(text)
    highlight(editor)
    restore({start: pos.end + text.length, end: pos.end + text.length})
  }


  function visit(editor: HTMLElement, visitor: (el: Node) => "stop" | undefined) {
    const queue: Node[] = []

    if (editor.firstChild) queue.push(editor.firstChild)

    let el = queue.pop()

    while (el) {
      if (visitor(el) === "stop")
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
    return isCtrl(event) && !event.shiftKey && event.code === "KeyZ"
  }

  function isRedo(event: KeyboardEvent) {
    return isCtrl(event) && event.shiftKey && event.code === "KeyZ"
  }

  function insert(text: string) {
    text = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;")
    document.execCommand("insertHTML", false, text)
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
    while (i >= 0 && text[i] !== "\n") i--
    i++
    // Find padding of the line.
    let j = i
    while (j < text.length && /[ \t]/.test(text[j])) j++
    return [text.substring(i, j) || "", i, j]
  }

  function toString() {
    return editor.textContent || ""
  }

  return {
    updateOptions(options: Partial<Options>) {
      options = {...options, ...options}
    },
    updateCode(code: string) {
      editor.textContent = code
      highlight(editor)
    },
    onUpdate(cb: (code: string) => void) {
      callback = cb
    },
    toString,
    destroy() {
      for (let [type, fn] of listeners) {
        editor.removeEventListener(type, fn)
      }
    },
  }
}
