import {
  cashierBody,
  cashierRoute,
  sessionToken,
  SessionParams,
} from "@/server/cashier-http";
import { turnSchema } from "@/server/cashier-schema";
import { submitCashierMessage } from "@/server/cashier-ai";
import { authorizeSession } from "@/server/cashier-store";
import { readUtterance } from "@/server/cashier-speech";
import { DemoError } from "@/server/errors";
export const runtime = "nodejs";
export async function POST(request: Request, context: SessionParams) {
  return cashierRoute(async () => {
    const { id } = await context.params;
    const token = sessionToken(request);
    authorizeSession(id, token);
    const input = turnSchema.parse(await cashierBody(request));
    if (input.source === "voice") {
      if (!input.utteranceId)
        throw new DemoError(
          "VOICE_TRANSCRIPT_REQUIRED",
          "Send a completed recognized utterance.",
        );
      const utterance = readUtterance(input.utteranceId, id, token);
      if (
        utterance.status !== "completed" ||
        utterance.text?.trim() !== input.text
      )
        throw new DemoError(
          "VOICE_TRANSCRIPT_MISMATCH",
          "Voice messages must use the actual completed recognition result.",
        );
    } else if (input.utteranceId)
      throw new DemoError(
        "INVALID_VOICE_SOURCE",
        "Use the voice source for a recognized utterance.",
      );
    return submitCashierMessage(
      id,
      token,
      input.text,
      input.messageId,
      input.source,
    );
  }, 202);
}
