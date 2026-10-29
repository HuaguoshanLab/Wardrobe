/** Only known in-app management routes can become a detail's return destination. */
function field(state: unknown, key: string) {
  if (!state || typeof state !== 'object' || !(key in state)) return null
  const value = (state as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : null
}

export function seasonalReturn(state: unknown) {
  const value = field(state, 'seasonalReturn')
  return value && /^\/wardrobe\/seasonal\/[0-9a-f-]{36}(?:[?#].*)?$/i.test(value) ? value : null
}

export function garmentReturn(state: unknown) {
  const seasonal = seasonalReturn(state)
  if (seasonal) return { to: seasonal, label: '返回本轮整理' }
  for (const [key, prefix, label] of [
    ['inventoryReturn', '/wardrobe/inventory', '返回盘点'],
    ['organizationReturn', '/wardrobe/organization', '返回整理清单'],
  ]) {
    const value = field(state, key)
    if (value?.startsWith(prefix)) return { to: value, label }
  }
  const search = field(state, 'wardrobeSearch')
  return { to: search ? `/wardrobe?${search}` : '/wardrobe', label: '返回衣橱' }
}
