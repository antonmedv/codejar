<p align="center"><a href="https://medv.io/codejar/"><img src="https://medv.io/assets/codejar.svg" width="72"></a></p>
<h3 align="center">CodeJar – an embeddable code editor for the browser</h3>
<p align="center"><a href="https://medv.io/codejar/"><img src="https://medv.io/assets/codejar/screenshot.png" width="709"></a></p>

[![npm](https://img.shields.io/npm/v/codejar?color=brightgreen)](https://www.npmjs.com/package/codejar)
[![npm bundle size](https://img.shields.io/bundlephobia/minzip/codejar?label=size)](https://bundlephobia.com/result?p=codejar)

## Features

* Lightweight (**2 kB** only)
* Preserves indentation on a new line
* Adds closing brackets, quotes
* Indents line with the **Tab** key
* Supports **undo**/**redo** 

## Getting Started

Install CodeJar 🍯 &nbsp; via npm:

```bash
npm i codejar
```

CodeJar 🍯 &nbsp; can be used via modules:

```html
<script type="module">
  import {CodeJar} from 'https://medv.io/codejar/codejar.js'
</script>
```

Create element and init:

```html
<div class="editor"></div>
<script>
  let jar = CodeJar(document.querySelector('.editor'), Prism.highlightElement)
</script>
```

Second argument to `CodeJar` is highligting function (in this example [PrismJS](https://prismjs.com)), but any function may be used:

```ts
const highlight = (editor: HTMLElement) => {
  const code = editor.textContent
  // Do something with code and set html.
  editor.innerHTML = code
}

let jar = CodeJar(editor, highlight)
```

Third argument to `CodeJar` is options:

```js
let options = {
  tab: ' '.repeat(4), // default is \t
}

let jar = CodeJar(editor, highlight, options)
```

Some styles may be applied to our editor to make it better looking:

```css
.editor {
    border-radius: 6px;
    box-shadow: 0 2px 2px 0 rgba(0, 0, 0, 0.14), 0 1px 5px 0 rgba(0, 0, 0, 0.12), 0 3px 1px -2px rgba(0, 0, 0, 0.2);
    font-family: 'Source Code Pro', monospace;
    font-size: 14px;
    font-weight: 400;
    height: 340px;
    letter-spacing: normal;
    line-height: 20px;
    padding: 10px;
    tab-size: 4;
}
```

## API

#### `updateCode(string)`

Updates the code.

```js
jar.updateCode(`let foo = bar`)
```

#### `updateOptions(Partial<Options>)`

Updates the options.

```js
jar.updateOptions({tab: '\t'})
```


#### `onUpdate((code: string) => void)`

Calls callback on code updates.

```js
jar.onUpdate(code => {
  console.log(code)
})
```

#### `toString(): string`

Return current code.

```js
let code = jar.toString()
```

#### `destroy()`

Removes event listeners from editor.

## Related

* [react-codejar](https://github.com/guilhermelimak/react-codejar)

## License

[MIT](LICENSE)
