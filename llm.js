// llm.js
import { Configuration, OpenAIApi } from "openai";

const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY
});
const openai = new OpenAIApi(configuration);

/**
 * Given an input prompt, return the assistant's reply.
 * Uses a chat completion with GPT-4o-mini.
 */
export async function generateReply(prompt) {
  const resp = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: "You are a helpful avatar assistant." },
      { role: "user",   content: prompt }
    ]
  });
  return resp.choices[0].message.content.trim();
}