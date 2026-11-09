export type Sample = {
  id: string
  name: string
  file: string
  grammar: string
  code: string
}

export const samples: Sample[] = [
  {
    id: 'javascript',
    name: 'JavaScript',
    file: 'jar.js',
    grammar: 'javascript',
    code: `import { CodeJar } from 'codejar'

// A jar holds code. Try typing below!
function fill(jar, honey = 'sweet') {
  const spoons = [1, 2, 3].map((n) => n * 2)
  for (const spoon of spoons) {
    jar.add({ spoon, honey })
  }
  return \`Filled with \${spoons.length} spoons\`
}

export default fill
`,
  },
  {
    id: 'typescript',
    name: 'TypeScript',
    file: 'bee.ts',
    grammar: 'typescript',
    code: `type Flower = { name: string; nectar: number }

interface Bee {
  collect(flower: Flower): number
}

class Worker implements Bee {
  private total = 0

  collect({ nectar }: Flower): number {
    this.total += nectar
    return this.total
  }
}

const bee = new Worker()
bee.collect({ name: 'clover', nectar: 42 })
`,
  },
  {
    id: 'css',
    name: 'CSS',
    file: 'jar.css',
    grammar: 'css',
    code: `.editor {
  font-family: 'JetBrains Mono', monospace;
  font-size: 14px;
  line-height: 1.6;
  tab-size: 2;
}

.editor:focus-within {
  outline: 2px solid #9d42ad;
}

@media (prefers-color-scheme: dark) {
  .editor {
    background: #1d1424;
  }
}
`,
  },
  {
    id: 'html',
    name: 'HTML',
    file: 'index.html',
    grammar: 'markup',
    code: `<!doctype html>
<html lang="en">
  <body>
    <div class="editor"></div>
    <script type="module">
      import { CodeJar } from 'https://esm.sh/codejar'
      CodeJar(document.querySelector('.editor'), (el) => {})
    </script>
  </body>
</html>
`,
  },
  {
    id: 'python',
    name: 'Python',
    file: 'hive.py',
    grammar: 'python',
    code: `from dataclasses import dataclass


@dataclass
class Hive:
    bees: int = 0
    honey: float = 0.0

    def harvest(self, days: int) -> float:
        for _ in range(days):
            self.honey += self.bees * 0.1
        return round(self.honey, 2)


print(Hive(bees=500).harvest(days=7))
`,
  },
  {
    id: 'json',
    name: 'JSON',
    file: 'package.json',
    grammar: 'json',
    code: `{
  "name": "my-editor",
  "type": "module",
  "dependencies": {
    "codejar": "^4.3.0",
    "prismjs": "^1.30.0"
  }
}
`,
  },
]
