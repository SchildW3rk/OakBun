export function maskData(
  data: Record<string, unknown>,
  maskKeys: string[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  const lowerMask = new Set(maskKeys.map(k => k.toLowerCase()))

  for (const [key, value] of Object.entries(data)) {
    if (lowerMask.has(key.toLowerCase())) {
      result[key] = '***'
    } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = maskData(value as Record<string, unknown>, maskKeys)
    } else {
      result[key] = value
    }
  }
  return result
}
