<p align="center"><img src="demo/public/logo.svg" width="72" alt="CodeJar"></p>
<h3 align="center">CodeJar – an embeddable code editor for the browser</h3>
<p align="center"><a href="https://antonmedv.github.io/codejar/"><b>Demo</b></a></p>

A tiny (~3 kB) editor with no dependencies. Instead of a hidden `<textarea>`
over highlighted code, CodeJar makes the highlighted element itself
`contenteditable`, so you type directly into it. Bring your own highlighter.

```sh
npm i codejar
```

```js
import { CodeJar } from 'codejar'
import Prism from 'prismjs'

const jar = CodeJar(document.querySelector('.editor'), (editor) => {
  editor.innerHTML = Prism.highlight(
    editor.textContent,
    Prism.languages.js,
    'js',
  )
})
```

## Options

Passed as the third argument:

- `tab` — string inserted on Tab. Default `'\t'`.
- `indentOn` — indent the new line if the text before the caret matches. Default `/[({[]$/`.
- `moveToNewLine` — move the text after the caret to its own line if it matches. Default `/^[)}\]]/`.
- `spellcheck` — default `false`.
- `catchTab` — handle Tab and Shift+Tab. Default `true`.
- `preserveIdent` — keep indentation on a new line. Default `true`.
- `addClosing` — auto-close brackets and quotes. Default `true`.
- `autoclose` — `{ open, close }` pairs to auto-close. Default ``{ open: `([{'"`, close: `)]}'"` }``.
- `history` — undo/redo. Default `true`.
- `window` — window to use, e.g. for iframes.

## API

- `updateCode(code, callOnUpdate = true)` — set the code.
- `updateOptions(options)` — change options.
- `onUpdate(callback)` — called with the code on every change.
- `toString()` — get the code.
- `save()` / `restore(pos)` — save and restore the caret or selection.
- `recordHistory()` — push the current state onto the undo stack.
- `destroy()` — remove event listeners.

## License

[MIT](LICENSE)
