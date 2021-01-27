declare type Options = {
    class: string;
    wrapClass: string;
    width: string;
    backgroundColor: string;
    color: string;
};
export declare function withLineNumbers(highlight: (e: HTMLElement) => void, options?: Partial<Options>): (editor: HTMLElement) => void;
export {};
