const KEYWORDS: Record<string, string[]> = {
  javascript: [
    "async", "await", "break", "case", "catch", "class", "const", "continue",
    "debugger", "default", "delete", "do", "else", "export", "extends", "false",
    "finally", "for", "function", "if", "import", "in", "instanceof", "let",
    "new", "null", "of", "return", "super", "switch", "this", "throw", "true",
    "try", "typeof", "undefined", "var", "void", "while", "with", "yield",
  ],
  typescript: [
    "async", "await", "break", "case", "catch", "class", "const", "continue",
    "debugger", "default", "delete", "do", "else", "enum", "export", "extends",
    "false", "finally", "for", "function", "if", "import", "in", "implements",
    "instanceof", "interface", "let", "new", "null", "of", "return", "super",
    "switch", "this", "throw", "true", "try", "typeof", "undefined", "var",
    "void", "while", "with", "yield", "type", "as", "from", "readonly",
    "private", "protected", "public", "static", "abstract", "declare",
  ],
  python: [
    "False", "None", "True", "and", "as", "assert", "async", "await", "break",
    "class", "continue", "def", "del", "elif", "else", "except", "finally",
    "for", "from", "global", "if", "import", "in", "is", "lambda", "nonlocal",
    "not", "or", "pass", "raise", "return", "try", "while", "with", "yield",
    "self", "print",
  ],
  rust: [
    "as", "break", "const", "continue", "crate", "else", "enum", "extern",
    "false", "fn", "for", "if", "impl", "in", "let", "loop", "match", "mod",
    "move", "mut", "pub", "ref", "return", "self", "Self", "static", "struct",
    "super", "trait", "true", "type", "unsafe", "use", "where", "while",
    "async", "await", "dyn",
  ],
  java: [
    "abstract", "assert", "boolean", "break", "byte", "case", "catch", "char",
    "class", "const", "continue", "default", "do", "double", "else", "enum",
    "extends", "false", "final", "finally", "float", "for", "goto", "if",
    "implements", "import", "instanceof", "int", "interface", "long", "native",
    "new", "null", "package", "private", "protected", "public", "return",
    "short", "static", "strictfp", "super", "switch", "synchronized", "this",
    "throw", "throws", "transient", "true", "try", "void", "volatile", "while",
  ],
  go: [
    "break", "case", "chan", "const", "continue", "default", "defer", "else",
    "fallthrough", "for", "func", "go", "goto", "if", "import", "interface",
    "map", "package", "range", "return", "select", "struct", "switch", "type",
    "var", "nil", "true", "false",
  ],
}

const LANGUAGE_ALIASES: Record<string, string> = {
  js: "javascript",
  ts: "typescript",
  jsx: "javascript",
  tsx: "typescript",
  py: "python",
  rb: "ruby",
  rs: "rust",
  cpp: "cpp",
  c: "cpp",
  cs: "csharp",
  sh: "bash",
  zsh: "bash",
  shell: "bash",
  yml: "yaml",
}

function resolveLanguage(lang: string): string {
  return LANGUAGE_ALIASES[lang] || lang
}

function getKeywords(lang: string): string[] {
  const resolved = resolveLanguage(lang)
  if (resolved === "cpp") {
    return [
      "auto", "bool", "break", "case", "catch", "char", "class", "const",
      "constexpr", "continue", "default", "delete", "do", "double", "else",
      "enum", "explicit", "export", "extern", "false", "float", "for", "friend",
      "goto", "if", "inline", "int", "long", "mutable", "namespace", "new",
      "noexcept", "nullptr", "operator", "override", "private", "protected",
      "public", "register", "return", "short", "signed", "sizeof", "static",
      "struct", "switch", "template", "this", "throw", "true", "try", "typedef",
      "typeid", "typename", "union", "unsigned", "using", "virtual", "void",
      "volatile", "while", "#include", "#define", "#ifdef", "#ifndef", "#endif",
      "#pragma",
    ]
  }
  if (resolved === "csharp") {
    return [
      "abstract", "as", "async", "await", "base", "bool", "break", "byte",
      "case", "catch", "char", "checked", "class", "const", "continue",
      "decimal", "default", "delegate", "do", "double", "else", "enum",
      "event", "explicit", "extern", "false", "finally", "fixed", "float",
      "for", "foreach", "goto", "if", "implicit", "in", "int", "interface",
      "internal", "is", "lock", "long", "namespace", "new", "null", "object",
      "operator", "out", "override", "params", "private", "protected",
      "public", "readonly", "ref", "return", "sbyte", "sealed", "short",
      "sizeof", "stackalloc", "static", "string", "struct", "switch", "this",
      "throw", "true", "try", "typeof", "uint", "ulong", "unchecked",
      "unsafe", "ushort", "using", "var", "virtual", "void", "volatile",
      "while",
    ]
  }
  if (resolved === "ruby") {
    return [
      "BEGIN", "END", "alias", "and", "begin", "break", "case", "class",
      "def", "defined?", "do", "else", "elsif", "end", "ensure", "false",
      "for", "if", "in", "module", "next", "nil", "not", "or", "redo",
      "rescue", "retry", "return", "self", "super", "then", "true",
      "undef", "unless", "until", "when", "while", "yield",
    ]
  }
  if (resolved === "html" || resolved === "xml") {
    return []
  }
  if (resolved === "css") {
    return []
  }
  if (resolved === "bash") {
    return [
      "if", "then", "else", "elif", "fi", "for", "while", "do", "done",
      "case", "esac", "in", "function", "return", "exit", "export", "local",
      "declare", "echo", "read", "set", "unset", "source", "cd", "ls",
      "rm", "mv", "cp", "mkdir", "cat", "grep", "sed", "awk", "printf",
    ]
  }
  if (resolved === "sql") {
    return [
      "SELECT", "FROM", "WHERE", "INSERT", "INTO", "VALUES", "UPDATE", "SET",
      "DELETE", "CREATE", "TABLE", "ALTER", "DROP", "INDEX", "VIEW", "JOIN",
      "LEFT", "RIGHT", "INNER", "OUTER", "ON", "AND", "OR", "NOT", "IN",
      "LIKE", "BETWEEN", "IS", "NULL", "AS", "ORDER", "BY", "GROUP", "HAVING",
      "LIMIT", "OFFSET", "DISTINCT", "COUNT", "SUM", "AVG", "MIN", "MAX",
      "UNION", "ALL", "EXISTS", "CASE", "WHEN", "THEN", "ELSE", "END",
      "BEGIN", "COMMIT", "ROLLBACK", "PRIMARY", "KEY", "FOREIGN", "REFERENCES",
    ]
  }
  if (resolved === "yaml") {
    return []
  }
  if (resolved === "json") {
    return []
  }
  return KEYWORDS[resolved] ?? []
}

interface TokenSpan {
  type: "keyword" | "string" | "comment" | "number" | "text"
  text: string
}

function tokenizeLine(line: string, lang: string): TokenSpan[] {
  const tokens: TokenSpan[] = []
  const keywords = new Set(getKeywords(lang))
  const resolved = resolveLanguage(lang)
  let remaining = line

  const patternGroups: Array<{ type: TokenSpan["type"]; regex: RegExp }> = [
    { type: "comment", regex: /\/\/[^\n]*/ },
    { type: "comment", regex: /\/\*[\s\S]*?\*\// },
    { type: "string", regex: /"(?:[^"\\]|\\.)*"/ },
    { type: "string", regex: /'(?:[^'\\]|\\.)*'/ },
    { type: "string", regex: /`(?:[^`\\]|\\.)*`/ },
  ]

  while (remaining.length > 0) {
    let earliestMatch: { index: number; match: string; type: TokenSpan["type"] } | null = null

    for (const { type, regex } of patternGroups) {
      const m = remaining.match(regex)
      if (m && m.index !== undefined && (earliestMatch === null || m.index < earliestMatch.index)) {
        earliestMatch = { index: m.index, match: m[0], type }
      }
    }

    if (earliestMatch) {
      if (earliestMatch.index > 0) {
        const before = remaining.slice(0, earliestMatch.index)
        for (const word of splitWords(before, keywords, resolved)) {
          tokens.push(word)
        }
      }
      tokens.push({ type: earliestMatch.type, text: earliestMatch.match })
      remaining = remaining.slice(earliestMatch.index + earliestMatch.match.length)
    } else {
      for (const word of splitWords(remaining, keywords, resolved)) {
        tokens.push(word)
      }
      remaining = ""
    }
  }

  return tokens
}

function splitWords(text: string, keywords: Set<string>, lang: string): TokenSpan[] {
  const tokens: TokenSpan[] = []
  const wordRegex = /(\w+\b)|([^\w]+)/g
  let m: RegExpExecArray | null
  while ((m = wordRegex.exec(text)) !== null) {
    if (m[1]) {
      const word = m[1]
      if (keywords.has(word) || (lang === "sql" && keywords.has(word.toUpperCase()))) {
        tokens.push({ type: "keyword", text: word })
      } else {
        tokens.push({ type: "text", text: word })
      }
    } else if (m[2]) {
      tokens.push({ type: "text", text: m[2] })
    }
  }
  return tokens
}

function renderTokens(tokens: TokenSpan[]): string {
  return tokens
    .map((t) => {
      switch (t.type) {
        case "keyword":
          return `<span class="hl-kw">${escapeHtml(t.text)}</span>`
        case "string":
          return `<span class="hl-str">${escapeHtml(t.text)}</span>`
        case "comment":
          return `<span class="hl-cm">${escapeHtml(t.text)}</span>`
        case "number":
          return `<span class="hl-num">${escapeHtml(t.text)}</span>`
        default:
          return escapeHtml(t.text)
      }
    })
    .join("")
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

export function highlightCode(code: string, lang: string): string {
  if (!lang || lang === "mermaid" || lang === "text" || lang === "plain") {
    return escapeHtml(code)
  }

  const lines = code.split("\n")
  const highlightedLines = lines.map((line) => {
    const tokens = tokenizeLine(line, lang)
    return renderTokens(tokens)
  })

  return highlightedLines.join("\n")
}