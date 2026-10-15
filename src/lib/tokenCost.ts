import { encoding_for_model, TiktokenModel } from 'tiktoken';

/**
 * Cost per 1,000 tokens in USD (based on standard provider pricing).
 * Sub-cent precision ($0.00015) is preserved for accurate accumulation.
 */
export const MODEL_INPUT_COST_PER_1K: Record<string, number> = {
    'gpt-4o': 0.005,    // $5.00 / 1M tokens
    'gpt-4o-mini': 0.00015,  // $0.15 / 1M tokens
    'claude-sonnet-4-6': 0.003,    // $3.00 / 1M tokens
    'claude-opus-4-6': 0.015,    // $15.00 / 1M tokens
    'claude-opus-4-8': 0.015     // $15.00 / 1M tokens
};

export const MODEL_OUTPUT_COST_PER_1K: Record<string, number> = {
    'gpt-4o': 0.015,    // $15.00 / 1M tokens
    'gpt-4o-mini': 0.0006,   // $0.60 / 1M tokens
    'claude-sonnet-4-6': 0.015,    // $15.00 / 1M tokens
    'claude-opus-4-6': 0.075,    // $75.00 / 1M tokens
    'claude-opus-4-8': 0.075     // $75.00 / 1M tokens
};

export const DAILY_BUDGET_BY_TIER: Record<string, number> = {
    free: 0.10,   // $0.10/day (limits costly models while allowing mini exploration)
    pro: 5.00,   // $5.00/day
    enterprise: 100.00  // $100.00/day
};

/**
 * Estimates input cost prior to dispatching the request to the LLM provider.
 * Uses exact byte-pair encoding (BPE) for OpenAI models and a character fallback for others.
 */
export function estimateInputCost(model: string, messages: Array<{ role?: string; content?: string }>): number {
    try {
        const enc = encoding_for_model(model as TiktokenModel);
        try {
            // 4 tokens overhead per message for <|im_start|>{role}\n{content}<|im_end|>\n
            const tokens = messages.reduce((sum, m) => sum + enc.encode(m.content ?? '').length + 4, 0);
            const costPer1k = MODEL_INPUT_COST_PER_1K[model] ?? 0.005;
            return (tokens / 1000) * costPer1k;
        } finally {
            // CRITICAL: Frees WASM linear memory from Rust heap to avoid 1-4MB leak per 1k calls
            enc.free();
        }
    } catch {
        // Fallback for non-OpenAI models (e.g. Anthropic Claude) or unrecognized model tags
        const totalChars = messages.reduce((s, m) => s + (m.content?.length ?? 0), 0);
        const costPer1k = MODEL_INPUT_COST_PER_1K[model] ?? 0.005;
        const estimatedTokens = Math.ceil(totalChars / 4);
        return (estimatedTokens / 1000) * costPer1k;
    }
}

/**
 * Calculates actual cost incurred given exact input and output token counts.
 * Used for post-call reconciliation in the controller.
 */
export function calculateActualCost(model: string, inputTokens: number, outputTokens: number): number {
    const inputRate = MODEL_INPUT_COST_PER_1K[model] ?? 0.005;
    const outputRate = MODEL_OUTPUT_COST_PER_1K[model] ?? 0.015;

    return ((inputTokens / 1000) * inputRate) + ((outputTokens / 1000) * outputRate);
}

/**
 * Accurately counts tokens for a text string using tiktoken with safe WASM memory cleanup.
 */
export function countTokens(model: string, text: string): number {
    if (!text) return 0;
    try {
        const enc = encoding_for_model(model as TiktokenModel);
        try {
            return enc.encode(text).length;
        } finally {
            enc.free();
        }
    } catch {
        return Math.ceil(text.length / 4);
    }
}

