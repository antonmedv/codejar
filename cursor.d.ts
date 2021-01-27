declare type Position = {
    top: string;
    left: string;
};
/**
 * Returns position of cursor on the page.
 * @param toStart Position of beginning of selection or end of selection.
 */
export declare function cursorPosition(toStart?: boolean): Position | undefined;
/**
 * Returns selected text.
 */
export declare function selectedText(): string;
/**
 * Returns text before the cursor.
 * @param editor Editor DOM node.
 */
export declare function textBeforeCursor(editor: Node): string;
/**
 * Returns text after the cursor.
 * @param editor Editor DOM node.
 */
export declare function textAfterCursor(editor: Node): string;
export {};
