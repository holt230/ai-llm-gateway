// CNY prices displayed at https://codexzh.com/models on 2026-11-19.
// Token price columns are yuan per million. One ledger unit is 10^-10 yuan.
export const PRICE_DATE = '2026-11-19';
export const PRICE_VERSION = `codexzh-cny-${PRICE_DATE}`;
export const YUAN = 10_000_000_000n;
// The order amount is stored in a signed PostgreSQL INTEGER.
export const MAX_TOPUP_FEN = 2_147_483_647;

function tier(input, read, write, output) {
  return { input, read, write, output };
}

const sol = tier(0.5, 0.025, 0.625, 2.5);
const solLong = tier(1, 0.05, 1.25, 3.75);
const astra = tier(2, 0.1, 2.5, 10);
const astraLong = tier(4, 0.2, 5, 15);
const sol6 = tier(0.5, 0.05, 0.625, 2.5);
const sol56 = tier(1, 0.1, 1.25, 5);
const astra6 = tier(2.5, 0.25, 3.13, 12.5);
const grok = tier(0.5, 0.125, null, 1.5);

export const CNY_PRICES = Object.fromEntries(
  [
    [['gpt-6.2-sol', 'cc-gpt-6.2-sol', 'gpt-6.1-sol', 'cc-gpt-6.1-sol'], sol, solLong],
    [['gpt-6.2-astra', 'cc-gpt-6.2-astra'], astra, astraLong],
    [['gpt-6.1-terra'], tier(0.25, 0.0125, 0.3125, 1.25), tier(0.5, 0.025, 0.625, 1.88)],
    [['gpt-6-astra', 'cc-gpt-6-astra'], astra6],
    [['gpt-6-sol'], sol6, tier(1, 0.1, 1.25, 3.75)],
    [['cc-gpt-6-sol'], sol6],
    [['gpt-5.6-sol'], sol56, tier(2, 0.2, 2.5, 7.5)],
    [['cc-gpt-5.6-sol'], sol56],
    [['gpt-5.6-terra'], tier(0.5, 0.05, 0.625, 3), tier(1, 0.1, 1.25, 4.5)],
    [['grok-4.6', 'grok-4.7', 'cc-grok-4.6', 'cc-grok-4.7'], grok],
    [['codex-auto-review'], tier(1.25, 0.125, null, 7.5)]
  ].flatMap(([models, standard, long]) => models.map((id) => [id, { standard, long }]))
);
for (const id of ['gpt-image-2', 'gpt-image-2.5']) CNY_PRICES[id] = { image: 0.125 };

// Reference for the UI comparison only; billing uses CNY_PRICES and runtime overrides.
// OpenAI Standard, short context, USD per million uncached input / output tokens.
export const OPENAI_STANDARD_REFERENCE = Object.freeze({
  checkedOn: '2026-11-20',
  usdCny: 6.7131
});
const OPENAI_STANDARD_USD = {
  'gpt-6-astra': [10, 50],
  'gpt-6-sol': [2, 10],
  'gpt-6.2-sol': [2, 10],
  'gpt-6.2-astra': [8, 40],
  'gpt-6.1-terra': [1, 5],
  'gpt-6.1-sol': [2, 10]
};

export function standardApiDiscount(model, price) {
  if (!Object.hasOwn(OPENAI_STANDARD_USD, model) || !price?.standard) return undefined;
  const [input, output] = OPENAI_STANDARD_USD[model];
  const { usdCny } = OPENAI_STANDARD_REFERENCE;
  const ratios = [price.standard.input / (input * usdCny), price.standard.output / (output * usdCny)];
  if (!ratios.every(ratio => Number.isFinite(ratio) && ratio >= 0 && ratio < 1)) return undefined;
  return { minRatio: Math.min(...ratios), maxRatio: Math.max(...ratios),
    referenceInputCny: input * usdCny, referenceOutputCny: output * usdCny };
}

export function normalizeCnyPrice(value) {
  const isRate = (number) => typeof number === 'number' && Number.isFinite(number) &&
    number >= 0 && number <= 1_000_000 && Number(number.toFixed(4)) === number;
  if (!value || typeof value !== 'object') return null;
  if (Object.hasOwn(value, 'image')) {
    return isRate(value.image) && value.image > 0 ? { image: value.image } : null;
  }
  const normalizeTier = (tier) => {
    if (!tier || ![tier.input, tier.read, tier.output].every(isRate) ||
        !(tier.write === null || isRate(tier.write))) return null;
    return { input: tier.input, read: tier.read, write: tier.write, output: tier.output };
  };
  const standard = normalizeTier(value.standard);
  const long = value.long === undefined ? undefined : normalizeTier(value.long);
  return standard && long !== null ? { standard, ...(long && { long }) } : null;
}

export function yuanString(units) {
  const n = BigInt(units);
  return (
    (n / YUAN).toString() +
    '.' +
    (n % YUAN)
      .toString()
      .padStart(10, '0')
      .replace(/0{1,8}$/, '')
  );
}

export function parseYuan(value, digits = 2) {
  if (typeof value !== 'string' || !/^\d{1,8}(\.\d{1,10})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > digits) return null;
  return BigInt(whole + fraction.padEnd(10, '0'));
}

const LONG_INPUT_TOKENS = 272_000;
const costAtRate = (count, rate) => BigInt(count) * BigInt(Math.round(rate * 10000));

// Estimate admission using the most expensive applicable input category, including cache writes.
export function prepaidBudget(price, inputTokens, outputTokens) {
  if (price.image) return usageCharge(price, null, 1);
  const tiers = inputTokens > LONG_INPUT_TOKENS && price.long ? [price.standard, price.long] : [price.standard];
  return tiers.reduce((upper, rates) => {
    const bound = costAtRate(inputTokens, Math.max(rates.input, rates.read, rates.write ?? 0)) + costAtRate(outputTokens, rates.output);
    return bound > upper ? bound : upper;
  }, 0n);
}

export function usageCharge(price, usage, imageCount) {
  if (price.image) {
    return Number.isSafeInteger(imageCount) && imageCount > 0
      ? BigInt(Math.round(price.image * 10000)) * 1_000_000n
      : null;
  }
  if (!usage) return null;
  const { inputTokens: input, outputTokens: output, cacheReadTokens: read = 0, cacheWriteTokens: write = 0 } = usage;
  if (![input, output, read, write].every((n) => Number.isSafeInteger(n) && n >= 0) || read + write > input)
    return null;
  const rates = input > LONG_INPUT_TOKENS && price.long ? price.long : price.standard;
  if (write && rates.write === null) return null;
  return (
    costAtRate(input - read - write, rates.input) +
    costAtRate(read, rates.read) +
    costAtRate(write, rates.write || 0) +
    costAtRate(output, rates.output)
  );
}
