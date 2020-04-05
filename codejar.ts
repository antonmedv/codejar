type Options = {
  tab: string
}

export class CodeJar {
  private readonly editor: HTMLElement
  private readonly highlight: (e: HTMLElement) => void
  private readonly listeners: [string, any][] = []
  private options: Options
  private history: HistoryRecord[] = []
  private at = -1
  private focus = false
  private callback?: (code: string) => void

  constructor(editor: HTMLElement, highlight: (e: HTMLElement) => void, options: Partial<Options> = {}) {
    this.editor = editor
    this.highlight = highlight
    this.options = {
      tab: "\t",
      ...options
    }

    this.editor.setAttribute("contentEditable", "true")
    this.editor.setAttribute("spellcheck", "false")
    this.editor.style.outline = "none"
    this.editor.style.overflowWrap = "break-word"
    this.editor.style.overflowY = "auto"
    this.editor.style.resize = "vertical"
    this.editor.style.whiteSpace = "pre-wrap"

    this.highlight(this.editor)
    const debounceHighlight = debounce(() => {
      const pos = this.save()
      this.highlight(this.editor)
      this.restore(pos)
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
        this.recordHistory()
        recording = false
      }
    }, 300)

    const on = <K extends keyof HTMLElementEventMap>(type: K, fn: (event: HTMLElementEventMap[K]) => void) => {
      this.listeners.push([type, fn])
      this.editor.addEventListener(type, fn)
    }

    on("keydown", event => {
      this.handleNewLine(event)
      this.handleTabCharacters(event)
      this.handleJumpToBeginningOfLine(event)
      this.handleSelfClosingCharacters(event)
      this.handleUndoRedo(event)
      if (shouldRecord(event) && !recording) {
        this.recordHistory()
        recording = true
      }
    })

    on("keyup", event => {
      debounceHighlight()
      debounceRecordHistory(event)
      if (this.callback) this.callback(this.toString())
    })

    on("focus", _event => {
      this.focus = true
    })

    on("blur", _event => {
      this.focus = false
    })

    on("paste", event => {
      this.recordHistory()
      this.handlePaste(event)
      this.recordHistory()
      if (this.callback) this.callback(this.toString())
    })
  }

  destroy() {
    for (let [type, fn] of this.listeners) {
      this.editor.removeEventListener(type, fn)
    }
  }

  private save(): Position {
    const s = window.getSelection()!
    const r = s.getRangeAt(0)

    const queue: ChildNode[] = []
    if (this.editor.firstChild) queue.push(this.editor.firstChild)

    const pos: Position = {start: 0, end: 0}

    let startFound = false
    let el = queue.shift()
    while (el) {
      if (el === r.startContainer) {
        pos.start += r.startOffset
        startFound = true
      }
      if (el === r.endContainer) {
        pos.end += r.endOffset
        break
      }
      if (el.nodeType === Node.TEXT_NODE) {
        let len = el.nodeValue!.length
        if (!startFound) pos.start += len
        pos.end += len
      }
      if (el.nextSibling) queue.push(el.nextSibling)
      if (el.firstChild) queue.push(el.firstChild)
      el = queue.pop()
    }

    return pos
  }

  private restore(pos: Position) {
    const s = window.getSelection()!
    s.removeAllRanges()

    if (pos.start < 0) pos.start = 0
    if (pos.end < 0) pos.end = 0

    const r = document.createRange()
    r.setStart(this.editor, 0)
    r.setEnd(this.editor, 0)

    const queue: ChildNode[] = []
    if (this.editor.firstChild) queue.push(this.editor.firstChild)

    let n = 0, startFound = false
    let el = queue.shift()
    while (el) {
      if (el.nodeType === Node.TEXT_NODE) {
        let len = (el.nodeValue || "").length
        n += len
        if (!startFound && n >= pos.start) {
          const offset = len - (n - pos.start)
          r.setStart(el, offset)
          startFound = true
        }
        if (n >= pos.end) {
          const offset = len - (n - pos.end)
          r.setEnd(el, offset)
          break
        }
      }
      if (el.nextSibling) queue.push(el.nextSibling)
      if (el.firstChild) queue.push(el.firstChild)
      el = queue.pop()
    }
    s.addRange(r)
  }

  private beforeCursor() {
    const s = window.getSelection()!
    const r0 = s.getRangeAt(0)
    const r = document.createRange()
    r.selectNodeContents(this.editor)
    r.setEnd(r0.startContainer, r0.startOffset)
    return r.toString()
  }

  private afterCursor() {
    const s = window.getSelection()!
    const r0 = s.getRangeAt(0)
    const r = document.createRange()
    r.selectNodeContents(this.editor)
    r.setStart(r0.endContainer, r0.endOffset)
    return r.toString()
  }

  private handleNewLine(event: KeyboardEvent) {
    if (event.key === "Enter") {
      event.preventDefault()
      const before = this.beforeCursor()
      const after = this.afterCursor()
      let [padding] = findPadding(before)
      let doublePadding = padding
      if (before[before.length - 1] === "{") doublePadding += this.options.tab
      let text = "\n" + doublePadding
      // Add an extra newline, otherwise Enter will not work at the end.
      if (after.length === 0) text += "\n"
      document.execCommand("insertHTML", false, text)
      if (after[0] === "}") {
        const pos = this.save()
        document.execCommand("insertHTML", false, "\n" + padding)
        this.restore(pos)
      }
    }
  }

  private handleSelfClosingCharacters(event: KeyboardEvent) {
    const open = `([{'"`
    const close = `)]}'"`
    const codeAfter = this.afterCursor()
    const pos = this.save()
    if (close.includes(event.key) && codeAfter.substr(0, 1) === event.key) {
      event.preventDefault()
      pos.start = ++pos.end
      this.restore(pos)
    } else if (open.includes(event.key)) {
      event.preventDefault()
      const text = event.key + close[open.indexOf(event.key)]
      document.execCommand("insertText", false, text)
      pos.start = ++pos.end
      this.restore(pos)
    }
  }

  private handleTabCharacters(event: KeyboardEvent) {
    if (event.key === "Tab") {
      event.preventDefault()
      if (event.shiftKey) {
        const before = this.beforeCursor()
        let [padding, start,] = findPadding(before)
        if (padding.length > 0) {
          const pos = this.save()
          // Remove full length tab or just remaining padding
          const len = Math.min(this.options.tab.length, padding.length)
          this.restore({start, end: start + len})
          document.execCommand("delete")
          pos.start -= len
          pos.end -= len
          this.restore(pos)
        }
      } else {
        document.execCommand("insertText", false, this.options.tab)
      }
    }
  }

  private handleJumpToBeginningOfLine(event: KeyboardEvent) {
    if (event.key === "ArrowLeft" && event.metaKey) {
      event.preventDefault()
      const before = this.beforeCursor()
      let [padding, start, end] = findPadding(before)
      if (before.endsWith(padding)) {
        if (event.shiftKey) {
          const pos = this.save()
          this.restore({start, end: pos.end}) // Select from line start.
        } else {
          this.restore({start, end: start}) // Jump to line start.
        }
      } else {
        if (event.shiftKey) {
          const pos = this.save()
          this.restore({start: end, end: pos.end}) // Select from beginning of text.
        } else {
          this.restore({start: end, end}) // Jump to beginning of text.
        }
      }
    }
  }

  private handleUndoRedo(event: KeyboardEvent) {
    if (isUndo(event)) {
      event.preventDefault()
      this.at--
      const record = this.history[this.at]
      if (record) {
        this.editor.innerHTML = record.html
        this.restore(record.pos)
      }
      if (this.at < 0) this.at = 0
    }
    if (isRedo(event)) {
      event.preventDefault()
      this.at++
      const record = this.history[this.at]
      if (record) {
        this.editor.innerHTML = record.html
        this.restore(record.pos)
      }
      if (this.at >= this.history.length) this.at--
    }
  }

  private recordHistory() {
    if (!this.focus) return

    const html = this.editor.innerHTML
    const pos = this.save()

    const lastRecord = this.history[this.at]
    if (lastRecord) {
      if (lastRecord.html === html
        && lastRecord.pos.start === pos.start
        && lastRecord.pos.end === pos.end) return
    }

    this.at++
    this.history[this.at] = {html, pos}
    this.history.splice(this.at + 1)

    const maxHistory = 300
    if (this.at > maxHistory) {
      this.at = maxHistory
      this.history.splice(0, 1)
    }
  }

  private handlePaste(event: ClipboardEvent) {
    event.preventDefault()
    const text = ((event as any).originalEvent || event).clipboardData.getData("text/plain")
    const pos = this.save()
    document.execCommand("insertText", false, text)
    let html = this.editor.innerHTML
    html = html
      .replace(/<div>/g, "\n")
      .replace(/<br>/g, "")
      .replace(/<\/div>/g, "")
    this.editor.innerHTML = html
    this.highlight(this.editor)
    this.restore({start: pos.end + text.length, end: pos.end + text.length})
  }

  updateOptions(options: Partial<Options>) {
    this.options = {...this.options, ...options}
  }

  updateCode(code: string) {
    this.editor.textContent = code
    this.highlight(this.editor)
  }

  onUpdate(callback: (code: string) => void) {
    this.callback = callback
  }

  toString() {
    return this.editor.textContent || ""
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

type HistoryRecord = {
  html: string
  pos: Position
}

type Position = {
  start: number
  end: number
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
