import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { AnthropicProvider } from './anthropic';
import { AiOutputError, AiRefusalError, AiUnavailableError, type StructuredRequest } from './types';

interface Captured {
  headers: IncomingMessage['headers'];
  body: Record<string, unknown>;
}

let server: Server;
let baseURL: string;
let captured: Captured[] = [];
let reply: { status: number; body: unknown } = { status: 200, body: {} };

const message = (text: string, overrides: Record<string, unknown> = {}) => ({
  id: 'msg_test',
  type: 'message',
  role: 'assistant',
  model: 'claude-sonnet-5-5',
  content: [{ type: 'text', text }],
  stop_reason: 'end_turn',
  stop_sequence: null,
  usage: { input_tokens: 1200, output_tokens: 300, cache_read_input_tokens: 900, cache_creation_input_tokens: 0 },
  ...overrides,
});

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      captured.push({ headers: req.headers, body: raw ? (JSON.parse(raw) as Record<string, unknown>) : {} });
      res.writeHead(reply.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(reply.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  captured = [];
});

const schema = z.object({ answer: z.string(), score: z.number() });
const request = (model: string): StructuredRequest<z.infer<typeof schema>> => ({
  task: 'audit.semantic',
  promptId: 'audit.semantic',
  promptVersion: 'test@1',
  model,
  effort: 'medium',
  maxTokens: 2_000,
  system: 'STATIC SYSTEM PROMPT',
  user: 'per-call content',
  schema,
});
const provider = () => new AnthropicProvider({ apiKey: 'test-key', baseURL, maxRetries: 0, timeoutMs: 5_000 });

describe('AnthropicProvider', () => {
  it('sends a cached system prompt, structured output format and effort; returns parsed data and usage', async () => {
    reply = { status: 200, body: message('{"answer":"ok","score":3}') };
    const result = await provider().generateStructured(request('claude-sonnet-5-5'));
    expect(result.data).toEqual({ answer: 'ok', score: 3 });
    expect(result.usage).toEqual({ inputTokens: 1200, outputTokens: 300, cacheReadTokens: 900, cacheWriteTokens: 0 });
    expect(result.servedModel).toBe('claude-sonnet-5-5');

    const { body, headers } = captured[0]!;
    expect(body.model).toBe('claude-sonnet-5-5');
    expect(body.system).toEqual([{ type: 'text', text: 'STATIC SYSTEM PROMPT', cache_control: { type: 'ephemeral' } }]);
    expect(body.messages).toEqual([{ role: 'user', content: 'per-call content' }]);
    const outputConfig = body.output_config as { effort: string; format: { type: string } };
    expect(outputConfig.effort).toBe('medium');
    expect(outputConfig.format.type).toBe('json_schema');
    expect(body.tools).toBeUndefined();
    // Server-side refusal fallback on the Sonnet tier.
    expect(body.fallbacks).toBe('default');
    expect(String(headers['anthropic-beta'])).toContain('server-side-fallback-2026-07-01');
  });

  it('does not request server-side fallbacks on Haiku (unsupported there)', async () => {
    reply = { status: 200, body: message('{"answer":"ok","score":1}', { model: 'claude-haiku-5-5' }) };
    await provider().generateStructured(request('claude-haiku-5-5'));
    expect(captured[0]!.body.fallbacks).toBeUndefined();
    expect(String(captured[0]!.headers['anthropic-beta'] ?? '')).not.toContain('server-side-fallback');
  });

  it('surfaces refusals with their category', async () => {
    reply = { status: 200, body: message('', { content: [], stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'cyber', explanation: 'x' } }) };
    await expect(provider().generateStructured(request('claude-sonnet-5-5'))).rejects.toMatchObject({ name: 'AiRefusalError', category: 'cyber' });
  });

  it('rejects truncated and schema-invalid output', async () => {
    reply = { status: 200, body: message('{"answer":"cut', { stop_reason: 'max_tokens' }) };
    await expect(provider().generateStructured(request('claude-sonnet-5-5'))).rejects.toBeInstanceOf(AiOutputError);
    reply = { status: 200, body: message('{"answer":"ok","score":"three"}') };
    await expect(provider().generateStructured(request('claude-sonnet-5-5'))).rejects.toBeInstanceOf(AiOutputError);
  });

  it('maps API errors to retryable / non-retryable', async () => {
    reply = { status: 429, body: { type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } } };
    await expect(provider().generateStructured(request('claude-sonnet-5-5'))).rejects.toMatchObject({ name: 'AiUnavailableError', retryable: true });
    reply = { status: 401, body: { type: 'error', error: { type: 'authentication_error', message: 'bad key' } } };
    await expect(provider().generateStructured(request('claude-sonnet-5-5'))).rejects.toMatchObject({ name: 'AiUnavailableError', retryable: false });
    reply = { status: 529, body: { type: 'error', error: { type: 'overloaded_error', message: 'busy' } } };
    const error = await provider().generateStructured(request('claude-sonnet-5-5')).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AiUnavailableError);
    expect((error as AiUnavailableError).retryable).toBe(true);
    expect(error).not.toBeInstanceOf(AiRefusalError);
  });
});
