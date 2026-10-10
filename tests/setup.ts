import { beforeEach } from 'vitest';
import { resetMocks } from '@/lib/adapters/mocks';
import { setAdapters } from '@/lib/adapters';
import { setRepo } from '@/lib/db';
import { createMemoryRepo } from '@/lib/db/memoryRepo';
import { setNow } from '@/lib/clock';

// Values for the always-required env vars. External credentials are not needed under MOCK_EXTERNAL=1.
Object.assign(process.env, {
  MOCK_EXTERNAL: '1',
  VAANI_WEBHOOK_SECRET: 'test-webhook-secret',
  CRON_SECRET: 'test-cron-secret',
  LINK_SIGNING_SECRET: 'test-link-signing-secret-0123456789',
  DASHBOARD_PASSWORD: 'test-dashboard-password',
  APP_BASE_URL: 'http://localhost:3000',
  EMAIL_FROM: 'Aangan Leads <onboarding@resend.dev>',
  FRONT_DESK_EMAIL: 'frontdesk@aangan-studio.test',
  OWNER_EMAIL: 'owner@aangan-studio.test',
  CALCOM_EVENT_TYPE_ID: '1001',
});

beforeEach(() => {
  resetMocks();
  setAdapters(null); // fall back to the shared mocks
  setRepo(createMemoryRepo());
  setNow(null);
});
