/**
 * Returns position of cursor on the page.
 * @param toStart Position of beginning of selection or end of selection.
 */
export function cursorPosition(toStart = true) {
    const s = window.getSelection();
    if (s.rangeCount > 0) {
        const cursor = document.createElement("span");
        cursor.textContent = "|";
        const r = s.getRangeAt(0).cloneRange();
        r.collapse(toStart);
        r.insertNode(cursor);
        const { x, y, height } = cursor.getBoundingClientRect();
        const top = (window.scrollY + y + height) + "px";
        const left = (window.scrollX + x) + "px";
        cursor.parentNode.removeChild(cursor);
        return { top, left };
    }
    return undefined;
}
/**
 * Returns selected text.
 */
export function selectedText() {
    const s = window.getSelection();
    if (s.rangeCount === 0)
        return '';
    return s.getRangeAt(0).toString();
}
/**
 * Returns text before the cursor.
 * @param editor Editor DOM node.
 */
export function textBeforeCursor(editor) {
    const s = window.getSelection();
    if (s.rangeCount === 0)
        return '';
    const r0 = s.getRangeAt(0);
    const r = document.createRange();
    r.selectNodeContents(editor);
    r.setEnd(r0.startContainer, r0.startOffset);
    return r.toString();
}
/**
 * Returns text after the cursor.
 * @param editor Editor DOM node.
 */
export function textAfterCursor(editor) {
    const s = window.getSelection();
    if (s.rangeCount === 0)
        return '';
    const r0 = s.getRangeAt(0);
    const r = document.createRange();
    r.selectNodeContents(editor);
    r.setStart(r0.endContainer, r0.endOffset);
    return r.toString();
}
