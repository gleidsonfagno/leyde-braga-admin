export function selectDatabaseUrl(environment: Record<string, string | undefined> = process.env, direct = false) {
  const keys = direct ? ['DIRECT_URL', 'POSTGRES_URL', 'DATABASE_URL', 'DATABASE_URL_POOLED'] : ['DATABASE_URL_POOLED', 'DATABASE_URL', 'POSTGRES_URL'];
  for (const key of keys) {
    const value = environment[key]?.trim();
    if (value && /^postgres(?:ql)?:\/\//.test(value)) return value;
  }
  return undefined;
}
