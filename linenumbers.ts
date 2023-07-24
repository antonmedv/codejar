type Options = {
  class: string
  wrapClass: string
  width: string
  backgroundColor: string
  color: string
  side: "left" | "right"
}

export function withLineNumbers(
  highlight: (e: HTMLElement) => void,
  options: Partial<Options> = {}
) {
  const opts: Options = {
    class: "codejar-linenumbers",
    wrapClass: "codejar-wrap",
    width: "35px",
    side: "left",
    backgroundColor: "rgba(128, 128, 128, 0.15)",
    color: "",
    ...options
  }

  let lineNumbers: HTMLElement
  return function (editor: HTMLElement) {
    highlight(editor)

    if (!lineNumbers) {
      lineNumbers = init(editor, opts)
      editor.addEventListener("scroll", () => lineNumbers.style.top = `-${editor.scrollTop}px`);
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

  const gutter = document.createElement("div")
  gutter.className = opts.class
  gutter.dir = opts.side == "left" ? "ltr" : "rtl"
  wrap.appendChild(gutter)

  // Add own styles
  gutter.style.position = "absolute"
  gutter.style.top = "0px"
  if (opts.side == "left") {
    gutter.style.left = "0px"
  } else {
    gutter.style.right = "0px"
  }
  gutter.style.bottom = "0px"
  gutter.style.width = opts.width
  gutter.style.overflow = "hidden"
  gutter.style.backgroundColor = opts.backgroundColor
  gutter.style.color = opts.color || css.color
  gutter.style.setProperty("mix-blend-mode", "difference")

  // Copy editor styles
  gutter.style.fontFamily = css.fontFamily
  gutter.style.fontSize = css.fontSize
  gutter.style.lineHeight = css.lineHeight
  gutter.style.paddingTop = css.paddingTop
  if (opts.side == "left") {
    gutter.style.paddingLeft = css.paddingLeft
    gutter.style.borderTopLeftRadius = css.borderTopLeftRadius
    gutter.style.borderBottomLeftRadius = css.borderBottomLeftRadius
  } else {
    gutter.style.paddingRight = css.paddingRight
    gutter.style.borderTopRightRadius = css.borderTopRightRadius
    gutter.style.borderBottomRightRadius = css.borderBottomRightRadius
  }

  // Add line numbers
  const lineNumbers = document.createElement("div");
  lineNumbers.style.position = "relative";
  lineNumbers.style.top = "0px"
  gutter.appendChild(lineNumbers)

  // Tweak editor styles
  editor.style.whiteSpace = "pre"
  if (opts.side == "left") {
    editor.style.paddingLeft = `calc(${opts.width} + ${gutter.style.paddingLeft})`
  } else {
    editor.style.paddingRight = `calc(${opts.width} + ${gutter.style.paddingRight})`
  }

  // Swap editor with a wrap
  editor.parentNode!.insertBefore(wrap, editor)
  wrap.appendChild(editor)
  return lineNumbers
}
