import { afterEach, describe, expect, it, vi } from "vitest";
import { createLLMClient, chatCompletion } from "../llm/provider.js";
import { LLMConfigSchema } from "../models/project.js";

// The real Pi/Google SDK builds the request. Only the HTTP boundary is replaced.
// Dropping reasoning from Inkos' client or stream options must fail this test.
afterEach(() => vi.unstubAllGlobals());

describe("Google request reasoning", () => {
  it.each([true, false])("sends HIGH to Google for stream=%s", async (stream) => {
    let payload: any;
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      payload = JSON.parse(init.body);
      const result = { candidates: [{ content: { role: "model", parts: [{ text: "测试完成" }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 4, totalTokenCount: 9 } };
      return new Response(`data: ${JSON.stringify(result)}\n\n`, { headers: { "Content-Type": "text/event-stream" } });
    }));
    const config = LLMConfigSchema.parse({ provider: "openai", service: "google", model: "models/gemini-3.8-flash", baseUrl: "https://generativelanguage.googleapis.com/v1beta", apiKey: "test-key", stream, reasoning: "high" });
    const client = createLLMClient(config);
    const result = await chatCompletion(client, config.model, [{ role: "user", content: "测试" }], { retry: false });
    expect(result.content).toBe("测试完成");
    expect(payload.generationConfig.thinkingConfig.thinkingLevel).toBe("HIGH");
  });

  it("keeps DeepSeek's existing request settings unchanged", () => {
    const client = createLLMClient(LLMConfigSchema.parse({ provider: "openai", service: "deepseek", model: "deepseek-v4-pro", baseUrl: "https://api.deepseek.com", apiKey: "test-key" }));
    expect(client.defaults.reasoning).toBeUndefined();
    expect(client._piModel?.reasoning).toBe(false);
  });
});
