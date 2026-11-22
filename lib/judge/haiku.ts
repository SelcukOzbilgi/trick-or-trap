import "server-only";
import { toJudgeHttpError } from "@/lib/judge/interface";
import type { JudgeClient, JudgeRawResponse } from "@/lib/judge/interface";
import type { JudgeConfigOn } from "@/lib/judge/config";
import { buildRequestBody } from "@/lib/judge/prompt";

/**
 * The real model client (design section 16): the only file of this feature
 * that touches the network or the Anthropic SDK. Only the opt-in live test
 * imports it; every other test uses the mock of `mock.ts`.
 *
 * It holds no key in any value it returns or throws. A failed call rejects
 * with a `JudgeHttpError`, whose message is fixed, so no text of the SDK's own
 * error (which can hold a header, a URL or a body) travels with it.
 */

/**
 * The SDK types a JSON Schema as a string-keyed record, while the seam types
 * it as `object`. A shallow copy of the top-level keys closes that gap without
 * a cast and leaves the schema unchanged.
 */
function toSchemaRecord(schema: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(schema));
}

/**
 * Build a client for an enabled configuration. The SDK is loaded here, on the
 * first call, and not at module load. Its own retries are off (`maxRetries: 0`):
 * the orchestrator decides about the one retry. The timeout and the abort
 * signal come with every call.
 */
export async function createHaikuClient(config: JudgeConfigOn): Promise<JudgeClient> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const sdk = new Anthropic({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    maxRetries: 0,
    // The orchestrator writes its own one record per scan. The SDK's debug and
    // info lines can hold request bodies, and the level is otherwise read from
    // the environment, so it is fixed here.
    logLevel: "off",
    // No spans, no trace headers sent to the model host, and no content on a
    // span if spans are ever switched on. A client given this option does not
    // read the OpenTelemetry environment variables.
    openTelemetry: {
      propagation: false,
      traces: { enabled: false, contentMode: "metadata_only" },
    },
  });

  return async (request, opts): Promise<JudgeRawResponse> => {
    try {
      const body = buildRequestBody(request, config.model);
      const message = await sdk.messages.create(
        {
          ...body,
          output_config: {
            ...body.output_config,
            format: {
              type: "json_schema",
              schema: toSchemaRecord(body.output_config.format.schema),
            },
          },
        },
        { timeout: opts.timeoutMs, signal: opts.signal },
      );
      let text = "";
      for (const block of message.content) {
        if (block.type === "text") text += block.text;
      }
      return {
        text,
        stopReason: message.stop_reason ?? "",
        usage: {
          input: message.usage.input_tokens,
          output: message.usage.output_tokens,
          cacheRead: message.usage.cache_read_input_tokens ?? 0,
          cacheWrite: message.usage.cache_creation_input_tokens ?? 0,
        },
      };
    } catch (error) {
      throw toJudgeHttpError(error);
    }
  };
}
