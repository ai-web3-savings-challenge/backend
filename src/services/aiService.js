import { Mistral } from "@mistralai/mistralai";

const SYSTEM_PROMPT =
  "You analyse synthetic savings data. Reply with JSON only, with keys: " +
  "summary (string), observations (string array), recommendations (string array), " +
  "suggestedAction (string), confidence (low|medium|high). " +
  "Do not assume a currency. Do not recommend investments.";

export async function analyseSavings(data) {
  const client = new Mistral({ apiKey: process.env.MISTRAL_API_KEY });

  const response = await client.chat.complete({
    model: process.env.MISTRAL_MODEL,
    responseFormat: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify(data) },
    ],
  });

  const text = response.choices[0].message.content;
  return JSON.parse(text);
}