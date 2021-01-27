declare type Options = {
    tab: string;
    indentOn: RegExp;
    spellcheck: boolean;
    addClosing: boolean;
};
export declare type CodeJar = ReturnType<typeof CodeJar>;
export declare function CodeJar(editor: HTMLElement, highlight: (e: HTMLElement) => void, opt?: Partial<Options>): {
    updateOptions(options: Partial<Options>): void;
    updateCode(code: string): void;
    onUpdate(cb: (code: string) => void): void;
    toString: () => string;
    destroy(): void;
};
export {};
