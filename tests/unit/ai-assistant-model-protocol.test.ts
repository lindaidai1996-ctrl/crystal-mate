import { describe, expect, it, vi } from 'vitest';
import { assistantModelConfiguration } from '../../src/lib/ai-assistant/model-config';
import { readProbeStream, runAssistantModelProbe } from '../../scripts/lib/assistant-model-probe';

const config = assistantModelConfiguration('assistant', { DEEPSEEK_API_KEY: 'test-secret' });
const json = (content: string | null, extra = {}) =>
  new Response(
    JSON.stringify({
      model: 'test-model',
      choices: [{ finish_reason: 'stop', message: { role: 'assistant', content }, ...extra }],
      usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
    }),
  );
const sse = (finish = 'stop', done = true) =>
  [
    ': comment\r\n\r\n',
    ...['STREAM', '_OK'].map(
      (content) =>
        `data: ${JSON.stringify({ model: 'test-model', choices: [{ index: 0, delta: { content }, finish_reason: null }] })}\r\n\r\n`,
    ),
    `data: ${JSON.stringify({ model: 'test-model', choices: [{ index: 0, delta: {}, finish_reason: finish }] })}\r\n\r\n`,
    `data: ${JSON.stringify({ model: 'test-model', choices: [], usage: { prompt_tokens: 10, completion_tokens: 2 } })}\r\n\r\n`,
    ...(done ? ['data: [DONE]\r\n\r\n'] : []),
  ].join('');

describe('independent assistant configuration', () => {
  it('shares provider credentials/endpoint but never the image model', () => {
    const env = {
      DEEPSEEK_API_KEY: 'provider-secret',
      DEEPSEEK_BASE_URL: 'https://example.test/v1/',
      DEEPSEEK_VISION_MODEL: 'vision-only',
    };
    expect(assistantModelConfiguration('assistant', env)).toMatchObject({
      model: 'deepseek-flash',
      endpoint: 'https://example.test/v1',
      apiKey: 'provider-secret',
    });
    expect(assistantModelConfiguration('relevance', env).model).toBe('deepseek-flash');
  });
  it('honors relevance > assistant > provider per field, keeping purpose overrides isolated', () => {
    const env = {
      DEEPSEEK_API_KEY: 'provider',
      ASSISTANT_API_KEY: 'assistant',
      ASSISTANT_BASE_URL: 'https://assistant.test/v1',
      ASSISTANT_MODEL: 'text-only',
      ASSISTANT_RELEVANCE_MODEL: 'relevance-only',
      ASSISTANT_RELEVANCE_API_KEY: 'relevance',
    };
    expect(assistantModelConfiguration('assistant', env)).toMatchObject({
      apiKey: 'assistant',
      model: 'text-only',
    });
    expect(assistantModelConfiguration('relevance', env)).toMatchObject({
      apiKey: 'relevance',
      endpoint: 'https://assistant.test/v1',
      model: 'relevance-only',
    });
    expect(
      assistantModelConfiguration('relevance', { ...env, ASSISTANT_RELEVANCE_MODEL: '' }).model,
    ).toBe('text-only');
  });
  it.each([
    'http://example.test',
    'https://user:pass@example.test',
    'https://example.test?key=secret',
    'https://example.test#secret',
    'invalid',
  ])('rejects unsafe or invalid endpoint %s without echoing it', (endpoint) => {
    expect(() =>
      assistantModelConfiguration('assistant', {
        ASSISTANT_API_KEY: 'secret',
        ASSISTANT_BASE_URL: endpoint,
      }),
    ).toThrow('MODEL_NOT_CONFIGURED');
  });
  it('rejects missing credentials', () => {
    expect(() => assistantModelConfiguration('assistant', {})).toThrow('MODEL_NOT_CONFIGURED');
  });
});

describe('bounded protocol probe (mock HTTP, no real model)', () => {
  it('parses fragmented SSE bytes, CRLF, usage-only chunk and DONE', async () => {
    const bytes = new TextEncoder().encode(sse());
    const response = new Response(
      new ReadableStream({
        start(controller) {
          for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
          controller.close();
        },
      }),
    );
    expect(await readProbeStream(response, Date.now())).toMatchObject({
      model: 'test-model',
      contentChunks: 2,
      finishReason: 'stop',
      done: true,
      usage: { prompt_tokens: 10, completion_tokens: 2 },
    });
  });
  it.each([
    ['length', true],
    ['stop', false],
  ] as const)('does not accept truncated stream %s/%s', async (finish, done) => {
    await expect(readProbeStream(new Response(sse(finish, done)), Date.now())).rejects.toThrow(
      'STREAM_INCOMPLETE',
    );
  });
  it('bounds stream bytes', async () => {
    await expect(readProbeStream(new Response('a'.repeat(64001)), Date.now())).rejects.toThrow(
      'RESPONSE_BUDGET',
    );
  });
  it('retains observed stream usage when DONE is missing', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async (_url, init) =>
        JSON.parse(init!.body as string).stream
          ? new Response(sse('stop', false), { headers: { 'Content-Type': 'text/event-stream' } })
          : new Response('unavailable', { status: 503 }),
      );
    const report = await runAssistantModelProbe(config, fetcher);
    expect(report.attempts.find((a) => a.id === 'stream')).toMatchObject({
      status: 'failed',
      error: 'STREAM_INCOMPLETE',
      actualModel: 'test-model',
      usage: { prompt_tokens: 10, completion_tokens: 2 },
    });
  });
  it('verifies five fixed requests with a synthetic tool result and no tool loop', async () => {
    const tool = {
      id: 'call_test',
      type: 'function' as const,
      function: { name: 'protocol_echo' as const, arguments: '{"value":"BLUE"}' },
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json('OK'))
      .mockResolvedValueOnce(json('BLUE'))
      .mockResolvedValueOnce(
        json(null, {
          finish_reason: 'tool_calls',
          message: { role: 'assistant', content: null, tool_calls: [tool] },
        }),
      )
      .mockResolvedValueOnce(json('TOOL_OK'))
      .mockResolvedValueOnce(
        new Response(sse(), { headers: { 'Content-Type': 'text/event-stream' } }),
      );
    const report = await runAssistantModelProbe(config, fetcher);
    expect(report.passed).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(5);
    const requests = fetcher.mock.calls.map((call) => JSON.parse(call[1]!.body as string));
    expect(requests[1].messages).toHaveLength(4);
    expect(requests[2].tool_choice.function.name).toBe('protocol_echo');
    expect(requests[3].messages[2]).toEqual({
      role: 'tool',
      tool_call_id: 'call_test',
      content: '{"value":"BLUE","result":"TOOL_OK"}',
    });
    expect(requests[3].tools).toBeUndefined();
    expect(requests[4].stream_options.include_usage).toBe(true);
    expect(JSON.stringify(report)).not.toContain('test-secret');
  });
  it('records HTTP failure and skips dependent cases; never leaks upstream error text', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => new Response('secret upstream body', { status: 429 }));
    const report = await runAssistantModelProbe(config, fetcher);
    expect(report.passed).toBe(false);
    expect(report.attempts.map((a) => a.status)).toEqual([
      'failed',
      'skipped',
      'failed',
      'skipped',
      'failed',
    ]);
    expect(report.attempts[0]).toMatchObject({ httpStatus: 429, error: 'HTTP_429', usage: null });
    expect(JSON.stringify(report)).not.toContain('secret');
  });
  it('retains usage on invalid tool arguments and does not send them back', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () =>
      json(null, {
        finish_reason: 'tool_calls',
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'test',
              type: 'function',
              function: {
                name: 'protocol_echo',
                arguments: '{"value":"BLUE","sql":"forbidden"}',
              },
            },
          ],
        },
      }),
    );
    const report = await runAssistantModelProbe(config, fetcher);
    const attempt = report.attempts.find((a) => a.id === 'tool-call');
    expect(attempt).toMatchObject({
      status: 'failed',
      error: 'INVALID_RESPONSE',
      usage: { prompt_tokens: 10, completion_tokens: 2 },
    });
    expect(report.attempts.find((a) => a.id === 'tool-result')?.status).toBe('skipped');
    expect(JSON.stringify(report)).not.toContain('forbidden');
  });
  it('records network failure with a safe cause code', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError('secret', { cause: { code: 'ENOTFOUND' } }));
    const report = await runAssistantModelProbe(config, fetcher);
    expect(report.attempts[0]).toMatchObject({
      error: 'NETWORK_ERROR',
      networkCode: 'ENOTFOUND',
      usage: null,
    });
    expect(JSON.stringify(report)).not.toContain('secret');
  });
});
