/**
 * AI CLIENT
 * 
 * Supports both GPT-4 (chat/completions) and GPT-5.2 (responses API)
 * Set MODEL_VERSION env var to "gpt5" to use GPT-5.2
 */

const OpenAI = require("openai");

let client = null;
function getClient() {
  if (!client) client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client;
}

/**
 * Make an AI completion request
 * @param {Object} options
 * @param {string} options.systemPrompt - System message
 * @param {string} options.userPrompt - User message
 * @param {number} options.temperature - Temperature (default 0.3)
 * @param {boolean} options.jsonMode - Whether to request JSON output
 * @returns {Promise<string>} - The AI response text
 */
async function complete({ systemPrompt, userPrompt, temperature = 0.3, jsonMode = true }) {
  const useGPT5 = process.env.MODEL_VERSION === "gpt5";
  
  if (useGPT5) {
    return await completeGPT5({ systemPrompt, userPrompt, temperature, jsonMode });
  } else {
    return await completeGPT4({ systemPrompt, userPrompt, temperature, jsonMode });
  }
}

/**
 * GPT-4o-mini completion (chat/completions API)
 */
async function completeGPT4({ systemPrompt, userPrompt, temperature, jsonMode }) {
  const resp = await getClient().chat.completions.create({
    model: "gpt-4o-mini",
    temperature,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    ...(jsonMode && { response_format: { type: "json_object" } }),
  });

  const text = resp.choices?.[0]?.message?.content;
  if (!text) throw new Error("Empty GPT-4 response");
  return text;
}

/**
 * GPT-5.2 completion (responses API)
 */
async function completeGPT5({ systemPrompt, userPrompt, temperature, jsonMode }) {
  const systemContent = jsonMode 
    ? systemPrompt + "\n\nIMPORTANT: Output valid JSON only, no markdown formatting."
    : systemPrompt;

  const resp = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-5.2",
      input: [
        {
          role: "system",
          content: "Produce a final textual answer. Do not stop at reasoning. Output plain text only. " + systemContent
        },
        {
          role: "user",
          content: userPrompt
        }
      ],
    }),
  });

  const data = await resp.json();

  if (!resp.ok) {
    console.error("GPT-5.2 error:", data);
    throw new Error(data?.error?.message || "OpenAI GPT-5.2 request failed");
  }

  // Extract text from GPT-5.2 response structure
  const text = data.output
    ?.flatMap(item =>
      item.type === "message"
        ? item.content
            ?.filter(c => c.type === "output_text")
            ?.map(c => c.text) ?? []
        : []
    )
    .join("")
    .trim();

  if (!text) {
    throw new Error("Empty GPT-5.2 response");
  }

  return text;
}

module.exports = { complete, getClient };
