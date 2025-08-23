import { google } from "@ai-sdk/google";

// Central model declaration for the app.
// Choose a model that supports tool calling. Gemini 2.0 Flash supports it and has large context windows.
export const model = google("gemini-2.0-flash-001");

export type Model = typeof model;
