import 'dotenv/config';
import { defineConfig } from 'prisma/config';
import { selectDatabaseUrl } from './src/lib/database-url';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: selectDatabaseUrl(process.env, true) ?? '' },
});
