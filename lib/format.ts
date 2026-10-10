/** "independent_house" → "independent house" */
export function humanise(v: string | null | undefined): string | null {
  return v ? v.replace(/_/g, ' ') : null;
}
