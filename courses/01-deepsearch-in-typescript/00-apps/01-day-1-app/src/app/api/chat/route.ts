import type { Message } from "ai";
import { streamText, createDataStreamResponse } from "ai";
import { z } from "zod";
import { auth } from "~/server/auth";
import { model } from "~/server/ai/model";
import { searchSerper } from "~/serper";
import { db } from "~/server/db";
import { requests, users } from "~/server/db/schema";
import { and, eq, gte, count } from "drizzle-orm";

export const maxDuration = 60;

// Rate limit: 20 requests per day for regular users
const DAILY_REQUEST_LIMIT = 1;

export async function POST(request: Request) {
  // Check if user is authenticated
  const session = await auth();

  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  const userId = session.user.id;

  // Get user info to check if they're an admin
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) {
    return new Response("User not found", { status: 404 });
  }

  // Check rate limit for non-admin users
  if (!user.isAdmin) {
    // Get start of today (midnight)
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    // Count requests made by user today
    const [requestCount] = await db
      .select({ count: count() })
      .from(requests)
      .where(
        and(eq(requests.userId, userId), gte(requests.createdAt, startOfToday)),
      );

    if (requestCount && requestCount.count >= DAILY_REQUEST_LIMIT) {
      return new Response(
        JSON.stringify({
          error: `Rate limit exceeded. You can make up to ${DAILY_REQUEST_LIMIT} requests per day.`,
        }),
        {
          status: 429,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
  }

  // Record this request
  await db.insert(requests).values({
    userId: userId,
  });

  const body = (await request.json()) as {
    messages: Array<Message>;
  };

  return createDataStreamResponse({
    execute: async (dataStream) => {
      const { messages } = body;

      const result = streamText({
        model,
        messages,
        system: `You are a helpful AI assistant with access to web search. Always use the search web tool to find current, accurate information to answer user questions. When providing information, always cite your sources with inline links in markdown format [text](url). Be comprehensive in your research and provide multiple sources when available.`,
        maxSteps: 10, // This makes the LLM behave like an agent
        tools: {
          searchWeb: {
            parameters: z.object({
              query: z.string().describe("The query to search the web for"),
            }),
            execute: async ({ query }, { abortSignal }) => {
              const results = await searchSerper(
                { q: String(query), num: 10 },
                abortSignal,
              );

              return results.organic.map((result) => ({
                // Only send relevant info, don't swamp LLM with unnecessary data
                title: result.title,
                link: result.link,
                snippet: result.snippet,
              }));
            },
          },
        },
      });

      result.mergeIntoDataStream(dataStream);
    },
    onError: (e) => {
      console.error(e);
      return "Oops, an error occured!";
    },
  });
}
