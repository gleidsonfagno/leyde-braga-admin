const keys = ['DATABASE_URL', 'DATABASE_URL_POOLED', 'POSTGRES_URL', 'PRISMA_DATABASE_URL', 'DIRECT_URL', 'APP_ORIGIN', 'AUTH_SECRET', 'CORS_ORIGINS'];
console.log(JSON.stringify(keys.map((key) => ({ key, present: Boolean(process.env[key]), protocol: key.includes('URL') && process.env[key] ? process.env[key].split(':')[0] : undefined }))));
