/**
 * 验证修复后的 withCustomOriginHeader 函数行为
 */

// 模拟修复后的函数
function isLocalOrPrivateHttpEndpoint(endpoint) {
  try {
    const parsed = new URL(endpoint)
    const host = parsed.hostname.toLowerCase()
    if (host === "localhost" || host.endsWith(".localhost")) return true
    if (host === "127.0.0.1" || host === "::1" || host === "[::1]") return true
    if (/^10\./.test(host)) return true
    if (/^192\.168\./.test(host)) return true
    const match = host.match(/^172\.(\d+)\./)
    if (match) {
      const second = Number(match[1])
      if (second >= 16 && second <= 31) return true
    }
    return false
  } catch {
    return /^(https?:\/\/)?(localhost|127\.0\.0\.1)([:/]|$)/i.test(endpoint)
  }
}

function localLlmOriginHeader() {
  return { Origin: "http://localhost" }
}

function withCustomOriginHeader(headers, url) {
  if (isLocalOrPrivateHttpEndpoint(url)) {
    return {
      ...headers,
      ...localLlmOriginHeader(),
    }
  }
  // 非本地端点：不添加 Origin
  return headers
}

// 测试用例
const testCases = [
  {
    name: "远程中转站 (hub.linux.do)",
    url: "https://hub.linux.do/v1/chat/completions",
    input: { Authorization: "Bearer sk-test", "Content-Type": "application/json" },
    expectedHasOrigin: false,
  },
  {
    name: "本地 Ollama",
    url: "http://localhost:11434/v1/chat/completions",
    input: { Authorization: "Bearer sk-test", "Content-Type": "application/json" },
    expectedHasOrigin: true,
    expectedOriginValue: "http://localhost",
  },
  {
    name: "远程 OpenRouter",
    url: "https://openrouter.ai/api/v1/chat/completions",
    input: { Authorization: "Bearer sk-test", "Content-Type": "application/json" },
    expectedHasOrigin: false,
  },
  {
    name: "本地 192.168 内网",
    url: "http://192.168.1.100:8080/v1/chat/completions",
    input: { "Content-Type": "application/json" },
    expectedHasOrigin: true,
    expectedOriginValue: "http://localhost",
  },
]

console.log("=== 验证修复后的 withCustomOriginHeader 函数 ===\n")

let allPassed = true

testCases.forEach((test, index) => {
  console.log(`测试 ${index + 1}: ${test.name}`)
  console.log(`  URL: ${test.url}`)

  const result = withCustomOriginHeader(test.input, test.url)

  console.log(`  输入 headers:`, test.input)
  console.log(`  输出 headers:`, result)

  const hasOrigin = result.hasOwnProperty("Origin")
  const passed = hasOrigin === test.expectedHasOrigin

  if (test.expectedHasOrigin) {
    const originCorrect = result.Origin === test.expectedOriginValue
    if (!originCorrect) {
      console.log(`  ❌ 失败: Origin 值错误，期望 "${test.expectedOriginValue}"，实际 "${result.Origin}"`)
      allPassed = false
    } else {
      console.log(`  ✅ 通过: Origin 正确设置为 "${result.Origin}"`)
    }
  } else {
    if (hasOrigin) {
      console.log(`  ❌ 失败: 不应该有 Origin 属性，但实际有 "${result.Origin}"`)
      allPassed = false
    } else {
      console.log(`  ✅ 通过: 未设置 Origin（符合预期）`)
    }
  }

  // 检查其他 headers 是否保留
  const otherHeadersPreserved = Object.keys(test.input).every(
    key => result[key] === test.input[key]
  )
  if (!otherHeadersPreserved) {
    console.log(`  ❌ 失败: 其他 headers 未正确保留`)
    allPassed = false
  } else {
    console.log(`  ✅ 其他 headers 正确保留`)
  }

  console.log()
})

console.log("==========================================")
if (allPassed) {
  console.log("✅ 所有测试通过！修复正确！")
  process.exit(0)
} else {
  console.log("❌ 部分测试失败，请检查代码")
  process.exit(1)
}
