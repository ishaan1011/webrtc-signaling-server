// llm.js
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

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