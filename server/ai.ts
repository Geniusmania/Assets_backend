import { GoogleGenAI } from "@google/genai";

export async function generateListingDescription(params: {
  title: string;
  category?: string;
  price?: string;
  location?: string;
  city?: string;
  region?: string;
}): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Gemini API is not configured. Set GEMINI_API_KEY in your environment.");
  }

  const ai = new GoogleGenAI({ apiKey });

  const context = [
    params.title && `Title: ${params.title}`,
    params.category && `Category: ${params.category}`,
    params.price && `Price: $${params.price} USD`,
    params.location && `Location: ${params.location}`,
    params.city && `City: ${params.city}`,
    params.region && `Region: ${params.region}`,
  ]
    .filter(Boolean)
    .join("\n");

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: `Write a compelling, professional marketplace listing description (2-4 paragraphs) for the following asset. Focus on key features, condition, and buyer appeal. Do not include pricing disclaimers or contact info.\n\n${context}`,
  });

  const text = response.text?.trim();
  if (!text) {
    throw new Error("Gemini returned an empty description.");
  }

  return text;
}
