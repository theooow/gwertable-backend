export function parseEuros(input: string): number {
  const cleaned = input.replace(/\s/g, "").replace(",", ".");
  const value = parseFloat(cleaned);
  if (Number.isNaN(value)) return 0;
  return Math.round(value * 100);
}
