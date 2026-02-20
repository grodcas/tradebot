/**
 * GPT-5.2 Client Helper
 *
 * Uses the new OpenAI responses API format for GPT-5.2
 */

async function callGPT5(systemPrompt, userPrompt, options = {}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');

  const resp = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: options.model || "gpt-5.2",
      input: [
        {
          role: "system",
          content: systemPrompt
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
    console.error(data);
    throw new Error(data?.error?.message || "OpenAI request failed");
  }

  // Extract text from GPT-5.2 response format
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
    throw new Error("Empty AI output");
  }

  return text;
}

async function callGPT5JSON(systemPrompt, userPrompt, options = {}) {
  const text = await callGPT5(
    systemPrompt + "\n\nIMPORTANT: Output valid JSON only, no markdown.",
    userPrompt,
    options
  );

  // Clean potential markdown code blocks
  let cleanText = text;
  if (cleanText.startsWith('```json')) {
    cleanText = cleanText.slice(7);
  } else if (cleanText.startsWith('```')) {
    cleanText = cleanText.slice(3);
  }
  if (cleanText.endsWith('```')) {
    cleanText = cleanText.slice(0, -3);
  }

  return JSON.parse(cleanText.trim());
}

module.exports = { callGPT5, callGPT5JSON };
