import { google } from "@ai-sdk/google";

// Central model declaration for the app.
// Enable search grounding for native search capabilities
export const model = google("gemini-2.0-flash-001", {
  useSearchGrounding: true,
});

export type Model = typeof model;
