type Options = {
  class: string
  wrapClass: string
  width: string
  backgroundColor: string
  color: string
}

export function withLineNumbers(
  highlight: (e: HTMLElement) => void,
  options: Partial<Options> = {}
) {
  const opts: Options = {
    class: "codejar-linenumbers",
    wrapClass: "codejar-wrap",
    width: "35px",
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    color: "",
    ...options
  }

  let lineNumbers: HTMLElement
  return function (editor: HTMLElement) {
    highlight(editor)

    if (!lineNumbers) {
      lineNumbers = init(editor, opts)
    }

    const code = editor.textContent || ""
    const linesCount = code.replace(/\n+$/, "\n").split("\n").length + 1

    let text = ""
    for (let i = 1; i < linesCount; i++) {
      text += `${i}\n`
    }

    lineNumbers.innerText = text
  }
}

function init(editor: HTMLElement, opts: Options): HTMLElement {
  const css = getComputedStyle(editor)

  const wrap = document.createElement("div")
  wrap.className = opts.wrapClass
  wrap.style.position = "relative"

  const lineNumbers = document.createElement("div")
  lineNumbers.className = opts.class
  wrap.appendChild(lineNumbers)

  // Add own styles
  lineNumbers.style.position = "absolute"
  lineNumbers.style.top = "0px"
  lineNumbers.style.left = "0px"
  lineNumbers.style.bottom = "0px"
  lineNumbers.style.width = opts.width
  lineNumbers.style.overflow = "hidden"
  lineNumbers.style.backgroundColor = opts.backgroundColor
  lineNumbers.style.color = opts.color || css.color
  lineNumbers.style.setProperty("mix-blend-mode", "difference")

  // Copy editor styles
  lineNumbers.style.fontFamily = css.fontFamily
  lineNumbers.style.fontSize = css.fontSize
  lineNumbers.style.lineHeight = css.lineHeight
  lineNumbers.style.paddingTop = css.paddingTop
  lineNumbers.style.paddingLeft = css.paddingLeft
  lineNumbers.style.borderTopLeftRadius = css.borderTopLeftRadius
  lineNumbers.style.borderBottomLeftRadius = css.borderBottomLeftRadius

  // Tweak editor styles
  editor.style.paddingLeft = `calc(${opts.width} + ${lineNumbers.style.paddingLeft})`
  editor.style.whiteSpace = "pre"

  // Swap editor with a wrap
  editor.parentNode!.insertBefore(wrap, editor)
  wrap.appendChild(editor)
  return lineNumbers
}
