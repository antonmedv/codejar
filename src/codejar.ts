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

export class CodeJar {
    private window: Window;
    private document: Document;
    private listeners: [string, any][];
    private readonly history: HistoryRecord[];
    private at: number;
    private focus: boolean;
    private callback: (code: string) => void | undefined;
    private prev: string // code content prior keydown event
    private readonly isFirefox: boolean;
    private readonly editor: HTMLElement;
    private options: Options;
    private readonly highlight: (e: HTMLElement, pos?: Position) => void;
    private recording = false;

    constructor(editor: HTMLElement, highlight: (e: HTMLElement, pos?: Position) => void, opt: Partial<Options> = {}) {
        this.editor = editor;
        this.highlight = highlight;
        this.options = {
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

        this.window = this.options.window
        this.document = window.document

        this.listeners = []
        this.history = []
        this.at = -1
        this.focus = false
        this.isFirefox = navigator.userAgent.toLowerCase().indexOf('firefox') > -1

        this.editor.setAttribute('contentEditable', this.isFirefox ? 'true' : 'plaintext-only')
        this.editor.setAttribute('spellcheck', this.options.spellcheck ? 'true' : 'false')
        this.editor.style.outline = 'none'
        this.editor.style.overflowWrap = 'break-word'
        this.editor.style.overflowY = 'auto'
        this.editor.style.resize = 'vertical'
        this.editor.style.whiteSpace = 'pre-wrap'

        this.highlight(this.editor)

        this.on('keydown', event => {
            if (event.defaultPrevented) return

            this.prev = this.toString()
            console.log(`prev is ${this.prev}`);
            if (this.options.preserveIdent) this.handleNewLine(event)
            else this.firefoxNewLineFix(event)
            if (this.options.catchTab) this.handleTabCharacters(event)
            if (this.options.addClosing) this.handleSelfClosingCharacters(event)
            if (this.options.history) {
                this.handleUndoRedo(event)
                if (this.shouldRecord(event) && !this.recording) {
                    this.recordHistory()
                    this.recording = true
                }
            }
        })

        this.on('keyup', event => {
            console.log(`keyup`);
            if (event.defaultPrevented) return
            if (event.isComposing) return

            if (this.prev !== this.toString()) this.debounceHighlight()
            this.debounceRecordHistory(event)
            if (this.callback) this.callback(this.toString())
        })

        this.on('focus', _event => {
            this.focus = true
        })

        this.on('blur', _event => {
            this.focus = false
        })

        this.on('paste', event => {
            this.recordHistory()
            this.handlePaste(event)
            this.recordHistory()
            if (this.callback) this.callback(this.toString())
        })
    }

    private shouldRecord = (event: KeyboardEvent): boolean => {
        return !this.isUndo(event) && !this.isRedo(event)
            && event.key !== 'Meta'
            && event.key !== 'Control'
            && event.key !== 'Alt'
            && !event.key.startsWith('Arrow')
    }
    private debounceRecordHistory = this.debounce((event: KeyboardEvent) => {
        if (this.shouldRecord(event)) {
            this.recordHistory()
            this.recording = false
        }
    }, 300)

    private debounceHighlight = this.debounce(() => {
        const pos = this.save()
        this.highlight(this.editor, pos)
        this.restore(pos)
    }, 30)

    public updateOptions(newOptions: Partial<Options>) {
        Object.assign(this.options, newOptions)
    }

    public updateCode(code: string) {
        this.editor.textContent = code
        this.highlight(this.editor)
    }

    public onUpdate(cb: (code: string) => void) {
        this.callback = cb
    }

    private on = <K extends keyof HTMLElementEventMap>(type: K, fn: (event: HTMLElementEventMap[K]) => void) => {
        console.log(`listen for ${type}`);
        this.listeners.push([type, fn])
        this.editor.addEventListener(type, fn)
    }

    public save(): Position {
        const s = getSelection()
        const pos: Position = {start: 0, end: 0, dir: undefined}

        this.visit(this.editor, el => {
            if (el === s.anchorNode && el === s.focusNode) {
                pos.start += s.anchorOffset
                pos.end += s.focusOffset
                pos.dir = s.anchorOffset <= s.focusOffset ? '->' : '<-'
                return 'stop'
            }

            if (el === s.anchorNode) {
                pos.start += s.anchorOffset
                if (!pos.dir) {
                    pos.dir = '->'
                } else {
                    return 'stop'
                }
            } else if (el === s.focusNode) {
                pos.end += s.focusOffset
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

        return pos
    }

    public restore(pos: Position) {
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

        this.visit(this.editor, el => {
            if (el.nodeType !== Node.TEXT_NODE) return

            const len = (el.nodeValue || '').length
            if (current + len >= pos.start) {
                if (!startNode) {
                    startNode = el
                    startOffset = pos.start - current
                }
                if (current + len >= pos.end) {
                    endNode = el
                    endOffset = pos.end - current
                    return 'stop'
                }
            }
            current += len
        })

        // If everything deleted place cursor at editor
        if (!startNode) startNode = this.editor
        if (!endNode) endNode = this.editor

        // Flip back the selection
        if (pos.dir == '<-') {
            [startNode, startOffset, endNode, endOffset] = [endNode, endOffset, startNode, startOffset]
        }

        s.setBaseAndExtent(startNode, startOffset, endNode, endOffset)
    }

    private beforeCursor() {
        const s = getSelection()
        const r0 = s.getRangeAt(0)
        const r = document.createRange()
        r.selectNodeContents(this.editor)
        r.setEnd(r0.startContainer, r0.startOffset)
        return r.toString()
    }

    private afterCursor() {
        const s = getSelection()
        const r0 = s.getRangeAt(0)
        const r = document.createRange()
        r.selectNodeContents(this.editor)
        r.setStart(r0.endContainer, r0.endOffset)
        return r.toString()
    }

    private handleNewLine(event: KeyboardEvent) {
        if (event.key === 'Enter') {
            const before = this.beforeCursor()
            const after = this.afterCursor()

            let [padding] = this.findPadding(before)
            let newLinePadding = padding

            // If last symbol is "{" ident new line
            // Allow user defines indent rule
            if (this.options.indentOn.test(before)) {
                newLinePadding += this.options.tab
            }

            // Preserve padding
            if (newLinePadding.length > 0) {
                this.preventDefault(event)
                event.stopPropagation()
                this.insert('\n' + newLinePadding)
            } else {
                this.firefoxNewLineFix(event)
            }

            // Place adjacent "}" on next line
            if (newLinePadding !== padding && after[0] === '}') {
                const pos = this.save()
                this.insert('\n' + padding)
                this.restore(pos)
            }
        }
    }

    private firefoxNewLineFix(event: KeyboardEvent) {
        // Firefox does not support plaintext-only mode
        // and puts <div><br></div> on Enter. Let's help.
        if (this.isFirefox && event.key === 'Enter') {
            this.preventDefault(event)
            event.stopPropagation()
            if (this.afterCursor() == '') {
                this.insert('\n ')
                const pos = this.save()
                pos.start = --pos.end
                this.restore(pos)
            } else {
                this.insert('\n')
            }
        }
    }

    private handleSelfClosingCharacters(event: KeyboardEvent) {
        const open = `([{'"`
        const close = `)]}'"`
        const codeAfter = this.afterCursor()
        const codeBefore = this.beforeCursor()
        const escapeCharacter = codeBefore.substr(codeBefore.length - 1) === '\\'
        const charAfter = codeAfter.substr(0, 1)
        if (close.includes(event.key) && !escapeCharacter && charAfter === event.key) {
            // We already have closing char next to cursor.
            // Move one char to right.
            const pos = this.save()
            this.preventDefault(event)
            pos.start = ++pos.end
            this.restore(pos)
        } else if (
            open.includes(event.key)
            && !escapeCharacter
            && (`"'`.includes(event.key) || ['', ' ', '\n'].includes(charAfter))
        ) {
            this.preventDefault(event)
            const pos = this.save()
            const wrapText = pos.start == pos.end ? '' : getSelection().toString()
            const text = event.key + wrapText + close[open.indexOf(event.key)]
            this.insert(text)
            pos.start++
            pos.end++
            this.restore(pos)
        }
    }

    private handleTabCharacters(event: KeyboardEvent) {
        if (event.key === 'Tab') {
            this.preventDefault(event)
            if (event.shiftKey) {
                const before = this.beforeCursor()
                let [padding, start] = this.findPadding(before)
                if (padding.length > 0) {
                    const pos = this.save()
                    // Remove full length tab or just remaining padding
                    const len = Math.min(this.options.tab.length, padding.length)
                    this.restore({start, end: start + len})
                    document.execCommand('delete')
                    pos.start -= len
                    pos.end -= len
                    this.restore(pos)
                }
            } else {
                this.insert(this.options.tab)
            }
        }
    }

    private handleUndoRedo(event: KeyboardEvent) {
        if (this.isUndo(event)) {
            this.preventDefault(event)
            this.at--
            const record = this.history[this.at]
            if (record) {
                this.editor.innerHTML = record.html
                this.restore(record.pos)
            }
            if (this.at < 0) this.at = 0
        }
        if (this.isRedo(event)) {
            this.preventDefault(event)
            this.at++
            const record = this.history[this.at]
            if (record) {
                this.editor.innerHTML = record.html
                this.restore(record.pos)
            }
            if (this.at >= this.history.length) this.at--
        }
    }

    public destroy(){
        for (let [type, fn] of this.listeners) {
            this.editor.removeEventListener(type, fn)
        }
    }

    public recordHistory() {
        if (!focus) return

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
        this.preventDefault(event)
        const text = ((event as any).originalEvent || event)
            .clipboardData
            .getData('text/plain')
            .replace(/\r/g, '')
        const pos = this.save()
        this.insert(text)
        this.highlight(this.editor)
        this.restore({start: pos.start + text.length, end: pos.start + text.length})
    }


    private visit(editor: HTMLElement, visitor: (el: Node) => 'stop' | undefined) {
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

    private isCtrl(event: KeyboardEvent) {
        return event.metaKey || event.ctrlKey
    }

    private isUndo(event: KeyboardEvent) {
        return this.isCtrl(event) && !event.shiftKey && event.key === 'z'
    }

    private isRedo(event: KeyboardEvent) {
        return this.isCtrl(event) && event.shiftKey && event.key === 'z'
    }

    private insert(text: string) {
        text = text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;')
        document.execCommand('insertHTML', false, text)
    }

    private debounce(cb: any, wait: number) {
        let timeout = 0
        return (...args: any) => {
            clearTimeout(timeout)
            timeout = window.setTimeout(() => cb(...args), wait)
        }
    }

    private findPadding(text: string): [string, number, number] {
        // Find beginning of previous line.
        let i = text.length - 1
        while (i >= 0 && text[i] !== '\n') i--
        i++
        // Find padding of the line.
        let j = i
        while (j < text.length && /[ \t]/.test(text[j])) j++
        return [text.substring(i, j) || '', i, j]
    }

    private toString() {
        return this.editor.textContent || ''
    }

    private preventDefault(event: Event) {
        event.preventDefault()
    }

    private getSelection() {
        if (this.editor.parentNode?.nodeType == Node.DOCUMENT_FRAGMENT_NODE) {
            return (this.editor.parentNode as Document).getSelection()!
        }
        return window.getSelection()!
    }

}
