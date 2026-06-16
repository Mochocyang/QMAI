// 测试 linux.do 的 API 接口
const API_KEY = "ah-52ff02ce8f7c1e6028e3bec33ba488a92cdaec659756c8cee92c2b4ef5ee83fe";
const BASE_URL = "https://hub.linux.do/v1";

async function testModelList() {
  console.log("=== 测试模型列表接口 ===");
  const url = `${BASE_URL}/models`;

  console.log(`请求 URL: ${url}`);
  console.log(`API Key: ${API_KEY.substring(0, 10)}...`);

  try {
    // 测试 1: 标准请求
    console.log("\n1. 标准 Bearer 认证请求:");
    let response = await fetch(url, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${API_KEY}`,
        "Content-Type": "application/json"
      }
    });

    console.log(`状态码: ${response.status}`);
    console.log(`状态文本: ${response.statusText}`);
    const text1 = await response.text();
    console.log(`响应内容: ${text1.substring(0, 500)}`);

    if (response.status === 403) {
      // 测试 2: 添加浏览器 User-Agent
      console.log("\n2. 添加浏览器 User-Agent:");
      response = await fetch(url, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${API_KEY}`,
          "Content-Type": "application/json",
          "Accept": "application/json",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) QMaiWrite"
        }
      });

      console.log(`状态码: ${response.status}`);
      const text2 = await response.text();
      console.log(`响应内容: ${text2.substring(0, 500)}`);

      if (response.status === 403) {
        // 测试 3: 去掉 Origin，添加更多兼容性 header
        console.log("\n3. 移除 Origin，添加兼容性 headers:");
        response = await fetch(url, {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${API_KEY}`,
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
          }
        });

        console.log(`状态码: ${response.status}`);
        const text3 = await response.text();
        console.log(`响应内容: ${text3.substring(0, 500)}`);
      }
    }

    if (response.ok) {
      const data = await response.json();
      console.log("\n✅ 成功获取模型列表:");
      console.log(`模型数量: ${data.data?.length || 0}`);
      if (data.data && data.data.length > 0) {
        console.log("前5个模型:", data.data.slice(0, 5).map(m => m.id).join(", "));
      }
    }
  } catch (error) {
    console.error("❌ 请求失败:", error.message);
  }
}

async function testChatCompletion() {
  console.log("\n\n=== 测试聊天接口 ===");
  const url = `${BASE_URL}/chat/completions`;

  const body = {
    model: "deepseek-v4-flash",
    messages: [
      { role: "user", content: "你好，请回复'测试成功'" }
    ],
    stream: false
  };

  try {
    console.log("\n使用兼容性 headers:");
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) QMaiWrite"
      },
      body: JSON.stringify(body)
    });

    console.log(`状态码: ${response.status}`);
    const text = await response.text();
    console.log(`响应内容: ${text.substring(0, 500)}`);

    if (response.ok) {
      const data = JSON.parse(text);
      console.log("\n✅ 聊天接口正常:");
      console.log(`回复: ${data.choices?.[0]?.message?.content}`);
    }
  } catch (error) {
    console.error("❌ 请求失败:", error.message);
  }
}

// 运行测试
testModelList().then(() => testChatCompletion());
