import { CandidateQueryError } from './candidate-contracts';

// Server-side only: never return this object through an assistant DTO or log it.
// Credentials/base URL may be shared; the image model is deliberately not a fallback.
export function assistantModelConfiguration(
  purpose: 'assistant' | 'relevance' = 'assistant',
  env: Record<string, string | undefined> = process.env,
) {
  const choose = (suffix: 'API_KEY' | 'BASE_URL' | 'MODEL', fallback: string) => {
    const names = [
      ...(purpose === 'relevance' ? [`ASSISTANT_RELEVANCE_${suffix}`] : []),
      `ASSISTANT_${suffix}`,
      ...(suffix !== 'MODEL' ? [`DEEPSEEK_${suffix}`] : []),
    ];
    const source = names.find((name) => env[name]?.trim());
    return { value: source ? env[source]!.trim() : fallback, source: source ?? 'default' };
  };
  const key = choose('API_KEY', '');
  const base = choose('BASE_URL', 'https://api.deepseek.com');
  const model = choose('MODEL', 'deepseek-flash');
  let url: URL;
  try {
    url = new URL(base.value);
  } catch {
    throw new CandidateQueryError('MODEL_NOT_CONFIGURED');
  }
  if (
    !key.value ||
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new CandidateQueryError('MODEL_NOT_CONFIGURED');
  const endpoint = url.toString().replace(/\/+$/, '');
  return {
    apiKey: key.value,
    endpoint,
    model: model.value,
    sources: { apiKey: key.source, endpoint: base.source, model: model.source },
  };
}
