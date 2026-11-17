// P4-01 protocol probe only. No business tools, database, retries or orchestration loop.
import { z } from 'zod';
import { assistantModelConfiguration } from '../../src/lib/ai-assistant/model-config';

const usageSchema = z.object({
  prompt_tokens: z.number().int().nonnegative(),
  completion_tokens: z.number().int().nonnegative(),
  total_tokens: z.number().int().nonnegative().optional(),
  prompt_cache_hit_tokens: z.number().int().nonnegative().optional(),
  prompt_cache_miss_tokens: z.number().int().nonnegative().optional(),
});
const toolCallSchema = z.object({
  id: z.string().min(1).max(200),
  type: z.literal('function'),
  function: z.object({ name: z.literal('protocol_echo'), arguments: z.string().max(1000) }),
});
const messageSchema = z.object({
  role: z.literal('assistant'),
  content: z.string().max(4000).nullable(),
  tool_calls: z.array(toolCallSchema).length(1).optional(),
});
const envelopeSchema = z.object({
  model: z.string().min(1).max(200),
  choices: z.array(z.object({ finish_reason: z.string(), message: messageSchema })).length(1),
  usage: usageSchema.optional(),
});
type Usage = z.infer<typeof usageSchema>;
type Message = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_call_id?: string;
  tool_calls?: z.infer<typeof toolCallSchema>[];
};
export const PROBE_VERSION = 'p4-01-protocol-v1';
const MAX_BYTES = 64_000;
const TOOL = {
  type: 'function',
  function: {
    name: 'protocol_echo',
    description: 'Protocol test only: echo the supplied synthetic value. No business data.',
    parameters: {
      type: 'object',
      properties: { value: { type: 'string', enum: ['BLUE'] } },
      required: ['value'],
      additionalProperties: false,
    },
  },
};
export class ProbeError extends Error {}

// Decode incrementally: byte chunks may split UTF-8, CRLF or SSE frames.
// This is a CLI verifier, not the future assistant streaming API.
export async function readProbeBody(response: Response, onData?: (data: string) => void) {
  if (!response.body) throw new ProbeError('EMPTY_BODY');
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0;
  let pending = '';
  let text = '';
  const drain = () => {
    for (;;) {
      const boundary = /\r?\n\r?\n/.exec(pending);
      if (!boundary) break;
      const frame = pending.slice(0, boundary.index);
      pending = pending.slice(boundary.index + boundary[0].length);
      const data = frame
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).replace(/^ /, ''))
        .join('\n');
      if (data) onData!(data);
    }
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw new ProbeError('RESPONSE_BUDGET');
      const decoded = decoder.decode(value, { stream: true });
      if (onData) {
        pending += decoded;
        drain();
      } else text += decoded;
    }
    const tail = decoder.decode();
    if (onData) {
      pending += tail;
      drain();
      if (pending.trim()) throw new ProbeError('INCOMPLETE_SSE_FRAME');
    } else text += tail;
    return { text, bytes: size };
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function readProbeStream(
  response: Response,
  started: number,
  observe: (state: {
    model: string | null;
    usage: Usage | null;
    finishReason: string | null;
    events: number;
    contentChunks: number;
    firstContentMs: number | null;
  }) => void = () => {},
) {
  let content = '';
  let model: string | null = null;
  let usage: Usage | null = null;
  let finishReason: string | null = null;
  let done = false;
  let events = 0;
  let contentChunks = 0;
  let firstContentMs: number | null = null;
  const chunkSchema = z.object({
    model: z.string().min(1).max(200),
    choices: z
      .array(
        z.object({
          index: z.literal(0),
          delta: z.object({
            content: z.string().nullable().optional(),
            role: z.literal('assistant').optional(),
            tool_calls: z.never().optional(),
          }),
          finish_reason: z.string().nullable(),
        }),
      )
      .max(1),
    usage: usageSchema.nullable().optional(),
  });
  const body = await readProbeBody(response, (data) => {
    if (done) throw new ProbeError('SSE_AFTER_DONE');
    if (data === '[DONE]') {
      done = true;
      return;
    }
    const chunk = chunkSchema.parse(JSON.parse(data));
    events++;
    if (model && model !== chunk.model) throw new ProbeError('MODEL_CHANGED');
    model = chunk.model;
    if (chunk.usage) usage = chunk.usage;
    const choice = chunk.choices[0];
    if (choice?.delta.content) {
      if (finishReason) throw new ProbeError('CONTENT_AFTER_FINISH');
      firstContentMs ??= Date.now() - started;
      contentChunks++;
      content += choice.delta.content;
    }
    if (choice?.finish_reason) finishReason = choice.finish_reason;
    observe({ model, usage, finishReason, events, contentChunks, firstContentMs });
  });
  if (!done || finishReason !== 'stop') throw new ProbeError('STREAM_INCOMPLETE');
  if (content.trim() !== 'STREAM_OK') throw new ProbeError('UNEXPECTED_STREAM_CONTENT');
  return {
    model,
    usage,
    finishReason,
    events,
    contentChunks,
    firstContentMs,
    bytes: body.bytes,
    done,
  };
}

export async function runAssistantModelProbe(
  config: ReturnType<typeof assistantModelConfiguration>,
  fetcher: typeof fetch = fetch,
) {
  const attempts: Record<string, unknown>[] = [];
  const request = async (
    id: string,
    messages: Message[],
    options: { stream?: boolean; tools?: boolean } = {},
  ) => {
    const started = Date.now();
    const parameters = {
      model: config.model,
      temperature: 0,
      max_tokens: 128,
      stream: options.stream ?? false,
      ...(new URL(config.endpoint).hostname === 'api.deepseek.com'
        ? { thinking: { type: 'disabled' } }
        : {}),
      ...(options.stream ? { stream_options: { include_usage: true } } : {}),
      ...(options.tools
        ? {
            tools: [TOOL],
            tool_choice: { type: 'function', function: { name: 'protocol_echo' } },
            parallel_tool_calls: false,
          }
        : {}),
      messages,
    };
    const attempt: Record<string, unknown> = {
      id,
      startedAt: new Date(started).toISOString(),
      parameters,
      status: 'failed',
      httpStatus: null,
      usage: null,
      actualModel: null,
    };
    attempts.push(attempt);
    const signal = AbortSignal.timeout(30_000);
    try {
      const response = await fetcher(`${config.endpoint}/chat/completions`, {
        method: 'POST',
        redirect: 'error',
        cache: 'no-store',
        signal,
        headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(parameters),
      });
      attempt.httpStatus = response.status;
      attempt.headersMs = Date.now() - started;
      if (!response.ok) {
        await response.body?.cancel();
        throw new ProbeError(`HTTP_${response.status}`);
      }
      if (options.stream) {
        if (!response.headers.get('content-type')?.includes('text/event-stream')) {
          await response.body?.cancel();
          throw new ProbeError('NOT_EVENT_STREAM');
        }
        const stream = await readProbeStream(response, started, (state) => {
          Object.assign(attempt, { actualModel: state.model, usage: state.usage, stream: state });
        });
        Object.assign(attempt, { actualModel: stream.model, usage: stream.usage, stream });
      } else {
        const body = await readProbeBody(response);
        const envelope = envelopeSchema.parse(JSON.parse(body.text));
        const choice = envelope.choices[0];
        Object.assign(attempt, {
          actualModel: envelope.model,
          usage: envelope.usage ?? null,
          finishReason: choice.finish_reason,
          responseBytes: body.bytes,
        });
        if (options.tools) {
          if (choice.finish_reason !== 'tool_calls' || !choice.message.tool_calls)
            throw new ProbeError('TOOL_CALL_MISSING');
          const call = choice.message.tool_calls[0];
          z.strictObject({ value: z.literal('BLUE') }).parse(JSON.parse(call.function.arguments));
          attempt.tool = {
            name: call.function.name,
            arguments: { value: 'BLUE' },
            idPresent: true,
            type: call.type,
          };
        } else {
          const expected = id === 'plain' ? 'OK' : id === 'multiturn' ? 'BLUE' : 'TOOL_OK';
          if (
            choice.finish_reason !== 'stop' ||
            choice.message.tool_calls ||
            choice.message.content?.trim() !== expected
          )
            throw new ProbeError('UNEXPECTED_MESSAGE');
          attempt.expectedContentMatched = true;
        }
        attempt.status = 'passed';
        return choice.message;
      }
      attempt.status = 'passed';
    } catch (error) {
      const cause = (error as { cause?: { code?: string } })?.cause?.code;
      attempt.error = signal.aborted
        ? 'TIMEOUT'
        : error instanceof ProbeError
          ? error.message
          : error instanceof TypeError
            ? 'NETWORK_ERROR'
            : 'INVALID_RESPONSE';
      // Never persist arbitrary upstream exception messages, body, stack, or headers.
      attempt.networkCode = [
        'ENOTFOUND',
        'EAI_AGAIN',
        'ECONNREFUSED',
        'ECONNRESET',
        'ETIMEDOUT',
        'UND_ERR_CONNECT_TIMEOUT',
      ].includes(cause ?? '')
        ? cause
        : null;
    } finally {
      attempt.durationMs = Date.now() - started;
    }
    return null;
  };
  const first: Message[] = [
    {
      role: 'system',
      content: 'This is a minimal protocol test. Follow the requested exact output.',
    },
    { role: 'user', content: '记住测试代号 BLUE。只回复 OK。' },
  ];
  const plain = await request('plain', first);
  if (plain)
    await request('multiturn', [
      ...first,
      plain,
      { role: 'user', content: '刚才的测试代号是什么？只回复代号。' },
    ]);
  else
    attempts.push({
      id: 'multiturn',
      status: 'skipped',
      error: 'PLAIN_PREREQUISITE_FAILED',
      usage: null,
    });
  const toolMessages: Message[] = [
    { role: 'user', content: '调用 protocol_echo，value 为 BLUE。' },
  ];
  const tool = await request('tool-call', toolMessages, { tools: true });
  if (tool)
    await request('tool-result', [
      ...toolMessages,
      tool,
      {
        role: 'tool',
        tool_call_id: tool.tool_calls![0].id,
        content: '{"value":"BLUE","result":"TOOL_OK"}',
      },
      { role: 'user', content: '只回复工具结果的 result 值。' },
    ]);
  else
    attempts.push({
      id: 'tool-result',
      status: 'skipped',
      error: 'TOOL_PREREQUISITE_FAILED',
      usage: null,
    });
  await request('stream', [{ role: 'user', content: '只回复 STREAM_OK。' }], { stream: true });
  return {
    probeVersion: PROBE_VERSION,
    mode: 'real-model',
    input: 'synthetic-only-no-database',
    endpoint: `${config.endpoint}/chat/completions`,
    requestedModel: config.model,
    configurationSources: config.sources,
    attempts,
    passed: attempts.every((a) => a.status === 'passed'),
  };
}
